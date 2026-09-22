use datolens_data::*;
use serde_json::{json, Value};
use std::{fs,path::Path};
use tempfile::TempDir;
fn fixture()->(TempDir,DataStore){let d=TempDir::new().unwrap();let path=d.path().join("companies.csv");fs::copy(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/companies.csv"),&path).unwrap();let s=DataStore::open(&path,None,&d.path().join("cache")).unwrap();(d,s)}
fn page(s:&DataStore,filters:Vec<Filter>,sorting:Vec<SortRule>,offset:u64,limit:u32)->Page {s.query_page(PageRequest{dataset_id:s.dataset().id,columns:s.dataset().columns.iter().map(|c|c.id.clone()).collect(),filters,sorting,offset,limit}).unwrap()}
fn view()->Value {json!({"formatVersion":1,"columns":{"order":["revenue","company"],"hidden":["notes"],"widths":{"company":240}},"sorting":[{"id":"revenue","desc":true}],"filters":[],"variablePanel":{"order":["sector"],"hidden":[],"pinned":["revenue"],"relative":true,"sortModeByColumn":{}}})}
#[test] fn csv_types_precision_global_sort_and_stable_ids(){
    fn assert_send<T:Send>(){} assert_send::<DataStore>();
    let (_d,s)=fixture();assert_eq!(s.dataset().row_count,Some(5));
    assert_eq!(s.dataset().columns.iter().find(|c|c.id=="revenue").unwrap().kind,VariableKind::Numeric);
    let original=page(&s,vec![],vec![],0,10);assert_eq!(original.rows[0].values["identifier"],json!("9007199254740993"));
    let sorting=vec![SortRule{id:"revenue".into(),desc:true},SortRule{id:"company".into(),desc:false}];
    let p=page(&s,vec![],sorting.clone(),1,2);
    assert_eq!(p.rows.iter().map(|r|r.values["company"].as_str().unwrap()).collect::<Vec<_>>(),vec!["Beta","Delta"]);
    assert_eq!(p.rows[0].id,original.rows[0].id);assert_eq!(p.rows[1].id,original.rows[3].id);
    assert_eq!(page(&s,vec![],sorting,4,2).rows[0].values["revenue"],Value::Null);
}
#[test] fn crossfilters_table_count_and_all_distributions_agree(){
    let (_d,s)=fixture();let filters=vec![Filter::Categorical{column:"sector".into(),selected:vec!["Tech".into()]},Filter::Numeric{column:"revenue".into(),min:Some(15.),max:Some(25.)}];
    let p=page(&s,filters.clone(),vec![],0,10);assert_eq!(p.filtered_count,Some(2));assert_eq!(p.rows.len(),2);
    let stats=s.distributions(&["sector".into(),"revenue".into(),"founded".into()],&filters).unwrap();assert_eq!(stats.selected_count,2);assert_eq!(stats.total_rows,5);assert!(!stats.sampled);
    for dist in &stats.variables{assert_eq!(dist.bins.iter().map(|b|b.background).sum::<u64>(),5);assert_eq!(dist.bins.iter().map(|b|b.foreground).sum::<u64>(),2);}
    let null_bin=stats.variables[1].bins.iter().find(|b|b.value==Some(Value::Null)).unwrap();assert_eq!(null_bin.background,1);assert_eq!(null_bin.foreground,0);
}
#[test] fn reference_text_date_list_and_escaping_semantics(){
    let (_d,s)=fixture();
    let f=Filter::Text{column:"notes".into(),terms:vec![" hello ".into(),"world".into()],mode:TextMode::All,case_sensitive:false};assert_eq!(page(&s,vec![f],vec![],0,10).rows.len(),1);
    let f=Filter::Date{column:"founded".into(),start:Some("2020-01-01T00:00".into()),end:Some("2021-12-31".into())};assert_eq!(page(&s,vec![f],vec![],0,10).rows.len(),2);
    let f=Filter::Multivalued{column:"tags".into(),selected:vec!["A".into()],list_encoded:true};assert_eq!(page(&s,vec![f],vec![],0,10).rows.len(),2);
    let f=Filter::Categorical{column:"sector".into(),selected:vec!["Tech') OR TRUE --".into()]};assert!(page(&s,vec![f],vec![],0,10).rows.is_empty());
    let f=Filter::Text{column:"notes".into(),terms:vec!["%".into()],mode:TextMode::Any,case_sensitive:false};assert!(page(&s,vec![f],vec![],0,10).rows.is_empty());
}
#[test] fn durable_results_follow_identity_and_export_roundtrip(){
    let (d,mut s)=fixture();let ds=s.dataset();let row=page(&s,vec![],vec![],0,1).rows.remove(0);
    s.ensure_result_column(Column{id:"score".into(),name:"Score".into(),data_type:"DOUBLE".into(),kind:VariableKind::Numeric}).unwrap();
    let update=CellUpdate{row_id:row.id.clone(),column_id:"score".into(),value:json!(42.5),expected_dataset_revision:ds.revision.clone()};s.apply_results(&[update.clone()]).unwrap();s.apply_results(&[update]).unwrap();s.save_view(view()).unwrap();
    let target=d.path().join("result.parquet");s.export(ExportRequest{path:target.to_string_lossy().into(),format:ExportFormat::Parquet,filters:vec![],sorting:vec![SortRule{id:"company".into(),desc:false}],columns:vec!["company".into(),"identifier".into(),"score".into()]}).unwrap();
    drop(s);let s=DataStore::open(Path::new(&ds.source_path),None,&d.path().join("cache")).unwrap();assert_eq!(s.load_view().unwrap(),Some(view()));assert_eq!(s.row_values(&row.id,&["score".into()]).unwrap()["score"],json!(42.5));
    let filters=vec![Filter::Numeric{column:"score".into(),min:Some(40.),max:None}];assert_eq!(page(&s,filters,vec![],0,10).rows[0].id,row.id);
    let exported=DataStore::open(&target,None,&d.path().join("export-cache")).unwrap();let p=page(&exported,vec![],vec![],0,10);let beta=p.rows.iter().find(|r|r.values["company"]=="Beta").unwrap();assert_eq!(beta.values["score"],json!(42.5));assert_eq!(beta.values["identifier"],json!("9007199254740993"));
    let csv=d.path().join("result.csv");exported.export(ExportRequest{path:csv.to_string_lossy().into(),format:ExportFormat::Csv,filters:vec![],sorting:vec![],columns:vec!["company".into(),"score".into()]}).unwrap();assert_eq!(DataStore::open(&csv,None,&d.path().join("csv-cache")).unwrap().dataset().row_count,Some(5));
}
#[test] fn invalid_batches_do_not_destroy_saved_rows_and_stale_sources_are_rejected(){
    let (_d,mut s)=fixture();let ds=s.dataset();s.ensure_result_column(Column{id:"flag".into(),name:"Flag".into(),data_type:"BOOLEAN".into(),kind:VariableKind::Boolean}).unwrap();let id=s.row_ids(&[],0,1).unwrap().remove(0);
    let good=CellUpdate{row_id:id.clone(),column_id:"flag".into(),value:json!(true),expected_dataset_revision:ds.revision.clone()};s.apply_results(&[good.clone()]).unwrap();let mut invalid=good.clone();invalid.row_id="another:0".into();assert!(s.apply_results(&[good,invalid]).is_err());assert_eq!(s.row_values(&id,&["flag".into()]).unwrap()["flag"],json!(true));
    let mut stale=CellUpdate{row_id:id.clone(),column_id:"flag".into(),value:json!(false),expected_dataset_revision:"old".into()};assert!(s.apply_results(&[stale.clone()]).is_err());stale.expected_dataset_revision=ds.revision;stale.value=json!(123);assert!(s.apply_results(&[stale]).is_err());
    fs::write(&ds.source_path,"company\nReplaced\n").unwrap();assert!(matches!(s.row_values(&id,&["flag".into()]),Err(Error::SourceChanged)));
}
#[test] fn malformed_project_is_not_silently_restored_and_export_never_overwrites_source(){
    let (_d,s)=fixture();s.save_view(view()).unwrap();let mut invalid=view();invalid["formatVersion"]=json!(9);assert!(s.save_view(invalid).is_err());assert_eq!(s.load_view().unwrap(),Some(view()));
    let mut file:Value=serde_json::from_slice(&fs::read(s.project_path()).unwrap()).unwrap();file["datasetId"]=json!("wrong");fs::write(s.project_path(),serde_json::to_vec(&file).unwrap()).unwrap();assert!(s.load_view().is_err());
    assert!(s.export(ExportRequest{path:s.dataset().source_path,format:ExportFormat::Csv,filters:vec![],sorting:vec![],columns:vec!["company".into()]}).is_err());
}
#[test] fn xlsx_sheets_types_and_empty_header_names(){
    let d=TempDir::new().unwrap();let path=d.path().join("book.xlsx");let mut book=rust_xlsxwriter::Workbook::new();
    let sheet=book.add_worksheet();sheet.set_name("Companies").unwrap();sheet.write_string(0,0,"company").unwrap();sheet.write_string(0,1,"value").unwrap();sheet.write_string(0,2,"active").unwrap();sheet.write_string(1,0,"A").unwrap();sheet.write_number(1,1,12.5).unwrap();sheet.write_boolean(1,2,true).unwrap();sheet.write_string(2,0,"B").unwrap();sheet.write_number(2,1,2.).unwrap();sheet.write_boolean(2,2,false).unwrap();
    book.add_worksheet().set_name("Empty").unwrap();book.save(&path).unwrap();assert_eq!(DataStore::list_sheets(&path).unwrap(),vec!["Companies","Empty"]);
    let s=DataStore::open(&path,Some("Companies"),&d.path().join("cache")).unwrap();let p=page(&s,vec![],vec![],0,10);assert_eq!(p.rows.len(),2);assert_eq!(p.rows[0].values["value"],json!(12.5));assert_eq!(p.rows[0].values["active"],json!(true));assert!(DataStore::open(&path,Some("Missing"),&d.path().join("cache")).is_err());
}
#[test] fn native_lists_null_and_duplicate_elements(){
    let d=TempDir::new().unwrap();let path=d.path().join("lists.parquet");let c=duckdb::Connection::open_in_memory().unwrap();c.execute_batch(&format!("COPY (SELECT 1 AS id, ['A','A','B'] AS tags UNION ALL SELECT 2,['B'] UNION ALL SELECT 3,NULL) TO '{}' (FORMAT PARQUET)",path.display())).unwrap();
    let s=DataStore::open(&path,None,&d.path().join("cache")).unwrap();let f=Filter::Multivalued{column:"tags".into(),selected:vec!["A".into()],list_encoded:false};assert_eq!(page(&s,vec![f.clone()],vec![],0,10).rows.len(),1);let stats=s.distributions(&["tags".into()],&[f]).unwrap();assert_eq!(stats.variables[0].bins.iter().find(|b|b.value==Some(json!("A"))).unwrap().background,1);
}
#[test] #[ignore = "Run explicitly with --ignored --nocapture; writes a local 1M-row fixture"]
fn million_row_benchmark(){
    use std::time::Instant;
    let d=TempDir::new().unwrap();let path=d.path().join("million.parquet");let c=duckdb::Connection::open_in_memory().unwrap();c.execute_batch(&format!("COPY (SELECT i::BIGINT AS id, (i%100)::INTEGER AS category, (i*0.5)::DOUBLE AS amount FROM range(1000000) t(i)) TO '{}' (FORMAT PARQUET)",path.display())).unwrap();drop(c);
    let start=Instant::now();let s=DataStore::open(&path,None,&d.path().join("cache")).unwrap();let opened=start.elapsed();let p=page(&s,vec![],vec![],0,100);let first=start.elapsed();assert_eq!(p.rows.len(),100);
    let t=Instant::now();let p=page(&s,vec![Filter::Numeric{column:"amount".into(),min:Some(250000.),max:None}],vec![SortRule{id:"category".into(),desc:true},SortRule{id:"id".into(),desc:true}],0,100);let filtered=t.elapsed();assert_eq!(p.filtered_count,Some(500000));assert_eq!(p.rows[0].values["id"],json!(999999));
    let t=Instant::now();let stats=s.distributions(&["category".into(),"amount".into()],&[]).unwrap();let aggregates=t.elapsed();assert_eq!(stats.total_rows,1000000);
    println!("BENCH rows=1000000 bytes={} open_ms={} first_page_including_open_ms={} filter_sort_ms={} distributions_ms={} conditions=generated_then_opened_warm_os_cache",fs::metadata(&path).unwrap().len(),opened.as_millis(),first.as_millis(),filtered.as_millis(),aggregates.as_millis());
}

