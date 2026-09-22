use crate::{sql::{ident, literal, predicate}, *};
use calamine::{open_workbook_auto, Reader, Data, DataType};
use duckdb::{Connection, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{collections::{BTreeMap, HashSet}, fs::{self, File}, io::{Read, Seek, SeekFrom, Write}, path::{Path,PathBuf}, time::UNIX_EPOCH};

const MAX_PAGE: u32 = 10_000;
const MAX_DISTRIBUTION_COLUMNS: usize = 64;
const CSV_IMPORT_VERSION: &str = "3";
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct SourceSignature { path: String, bytes: u64, modified_ns: u128, sample_hash: String, sheet: Option<String> }
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all="camelCase")]
struct ProjectFile { format_version: u32, dataset_id: String, source: SourceSignature, columns: Vec<Column>, #[serde(default)] view: Value, #[serde(default)] enrichments: Value }
/// One dataset and its local project database. `Connection` is Send (not Sync).
/// Use a host-owned Mutex and spawn_blocking; do not hold this on the UI thread.
pub struct DataStore {
    conn: Connection,
    dataset: Dataset,
    source: SourceSignature,
    source_columns: Vec<Column>,
    result_columns: Vec<Column>,
    rid: String,
    project_path: PathBuf,
    database_path: PathBuf,
}
impl DataStore {
    pub fn list_sheets(path: &Path) -> Result<Vec<String>> {
        let workbook = open_workbook_auto(path).map_err(|e| Error::Spreadsheet(e.to_string()))?;
        Ok(workbook.sheet_names())
    }
    /// CSV/XLSX imports are transactional and disk-backed. Parquet remains a file scan.
    /// `storage_dir` should be writable application data, not the source directory.
    pub fn open(path: &Path, sheet: Option<&str>, storage_dir: &Path) -> Result<Self> {
        let path = fs::canonicalize(path)?;
        let ext = path.extension().and_then(|s|s.to_str()).unwrap_or("").to_ascii_lowercase();
        if !["csv","xlsx","parquet"].contains(&ext.as_str()) { return Err(Error::Invalid("Supported formats: CSV, XLSX, Parquet".into())); }
        let sheet = if ext=="xlsx" { Some(match sheet { Some(s)=>s.to_string(),None=>Self::list_sheets(&path)?.into_iter().next().ok_or_else(||Error::Invalid("Workbook has no sheets".into()))? }) } else { None };
        let source = signature(&path,sheet.clone())?;
        let revision = hash(&serde_json::to_vec(&source)?);
        let id = format!("ds_{}",&revision[..24]);
        fs::create_dir_all(storage_dir)?;
        let database_path = storage_dir.join(format!("{id}.duckdb"));
        let project_path = storage_dir.join(format!("{id}.datolens.json"));
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
            conn.execute_batch("BEGIN TRANSACTION")?;
            let imported = (|| -> Result<Vec<Column>> {
                let relation = match ext.as_str() {
                    "parquet" => format!("read_parquet({})",literal(&path.to_string_lossy())),
                    "csv" => {
                        let (relation,protected)=exact_csv_relation(&conn,&path)?;
                        if protected {conn.execute_batch("INSERT OR REPLACE INTO dl_meta VALUES ('csv_exact_integers','1')")?;}
                        relation
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
                    describe(&conn,&format!("(SELECT * EXCLUDE ({}) FROM dl_source)",ident(&rid)))?
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
        if signature(&path,sheet.clone())?!=source { return Err(Error::SourceChanged); }
        if ext=="parquet" {
            let projection=source_columns.iter().map(|c|ident(&c.id)).collect::<Vec<_>>().join(",");
            conn.execute_batch(&format!("CREATE TEMP VIEW dl_base AS SELECT file_row_number::UBIGINT AS {}, {projection} FROM read_parquet({}, file_row_number=true)",ident(&rid),literal(&path.to_string_lossy())))?;
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
        let dataset=Dataset { id, name:path.file_name().unwrap_or_default().to_string_lossy().into(), source_path:path.to_string_lossy().into(), sheet, columns, row_count:Some(row_count),revision };
        let store=Self{conn,dataset,source,source_columns,result_columns,rid,project_path,database_path};
        store.migrate_project_columns()?;
        store.refresh_view()?;
        Ok(store)
    }
    pub fn dataset(&self) -> Dataset { self.dataset.clone() }
    pub fn database_path(&self) -> &Path { &self.database_path }
    pub fn project_path(&self) -> &Path { &self.project_path }
    pub fn check_source(&self) -> Result<()> {
        if signature(Path::new(&self.source.path),self.source.sheet.clone())? != self.source { return Err(Error::SourceChanged); } Ok(())
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
    fn count(&self,where_sql:&str)->Result<u64> { Ok(self.conn.query_row(&format!("SELECT COUNT(*) FROM dl_data WHERE {where_sql}"),[],|r|r.get(0))?) }
    pub fn query_page(&self,request:PageRequest)->Result<Page> {
        self.check_source()?;
        if request.dataset_id!=self.dataset.id {return Err(Error::Invalid("Dataset identity mismatch".into()));}
        if request.limit>MAX_PAGE {return Err(Error::Invalid(format!("Page limit exceeds {MAX_PAGE}")));}
        let columns=self.projection(&request.columns)?;
        let predicate=self.where_sql(&request.filters)?;
        let order=self.order_sql(&request.sorting)?;
        let fields=columns.iter().map(cell_expr).collect::<Vec<_>>();
        let sql=format!("SELECT {}{} FROM dl_data WHERE {predicate} ORDER BY {order} LIMIT {} OFFSET {}",ident(&self.rid),if fields.is_empty(){String::new()}else{format!(",{}",fields.join(","))},request.limit,request.offset);
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
        if self.source_columns.iter().any(|c|c.id.eq_ignore_ascii_case(&column.id)) || column.id.eq_ignore_ascii_case(&self.rid) {return Err(Error::Invalid("Cannot replace source column".into()));}
        column.data_type=kind_type(&column.kind).into();
        if let Some(old)=self.result_columns.iter().find(|c|c.id.eq_ignore_ascii_case(&column.id)) {if old!=&column{return Err(Error::Invalid("Result column definition changed; use a new column ID".into()));} return Ok(());}
        if column.id.is_empty() {return Err(Error::Invalid("Column ID cannot be empty".into()));}
        self.conn.execute("INSERT INTO dl_columns VALUES (?,?)",params![column.id,serde_json::to_string(&column)?])?;
        self.result_columns.push(column.clone());self.dataset.columns.push(column);
        self.refresh_view()
    }
    pub fn apply_results(&self,updates:&[CellUpdate])->Result<()> {
        self.check_source()?;
        let mut parsed=Vec::new();
        for u in updates {
            if u.expected_dataset_revision!=self.dataset.revision {return Err(Error::SourceChanged);}
            if !self.result_columns.iter().any(|c|c.id==u.column_id) {return Err(Error::Invalid("Result column must be registered".into()));}
            let col=self.column(&u.column_id)?;
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
            for (n,u) in parsed {stmt.execute(params![n,u.column_id,serde_json::to_string(&u.value)?])?;} Ok(())
        })();
        match result { Ok(())=>{self.conn.execute_batch("COMMIT")?;Ok(())},Err(e)=>{let _=self.conn.execute_batch("ROLLBACK");Err(e)} }
    }
    fn refresh_view(&self)->Result<()> {
        let mut fields=vec!["b.*".to_string()];
        for col in &self.result_columns {
            let raw=format!("(SELECT r.value FROM dl_results r WHERE r.rid=b.{} AND r.col={})",ident(&self.rid),literal(&col.id));
            let expr=match col.kind {VariableKind::Multivalued=>format!("TRY_CAST(json_extract({raw}, '$') AS VARCHAR[])"),_=>format!("TRY_CAST(json_extract_string({raw}, '$') AS {})",kind_type(&col.kind))};
            fields.push(format!("{expr} AS {}",ident(&col.id)));
        }
        self.conn.execute_batch(&format!("CREATE OR REPLACE TEMP VIEW dl_data AS SELECT {} FROM dl_base b",fields.join(",")))?;Ok(())
    }
    pub fn save_view(&self,view:Value)->Result<()> {
        self.check_source()?;self.validate_view(&view)?;
        let enrichments=self.read_project()?.map(|p|p.enrichments).unwrap_or_else(||json!([]));
        let p=ProjectFile{format_version:1,dataset_id:self.dataset.id.clone(),source:self.source.clone(),columns:self.source_columns.clone(),view,enrichments};
        atomic_json(&self.project_path,&serde_json::to_value(p)?)
    }
    pub fn load_view(&self)->Result<Option<Value>> {
        let Some(p)=self.read_project()? else{return Ok(None)};
        if p.view.is_null(){return Ok(None);}
        self.validate_view(&p.view)?;Ok(Some(p.view))
    }
    fn migrate_project_columns(&self)->Result<()> {
        if !self.project_path.exists(){return Ok(());}
        let old:Option<String>=self.conn.query_row("SELECT value FROM dl_meta WHERE key='previous_source_columns'",[],|r|r.get(0)).ok();
        let Some(old)=old else{return Ok(())};
        let old:Vec<Column>=serde_json::from_str(&old)?;
        let mut p:ProjectFile=serde_json::from_reader(File::open(&self.project_path)?)?;
        if p.format_version==1 && p.dataset_id==self.dataset.id && p.source==self.source && p.columns==old && p.columns!=self.source_columns {
            p.columns=self.source_columns.clone();
            atomic_json(&self.project_path,&serde_json::to_value(p)?)?;
        }
        Ok(())
    }
    fn read_project(&self)->Result<Option<ProjectFile>> {
        self.check_source()?;
        if !self.project_path.exists(){return Ok(None);}
        let p:ProjectFile=serde_json::from_reader(File::open(&self.project_path)?)?;
        if p.format_version!=1{return Err(Error::Invalid("Unsupported project format version".into()));}
        if p.dataset_id!=self.dataset.id || p.source!=self.source || p.columns!=self.source_columns{return Err(Error::SourceChanged);}
        Ok(Some(p))
    }
    /// Mirror definitions into the portable project file. Jobs remain in enrichment SQLite.
    pub fn save_enrichments(&self,enrichments:Value)->Result<()> {
        self.check_source()?;
        if !enrichments.is_array(){return Err(Error::Invalid("Enrichments must be an array".into()));}
        let view=self.read_project()?.map(|p|p.view).unwrap_or(Value::Null);
        let p=ProjectFile{format_version:1,dataset_id:self.dataset.id.clone(),source:self.source.clone(),columns:self.source_columns.clone(),view,enrichments};
        atomic_json(&self.project_path,&serde_json::to_value(p)?)
    }
    pub fn load_enrichments(&self)->Result<Value> {Ok(self.read_project()?.map(|p|p.enrichments).filter(Value::is_array).unwrap_or_else(||json!([])))}
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
    pub fn distributions(&self,columns:&[String],filters:&[Filter])->Result<Distributions> {
        self.check_source()?;
        if columns.len()>MAX_DISTRIBUTION_COLUMNS{return Err(Error::Invalid("Request at most 64 distributions at once".into()));}
        let cols=self.projection(columns)?;let predicate=self.where_sql(filters)?;
        let total=self.dataset.row_count.unwrap_or(0);let selected=self.count(&predicate)?;
        let mut variables=Vec::new();
        for col in cols {
            let field=ident(&col.id);let mut bins=Vec::new();let mut truncated=false;
            match col.kind {
                VariableKind::Numeric|VariableKind::Date => {
                    let expr=if col.kind==VariableKind::Date {format!("epoch_ms(TRY_CAST({field} AS TIMESTAMP))::DOUBLE")}else{format!("TRY_CAST({field} AS DOUBLE)")};
                    let (min,max):(Option<f64>,Option<f64>)=self.conn.query_row(&format!("SELECT min({expr}),max({expr}) FROM dl_data WHERE isfinite({expr})"),[],|r|Ok((r.get(0)?,r.get(1)?)))?;
                    let (min,max)=match (min,max){(Some(a),Some(b))=>(a,b),_=>(0.,0.)};
                    let count=if max>min{32}else{1};let width=if max>min{(max-min)/(count as f64)}else{1.};
                    let bucket=format!("CASE WHEN {expr} IS NULL OR NOT isfinite({expr}) THEN -1 ELSE LEAST(GREATEST(FLOOR(({expr}-({min}))/{width}),0),{})::INTEGER END",count-1);
                    let sql=format!("SELECT {bucket} AS bucket, COUNT(*), COUNT(*) FILTER (WHERE {predicate}) FROM dl_data GROUP BY 1 ORDER BY 1");
                    let mut stmt=self.conn.prepare(&sql)?;let mut rows=stmt.query([])?;
                    let mut counts=BTreeMap::new();
                    while let Some(r)=rows.next()? {counts.insert(r.get::<_,i32>(0)?,(r.get::<_,u64>(1)?,r.get::<_,u64>(2)?));}
                    for i in 0..count {let (bg,fg)=counts.get(&i).copied().unwrap_or((0,0));bins.push(bin(None,Some(min+i as f64*width),Some(if i==count-1 && max>min{max}else{min+(i+1) as f64*width}),bg,fg,total,selected));}
                    if let Some((bg,fg))=counts.get(&-1){bins.push(bin(Some(Value::Null),None,None,*bg,*fg,total,selected));}
                },
                _ => {
                    let relation=if col.kind==VariableKind::Multivalued {
                        // DISTINCT per row ensures [a,a] contributes only once.
                        {let list=if col.data_type=="VARCHAR" {format!("list_transform(TRY_CAST({field} AS VARCHAR[]), x -> TRIM(x))")}else{field.clone()};
                        format!("(SELECT DISTINCT {} AS rid, CAST(unnest({list}) AS VARCHAR) AS value, ({predicate}) AS picked FROM dl_data)",ident(&self.rid))}
                    } else {format!("(SELECT CAST({field} AS VARCHAR) AS value, ({predicate}) AS picked FROM dl_data)")};
                    let sql=format!("SELECT value, COUNT(*) AS bg, COUNT(*) FILTER (WHERE picked) FROM {relation} GROUP BY 1 ORDER BY bg DESC, value ASC NULLS LAST LIMIT 257");
                    let mut stmt=self.conn.prepare(&sql)?;let mut rows=stmt.query([])?;
                    while let Some(r)=rows.next()? {let val:Option<String>=r.get(0)?;bins.push(bin(Some(val.map(Value::String).unwrap_or(Value::Null)),None,None,r.get(1)?,r.get(2)?,total,selected));}
                }
            }
            if bins.len()>256 {bins.truncate(256);truncated=true;}
            variables.push(Distribution{column:col.id,kind:col.kind,bins,truncated});
        }
        Ok(Distributions{variables,selected_count:selected,total_rows:total,analyzed_rows:total,sampled:false})
    }
}
fn bin(value:Option<Value>,left:Option<f64>,right:Option<f64>,background:u64,foreground:u64,total:u64,selected:u64)->Bin {
    Bin{value,left,right,background,foreground,r_background:if total==0{0.}else{background as f64/total as f64},r_foreground:if selected==0{0.}else{foreground as f64/selected as f64}}
}
/// Check raw CSV tokens before any floating-point conversion. A column containing
/// an integer outside the safe DOUBLE range remains text, including its decimal
/// neighbours. BIGINT-only columns already retain their integer representation.
/// The native aggregate scans all rows; no source rows cross into JavaScript.
fn exact_csv_relation(conn:&Connection,path:&Path)->Result<(String,bool)> {
    let file=literal(&path.to_string_lossy());
    let options="header=true, sample_size=-1, auto_type_candidates=['BOOLEAN','BIGINT','DOUBLE','DATE','TIMESTAMP','VARCHAR']";
    let relation=format!("read_csv_auto({file}, {options})");
    let candidates={
        let mut stmt=conn.prepare(&format!("DESCRIBE SELECT * FROM {relation}"))?;
        let cols=stmt.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?)))?.collect::<std::result::Result<Vec<_>,_>>()?;
        cols.into_iter().filter(|(_,t)|t=="DOUBLE").map(|(n,_)|n).collect::<Vec<_>>()
    };
    if candidates.is_empty(){return Ok((relation,false));}
    let expressions=candidates.iter().map(|name|{
        let c=ident(name);
        format!("count(*) FILTER (WHERE regexp_full_match(trim({c}), '[+-]?[0-9]+') AND (TRY_CAST(trim({c}) AS BIGINT) IS NULL OR TRY_CAST(trim({c}) AS BIGINT) NOT BETWEEN -9007199254740991 AND 9007199254740991))>0")
    }).collect::<Vec<_>>().join(",");
    let mut stmt=conn.prepare(&format!("SELECT {expressions} FROM read_csv_auto({file}, header=true, sample_size=-1, all_varchar=true)"))?;
    let mut cursor=stmt.query([])?;
    let row=cursor.next()?.ok_or_else(||Error::Invalid("CSV precision scan returned no aggregate".into()))?;
    let mut overrides=Vec::new();
    for (i,name) in candidates.iter().enumerate(){if row.get::<_,bool>(i)? {overrides.push(format!("{}:'VARCHAR'",literal(name)));}}
    if overrides.is_empty(){Ok((relation,false))}else{Ok((format!("read_csv_auto({file}, {options}, types={{{}}})",overrides.join(",")),true))}
}
fn describe(conn:&Connection,relation:&str)->Result<Vec<Column>> {
    let mut stmt=conn.prepare(&format!("DESCRIBE SELECT * FROM {relation}"))?;
    let rows=stmt.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?)))?;
    let mut columns=Vec::new();
    for row in rows {let (name,data_type)=row?;let mut kind=kind_from_type(&data_type);
        if data_type=="VARCHAR" {
            let c=ident(&name);
            let (n,distinct,lists):(u64,u64,u64)=conn.query_row(&format!("SELECT count({c}), count(DISTINCT {c}), count(*) FILTER (WHERE TRY_CAST({c} AS VARCHAR[]) IS NOT NULL AND starts_with(trim({c}), '[') AND ends_with(trim({c}), ']')) FROM (SELECT {c} FROM {relation} LIMIT 10000)"),[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?;
            if n>0 && lists as f64/n as f64>=0.9 {kind=VariableKind::Multivalued;}else if distinct>100{kind=VariableKind::Text;}
        }
        columns.push(Column{id:name.clone(),name,data_type,kind});} Ok(columns)
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
fn signature(path:&Path,sheet:Option<String>)->Result<SourceSignature> {
    let mut file=File::open(path)?;let meta=file.metadata()?;
    let mut sha=Sha256::new();let size=meta.len();
    // Bounded first/middle/last samples; never hash gigabytes to open a file.
    for offset in [0,size.saturating_sub(65536)/2,size.saturating_sub(65536)] {file.seek(SeekFrom::Start(offset))?;let mut bytes=vec![0;65536];let n=file.read(&mut bytes)?;sha.update(&bytes[..n]);}
    Ok(SourceSignature{path:path.to_string_lossy().into(),bytes:size,modified_ns:meta.modified()?.duration_since(UNIX_EPOCH).map_err(|e|Error::Invalid(e.to_string()))?.as_nanos(),sample_hash:format!("{:x}",sha.finalize()),sheet})
}
fn atomic_json(path:&Path,value:&Value)->Result<()> {
    let parent=path.parent().unwrap();let mut temp=tempfile::NamedTempFile::new_in(parent)?;
    serde_json::to_writer_pretty(&mut temp,value)?;temp.write_all(b"\n")?;temp.as_file().sync_all()?;
    temp.persist(path).map_err(|e|Error::Io(e.error))?;File::open(parent)?.sync_all()?;Ok(())
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
