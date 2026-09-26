//! Local, scalar DuckDB formulas. Only the parsed, allowlisted expression is used.
//! This is a child of store so the connection remains private to the data service.
use super::*;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct DerivedDefinition { pub id:String, pub name:String, pub expression:String }
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct DerivedPreviewRow { pub row_id:String, pub inputs:BTreeMap<String,Value>, pub value:Value }
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct DerivedPreview {
    pub dataset_revision:String, pub fingerprint:String, pub column:Column,
    pub input_columns:Vec<String>, pub rows:Vec<DerivedPreviewRow>, pub total_rows:u64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct DerivedCreated { pub dataset:Dataset, pub column:Column, pub save:ViewSaveResult }

// No aggregates, windows, subqueries, volatile functions, macros or file/network functions.
const FUNCTIONS:&[&str]=&[
    "+","-","*","/","//","%","**","^","||","~~","!~~","~~*","!~~*",
    "abs","ceil","ceiling","floor","round","trunc","sign","sqrt","cbrt","pow","power",
    "ln","log","log10","log2","exp","greatest","least","nullif","ifnull",
    "lower","upper","trim","ltrim","rtrim","length","char_length","character_length",
    "concat","concat_ws","replace","substring","substr","left","right","split_part",
    "starts_with","ends_with","contains","regexp_extract","regexp_replace","regexp_matches",
    "regexp_full_match","reverse","strip_accents","format",
    "date_part","date_diff","datediff","date_trunc","datetrunc","strftime","strptime","try_strptime",
    "year","month","day","dayofmonth","dayofweek","dayofyear","week","quarter","hour","minute","second",
    "make_date","last_day","epoch","epoch_ms","to_timestamp","isfinite","isinf","isnan",
];
fn invalid(message:impl Into<String>)->Error {Error::Invalid(message.into())}
fn array<'a>(value:&'a Value,key:&str)->Result<&'a Vec<Value>> {
    value.get(key).and_then(Value::as_array).ok_or_else(||invalid("Expresión SQL no compatible."))
}
fn empty(value:Option<&Value>)->bool {value.is_none_or(|v|v.is_null()||v.as_array().is_some_and(Vec::is_empty)||v.as_object().is_some_and(serde_json::Map::is_empty))}
fn validate_expression(node:&Value,columns:&[Column],inputs:&mut Vec<String>,depth:usize)->Result<()> {
    if depth>40 {return Err(invalid("La fórmula es demasiado compleja."));}
    let class=node.get("class").and_then(Value::as_str).ok_or_else(||invalid("Expresión SQL no compatible."))?;
    let kind=node.get("type").and_then(Value::as_str).unwrap_or("");
    if node.get("alias").and_then(Value::as_str).is_some_and(|s|!s.is_empty()) {return Err(invalid("Escribe solo la fórmula; el nombre se indica por separado."));}
    let visit=|child:&Value,inputs:&mut Vec<String>|validate_expression(child,columns,inputs,depth+1);
    match class {
        "COLUMN_REF"=>{
            let names=array(node,"column_names")?;
            if names.len()!=1 {return Err(invalid("Usa nombres de columnas sin tablas ni esquemas."));}
            let id=names[0].as_str().ok_or_else(||invalid("Columna inválida."))?;
            let column=columns.iter().find(|c|c.id.eq_ignore_ascii_case(id)).ok_or_else(||invalid(format!("La fórmula utiliza una columna desconocida: {id}")))?;
            if !inputs.contains(&column.id){inputs.push(column.id.clone());}
        },
        "CONSTANT"=>{},
        "FUNCTION"=>{
            let name=node.get("function_name").and_then(Value::as_str).unwrap_or("").to_ascii_lowercase();
            let schema=node.get("schema").and_then(Value::as_str).unwrap_or("");
            let catalog=node.get("catalog").and_then(Value::as_str).unwrap_or("");
            if !FUNCTIONS.contains(&name.as_str()) || !["","main"].contains(&schema) || !catalog.is_empty()
                || !empty(node.get("filter")) || node.get("distinct").and_then(Value::as_bool)==Some(true)
                || !empty(node.pointer("/order_bys/orders")) {
                return Err(invalid(format!("La función {name} no está disponible para columnas calculadas.")));
            }
            for child in array(node,"children")? {visit(child,inputs)?;}
        },
        "CAST"=>{
            let target=node.pointer("/cast_type/id").and_then(Value::as_str).unwrap_or("");
            if !["BOOLEAN","TINYINT","SMALLINT","INTEGER","BIGINT","HUGEINT","UTINYINT","USMALLINT","UINTEGER","UBIGINT","UHUGEINT","FLOAT","DOUBLE","DECIMAL","VARCHAR","DATE","TIME","TIMESTAMP","TIMESTAMP_S","TIMESTAMP_MS","TIMESTAMP_NS","TIMESTAMP_TZ","INTERVAL"].contains(&target) {return Err(invalid("Ese tipo de conversión no está disponible en una fórmula."));}
            visit(&node["child"],inputs)?;
        },
        "COMPARISON"=>{visit(&node["left"],inputs)?;visit(&node["right"],inputs)?;},
        "CONJUNCTION"=>{for child in array(node,"children")? {visit(child,inputs)?;}},
        "OPERATOR" if ["OPERATOR_NOT","OPERATOR_IS_NULL","OPERATOR_IS_NOT_NULL","OPERATOR_COALESCE","COMPARE_IN","COMPARE_NOT_IN"].contains(&kind)=>{
            for child in array(node,"children")? {visit(child,inputs)?;}
        },
        "BETWEEN"=>{for key in ["input","lower","upper"]{visit(&node[key],inputs)?;}},
        "CASE"=>{for check in array(node,"case_checks")?{visit(&check["when_expr"],inputs)?;visit(&check["then_expr"],inputs)?;}visit(&node["else_expr"],inputs)?;},
        _=>return Err(invalid("Usa una expresión escalar por fila, sin consultas, agregaciones ni ventanas.")),
    }
    // Reject new AST execution-bearing fields instead of silently ignoring them.
    let extra=match class {
        "COLUMN_REF"=>vec!["column_names"],"CONSTANT"=>vec!["value"],
        "FUNCTION"=>vec!["function_name","schema","catalog","children","filter","order_bys","distinct","is_operator","export_state"],
        "CAST"=>vec!["child","cast_type","try_cast"],"COMPARISON"=>vec!["left","right"],
        "CONJUNCTION"|"OPERATOR"=>vec!["children"],"BETWEEN"=>vec!["input","lower","upper"],
        "CASE"=>vec!["case_checks","else_expr"],_=>vec![],
    };
    if node.as_object().is_none_or(|o|o.keys().any(|k|!["class","type","alias","query_location"].contains(&k.as_str())&&!extra.contains(&k.as_str()))) {return Err(invalid("Esta variante de expresión SQL no está disponible."));}
    Ok(())
}