#[test] fn csv_late_text_outlier_is_preserved_after_default_sniff_window(){
    use std::io::Write;
    let d=TempDir::new().unwrap();let path=d.path().join("late-outlier.csv");let mut f=fs::File::create(&path).unwrap();
    writeln!(f,"id,CADASTRALQUALITYID").unwrap();for i in 0..25000{writeln!(f,"{i},{}",if i==24632{"NA".into()}else{(i%17).to_string()}).unwrap();}drop(f);
    let s=DataStore::open(&path,None,&d.path().join("cache")).unwrap();assert_eq!(s.dataset().row_count,Some(25000));assert_eq!(s.dataset().columns.iter().find(|c|c.id=="CADASTRALQUALITYID").unwrap().data_type,"VARCHAR");
    let p=page(&s,vec![Filter::Categorical{column:"CADASTRALQUALITYID".into(),selected:vec!["NA".into()]}],vec![],0,10);assert_eq!(p.rows.len(),1);assert_eq!(p.rows[0].values["id"],json!(24632));assert_eq!(p.rows[0].values["CADASTRALQUALITYID"],json!("NA"));
}
#[test] fn negative_histogram_ranges_and_project_definition_mirror(){
    let d=TempDir::new().unwrap();let path=d.path().join("negative.csv");fs::write(&path,"company,revenue,notes,sector\nA,-10,n,T\nB,-5,n,T\nC,0,n,T\n").unwrap();let s=DataStore::open(&path,None,&d.path().join("cache")).unwrap();
    let stats=s.distributions(&["revenue".into()],&[]).unwrap();assert_eq!(stats.variables[0].bins.iter().map(|b|b.background).sum::<u64>(),3);
    let defs=json!([{"id":"demo","prompt":"Use {{company}}"}]);s.save_enrichments(defs.clone()).unwrap();assert_eq!(s.load_view().unwrap(),None);s.save_view(view()).unwrap();assert_eq!(s.load_enrichments().unwrap(),defs);s.save_enrichments(json!([])).unwrap();assert_eq!(s.load_view().unwrap(),Some(view()));
}

