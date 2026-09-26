use crate::{sql::{ident, literal, predicate}, *};
use calamine::{open_workbook_auto, Reader, Data, DataType};
use duckdb::{Connection, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{collections::{BTreeMap, HashSet}, fs::{self, File}, io::{Read, Seek, SeekFrom, Write}, path::{Path,PathBuf}, time::UNIX_EPOCH};
#[path="derived.rs"] pub mod derived;
use derived::DerivedDefinition;
#[path="sampling.rs"] mod sampling;
use sampling::AnalysisCache;
#[path="csv.rs"] mod csv;
use csv::exact_csv_relation;
use std::cell::RefCell;
#[path="remote.rs"] mod remote;

const MAX_PAGE: u32 = 10_000;
const MAX_DISTRIBUTION_COLUMNS: usize = 64;
const CSV_IMPORT_VERSION: &str = "3";
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct SourceSignature { path: String, bytes: u64, modified_ns: u128, sample_hash: String, sheet: Option<String>, #[serde(default, skip_serializing_if="Option::is_none")] remote: Option<remote::RemoteIdentity> }
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase")]
struct ProjectFile { format_version: u32, dataset_id: String, source: SourceSignature, columns: Vec<Column>, #[serde(default)] view: Value, #[serde(default)] enrichments: Value, #[serde(default)] saved_at_ns: u128, #[serde(default)] column_types: BTreeMap<String,VariableKind>, #[serde(default)] type_revision: u64, #[serde(default)] derived_columns:Vec<DerivedDefinition>, #[serde(default)] result_columns:Vec<Column>, #[serde(default,skip_serializing_if="Option::is_none")] portable_hash:Option<String>, #[serde(default,skip_serializing_if="Option::is_none")] results_file:Option<String>, #[serde(default,skip_serializing_if="Option::is_none")] revision_id:Option<String>, #[serde(default,skip_serializing_if="Option::is_none")] parent_revision:Option<String>, #[serde(default,skip_serializing_if="Vec::is_empty")] resolved_revisions:Vec<String> }
/// One dataset and its local project database. `Connection` is Send (not Sync).
/// Use a host-owned Mutex and spawn_blocking; do not hold this on the UI thread.
pub struct DataStore {
    conn: Connection,
    dataset: Dataset,
    source: SourceSignature,
    source_columns: Vec<Column>,
    result_columns: Vec<Column>,
    derived_columns: Vec<DerivedDefinition>,
    rid: String,
    project_path: PathBuf,
    legacy_project_path: PathBuf,
    pending_project_path: PathBuf,
    database_path: PathBuf,
    base_revision: String,
    type_revision: u64,
    analysis_cache: RefCell<AnalysisCache>,
    portable_hash_cache: RefCell<Option<String>>,
    known_project_revision: RefCell<Option<String>>,
    known_primary_revision: RefCell<Option<String>>,
    remote: Option<remote::RemoteSource>,
}
impl DataStore {
    pub fn list_sheets(path: &Path) -> Result<Vec<String>> {
        let workbook = open_workbook_auto(path).map_err(|e| Error::Spreadsheet(e.to_string()))?;
        Ok(workbook.sheet_names())
    }
    /// CSV/XLSX/SAV imports are transactional and disk-backed. Parquet remains a file scan.
    /// Databases stay in writable application data; view/definitions live beside the source.
    pub fn open(path: &Path, sheet: Option<&str>, storage_dir: &Path) -> Result<Self> {
        Self::open_with_progress(path, sheet, storage_dir, &|_| {})
    }
    pub fn open_with_progress(path: &Path, sheet: Option<&str>, storage_dir: &Path, progress: &dyn Fn(&str)) -> Result<Self> {
        progress("inspect");
        let path = fs::canonicalize(path)?;
        let ext = path.extension().and_then(|s|s.to_str()).unwrap_or("").to_ascii_lowercase();
        if !["csv","xlsx","parquet","sav"].contains(&ext.as_str()) { return Err(Error::Invalid("Supported formats: CSV, XLSX, Parquet, SAV".into())); }
        let sheet = if ext=="xlsx" { Some(match sheet { Some(s)=>s.to_string(),None=>Self::list_sheets(&path)?.into_iter().next().ok_or_else(||Error::Invalid("Workbook has no sheets".into()))? }) } else { None };
        let source = signature(&path,sheet.clone())?;
        let revision = hash(&serde_json::to_vec(&source)?);
        let id = format!("ds_{}",&revision[..24]);
        fs::create_dir_all(storage_dir)?;
        let database_path = storage_dir.join(format!("{id}.duckdb"));
        let legacy_project_path = storage_dir.join(format!("{id}.datolens.json"));
        let pending_project_path = storage_dir.join(format!("{id}.pending.datolens.json"));
        let project_path = project_sidecar_path(&path, sheet.as_deref());
        let conn = Connection::open(&database_path)?;
        // Native spilling, bounded execution, no runtime downloads/extensions.
        conn.execute_batch("SET memory_limit='512MB'; SET threads=2; SET preserve_insertion_order=true; SET autoinstall_known_extensions=false; SET autoload_known_extensions=false;")?;
        let spill = storage_dir.join(format!("{id}.spill"));
        conn.execute_batch(&format!("SET temp_directory={}",literal(&spill.to_string_lossy())))?;
        conn.execute_batch("CREATE TABLE IF NOT EXISTS dl_meta (key VARCHAR PRIMARY KEY, value VARCHAR NOT NULL); CREATE TABLE IF NOT EXISTS dl_columns (id VARCHAR PRIMARY KEY, definition VARCHAR NOT NULL); CREATE TABLE IF NOT EXISTS dl_results (rid UBIGINT, col VARCHAR, value VARCHAR NOT NULL, PRIMARY KEY (rid,col));")?;
        let rid = format!("__dl_{}_row",&revision[..12]);
        let existing: Option<String> = conn.query_row("SELECT value FROM dl_meta WHERE key='source_columns'",[],|r|r.get(0)).ok();
        let csv_version: Option<String> = conn.query_row("SELECT value FROM dl_meta WHERE key='csv_import_version'",[],|r|r.get(0)).ok();
        let reimport_csv = ext=="csv" && csv_version.as_deref()!=Some(CSV_IMPORT_VERSION);
        let source_columns: Vec<Column>;
        if existing.is_some() && !reimport_csv { source_columns=serde_json::from_str(existing.as_ref().unwrap())?; }
        else {
            progress("import");
            conn.execute_batch("BEGIN TRANSACTION")?;
            let imported = (|| -> Result<Vec<Column>> {
                let relation = match ext.as_str() {
                    "parquet" => format!("read_parquet({})",literal(&path.to_string_lossy())),
                    "csv" => {
                        let (relation,protected)=exact_csv_relation(&conn,&path)?;
                        if protected {conn.execute_batch("INSERT OR REPLACE INTO dl_meta VALUES ('csv_exact_integers','1')")?;}
                        relation
                    },
                    "sav" => {
                        crate::sav::import_sav(&conn,&path)?;
                        "dl_sav".into()
                    },
                    _ => {
                        import_xlsx(&conn,&path,sheet.as_deref().unwrap())?;
                        "dl_xlsx".into()
                    }
                };
                // Materialize CSV once, with whole-file inference, before profiling strings.
                // Otherwise each string-profile query would repeat the full CSV type sniff.
                let columns = if ext!="parquet" {
                    // Replace only the regenerable source table inside this transaction.
                    // Stable ordinals, results, definitions and the project view survive.
                    if reimport_csv {conn.execute_batch("DROP TABLE IF EXISTS dl_source")?;}
                    conn.execute_batch(&format!("CREATE TABLE dl_source AS SELECT (row_number() OVER ()-1)::UBIGINT AS {}, * FROM {relation}",ident(&rid)))?;
                    if ext=="xlsx" { conn.execute_batch("DROP TABLE dl_xlsx")?; }
                    if ext=="sav" { conn.execute_batch("DROP TABLE dl_sav")?; }
                    let mut columns=describe(&conn,&format!("(SELECT * EXCLUDE ({}) FROM dl_source)",ident(&rid)))?;
                    if ext=="sav" { crate::sav::decorate_columns(&conn,&mut columns)?; }
                    columns
                } else {describe(&conn,&relation)?};
                if columns.iter().any(|c|c.id==rid || (ext=="parquet" && c.id=="file_row_number")) { return Err(Error::Invalid("Source column conflicts with reserved row identity".into())); }
                if signature(&path,sheet.clone())?!=source {return Err(Error::SourceChanged);}
                if let Some(old)=&existing {
                    // Retain the old schema so project JSON migration can resume if the
                    // process exits after DB commit and before its atomic JSON write.
                    conn.execute("INSERT OR REPLACE INTO dl_meta VALUES ('previous_source_columns',?)",params![old])?;
                }
                conn.execute("INSERT OR REPLACE INTO dl_meta VALUES ('source_columns',?)",params![serde_json::to_string(&columns)?])?;
                if ext=="csv" {conn.execute("INSERT OR REPLACE INTO dl_meta VALUES ('csv_import_version',?)",params![CSV_IMPORT_VERSION])?;}
                Ok(columns)
            })();
            match imported { Ok(c)=>{conn.execute_batch("COMMIT")?;source_columns=c;}, Err(e)=>{let _=conn.execute_batch("ROLLBACK");return Err(e);} }
        }
        progress("prepare");
        if signature(&path,sheet.clone())?!=source { return Err(Error::SourceChanged); }
        if ext=="parquet" {
            let projection=source_columns.iter().map(|c|ident(&c.id)).collect::<Vec<_>>().join(",");
            conn.execute_batch(&format!("CREATE TEMP VIEW dl_base AS SELECT file_row_number AS {}, {projection} FROM read_parquet({}, file_row_number=true)",ident(&rid),literal(&path.to_string_lossy())))?;
        } else { conn.execute_batch("CREATE TEMP VIEW dl_base AS SELECT * FROM dl_source")?; }
        let row_count: u64 = conn.query_row("SELECT COUNT(*) FROM dl_base",[],|r|r.get(0))?;
        let result_columns = {
            let mut stmt=conn.prepare("SELECT definition FROM dl_columns ORDER BY id")?;
            let defs=stmt.query_map([],|r|r.get::<_,String>(0))?.collect::<std::result::Result<Vec<_>,_>>()?;
            defs.iter().map(|s|serde_json::from_str(s)).collect::<std::result::Result<Vec<Column>,_>>()?
        };
        let mut columns=source_columns.clone();columns.extend(result_columns.clone());
        // Corrected input semantics invalidate frozen enrichment plans/fingerprints,
        // while keeping dataset/row IDs and all saved results/history intact.
        let protected: bool=conn.query_row("SELECT count(*)>0 FROM dl_meta WHERE key='csv_exact_integers' AND value='1'",[],|r|r.get(0))?;
        let revision=if protected {hash(format!("{revision}:csv-exact-integers-v2").as_bytes())}else{revision};
        let base_revision=revision.clone();
        let dataset=Dataset { id, name:path.file_name().unwrap_or_default().to_string_lossy().into(), source_path:path.to_string_lossy().into(), sheet, columns, row_count:Some(row_count),revision,type_overrides:BTreeMap::new() };
        let mut store=Self{conn,dataset,source,source_columns,result_columns,derived_columns:vec![],rid,project_path,legacy_project_path,pending_project_path,database_path,base_revision,type_revision:0,analysis_cache:RefCell::default(),portable_hash_cache:RefCell::default(),known_project_revision:RefCell::default(),known_primary_revision:RefCell::default(),remote:None};
        store.migrate_project_columns()?;
        store.refresh_view()?;
        *store.known_primary_revision.borrow_mut()=store.read_project_file(store.read_project_path())?.and_then(|p|p.revision_id);
        if let Some(project)=store.read_project()? {
            *store.known_project_revision.borrow_mut()=project.revision_id.clone();
            if project.derived_columns.len()>128 || project.result_columns.len()>1000 {return Err(Error::Invalid("Demasiadas columnas guardadas.".into()));}
            // Restore result schema before formulas bind to it. Values remain in
            // the native results store; in a fresh cache they correctly start NULL.
            for column in project.result_columns {store.ensure_result_column(column)?;}
            // Result definitions may be restored by the host after source opening.
            // Keep their overrides pending until ensure_result_column registers them.
            store.dataset.type_overrides=project.column_types;
            store.type_revision=project.type_revision;
            store.derived_columns=project.derived_columns;
            store.refresh_types()?;
            store.restore_portable_results(project.results_file.as_deref())?;
        }
        Ok(store)
    }
    pub fn dataset(&self) -> Dataset { self.dataset.clone() }
    pub fn database_path(&self) -> &Path { &self.database_path }
    pub fn project_path(&self) -> &Path { &self.project_path }
    pub fn source_bytes(&self) -> u64 { self.source.bytes }
    pub fn is_remote(&self) -> bool { self.remote.is_some() }
    pub fn check_source(&self) -> Result<()> {
        if let Some(remote)=&self.remote { return remote.check(); }
        if signature(Path::new(&self.source.path),self.source.sheet.clone())? != self.source { return Err(Error::SourceChanged); } Ok(())
    }
    fn portable_hash(&self)->Result<String> {
        if let Some(cached)=self.portable_hash_cache.borrow().as_ref(){return Ok(cached.clone());}
        self.check_source()?;
        let value=file_hash(Path::new(&self.source.path))?;
        self.check_source()?;
        *self.portable_hash_cache.borrow_mut()=Some(value.clone());
        Ok(value)
    }
    fn column(&self,id:&str)->Result<&Column> { self.dataset.columns.iter().find(|c|c.id==id).ok_or_else(||Error::Invalid(format!("Unknown column: {id}"))) }
    fn projection(&self,columns:&[String])->Result<Vec<Column>> {
        let mut seen=HashSet::new();
        columns.iter().map(|id| { if !seen.insert(id) {return Err(Error::Invalid(format!("Duplicate column: {id}")));} Ok(self.column(id)?.clone()) }).collect()
    }
    fn where_sql(&self,filters:&[Filter])->Result<String> {
        let mut parts=vec![];
        for filter in filters { self.column(filter.column())?; let mut normalized=filter.clone();
            if let Filter::Multivalued{list_encoded,..}=&mut normalized {if self.column(filter.column())?.data_type=="VARCHAR" {*list_encoded=true;}}
            if let Some(p)=predicate(&normalized)? {parts.push(format!("({p})"));} }
        Ok(if parts.is_empty(){"TRUE".into()}else{parts.join(" AND ")})
    }
    fn order_sql(&self,sorting:&[SortRule])->Result<String> {
        let mut parts=Vec::new();
        for sort in sorting { self.column(&sort.id)?; parts.push(format!("{} {} NULLS LAST",ident(&sort.id),if sort.desc{"DESC"}else{"ASC"})); }
        parts.push(format!("{} ASC",ident(&self.rid)));Ok(parts.join(","))
    }
    fn count(&self,where_sql:&str)->Result<u64> {
        if where_sql == "TRUE" { return Ok(self.dataset.row_count.unwrap_or(0)); }
        if let Some((_, count)) = self.analysis_cache.borrow().exact_counts.iter().find(|(key, _)| key == where_sql) { return Ok(*count); }
        let count = self.conn.query_row(&format!("SELECT COUNT(*) FROM dl_data WHERE {where_sql}"), [], |r| r.get(0))?;
        let mut cache = self.analysis_cache.borrow_mut();
        if cache.exact_counts.len() >= 16 { cache.exact_counts.pop_front(); }
        cache.exact_counts.push_back((where_sql.into(), count));
        Ok(count)
    }
    pub fn query_page(&self,request:PageRequest)->Result<Page> {
        self.check_source()?;
        if request.dataset_id!=self.dataset.id {return Err(Error::Invalid("Dataset identity mismatch".into()));}
        if request.limit>MAX_PAGE {return Err(Error::Invalid(format!("Page limit exceeds {MAX_PAGE}")));}
        let columns=self.projection(&request.columns)?;
        let predicate=self.where_sql(&request.filters)?;
        let order=self.order_sql(&request.sorting)?;
        let fields=columns.iter().map(cell_expr).collect::<Vec<_>>();
        // Unfiltered ordinals are contiguous. Prune to this page before sorting
        // wide rows, instead of running TOP_N over the entire dataset each time.
        let ordinal_page=request.filters.is_empty() && request.sorting.is_empty();
        let scan=if ordinal_page {format!("{} >= {} AND {} < {}",ident(&self.rid),request.offset,ident(&self.rid),request.offset.saturating_add(request.limit as u64))}else{predicate.clone()};
        let sql=format!("SELECT {}{} FROM dl_data WHERE {scan} ORDER BY {order} LIMIT {} OFFSET {}",ident(&self.rid),if fields.is_empty(){String::new()}else{format!(",{}",fields.join(","))},request.limit,if ordinal_page{0}else{request.offset});
        let mut stmt=self.conn.prepare(&sql)?;
        let mut cursor=stmt.query([])?;
        let mut rows=Vec::new();
        while let Some(row)=cursor.next()? {
            let ordinal:u64=row.get(0)?;
            let mut values=BTreeMap::new();
            for (i,col) in columns.iter().enumerate() { let raw:Option<String>=row.get(i+1)?; values.insert(col.id.clone(),parse_cell(raw,col)?); }
            rows.push(Row{id:format!("{}:{ordinal}",self.dataset.id),values});
        }
        Ok(Page{rows,filtered_count:Some(self.count(&predicate)?),dataset_revision:self.dataset.revision.clone()})
    }
    pub fn query_plot(&self,request:crate::plots::PlotQuery)->Result<crate::plots::PlotResult> {
        self.check_source()?;
        let predicate=self.where_sql(&request.filters)?;
        let result=crate::plots::query(&self.conn,&self.dataset,&predicate,&self.rid,request)?;
        self.check_source()?;
        Ok(result)
    }
    pub fn row_ids(&self,filters:&[Filter],offset:u64,limit:u32)->Result<Vec<String>> {
        Ok(self.query_page(PageRequest{dataset_id:self.dataset.id.clone(),columns:vec![],filters:filters.to_vec(),sorting:vec![],offset,limit})?.rows.into_iter().map(|r|r.id).collect())
    }
    fn ordinal(&self,row_id:&str)->Result<u64> {
        let prefix=format!("{}:",self.dataset.id);
        let n=row_id.strip_prefix(&prefix).and_then(|s|s.parse::<u64>().ok()).ok_or_else(||Error::Invalid("Invalid row identity".into()))?;
        if n>=self.dataset.row_count.unwrap_or(0) {return Err(Error::Invalid("Row does not exist".into()));} Ok(n)
    }
    pub fn row_values(&self,row_id:&str,columns:&[String])->Result<BTreeMap<String,Value>> {
        self.check_source()?;
        let n=self.ordinal(row_id)?;
        let cols=self.projection(columns)?;
        if cols.is_empty() {return Ok(BTreeMap::new());}
        let fields=cols.iter().map(cell_expr).collect::<Vec<_>>().join(",");
        let mut stmt=self.conn.prepare(&format!("SELECT {fields} FROM dl_data WHERE {}={n}",ident(&self.rid)))?;
        let mut cursor=stmt.query([])?;
        let row=cursor.next()?.ok_or_else(||Error::Invalid("Row does not exist".into()))?;
        let mut values=BTreeMap::new();
        for (i,c) in cols.iter().enumerate(){values.insert(c.id.clone(),parse_cell(row.get(i)?,c)?);}
        Ok(values)
    }
    pub fn ensure_result_column(&mut self,mut column:Column)->Result<()> {
        if self.source_columns.iter().any(|c|c.id.eq_ignore_ascii_case(&column.id)) || self.derived_columns.iter().any(|c|c.id.eq_ignore_ascii_case(&column.id)) || column.id.eq_ignore_ascii_case(&self.rid) {return Err(Error::Invalid("Cannot replace source or calculated column".into()));}
        column.data_type=kind_type(&column.kind).into();
        if let Some(old)=self.result_columns.iter().find(|c|c.id.eq_ignore_ascii_case(&column.id)) {if old!=&column{return Err(Error::Invalid("Result column definition changed; use a new column ID".into()));} return Ok(());}
        if column.id.is_empty() {return Err(Error::Invalid("Column ID cannot be empty".into()));}
        self.conn.execute("INSERT INTO dl_columns VALUES (?,?)",params![column.id,serde_json::to_string(&column)?])?;
        self.result_columns.push(column.clone());self.dataset.columns.push(column);
        self.refresh_view()?;
        self.refresh_types()
    }
    pub fn apply_results(&self,updates:&[CellUpdate])->Result<()> {
        self.check_source()?;
        let mut parsed=Vec::new();
        for u in updates {
            if u.expected_dataset_revision!=self.dataset.revision {return Err(Error::SourceChanged);}
            if !self.result_columns.iter().any(|c|c.id==u.column_id) {return Err(Error::Invalid("Result column must be registered".into()));}
            let col=self.result_columns.iter().find(|c|c.id==u.column_id).ok_or_else(||Error::Invalid("Unknown result column".into()))?;
            validate_result(&u.value,&col.kind)?;
            if col.kind==VariableKind::Date && !u.value.is_null() {
                let valid:bool=self.conn.query_row("SELECT TRY_CAST(? AS TIMESTAMP) IS NOT NULL",params![u.value.as_str().unwrap()],|r|r.get(0))?;
                if !valid {return Err(Error::Invalid("Invalid date result".into()));}
            }
            parsed.push((self.ordinal(&u.row_id)?,u));
        }
        self.conn.execute_batch("BEGIN TRANSACTION")?;
        let result=(|| -> Result<()> {
            let mut stmt=self.conn.prepare("INSERT INTO dl_results VALUES (?,?,?) ON CONFLICT (rid,col) DO UPDATE SET value=excluded.value")?;
            for (n,u) in parsed {stmt.execute(params![n,u.column_id,serde_json::to_string(&u.value)?])?;}
            // Invalidate persisted analysis in the same transaction as its inputs.
            self.conn.execute("DELETE FROM dl_meta WHERE key='analysis_sample'", [])?;
            Ok(())
        })();
        match result { Ok(())=>{self.conn.execute_batch("COMMIT")?;self.analysis_cache.replace(AnalysisCache::default());Ok(())},Err(e)=>{let _=self.conn.execute_batch("ROLLBACK");Err(e)} }
    }
    fn refresh_view(&self)->Result<Vec<Column>> {
        self.analysis_cache.replace(AnalysisCache::default());
        let mut fields=vec!["b.*".to_string()];
        for col in &self.result_columns {
            let raw=format!("(SELECT r.value FROM dl_results r WHERE r.rid=b.{} AND r.col={})",ident(&self.rid),literal(&col.id));
            let expr=match col.kind {VariableKind::Multivalued=>format!("TRY_CAST(json_extract({raw}, '$') AS VARCHAR[])"),_=>format!("TRY_CAST(json_extract_string({raw}, '$') AS {})",kind_type(&col.kind))};
            fields.push(format!("{expr} AS {}",ident(&col.id)));
        }
        self.conn.execute_batch(&format!("CREATE OR REPLACE TEMP VIEW dl_raw AS SELECT {} FROM dl_base b",fields.join(",")))?;
        let mut fields=vec![ident(&self.rid)];
        for column in self.source_columns.iter().chain(&self.result_columns) {
            let expr=self.cast_expression(column,self.dataset.type_overrides.get(&column.id))?.0;
            fields.push(format!("{expr} AS {}",ident(&column.id)));
        }
        self.conn.execute_batch(&format!("CREATE OR REPLACE TEMP VIEW dl_typed AS SELECT {} FROM dl_raw",fields.join(",")))?;
        self.refresh_derived_view()
    }
    pub fn save_view(&self,view:Value)->Result<ViewSaveResult> {
        self.check_source()?;self.validate_view(&view)?;
        let enrichments=self.read_project()?.map(|p|p.enrichments).unwrap_or_else(||json!([]));
        let p=ProjectFile{format_version:1,dataset_id:self.dataset.id.clone(),source:self.source.clone(),columns:self.source_columns.clone(),view,enrichments,saved_at_ns:0,column_types:self.dataset.type_overrides.clone(),type_revision:self.type_revision,derived_columns:self.derived_columns.clone(),result_columns:self.result_columns.clone(),portable_hash:None,results_file:None,revision_id:None,parent_revision:None,resolved_revisions:vec![]};
        self.write_project(p)
    }
    pub fn load_view(&self)->Result<Option<Value>> {
        let Some(p)=self.read_project()? else{return Ok(None)};
        if p.view.is_null(){return Ok(None);}
        self.validate_view(&p.view)?;Ok(Some(p.view))
    }
    /// Convert a projection over the original values; never ALTER the source table.
    fn cast_expression(&self,column:&Column,kind:Option<&VariableKind>)->Result<(String,String)> {
        self.cast_expression_from(column,kind,"dl_raw")
    }
    fn cast_expression_from(&self,column:&Column,kind:Option<&VariableKind>,relation:&str)->Result<(String,String)> {
        let field=ident(&column.id);
        let Some(kind)=kind else {return Ok((field,column.data_type.clone()));};
        if kind==&column.kind && matches!(kind,VariableKind::Numeric|VariableKind::Date|VariableKind::Boolean) {
            return Ok((field,column.data_type.clone()));
        }
        let text=format!("trim(CAST({field} AS VARCHAR))");
        let data_type=if *kind==VariableKind::Numeric {
            // Integer tokens stay integers, including IDs larger than JS's safe range.
            let fractional:u64=self.conn.query_row(&format!("SELECT count(*) FROM {relation} WHERE TRY_CAST({text} AS DOUBLE) IS NOT NULL AND NOT regexp_full_match({text}, '[+-]?[0-9]+')"),[],|r|r.get(0))?;
            if fractional==0 {
                let big:u64=self.conn.query_row(&format!("SELECT count(*) FROM {relation} WHERE regexp_full_match({text}, '[+-]?[0-9]+') AND TRY_CAST({text} AS BIGINT) IS NULL"),[],|r|r.get(0))?;
                // Parquet exports HUGEINT as floating point. DECIMAL keeps large
                // integer tokens exact across IPC AND a native export/reopen.
                if big>0 {"DECIMAL(38,0)"} else {"BIGINT"}
            } else {
                let unsafe_integers:u64=self.conn.query_row(&format!("SELECT count(*) FROM {relation} WHERE regexp_full_match({text}, '[+-]?[0-9]+') AND (TRY_CAST({text} AS HUGEINT) IS NULL OR TRY_CAST({text} AS HUGEINT) NOT BETWEEN -9007199254740991 AND 9007199254740991)"),[],|r|r.get(0))?;
                if unsafe_integers>0 {return Err(Error::Invalid("Convertir esta mezcla de decimales e identificadores grandes a Número perdería precisión. Conserva Texto o Categoría.".into()));}
                "DOUBLE"
            }
        } else {kind_type(kind)};
        let expr=if matches!(kind,VariableKind::Text|VariableKind::Categorical) {
            format!("CAST({field} AS VARCHAR)")
        } else {
            let cast=format!("TRY_CAST({text} AS {data_type})");
            if *kind==VariableKind::Numeric {format!("CASE WHEN isfinite({cast}) THEN {cast} ELSE NULL END")}
            else if *kind==VariableKind::Multivalued {format!("list_transform({cast}, x -> trim(x))")}
            else {cast}
        };
        Ok((expr,data_type.into()))
    }
    fn refresh_types(&mut self)->Result<()> {
        let mut columns=Vec::new();
        for original in self.source_columns.iter().chain(&self.result_columns) {
            let mut column=original.clone();
            if let Some(kind)=self.dataset.type_overrides.get(&column.id) {
                column.data_type=self.cast_expression(original,Some(kind))?.1;
                column.kind=kind.clone();
            }
            columns.push(column);
        }
        self.dataset.columns=columns;
        self.dataset.revision=if self.type_revision==0 {self.base_revision.clone()} else {
            hash(format!("{}:types:{}:{}",self.base_revision,self.type_revision,serde_json::to_string(&self.dataset.type_overrides)?).as_bytes())
        };
        let derived=self.refresh_view()?;
        self.dataset.columns.extend(derived);
        Ok(())
    }
    pub fn preview_cast(&self,column:&str,kind:Option<&VariableKind>)->Result<CastPreview> {
        self.check_source()?;
        let (original,relation)=if let Some((index,formula))=self.derived_columns.iter().enumerate().find(|(_,f)|f.id==column) {
            let input=if index==0 {"dl_typed".into()}else{format!("dl_formula_{}",index-1)};
            (self.derived_column(formula,&input)?,format!("dl_formula_raw_{index}"))
        }else{(self.source_columns.iter().chain(&self.result_columns).find(|c|c.id==column).ok_or_else(||Error::Invalid("Unknown column".into()))?.clone(),"dl_raw".into())};
        let (expr,physical_type)=self.cast_expression_from(&original,kind,&relation)?;
        let field=ident(column);
        let (non_null_count,invalid_count)=self.conn.query_row(&format!("SELECT count({field}), count(*) FILTER (WHERE {field} IS NOT NULL AND ({expr}) IS NULL) FROM {relation}"),[],|r|Ok((r.get::<_,u64>(0)?,r.get::<_,u64>(1)?)))?;
        Ok(CastPreview{dataset_revision:self.dataset.revision.clone(),invalid_count,non_null_count,physical_type})
    }
    pub fn cast_column(&mut self,column:&str,kind:Option<VariableKind>,expected_revision:&str)->Result<CastResult> {
        if expected_revision!=self.dataset.revision {return Err(Error::Invalid("La vista previa de conversión ha caducado. Vuelve a elegir el tipo.".into()));}
        self.preview_cast(column,kind.as_ref())?;
        let old_dataset=self.dataset.clone();let old_revision=self.type_revision;
        let previous=self.read_project()?;
        let result=(||->Result<ViewSaveResult>{
            match kind {Some(kind)=>{self.dataset.type_overrides.insert(column.into(),kind);},None=>{self.dataset.type_overrides.remove(column);}}
            self.type_revision=self.type_revision.checked_add(1).ok_or_else(||Error::Invalid("Type revision overflow".into()))?;
            self.refresh_types()?;
            let (mut view,enrichments)=previous.map(|p|(p.view,p.enrichments)).unwrap_or((Value::Null,json!([])));
            if let Some(filters)=view.get_mut("filters").and_then(Value::as_array_mut) {filters.retain(|f|f.get("column").and_then(Value::as_str)!=Some(column));}
            self.write_project(ProjectFile{format_version:1,dataset_id:self.dataset.id.clone(),source:self.source.clone(),columns:self.source_columns.clone(),view,enrichments,saved_at_ns:0,column_types:self.dataset.type_overrides.clone(),type_revision:self.type_revision,derived_columns:self.derived_columns.clone(),result_columns:self.result_columns.clone(),portable_hash:None,results_file:None,revision_id:None,parent_revision:None,resolved_revisions:vec![]})
        })();
        match result {
            Ok(save)=>Ok(CastResult{dataset:self.dataset(),save}),
            Err(e)=>{self.dataset=old_dataset;self.type_revision=old_revision;self.refresh_view()?;Err(e)}
        }
    }
    fn statistics_from(&self,column:&Column,predicate:&str,relation:&str)->Result<VariableStatistics> {
        let field=ident(&column.id);
        let numeric=column.kind==VariableKind::Numeric;
        let date=column.kind==VariableKind::Date;
        let expr=if numeric {format!("CASE WHEN isfinite({field}) THEN {field} ELSE NULL END")}
            else if date {format!("TRY_CAST({field} AS TIMESTAMP)")}else{field};
        let range=if numeric||date {
            let mean=if date {"CAST(to_timestamp(avg(epoch(v))) AS VARCHAR)"} else {"CAST(avg(v) AS VARCHAR)"};
            format!("CAST(min(v) AS VARCHAR),CAST(quantile_cont(v,0.25) AS VARCHAR),CAST(quantile_cont(v,0.5) AS VARCHAR),{mean},CAST(quantile_cont(v,0.75) AS VARCHAR),CAST(max(v) AS VARCHAR)")
        } else {"NULL::VARCHAR,NULL::VARCHAR,NULL::VARCHAR,NULL::VARCHAR,NULL::VARCHAR,NULL::VARCHAR".into()};
        let sql=format!("SELECT count(v),count(*)-count(v),count(DISTINCT v),{range} FROM (SELECT {expr} AS v FROM {relation} WHERE {predicate})");
        Ok(self.conn.query_row(&sql,[],|r|Ok(VariableStatistics{count:r.get(0)?,missing:r.get(1)?,distinct:r.get(2)?,min:r.get(3)?,p25:r.get(4)?,median:r.get(5)?,mean:r.get(6)?,p75:r.get(7)?,max:r.get(8)?}))?)
    }
    fn migrate_project_columns(&self)->Result<()> {
        let old:Option<String>=self.conn.query_row("SELECT value FROM dl_meta WHERE key='previous_source_columns'",[],|r|r.get(0)).ok();
        let Some(old)=old else{return Ok(())};
        let old:Vec<Column>=serde_json::from_str(&old)?;
        for path in [self.read_project_path(),self.pending_project_path.as_path()] {
            if !path.exists(){continue;}
            let mut p:ProjectFile=serde_json::from_reader(File::open(path)?)?;
            let matching_project=if p.format_version==1 {p.dataset_id==self.dataset.id && p.source==self.source}
                else if p.format_version==2 && !self.is_remote() {let fingerprint=self.portable_hash()?;p.portable_hash.as_deref()==Some(fingerprint.as_str()) && p.dataset_id==format!("project_{}",&fingerprint[..24])}
                else {false};
            if matching_project && p.columns==old && p.columns!=self.source_columns {
                p.columns=self.source_columns.clone();
                atomic_json(path,&serde_json::to_value(p)?)?;
            }
        }
        Ok(())
    }
    fn read_project(&self)->Result<Option<ProjectFile>> {
        self.check_source()?;
        // Validate an existing sidecar before considering the recoverable local copy.
        let primary=self.read_project_file(self.read_project_path())?;
        let pending=self.read_project_file(&self.pending_project_path)?;
        Ok(match (primary,pending) {
            (Some(primary),Some(pending)) if pending.saved_at_ns>primary.saved_at_ns=>Some(pending),
            (Some(primary),_)=>Some(primary),
            (None,pending)=>pending,
        })
    }
    fn read_project_file(&self,path:&Path)->Result<Option<ProjectFile>> {
        if !path.exists(){return Ok(None);}
        let p:ProjectFile=serde_json::from_reader(File::open(path)?)?;
        match p.format_version {
            1 if p.dataset_id==self.dataset.id && p.source==self.source && p.columns==self.source_columns=>{},
            2 if !self.is_remote() && p.columns==self.source_columns && p.source.sheet==self.source.sheet && p.source.bytes==self.source.bytes=>{
                let fingerprint=p.portable_hash.as_deref().ok_or_else(||Error::Invalid("El proyecto compartido no tiene huella del archivo.".into()))?;
                if fingerprint!=self.portable_hash()? || p.dataset_id!=format!("project_{}",&fingerprint[..24.min(fingerprint.len())]) {return Err(Error::SourceChanged);}
            },
            1|2=>return Err(Error::SourceChanged),
            _=>return Err(Error::Invalid("Unsupported project format version".into())),
        }
        Ok(Some(p))
    }
    fn read_project_path(&self)->&Path {
        // Validate an existing sidecar before reading legacy or newer local saves.
        // Never silently overwrite someone else's malformed/incompatible file.
        if self.project_path.exists() {&self.project_path} else {&self.legacy_project_path}
    }
    fn write_project(&self,project:ProjectFile)->Result<ViewSaveResult> {self.write_project_from(project,None)}
    fn write_project_from(&self,mut project:ProjectFile,parent_override:Option<String>)->Result<ViewSaveResult> {
        let previous=self.read_project()?;
        if !self.is_remote() && parent_override.is_none() && previous.as_ref().and_then(|p|p.revision_id.clone())!=*self.known_project_revision.borrow() {
            return Err(Error::Invalid("Otra persona ha actualizado este proyecto compartido. Elige qué versión conservar antes de guardar más cambios.".into()));
        }
        if !self.is_remote() && parent_override.is_none() && self.read_project_file(self.read_project_path())?.and_then(|p|p.revision_id)!=*self.known_primary_revision.borrow() {
            return Err(Error::Invalid("Otra persona ha actualizado este proyecto compartido. Elige qué versión conservar antes de guardar más cambios.".into()));
        }
        if !self.is_remote() {
            let fingerprint=self.portable_hash()?;
            project.format_version=2;
            project.dataset_id=format!("project_{}",&fingerprint[..24]);
            project.portable_hash=Some(fingerprint);
            if project.results_file.is_none() && parent_override.is_none(){project.results_file=previous.as_ref().and_then(|p|p.results_file.clone());}
            project.parent_revision=parent_override.or_else(||previous.as_ref().and_then(|p|p.revision_id.clone()));
            if project.resolved_revisions.is_empty(){project.resolved_revisions=previous.as_ref().map(|p|p.resolved_revisions.clone()).unwrap_or_default();}
        }
        let previous_time=previous.as_ref().map(|p|p.saved_at_ns).unwrap_or(0);
        let now=std::time::SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e|Error::Invalid(e.to_string()))?.as_nanos();
        project.saved_at_ns=now.max(previous_time.saturating_add(1));
        if !self.is_remote(){project.revision_id=Some(format!("rev-{}",hash(format!("{}:{}:{}",now,std::process::id(),self.project_path.display()).as_bytes())));}
        let value=serde_json::to_value(project)?;
        match atomic_json(&self.project_path,&value) {
            Ok(())=>{
                let warning=if !self.is_remote(){self.save_project_revision(&value).err().map(|e|format!("La vista se guardó, pero no se pudo conservar una versión para resolver cambios simultáneos: {e}"))}else{None};
                *self.known_project_revision.borrow_mut()=value.get("revisionId").and_then(Value::as_str).map(str::to_owned);
                *self.known_primary_revision.borrow_mut()=self.known_project_revision.borrow().clone();
                Ok(ViewSaveResult{path:self.project_path.to_string_lossy().into(),beside_source:!self.is_remote(),warning})
            },
            Err(source_error)=>{
                atomic_json(&self.pending_project_path,&value).map_err(|e|Error::Invalid(format!("No se pudo guardar junto al original ({source_error}) ni en este Mac ({e}).")))?;
                *self.known_project_revision.borrow_mut()=value.get("revisionId").and_then(Value::as_str).map(str::to_owned);
                let path=self.pending_project_path.to_string_lossy().into_owned();
                Ok(ViewSaveResult{path:path.clone(),beside_source:false,warning:Some(format!("No se pudo escribir junto al archivo original. Los ajustes están guardados en este Mac: {path}"))})
            }
        }
    }
    fn save_project_revision(&self,value:&Value)->Result<()> {
        let id=value.get("revisionId").and_then(Value::as_str).ok_or_else(||Error::Invalid("Revisión del proyecto no válida".into()))?;
        let directory=self.project_path.with_extension("").join("revisions");
        fs::create_dir_all(&directory)?;
        atomic_json(&directory.join(format!("{id}.json")),value)
    }
    fn all_shared_revisions(&self)->Result<Vec<ProjectFile>> {
        if self.is_remote(){return Ok(vec![]);}
        let Some(current)=self.read_project()? else{return Ok(vec![])};
        if current.format_version!=2{return Ok(vec![]);}
        let mut versions=BTreeMap::<String,ProjectFile>::new();
        let directory=self.project_path.with_extension("").join("revisions");
        if directory.exists(){
            for entry in fs::read_dir(directory)? {
                let entry=entry?;let path=entry.path();
                if path.extension().and_then(|s|s.to_str())!=Some("json"){continue;}
                let Some(project)=self.read_project_file(&path)? else{continue};
                if let Some(id)=project.revision_id.clone(){versions.insert(id,project);}
            }
        }
        if let Some(id)=current.revision_id.clone(){versions.insert(id,current);}
        // A newer recoverable local copy can mask a Dropbox update in
        // read_project(); show both so the user can make an explicit choice.
        if let Some(primary)=self.read_project_file(self.read_project_path())? {
            if let Some(id)=primary.revision_id.clone(){versions.insert(id,primary);}
        }
        Ok(versions.into_values().collect())
    }
    pub fn shared_revisions(&self)->Result<Vec<SharedRevision>> {
        let versions=self.all_shared_revisions()?;
        let active=self.known_project_revision.borrow().clone();
        let ancestors:HashSet<String>=versions.iter().flat_map(|p|p.parent_revision.iter().chain(p.resolved_revisions.iter()).cloned()).collect();
        let mut items=versions.into_iter().filter_map(|p|{
            let id=p.revision_id?;
            Some(SharedRevision{id:id.clone(),saved_at_ms:(p.saved_at_ns/1_000_000).min(u64::MAX as u128) as u64,active:active.as_deref()==Some(id.as_str()),head:!ancestors.contains(&id)})
        }).collect::<Vec<_>>();
        items.sort_by(|a,b|b.saved_at_ms.cmp(&a.saved_at_ms).then_with(||a.id.cmp(&b.id)));
        Ok(items)
    }
    pub fn select_shared_revision(&mut self,id:&str)->Result<Dataset> {
        if self.is_remote() || id.len()>128 || !id.starts_with("rev-") || !id[4..].bytes().all(|b|b.is_ascii_hexdigit()){
            return Err(Error::Invalid("Revisión compartida no válida".into()));
        }
        let versions=self.all_shared_revisions()?;
        let chosen=versions.iter().find(|p|p.revision_id.as_deref()==Some(id)).cloned().ok_or_else(||Error::Invalid("No se encuentra esa versión del proyecto.".into()))?;
        if let Some(reference)=chosen.results_file.as_deref(){self.validate_portable_results(reference)?;}
        // A remote save may have arrived since this Mac opened the file. In
        // that case our last published snapshot is already in the revisions
        // directory; publishing now would overwrite the remote head.
        if self.read_project()?.and_then(|p|p.revision_id)==*self.known_project_revision.borrow() {
            self.publish_portable_results()?;
        }
        let heads=self.shared_revisions()?.into_iter().filter(|item|item.head).map(|item|item.id).collect::<Vec<_>>();
        let mut selected=chosen;
        selected.resolved_revisions.extend(heads.into_iter().filter(|head|head!=id));
        selected.resolved_revisions.sort();selected.resolved_revisions.dedup();
        let old_dataset=self.dataset.clone();let old_results=self.result_columns.clone();
        let old_derived=self.derived_columns.clone();let old_type_revision=self.type_revision;
        self.conn.execute_batch("BEGIN TRANSACTION")?;
        let switched=(||->Result<()> {
            self.conn.execute("DELETE FROM dl_results",[])?;
            self.conn.execute("DELETE FROM dl_columns",[])?;
            self.conn.execute("DELETE FROM dl_meta WHERE key='shared_results_hash' OR key='analysis_sample'",[])?;
            self.result_columns.clear();self.derived_columns.clear();
            self.dataset.type_overrides.clear();self.type_revision=0;
            self.refresh_types()?;
            for column in &selected.result_columns {
                self.conn.execute("INSERT INTO dl_columns VALUES (?,?)",params![column.id,serde_json::to_string(column)?])?;
            }
            self.result_columns=selected.result_columns.clone();
            self.derived_columns=selected.derived_columns.clone();
            self.dataset.type_overrides=selected.column_types.clone();
            self.type_revision=selected.type_revision;
            self.refresh_types()?;
            if let Some(reference)=selected.results_file.as_deref(){self.load_portable_results_into_db(reference)?;}
            let saved=self.write_project_from(selected,Some(id.into()))?;
            if !saved.beside_source {return Err(Error::Invalid("No se pudo seleccionar la versión compartida junto al archivo original.".into()));}
            self.conn.execute_batch("COMMIT")?;
            Ok(())
        })();
        if let Err(error)=switched {
            let _=self.conn.execute_batch("ROLLBACK");
            self.dataset=old_dataset;self.result_columns=old_results;
            self.derived_columns=old_derived;self.type_revision=old_type_revision;
            let _=self.refresh_view();
            return Err(error);
        }
        self.analysis_cache.replace(AnalysisCache::default());
        Ok(self.dataset())
    }
    fn validate_portable_results(&self,reference:&str)->Result<PathBuf> {
        let Some(digest)=reference.strip_prefix("results/").and_then(|s|s.strip_suffix(".parquet")) else{return Err(Error::Invalid("Referencia de resultados compartidos no válida".into()))};
        if digest.len()!=64 || !digest.bytes().all(|b|b.is_ascii_hexdigit()){return Err(Error::Invalid("Referencia de resultados compartidos no válida".into()));}
        let path=self.project_path.with_extension("").join(reference);
        if !path.exists(){return Err(Error::Invalid("Esperando a que se sincronicen los resultados del proyecto. Vuelve a abrir el archivo.".into()));}
        if file_hash(&path)?!=digest{return Err(Error::Invalid("Los resultados compartidos no superaron la verificación. Vuelve a sincronizarlos.".into()));}
        Ok(path)
    }
    fn restore_portable_results(&self,reference:Option<&str>)->Result<()> {
        let Some(reference)=reference else{return Ok(())};
        let Some(digest)=reference.strip_prefix("results/").and_then(|s|s.strip_suffix(".parquet")) else{return Err(Error::Invalid("Referencia de resultados compartidos no válida".into()))};
        let current:Option<String>=self.conn.query_row("SELECT value FROM dl_meta WHERE key='shared_results_hash'",[],|r|r.get(0)).ok();
        if current.as_deref()==Some(digest){return Ok(());}
        self.conn.execute_batch("BEGIN TRANSACTION")?;
        let result=self.load_portable_results_into_db(reference);
        match result {Ok(())=>self.conn.execute_batch("COMMIT")?,Err(error)=>{let _=self.conn.execute_batch("ROLLBACK");return Err(error);}}
        Ok(())
    }
    fn load_portable_results_into_db(&self,reference:&str)->Result<()> {
        let digest=reference.strip_prefix("results/").and_then(|s|s.strip_suffix(".parquet")).ok_or_else(||Error::Invalid("Referencia de resultados compartidos no válida".into()))?;
        let path=self.validate_portable_results(reference)?;
        let input=literal(&path.to_string_lossy());
        let invalid:u64=self.conn.query_row(&format!("SELECT count(*) FROM read_parquet({input}) WHERE rid >= {} OR col NOT IN (SELECT id FROM dl_columns) OR NOT json_valid(value)",self.dataset.row_count.unwrap_or(0)),[],|r|r.get(0))?;
        if invalid!=0{return Err(Error::Invalid("Los resultados compartidos contienen filas o columnas incompatibles.".into()));}
        self.conn.execute("DELETE FROM dl_results",[])?;
        self.conn.execute_batch(&format!("INSERT INTO dl_results SELECT rid,col,value FROM read_parquet({input})"))?;
        self.conn.execute("INSERT OR REPLACE INTO dl_meta VALUES ('shared_results_hash',?)",params![digest])?;
        self.conn.execute("DELETE FROM dl_meta WHERE key='analysis_sample'",[])?;
        Ok(())
    }
    /// Publish immutable Parquet results after a completed enrichment run.
    pub fn publish_portable_results(&self)->Result<Option<ViewSaveResult>> {
        if self.is_remote(){return Ok(None);}
        self.check_source()?;
        let count:u64=self.conn.query_row("SELECT count(*) FROM dl_results",[],|r|r.get(0))?;
        if count==0{return Ok(None);}
        let Some(mut project)=self.read_project()? else{return Ok(None)};
        let directory=self.project_path.with_extension("").join("results");
        fs::create_dir_all(&directory)?;
        let temporary=tempfile::Builder::new().prefix(".results-").suffix(".parquet").tempfile_in(&directory)?;
        let temporary_path=temporary.path().to_owned();drop(temporary);
        let output=literal(&temporary_path.to_string_lossy());
        self.conn.execute_batch(&format!("COPY (SELECT rid,col,value FROM dl_results ORDER BY rid,col) TO {output} (FORMAT PARQUET, COMPRESSION ZSTD)"))?;
        let digest=file_hash(&temporary_path)?;
        let final_path=directory.join(format!("{digest}.parquet"));
        if final_path.exists(){fs::remove_file(&temporary_path)?;}else{fs::rename(&temporary_path,&final_path)?;}
        project.results_file=Some(format!("results/{digest}.parquet"));
        project.result_columns=self.result_columns.clone();
        project.derived_columns=self.derived_columns.clone();
        project.column_types=self.dataset.type_overrides.clone();
        project.type_revision=self.type_revision;
        let saved=self.write_project(project)?;
        self.conn.execute("INSERT OR REPLACE INTO dl_meta VALUES ('shared_results_hash',?)",params![digest])?;
        Ok(Some(saved))
    }
    /// Mirror definitions into the portable project file. Jobs remain in enrichment SQLite.
    pub fn save_enrichments(&self,enrichments:Value)->Result<()> {
        self.check_source()?;
        if !enrichments.is_array(){return Err(Error::Invalid("Enrichments must be an array".into()));}
        let view=self.read_project()?.map(|p|p.view).unwrap_or(Value::Null);
        let p=ProjectFile{format_version:1,dataset_id:self.dataset.id.clone(),source:self.source.clone(),columns:self.source_columns.clone(),view,enrichments,saved_at_ns:0,column_types:self.dataset.type_overrides.clone(),type_revision:self.type_revision,derived_columns:self.derived_columns.clone(),result_columns:self.result_columns.clone(),portable_hash:None,results_file:None,revision_id:None,parent_revision:None,resolved_revisions:vec![]};
        let saved=self.write_project(p)?;
        // Existing enrichment callers display errors after their DB write. Surface
        // this recoverable location warning through that same visible path.
        if let Some(warning)=saved.warning {return Err(Error::Invalid(warning));}
        Ok(())
    }
    pub fn load_enrichments(&self)->Result<Value> {Ok(self.read_project()?.map(|p|p.enrichments).filter(Value::is_array).unwrap_or_else(||json!([])))}
    pub fn shared_enrichments(&self)->Result<Option<Value>> {Ok(self.read_project()?.map(|p|p.enrichments))}
    fn validate_view(&self,view:&Value)->Result<()> {
        if view.get("formatVersion").and_then(Value::as_u64)!=Some(1) {return Err(Error::Invalid("Unsupported view format version".into()));}
        let filters:Vec<Filter>=serde_json::from_value(view.get("filters").cloned().ok_or_else(||Error::Invalid("Missing view filters".into()))?)?;
        let sorting:Vec<SortRule>=serde_json::from_value(view.get("sorting").cloned().ok_or_else(||Error::Invalid("Missing view sorting".into()))?)?;
        self.where_sql(&filters)?;self.order_sql(&sorting)?;
        for parent in ["columns","variablePanel"] {
            let obj=view.get(parent).and_then(Value::as_object).ok_or_else(||Error::Invalid(format!("Missing view {parent}")))?;
            for field in ["order","hidden","pinned"] {if let Some(ids)=obj.get(field) {let ids:Vec<String>=serde_json::from_value(ids.clone())?;self.projection(&ids)?;}}
        }
        if let Some(widths)=view.pointer("/columns/widths").and_then(Value::as_object) {for (id,width) in widths {self.column(id)?;if !width.as_f64().is_some_and(|v|v.is_finite()&&v>0.&&v<=10000.) {return Err(Error::Invalid("Invalid column width".into()));}}}
        Ok(())
    }
    pub fn export(&self,request:ExportRequest)->Result<String> {
        self.check_source()?;
        let columns=self.projection(&request.columns)?;
        if columns.is_empty(){return Err(Error::Invalid("Choose at least one export column".into()));}
        let target=PathBuf::from(&request.path);
        if target.exists() {return Err(Error::Invalid("Export destination already exists; choose a new path".into()));}
        let parent=target.parent().filter(|p|!p.as_os_str().is_empty()).unwrap_or(Path::new("."));
        let tmp=tempfile::NamedTempFile::new_in(parent)?;
        let options=match request.format {ExportFormat::Csv=>"FORMAT CSV, HEADER TRUE",ExportFormat::Parquet=>"FORMAT PARQUET, COMPRESSION ZSTD"};
        let fields=columns.iter().map(|c|ident(&c.id)).collect::<Vec<_>>().join(",");
        let predicate=self.where_sql(&request.filters)?;let order=self.order_sql(&request.sorting)?;
        self.conn.execute_batch(&format!("COPY (SELECT {fields} FROM dl_data WHERE {predicate} ORDER BY {order}) TO {} ({options})",literal(&tmp.path().to_string_lossy())))?;
        tmp.as_file().sync_all()?;
        tmp.persist_noclobber(&target).map_err(|e|Error::Io(e.error))?;
        Ok(target.to_string_lossy().into())
    }
    /// Exact whole-dataset aggregates. Foreground applies the same full predicate as pages.
    /// Numeric/date ranges use 32 bins; null has its own bucket.
    /// Exact legacy API, also used for exports/analysis verification.
    pub fn distributions(&self,columns:&[String],filters:&[Filter])->Result<Distributions> {
        self.distributions_with_options(columns, filters, &DistributionOptions { sampling: AnalysisSampling::Full, statistics: None })
    }

}
fn bin(value:Option<Value>,left:Option<f64>,right:Option<f64>,background:u64,foreground:u64,total:u64,selected:u64)->Bin {
    Bin{value,left,right,background,foreground,r_background:if total==0{0.}else{background as f64/total as f64},r_foreground:if selected==0{0.}else{foreground as f64/selected as f64}}
}
fn describe(conn:&Connection,relation:&str)->Result<Vec<Column>> {
    let mut stmt=conn.prepare(&format!("DESCRIBE SELECT * FROM {relation}"))?;
    let rows=stmt.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?)))?.collect::<std::result::Result<Vec<_>,_>>()?;
    // Wide tables open from schema alone. Avoid thousands of eager string scans;
    // value distributions are requested on demand by the viewport.
    let profile_strings=rows.len() <= 256;
    let mut columns=Vec::new();
    for (name,data_type) in rows {let mut kind=kind_from_type(&data_type);
        if profile_strings && data_type=="VARCHAR" {
            let c=ident(&name);
            let (n,distinct,lists):(u64,u64,u64)=conn.query_row(&format!("SELECT count({c}), count(DISTINCT {c}), count(*) FILTER (WHERE TRY_CAST({c} AS VARCHAR[]) IS NOT NULL AND starts_with(trim({c}), '[') AND ends_with(trim({c}), ']')) FROM (SELECT {c} FROM {relation} LIMIT 10000)"),[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?;
            if n>0 && lists as f64/n as f64>=0.9 {kind=VariableKind::Multivalued;}else if distinct>100{kind=VariableKind::Text;}
        }
        columns.push(Column{id:name.clone(),name,data_type,kind,spss:None});} Ok(columns)
}
fn kind_from_type(t:&str)->VariableKind {
    if t.ends_with("[]") {VariableKind::Multivalued}
    else if t=="BOOLEAN" {VariableKind::Boolean}
    else if ["DATE","TIMESTAMP","TIME"].iter().any(|p|t.starts_with(p)){VariableKind::Date}
    else if ["TINYINT","SMALLINT","INTEGER","BIGINT","HUGEINT","UTINYINT","USMALLINT","UINTEGER","UBIGINT","UHUGEINT","DOUBLE","FLOAT","DECIMAL","REAL"].iter().any(|p|t.starts_with(p)){VariableKind::Numeric}
    else if t.starts_with("STRUCT")||t.starts_with("MAP")||t=="JSON" {VariableKind::Text}
    else {VariableKind::Categorical}
}
fn kind_type(k:&VariableKind)->&'static str {match k {VariableKind::Numeric=>"DOUBLE",VariableKind::Date=>"TIMESTAMP",VariableKind::Boolean=>"BOOLEAN",VariableKind::Multivalued=>"VARCHAR[]",_=>"VARCHAR"}}
fn cell_expr(c:&Column)->String {
    let field=ident(&c.id);
    if c.kind==VariableKind::Multivalued && c.data_type=="VARCHAR" {format!("CAST(to_json(TRY_CAST({field} AS VARCHAR[])) AS VARCHAR)")}
    else if c.kind==VariableKind::Multivalued||c.data_type.starts_with("STRUCT")||c.data_type.starts_with("MAP")||c.data_type=="JSON" {format!("CAST(to_json({field}) AS VARCHAR)")}
    else {format!("CAST({field} AS VARCHAR)")}
}
fn parse_cell(raw:Option<String>,c:&Column)->Result<Value> {
    let Some(raw)=raw else{return Ok(Value::Null)};
    match c.kind {
        VariableKind::Multivalued=>Ok(safe_json(serde_json::from_str(&raw)?)),
        VariableKind::Boolean=>Ok(Value::Bool(raw=="true")),
        VariableKind::Numeric=>{
            // Decimal and integers beyond JS safe range remain exact strings across IPC.
            if c.data_type.starts_with("DECIMAL") {return Ok(Value::String(raw));}
            if let Ok(n)=raw.parse::<i128>() {if n.unsigned_abs()>9_007_199_254_740_991 {return Ok(Value::String(raw));}return Ok(json!(n as i64));}
            Ok(raw.parse::<f64>().ok().filter(|n|n.is_finite()).map(|n|json!(n)).unwrap_or(Value::Null))
        },
        _=> if c.data_type.starts_with("STRUCT")||c.data_type.starts_with("MAP")||c.data_type=="JSON" {Ok(safe_json(serde_json::from_str(&raw)?))}else{Ok(Value::String(raw))},
    }
}
fn safe_json(v:Value)->Value {match v { Value::Number(n) if n.as_i64().is_some_and(|n|n.unsigned_abs()>9_007_199_254_740_991)||n.as_u64().is_some_and(|n|n>9_007_199_254_740_991)=>Value::String(n.to_string()),Value::Array(a)=>Value::Array(a.into_iter().map(safe_json).collect()),Value::Object(o)=>Value::Object(o.into_iter().map(|(k,v)|(k,safe_json(v))).collect()),v=>v}}
fn validate_result(v:&Value,k:&VariableKind)->Result<()> {
    if v.is_null(){return Ok(());}
    let valid=match k {VariableKind::Numeric=>v.is_number(),VariableKind::Boolean=>v.is_boolean(),VariableKind::Multivalued=>v.as_array().is_some_and(|a|a.iter().all(Value::is_string)),_=>v.is_string()};
    if valid {Ok(())}else{Err(Error::Invalid("Result value does not match column kind".into()))}
}
fn hash(bytes:&[u8])->String {format!("{:x}",Sha256::digest(bytes))}
fn file_hash(path:&Path)->Result<String> {
    let mut file=File::open(path)?;let mut hasher=Sha256::new();let mut buffer=[0u8;1024*1024];
    loop {let read=file.read(&mut buffer)?;if read==0{break;}hasher.update(&buffer[..read]);}
    Ok(format!("{:x}",hasher.finalize()))
}
fn project_sidecar_path(source:&Path,sheet:Option<&str>)->PathBuf {
    let mut filename=source.file_name().unwrap_or_default().to_os_string();
    if let Some(sheet)=sheet {
        // Hash the full, case-sensitive sheet name; never put user sheet text in a path.
        filename.push(format!(".sheet-{}",hash(sheet.as_bytes())));
    }
    filename.push(".datolens.json");
    source.with_file_name(filename)
}
fn signature(path:&Path,sheet:Option<String>)->Result<SourceSignature> {
    let mut file=File::open(path)?;let meta=file.metadata()?;
    let mut sha=Sha256::new();let size=meta.len();
    // Bounded first/middle/last samples; never hash gigabytes to open a file.
    for offset in [0,size.saturating_sub(65536)/2,size.saturating_sub(65536)] {file.seek(SeekFrom::Start(offset))?;let mut bytes=vec![0;65536];let n=file.read(&mut bytes)?;sha.update(&bytes[..n]);}
    Ok(SourceSignature{path:path.to_string_lossy().into(),bytes:size,modified_ns:meta.modified()?.duration_since(UNIX_EPOCH).map_err(|e|Error::Invalid(e.to_string()))?.as_nanos(),sample_hash:format!("{:x}",sha.finalize()),sheet,remote:None})
}
fn atomic_json(path:&Path,value:&Value)->Result<()> {
    let parent=path.parent().unwrap();let mut temp=tempfile::NamedTempFile::new_in(parent)?;
    serde_json::to_writer_pretty(&mut temp,value)?;temp.write_all(b"\n")?;temp.as_file().sync_all()?;
    temp.persist(path).map_err(|e|Error::Io(e.error))?;
    // On macOS, opening the containing directory requests directory-read access
    // beyond the selected document. In protected folders this can suspend the
    // save after its atomic rename and block every subsequent dataset operation.
    // The temporary file has already been synced; do not enumerate/open its folder.
    #[cfg(not(target_os="macos"))]
    File::open(parent)?.sync_all()?;
    Ok(())
}
fn import_xlsx(conn:&Connection,path:&Path,sheet:&str)->Result<()> {
    let mut book=open_workbook_auto(path).map_err(|e|Error::Spreadsheet(e.to_string()))?;
    let range=book.worksheet_range(sheet).map_err(|e|Error::Spreadsheet(e.to_string()))?;
    let mut rows=range.rows();
    let headers=rows.next().ok_or_else(||Error::Invalid("Sheet is empty".into()))?;
    if headers.is_empty(){return Err(Error::Invalid("Sheet has no columns".into()));}
    let mut used=HashSet::new();let mut names=Vec::new();
    for (i,h) in headers.iter().enumerate(){let raw=h.to_string();let base=if raw.trim().is_empty(){format!("column_{}",i+1)}else{raw};let mut name=base.clone();let mut suffix=2;while !used.insert(name.to_lowercase()){name=format!("{base}_{suffix}");suffix+=1;}names.push(name);}
    // Calamine materializes one sheet in native memory. Append rows incrementally to DuckDB;
    // do not build a second copy or pass worksheet data through JavaScript.
    let mut kinds=vec![0u8;names.len()];
    for row in range.rows().skip(1){for (i,c) in row.iter().enumerate(){let k=match c {Data::Empty=>0,Data::Int(_)|Data::Float(_)=>1,Data::Bool(_)=>2,Data::DateTime(_)|Data::DateTimeIso(_)=>3,_=>4};if k!=0 {kinds[i]=if kinds[i]==0||kinds[i]==k{k}else{4};}}}
    let fields=names.iter().zip(&kinds).map(|(n,k)|format!("{} {}",ident(n),match k{1=>"DOUBLE",2=>"BOOLEAN",3=>"TIMESTAMP",_=>"VARCHAR"})).collect::<Vec<_>>().join(",");
    conn.execute_batch(&format!("CREATE TABLE dl_xlsx ({fields})"))?;
    let mut appender=conn.appender("dl_xlsx")?;
    for row in rows {
        let values=names.iter().enumerate().map(|(i,_)|{
            let c=row.get(i).unwrap_or(&Data::Empty);
            if matches!(c,Data::Empty){return duckdb::types::Value::Null;}
            match kinds[i] {
                1=>duckdb::types::Value::Double(c.as_f64().unwrap_or(0.)),
                2=>duckdb::types::Value::Boolean(c.get_bool().unwrap_or(false)),
                3=>duckdb::types::Value::Text(c.as_datetime().map(|v|v.to_string()).unwrap_or_else(||c.to_string())),
                _=>duckdb::types::Value::Text(c.to_string()),
            }
        }).collect::<Vec<_>>();
        appender.append_row(duckdb::appender_params_from_iter(values.iter()))?;
    }
    appender.flush()?;Ok(())
}
