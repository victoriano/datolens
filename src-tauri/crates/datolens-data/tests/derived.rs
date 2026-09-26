use datolens_data::*;
use serde_json::{json,Value};
use std::{fs,path::Path};
use tempfile::TempDir;

fn fixture()->(TempDir,DataStore) {
    let dir=TempDir::new().unwrap();let source=dir.path().join("houses.csv");
    fs::write(&source,"price,area,city,date\n100000,50,Madrid,2024-01-02\n240000,80,Sevilla,2024-02-03\n60000,0,Madrid,2024-03-04\n80000,40,Madrid,2024-04-05\n").unwrap();
    let store=DataStore::open(&source,None,&dir.path().join("cache")).unwrap();(dir,store)
}
fn formula(id:&str,expression:&str)->DerivedDefinition {DerivedDefinition{id:id.into(),name:id.into(),expression:expression.into()}}
fn create(store:&mut DataStore,f:DerivedDefinition)->DerivedCreated {
    let p=store.preview_derived_column(&f,None,&[]).unwrap();
    store.create_derived_column(f,&p.dataset_revision,&p.fingerprint).unwrap()
}
fn values(store:&DataStore,id:&str)->Vec<Value> {
    store.query_page(PageRequest{dataset_id:store.dataset().id,columns:vec![id.into()],filters:vec![],sorting:vec![],offset:0,limit:100}).unwrap().rows.into_iter().map(|r|r.values[id].clone()).collect()
}
#[test]
fn preview_is_bounded_local_filtered_and_does_not_create_any_column_or_project() {
    let (_dir,store)=fixture();let before=fs::read(&store.dataset().source_path).unwrap();
    let f=formula("price_m2","round(\"price\" / nullif(\"area\", 0), 2)");
    let p=store.preview_derived_column(&f,None,&[Filter::Categorical{column:"city".into(),selected:vec!["Madrid".into()]}]).unwrap();
    assert_eq!(p.rows.len(),3);assert_eq!(p.input_columns,vec!["price","area"]);assert_eq!(p.total_rows,4);
    assert_eq!(p.rows.iter().map(|r|r.value.clone()).collect::<Vec<_>>(),vec![json!(2000.0),Value::Null,json!(2000.0)]);
    assert_eq!(store.dataset().columns.len(),4);assert!(!store.project_path().exists());assert_eq!(fs::read(&store.dataset().source_path).unwrap(),before);
    let ids=store.row_ids(&[],0,4).unwrap();assert!(store.preview_derived_column(&f,Some(&ids),&[]).is_err());
    assert!(store.preview_derived_column(&f,Some(&["other:0".into()]),&[]).is_err());
}
#[test]
fn create_projects_all_rows_and_survives_export_and_fresh_cache_reopen() {
    let (dir,mut store)=fixture();let before=fs::read(&store.dataset().source_path).unwrap();let revision=store.dataset().revision;
    create(&mut store,formula("price_m2","\"price\" / nullif(\"area\",0)"));
    create(&mut store,formula("label","CASE WHEN \"price_m2\" >= 2500 THEN 'alto' ELSE 'otro' END"));
    assert_eq!(values(&store,"price_m2"),vec![json!(2000.0),json!(3000.0),Value::Null,json!(2000.0)]);
    assert_eq!(values(&store,"label"),vec![json!("otro"),json!("alto"),json!("otro"),json!("otro")]);
    assert_eq!(store.dataset().revision,revision,"adding a projection must not invalidate unrelated AI results");
    let p=store.query_page(PageRequest{dataset_id:store.dataset().id,columns:vec!["label".into()],filters:vec![Filter::Numeric{column:"price_m2".into(),min:Some(2500.),max:None}],sorting:vec![SortRule{id:"price_m2".into(),desc:true}],offset:0,limit:3}).unwrap();assert_eq!(p.rows.len(),1);
    let exported=dir.path().join("out.parquet");store.export(ExportRequest{path:exported.to_string_lossy().into(),format:ExportFormat::Parquet,columns:vec!["price_m2".into(),"label".into()],filters:vec![],sorting:vec![]}).unwrap();
    let restored=DataStore::open(&exported,None,&dir.path().join("export")).unwrap();assert_eq!(values(&restored,"label"),values(&store,"label"));
    store.save_enrichments(json!([])).unwrap();let source=store.dataset().source_path;drop(store);
    let store=DataStore::open(Path::new(&source),None,&dir.path().join("fresh")).unwrap();
    assert_eq!(values(&store,"price_m2"),vec![json!(2000.0),json!(3000.0),Value::Null,json!(2000.0)]);assert_eq!(fs::read(source).unwrap(),before);
}
#[test]
fn rejects_stale_confirmation_expression_schema_and_source_changes() {
    let (_dir,mut store)=fixture();let f=formula("ratio","price / area");let p=store.preview_derived_column(&f,None,&[]).unwrap();
    let edited=formula("ratio","price * area");assert!(store.create_derived_column(edited,&p.dataset_revision,&p.fingerprint).is_err());
    create(&mut store,formula("more","area+1"));assert!(store.create_derived_column(f.clone(),&p.dataset_revision,&p.fingerprint).is_err());
    let p=store.preview_derived_column(&f,None,&[]).unwrap();fs::write(&store.dataset().source_path,"price,area\n1,1\n").unwrap();
    assert!(store.create_derived_column(f,&p.dataset_revision,&p.fingerprint).is_err());
}
#[test]
fn rejects_sql_statements_subqueries_external_access_aggregates_and_volatile_calls() {
    let (_dir,store)=fixture();
    for expression in ["(SELECT price FROM dl_data LIMIT 1)","price) FROM dl_data; SELECT (1","read_blob('/etc/passwd')","query('SELECT 1')","nextval('secret')","random()","current_timestamp","sum(price)","sum(price) OVER ()","price, area","price FROM dl_data","other.price","missing + 1","price + ?","*","main.read_text('/etc/passwd')","(SELECT content FROM read_text('/etc/passwd'))","1) UNION SELECT (2","area; DROP TABLE dl_source","row_number() OVER ()"] {
        assert!(store.preview_derived_column(&formula("unsafe",expression),None,&[]).is_err(),"accepted {expression}");
    }
    assert_eq!(values(&store,"area"),vec![json!(50),json!(80),json!(0),json!(40)]);
}
#[test]
fn supports_text_dates_boolean_casts_and_isolates_invalid_rows() {
    let (_dir,mut store)=fixture();
    create(&mut store,formula("city_lower","lower(city) || '-' || CAST(year(date) AS VARCHAR)"));
    create(&mut store,formula("condition","area BETWEEN 40 AND 60 AND price IS NOT NULL"));
    create(&mut store,formula("bad_cast","CAST(city AS DOUBLE)"));
    create(&mut store,formula("infinity","price / area"));
    assert_eq!(values(&store,"city_lower")[0],json!("madrid-2024"));
    assert_eq!(values(&store,"condition"),vec![json!(true),json!(false),json!(false),json!(true)]);
    assert!(values(&store,"bad_cast").iter().all(Value::is_null));assert!(values(&store,"infinity")[2].is_null());
}
#[test]
fn dependency_results_are_live_and_schema_restores_before_formulas() {
    let (dir,mut store)=fixture();
    store.ensure_result_column(Column{id:"ai_number".into(),name:"AI number".into(),data_type:String::new(),kind:VariableKind::Numeric,spss:None}).unwrap();
    create(&mut store,formula("double_ai","coalesce(ai_number,0)*2"));
    let row=store.row_ids(&[],0,1).unwrap()[0].clone();
    for number in [4,7] {store.apply_results(&[CellUpdate{row_id:row.clone(),column_id:"ai_number".into(),value:json!(number),expected_dataset_revision:store.dataset().revision}]).unwrap();assert_eq!(values(&store,"double_ai")[0],json!((number*2) as f64));}
    let source=store.dataset().source_path;drop(store);
    let reopened=DataStore::open(Path::new(&source),None,&dir.path().join("cache")).unwrap();assert_eq!(values(&reopened,"double_ai")[0],json!(14.0));drop(reopened);
    let fresh=DataStore::open(Path::new(&source),None,&dir.path().join("fresh")).unwrap();assert_eq!(values(&fresh,"double_ai")[0],json!(0.0));
}
#[test]
fn casts_respect_derived_dependencies_and_rollback_incompatible_changes() {
    let (_dir,mut store)=fixture();create(&mut store,formula("double_area","area*2"));
    let revision=store.dataset().revision;
    assert!(store.cast_column("area",Some(VariableKind::Categorical),&revision).is_err());
    assert_eq!(store.dataset().revision,revision);assert_eq!(values(&store,"double_area")[0],json!(100));
    let p=store.preview_cast("double_area",Some(&VariableKind::Text)).unwrap();store.cast_column("double_area",Some(VariableKind::Text),&p.dataset_revision).unwrap();
    assert_eq!(values(&store,"double_area")[0],json!("100"));
    let revision=store.dataset().revision;store.cast_column("double_area",None,&revision).unwrap();assert_eq!(values(&store,"double_area")[0],json!(100));
}
#[test]
fn reopening_revalidates_formulas_and_rejects_cycles_or_tampered_sql() {
    for expression in ["loop + 1","(SELECT content FROM read_text('/etc/passwd'))"] {
        let (_dir,mut store)=fixture();create(&mut store,formula("loop","area+1"));
        let source=store.dataset().source_path;let sidecar=store.project_path().to_path_buf();let cache=store.database_path().parent().unwrap().to_path_buf();drop(store);
        let mut project:Value=serde_json::from_slice(&fs::read(&sidecar).unwrap()).unwrap();project["derivedColumns"][0]["expression"]=json!(expression);fs::write(&sidecar,serde_json::to_vec(&project).unwrap()).unwrap();
        assert!(DataStore::open(Path::new(&source),None,&cache).is_err());
    }
}