#[test] fn csv_out_of_bigint_tokens_and_mixed_decimals_survive_export_reopen(){
    let d=TempDir::new().unwrap();let source=d.path().join("precise.csv");
    let tokens=["9223372036854775808","9223372036854775809","18446744073709551615","123456789012345678901234567890","-9223372036854775809","+0009223372036854775809","1.25","1e3"];
    let csv=format!("identifier,amount,mixed\n{}",tokens.iter().enumerate().map(|(i,n)|format!("{n},{},{}\n",i as f64+0.25,if i==1{"NA"}else{n})).collect::<String>());
    fs::write(&source,&csv).unwrap();let s=DataStore::open(&source,None,&d.path().join("cache")).unwrap();
    assert_eq!(s.dataset().columns[0].data_type,"VARCHAR");assert_eq!(s.dataset().columns[1].data_type,"DOUBLE");assert_eq!(s.dataset().columns[2].data_type,"VARCHAR");
    let original=page(&s,vec![],vec![],0,100);
    for (row,token) in original.rows.iter().zip(tokens){assert_eq!(row.values["identifier"],json!(token));}
    assert_eq!(original.rows[1].values["mixed"],json!("NA"));assert_eq!(original.rows[1].values["amount"],json!(1.25));
    assert_eq!(page(&s,vec![Filter::Categorical{column:"identifier".into(),selected:vec!["9223372036854775809".into()]}],vec![],0,10).rows.len(),1);
    for (name,format) in [("roundtrip.csv",ExportFormat::Csv),("roundtrip.parquet",ExportFormat::Parquet)] {
        let target=d.path().join(name);s.export(ExportRequest{path:target.to_string_lossy().into(),format,columns:vec!["identifier".into(),"amount".into(),"mixed".into()],filters:vec![],sorting:vec![]}).unwrap();
        let reopened=DataStore::open(&target,None,&d.path().join(format!("cache-{name}"))).unwrap();let p=page(&reopened,vec![],vec![],0,100);
        assert_eq!(p.rows.iter().map(|r|&r.values).collect::<Vec<_>>(),original.rows.iter().map(|r|&r.values).collect::<Vec<_>>());
    }
    assert_eq!(fs::read_to_string(source).unwrap(),csv);
    // A decimal neighbour can force DOUBLE even when an unsafe integer still
    // fits BIGINT. Preserve those raw tokens too, without requiring overflow.
    let mixed=d.path().join("mixed-safe-range.csv");
    fs::write(&mixed,"identifier,amount\n9007199254740993,1.25\n1.25,2.5\n-9007199254740993,3.75\n").unwrap();
    let mixed=DataStore::open(&mixed,None,&d.path().join("mixed-cache")).unwrap();
    let p=page(&mixed,vec![],vec![],0,10);
    assert_eq!(mixed.dataset().columns[0].data_type,"VARCHAR");
    assert_eq!(p.rows[0].values["identifier"],json!("9007199254740993"));
    assert_eq!(p.rows[1].values["identifier"],json!("1.25"));
    assert_eq!(p.rows[2].values["identifier"],json!("-9007199254740993"));
    assert_eq!(mixed.dataset().columns[1].data_type,"DOUBLE");
}

