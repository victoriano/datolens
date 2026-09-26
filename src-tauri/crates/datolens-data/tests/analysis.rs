use datolens_data::*;
use serde_json::{json,Value};
use std::{fs,path::Path};
use tempfile::TempDir;

fn fixture(csv:&str)->(TempDir,DataStore) {
    let dir=TempDir::new().unwrap();let source=dir.path().join("analysis.csv");
    fs::write(&source,csv).unwrap();
    let store=DataStore::open(&source,None,&dir.path().join("cache")).unwrap();(dir,store)
}
fn page(s:&DataStore,filters:Vec<Filter>)->Page {
    s.query_page(PageRequest{dataset_id:s.dataset().id,columns:s.dataset().columns.iter().map(|c|c.id.clone()).collect(),filters,sorting:vec![],offset:0,limit:100}).unwrap()
}
fn view(s:&DataStore)->Value {
    let ids=s.dataset().columns.into_iter().map(|c|c.id).collect::<Vec<_>>();
    json!({"formatVersion":1,"columns":{"order":ids,"hidden":[],"widths":{}},"sorting":[],"filters":[],"variablePanel":{"order":ids,"hidden":[],"pinned":[],"metadata":{"amount":{"role":"target","group":"Precio"}},"statistics":["amount"]}})
}
#[test] fn statistics_are_exact_selected_row_aggregates_not_histogram_estimates() {
    let (_dir,s)=fixture("amount,group,date\n1,A,2024-01-01\n2,A,2024-01-02\n3,B,2024-01-03\n4,B,2024-01-04\n,B,\n");
    let dist=s.distributions(&["amount".into(),"group".into(),"date".into()],&[]).unwrap();
    let st=dist.variables[0].statistics.as_ref().unwrap();
    assert_eq!((st.count,st.missing,st.distinct),(4,1,4));
    for (v,n) in [(&st.min,1.),(&st.p25,1.75),(&st.median,2.5),(&st.mean,2.5),(&st.p75,3.25),(&st.max,4.)] {assert_eq!(v.as_ref().unwrap().parse::<f64>().unwrap(),n);}
    assert_eq!(dist.variables[1].statistics.as_ref().unwrap().distinct,2);
    assert!(dist.variables[2].statistics.as_ref().unwrap().median.as_ref().unwrap().starts_with("2024-01-02 12:00"));
    let filtered=s.distributions(&["amount".into()],&[Filter::Categorical{column:"group".into(),selected:vec!["B".into()]}]).unwrap();
    assert_eq!(filtered.variables[0].statistics.as_ref().unwrap().mean.as_deref(),Some("3.5"));assert_eq!(filtered.variables[0].statistics.as_ref().unwrap().missing,1);
    let empty=s.distributions(&["amount".into()],&[Filter::Numeric{column:"amount".into(),min:Some(100.),max:None}]).unwrap();
    assert_eq!(empty.variables[0].statistics.as_ref().unwrap().count,0);assert_eq!(empty.variables[0].statistics.as_ref().unwrap().min,None);
}
#[test] fn cast_preview_filter_export_persistence_and_auto_restore_originals() {
    let (dir,mut s)=fixture("amount,date,tags\n10,2024-01-01,\"[a,b]\"\n2,bad,broken\nwrong,2024-02-02,\"[b,c]\"\n,,\n");
    let source=s.dataset().source_path.clone();let original=fs::read(&source).unwrap();
    let ids=s.row_ids(&[],0,100).unwrap();let revision=s.dataset().revision.clone();let saved=view(&s);s.save_view(saved.clone()).unwrap();
    let preview=s.preview_cast("amount",Some(&VariableKind::Numeric)).unwrap();assert_eq!((preview.non_null_count,preview.invalid_count),(3,1));assert_eq!(preview.physical_type,"BIGINT");
    let result=s.cast_column("amount",Some(VariableKind::Numeric),&preview.dataset_revision).unwrap();assert_ne!(result.dataset.revision,revision);
    assert_eq!(page(&s,vec![]).rows[2].values["amount"],Value::Null);
    assert_eq!(page(&s,vec![Filter::Numeric{column:"amount".into(),min:Some(3.),max:None}]).filtered_count,Some(1));
    assert!(s.cast_column("amount",None,&revision).is_err());
    for (col,kind) in [("date",VariableKind::Date),("tags",VariableKind::Multivalued)] {
        let p=s.preview_cast(col,Some(&kind)).unwrap();assert_eq!(p.invalid_count,1);s.cast_column(col,Some(kind),&p.dataset_revision).unwrap();
    }
    assert_eq!(page(&s,vec![Filter::Multivalued{column:"tags".into(),selected:vec!["c".into()],list_encoded:false}]).filtered_count,Some(1));
    let exported=dir.path().join("typed.parquet");
    s.export(ExportRequest{path:exported.to_string_lossy().into(),format:ExportFormat::Parquet,filters:vec![],sorting:vec![SortRule{id:"amount".into(),desc:false}],columns:vec!["amount".into()]}).unwrap();
    let e=DataStore::open(&exported,None,&dir.path().join("export-cache")).unwrap();assert_eq!(page(&e,vec![]).rows[0].values["amount"],json!(2));drop(e);
    // An old view autosave cannot erase a type override.
    s.save_view(saved.clone()).unwrap();s.save_enrichments(json!([])).unwrap();let revised=s.dataset().revision;drop(s);
    let mut s=DataStore::open(Path::new(&source),None,&dir.path().join("fresh-cache")).unwrap();
    assert_eq!(s.dataset().revision,revised);assert_eq!(s.row_ids(&[],0,100).unwrap(),ids);assert_eq!(s.dataset().type_overrides.len(),3);
    assert_eq!(s.load_view().unwrap(),Some(saved));
    for col in ["amount","date","tags"] {let rev=s.dataset().revision;s.cast_column(col,None,&rev).unwrap();}
    assert_eq!(page(&s,vec![]).rows[2].values["amount"],json!("wrong"));assert!(s.dataset().type_overrides.is_empty());assert_eq!(fs::read(source).unwrap(),original);
}
#[test] fn numeric_cast_preserves_large_integer_ids_and_rejects_lossy_mixed_numbers() {
    let (dir,mut s)=fixture("identifier\n9007199254740993\n9223372036854775808\n123456789012345678901234567890\ninvalid\n");
    let p=s.preview_cast("identifier",Some(&VariableKind::Numeric)).unwrap();assert_eq!(p.invalid_count,1);
    s.cast_column("identifier",Some(VariableKind::Numeric),&p.dataset_revision).unwrap();
    let rows=page(&s,vec![]).rows;assert_eq!(rows[0].values["identifier"],json!("9007199254740993"));assert_eq!(rows[2].values["identifier"],json!("123456789012345678901234567890"));
    let path=dir.path().join("exact.parquet");s.export(ExportRequest{path:path.to_string_lossy().into(),format:ExportFormat::Parquet,columns:vec!["identifier".into()],filters:vec![],sorting:vec![]}).unwrap();
    let exported=DataStore::open(&path,None,&dir.path().join("export-cache")).unwrap();assert_eq!(page(&exported,vec![]).rows[2].values["identifier"],json!("123456789012345678901234567890"));
    let (_dir,s)=fixture("identifier\n9007199254740993\n1.25\ninvalid\n");assert!(s.preview_cast("identifier",Some(&VariableKind::Numeric)).unwrap_err().to_string().contains("precisión"));
}
#[test] fn result_cast_keeps_original_validation_and_auto_value() {
    let (_dir,mut s)=fixture("id\n1\n2\n");
    s.ensure_result_column(Column{id:"score".into(),name:"Score".into(),kind:VariableKind::Numeric,data_type:String::new(),spss:None}).unwrap();
    let row=s.row_ids(&[],0,1).unwrap()[0].clone();
    let rev=s.dataset().revision;s.cast_column("score",Some(VariableKind::Categorical),&rev).unwrap();
    s.apply_results(&[CellUpdate{row_id:row.clone(),column_id:"score".into(),value:json!(42),expected_dataset_revision:s.dataset().revision}]).unwrap();
    assert_eq!(s.row_values(&row,&["score".into()]).unwrap()["score"],json!("42.0"));
    let rev=s.dataset().revision;s.cast_column("score",None,&rev).unwrap();
    assert_eq!(s.row_values(&row,&["score".into()]).unwrap()["score"],json!(42.0));
}