impl DataStore {
    fn validate_derived(&self,formula:&DerivedDefinition,columns:&[Column])->Result<Vec<String>> {
        if formula.id.is_empty() || formula.id.len()>128 || formula.name.trim().is_empty() || formula.name.len()>160 {return Err(invalid("Escribe un nombre de columna de hasta 160 caracteres."));}
        if columns.iter().any(|c|c.id.eq_ignore_ascii_case(&formula.id)||c.name.eq_ignore_ascii_case(formula.name.trim())) || formula.id.eq_ignore_ascii_case(&self.rid) {return Err(invalid("Ya existe una columna con ese nombre. Elige otro."));}
        if formula.expression.trim().is_empty() || formula.expression.len()>8000 {return Err(invalid("Escribe una fórmula SQL de hasta 8.000 caracteres."));}
        let sql=format!("SELECT (\n{}\n)",formula.expression);
        let raw:String=self.conn.query_row("SELECT CAST(json_serialize_sql(CAST(? AS VARCHAR), skip_default := true) AS VARCHAR)",params![sql],|r|r.get(0))?;
        let ast:Value=serde_json::from_str(&raw)?;
        if ast["error"]==true {return Err(invalid("No se pudo interpretar la fórmula SQL. Revisa paréntesis, comillas y nombres de columnas."));}
        let statements=array(&ast,"statements")?;
        if statements.len()!=1 {return Err(invalid("Escribe una sola expresión SQL."));}
        let node=&statements[0]["node"];
        if node["type"]!="SELECT_NODE" || node["from_table"]["type"]!="EMPTY" || !empty(node.get("cte_map"))
            || node.as_object().is_none_or(|o|o.keys().any(|k|!["type","cte_map","select_list","from_table","aggregate_handling"].contains(&k.as_str()))) {
            return Err(invalid("Escribe solo una fórmula por fila, sin SELECT, FROM ni otras instrucciones SQL."));
        }
        let select=array(node,"select_list")?;
        if select.len()!=1 {return Err(invalid("La fórmula debe devolver un solo valor por fila."));}
        let mut inputs=Vec::new();validate_expression(&select[0],columns,&mut inputs,0)?;
        Ok(inputs)
    }
    pub(super) fn derived_column(&self,formula:&DerivedDefinition,relation:&str)->Result<Column> {
        let sql=format!("DESCRIBE SELECT TRY((\n{}\n)) AS {} FROM {relation}",formula.expression,ident(&formula.id));
        let data_type:String=self.conn.query_row(&sql,[],|r|r.get(1)).map_err(|_|invalid("La fórmula no es compatible con los tipos de estas columnas. Prueba TRY_CAST para convertirlos."))?;
        let kind=kind_from_type(&data_type);
        if data_type.ends_with("[]") || data_type.starts_with("STRUCT") || data_type.starts_with("MAP") || data_type=="INTERVAL" || data_type=="BLOB" {return Err(invalid("La fórmula debe producir números, texto, fechas o valores sí/no."));}
        Ok(Column{id:formula.id.clone(),name:formula.name.trim().into(),data_type,kind,spss:None})
    }
    fn derived_sql(formula:&DerivedDefinition,column:&Column)->String {
        let expr=format!("TRY((\n{}\n))",formula.expression);
        if column.kind==VariableKind::Numeric {format!("CASE WHEN isfinite({expr}) THEN {expr} ELSE NULL END")}else{expr}
    }
    pub(super) fn refresh_derived_view(&self)->Result<Vec<Column>> {
        let mut columns=self.source_columns.iter().chain(&self.result_columns).cloned().collect::<Vec<_>>();
        let mut derived=Vec::new();let mut relation="dl_typed".to_string();
        for (i,formula) in self.derived_columns.iter().enumerate() {
            self.validate_derived(formula,&columns)?;
            let mut column=self.derived_column(formula,&relation)?;
            let raw=format!("dl_formula_raw_{i}");
            self.conn.execute_batch(&format!("CREATE OR REPLACE TEMP VIEW {raw} AS SELECT *, {} AS {} FROM {relation}",Self::derived_sql(formula,&column),ident(&formula.id)))?;
            relation=format!("dl_formula_{i}");
            let expr=self.cast_expression_from(&column,self.dataset.type_overrides.get(&column.id),&raw)?;
            self.conn.execute_batch(&format!("CREATE OR REPLACE TEMP VIEW {relation} AS SELECT * EXCLUDE ({}), {} AS {} FROM {raw}",ident(&column.id),expr.0,ident(&column.id)))?;
            if let Some(kind)=self.dataset.type_overrides.get(&column.id){column.kind=kind.clone();column.data_type=expr.1;}
            columns.push(column.clone());derived.push(column);
        }
        self.conn.execute_batch(&format!("CREATE OR REPLACE TEMP VIEW dl_data AS SELECT * FROM {relation}"))?;
        Ok(derived)
    }
    fn derived_fingerprint(&self,formula:&DerivedDefinition)->Result<String> {
        Ok(hash(&serde_json::to_vec(&(self.dataset.revision.as_str(),formula,&self.dataset.columns,&self.dataset.type_overrides,&self.derived_columns))?))
    }
    pub fn preview_derived_column(&self,formula:&DerivedDefinition,row_ids:Option<&[String]>,filters:&[Filter])->Result<DerivedPreview> {
        self.check_source()?;
        if self.derived_columns.len()>=128 {return Err(invalid("Este archivo ya tiene 128 columnas calculadas."));}
        let input_columns=self.validate_derived(formula,&self.dataset.columns)?;
        let column=self.derived_column(formula,"dl_data")?;
        let ids=match row_ids {Some(ids) if ids.len()>3=>return Err(invalid("La vista previa admite como máximo 3 filas.")),Some(ids)=>ids.to_vec(),None=>self.row_ids(filters,0,3)?};
        let mut rows=Vec::new();let mut seen=HashSet::new();
        for row_id in ids {
            if !seen.insert(row_id.clone()){continue;}
            let ordinal=self.ordinal(&row_id)?;
            let inputs=self.row_values(&row_id,&input_columns)?;
            if serde_json::to_vec(&inputs)?.len()>64_000 {return Err(invalid("Las entradas de la muestra superan 64 KB por fila."));}
            let raw:Option<String>=self.conn.query_row(&format!("SELECT CAST({} AS VARCHAR) FROM dl_data WHERE {}={ordinal}",Self::derived_sql(formula,&column),ident(&self.rid)),[],|r|r.get(0))?;
            rows.push(DerivedPreviewRow{row_id,inputs,value:parse_cell(raw,&column)?});
        }
        self.check_source()?;
        Ok(DerivedPreview{dataset_revision:self.dataset.revision.clone(),fingerprint:self.derived_fingerprint(formula)?,column,input_columns,rows,total_rows:self.dataset.row_count.unwrap_or(0)})
    }
    pub fn create_derived_column(&mut self,formula:DerivedDefinition,expected_revision:&str,expected_fingerprint:&str)->Result<DerivedCreated> {
        self.check_source()?;
        if expected_revision!=self.dataset.revision || expected_fingerprint!=self.derived_fingerprint(&formula)? {return Err(invalid("La fórmula o los datos cambiaron. Revisa de nuevo la vista previa."));}
        let preview=self.preview_derived_column(&formula,Some(&[]),&[])?;
        let previous=self.read_project()?;let old_dataset=self.dataset.clone();
        self.derived_columns.push(formula);
        let result=(||->Result<ViewSaveResult>{
            self.refresh_types()?;
            let (view,enrichments)=previous.map(|p|(p.view,p.enrichments)).unwrap_or((Value::Null,json!([])));
            self.write_project(ProjectFile{format_version:1,dataset_id:self.dataset.id.clone(),source:self.source.clone(),columns:self.source_columns.clone(),view,enrichments,saved_at_ns:0,column_types:self.dataset.type_overrides.clone(),type_revision:self.type_revision,derived_columns:self.derived_columns.clone(),result_columns:self.result_columns.clone(),portable_hash:None,results_file:None,revision_id:None,parent_revision:None,resolved_revisions:vec![]})
        })();
        match result {Ok(save)=>Ok(DerivedCreated{dataset:self.dataset(),column:preview.column,save}),Err(error)=>{self.derived_columns.pop();self.dataset=old_dataset;self.refresh_view()?;Err(error)}}
    }
}