#[test] fn csv_precision_upgrade_preserves_rows_results_view_and_recovers_json_migration(){
    let d=TempDir::new().unwrap();let source=d.path().join("legacy.csv");let cache=d.path().join("cache");
    fs::write(&source,"identifier,amount\n9223372036854775808,1.25\n9223372036854775809,2.5\n").unwrap();
    let mut s=DataStore::open(&source,None,&cache).unwrap();let dataset=s.dataset();let ids=s.row_ids(&[],0,10).unwrap();
    let saved_view=json!({"formatVersion":1,"columns":{"order":["amount","identifier"],"hidden":[],"widths":{"identifier":301}},"sorting":[{"id":"amount","desc":true}],"filters":[],"variablePanel":{"order":[],"hidden":[],"pinned":[]}});
    s.ensure_result_column(Column{id:"answer".into(),name:"Saved answer".into(),kind:VariableKind::Text,data_type:"VARCHAR".into()}).unwrap();
    s.apply_results(&[CellUpdate{row_id:ids[1].clone(),column_id:"answer".into(),value:json!("keep me"),expected_dataset_revision:dataset.revision.clone()}]).unwrap();
    s.save_view(saved_view.clone()).unwrap();let defs=json!([{"id":"answer","prompt":"keep definition"}]);s.save_enrichments(defs.clone()).unwrap();
    let db=s.database_path().to_owned();let project=s.project_path().to_owned();drop(s);
    // Recreate the old importer's persisted DOUBLE schema/table, including its
    // project JSON. No production cache or user source is touched by this test.
    let c=duckdb::Connection::open(&db).unwrap();c.execute_batch("ALTER TABLE dl_source ALTER COLUMN identifier TYPE DOUBLE; DELETE FROM dl_meta WHERE key='csv_exact_integers';").unwrap();
    let old:String=c.query_row("SELECT value FROM dl_meta WHERE key='source_columns'",[],|r|r.get(0)).unwrap();let mut cols:Value=serde_json::from_str(&old).unwrap();cols[0]["dataType"]=json!("DOUBLE");cols[0]["kind"]=json!("numeric");
    c.execute("UPDATE dl_meta SET value=? WHERE key='source_columns'",duckdb::params![cols.to_string()]).unwrap();drop(c);
    let mut p:Value=serde_json::from_slice(&fs::read(&project).unwrap()).unwrap();p["columns"]=cols;let old_json=serde_json::to_vec(&p).unwrap();fs::write(&project,&old_json).unwrap();
    let legacy=DataStore::open(&source,None,&cache).unwrap();let old_revision=legacy.dataset().revision;assert_ne!(old_revision,dataset.revision);drop(legacy);
    let c=duckdb::Connection::open(&db).unwrap();c.execute_batch("UPDATE dl_meta SET value='2' WHERE key='csv_import_version'").unwrap();drop(c);
    let repaired=DataStore::open(&source,None,&cache).unwrap();assert_eq!(repaired.dataset().id,dataset.id);assert_ne!(repaired.dataset().revision,old_revision);assert_eq!(repaired.row_ids(&[],0,10).unwrap(),ids);
    assert_eq!(repaired.load_view().unwrap(),Some(saved_view.clone()));assert_eq!(repaired.load_enrichments().unwrap(),defs);
    let values=repaired.row_values(&ids[1],&["identifier".into(),"answer".into()]).unwrap();assert_eq!(values["identifier"],json!("9223372036854775809"));assert_eq!(values["answer"],json!("keep me"));drop(repaired);
    // Simulate a crash between transactional DB commit and atomic JSON update.
    fs::write(&project,old_json).unwrap();let recovered=DataStore::open(&source,None,&cache).unwrap();assert_eq!(recovered.load_view().unwrap(),Some(saved_view));assert_eq!(recovered.load_enrichments().unwrap(),defs);
}
