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
    s.ensure_result_column(Column{id:"score".into(),name:"Score".into(),data_type:"DOUBLE".into(),kind:VariableKind::Numeric,spss:None}).unwrap();
    let update=CellUpdate{row_id:row.id.clone(),column_id:"score".into(),value:json!(42.5),expected_dataset_revision:ds.revision.clone()};s.apply_results(&[update.clone()]).unwrap();s.apply_results(&[update]).unwrap();s.save_view(view()).unwrap();
    let target=d.path().join("result.parquet");s.export(ExportRequest{path:target.to_string_lossy().into(),format:ExportFormat::Parquet,filters:vec![],sorting:vec![SortRule{id:"company".into(),desc:false}],columns:vec!["company".into(),"identifier".into(),"score".into()]}).unwrap();
    drop(s);let s=DataStore::open(Path::new(&ds.source_path),None,&d.path().join("cache")).unwrap();assert_eq!(s.load_view().unwrap(),Some(view()));assert_eq!(s.row_values(&row.id,&["score".into()]).unwrap()["score"],json!(42.5));
    let filters=vec![Filter::Numeric{column:"score".into(),min:Some(40.),max:None}];assert_eq!(page(&s,filters,vec![],0,10).rows[0].id,row.id);
    let exported=DataStore::open(&target,None,&d.path().join("export-cache")).unwrap();let p=page(&exported,vec![],vec![],0,10);let beta=p.rows.iter().find(|r|r.values["company"]=="Beta").unwrap();assert_eq!(beta.values["score"],json!(42.5));assert_eq!(beta.values["identifier"],json!("9007199254740993"));
    let csv=d.path().join("result.csv");exported.export(ExportRequest{path:csv.to_string_lossy().into(),format:ExportFormat::Csv,filters:vec![],sorting:vec![],columns:vec!["company".into(),"score".into()]}).unwrap();assert_eq!(DataStore::open(&csv,None,&d.path().join("csv-cache")).unwrap().dataset().row_count,Some(5));
}
#[test] fn invalid_batches_do_not_destroy_saved_rows_and_stale_sources_are_rejected(){
    let (_d,mut s)=fixture();let ds=s.dataset();s.ensure_result_column(Column{id:"flag".into(),name:"Flag".into(),data_type:"BOOLEAN".into(),kind:VariableKind::Boolean,spss:None}).unwrap();let id=s.row_ids(&[],0,1).unwrap().remove(0);
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
    s.ensure_result_column(Column{id:"answer".into(),name:"Saved answer".into(),kind:VariableKind::Text,data_type:"VARCHAR".into(),spss:None}).unwrap();
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

#[test] fn sidecar_restores_view_with_a_fresh_cache_and_preserves_source() {
    let (d,s)=fixture();let ds=s.dataset();let source=fs::read(&ds.source_path).unwrap();
    let mut saved=view();saved["workspace"]=json!({"mode":"variables","variablesVisible":false,"enrichmentsVisible":false,"pageOffset":100});
    saved["variablePanel"]["search"]=json!("rev");saved["variablePanel"]["expanded"]=json!(["sector"]);
    saved["categoryColors"]=json!({"sector":{"Retail":"#aabbcc","Public sector":"#102030"}});
    s.save_view(saved.clone()).unwrap();
    assert_eq!(s.project_path(),Path::new(&format!("{}.datolens.json",ds.source_path)));
    let json:Value=serde_json::from_slice(&fs::read(s.project_path()).unwrap()).unwrap();assert_eq!(json["view"],saved);
    drop(s);
    let reopened=DataStore::open(Path::new(&ds.source_path),None,&d.path().join("fresh-cache")).unwrap();
    assert_eq!(reopened.load_view().unwrap(),Some(saved));assert_eq!(fs::read(&ds.source_path).unwrap(),source);
}

#[test] fn portable_project_restores_view_definitions_and_results_on_another_mac() {
    let root=TempDir::new().unwrap();
    let first=root.path().join("first-mac");let second=root.path().join("second-mac");
    fs::create_dir_all(&first).unwrap();fs::create_dir_all(&second).unwrap();
    let source=first.join("clients.csv");fs::write(&source,"id,amount\nA,10\nB,20\n").unwrap();
    let mut owner=DataStore::open(&source,None,&first.join("local-cache")).unwrap();
    let saved=json!({"formatVersion":1,"columns":{"order":["amount","id"],"hidden":[],"widths":{}},"sorting":[],"filters":[{"column":"id","kind":"categorical","selected":["B"]}],"variablePanel":{"order":["id","amount"],"hidden":[],"pinned":[],"relative":false,"sortModeByColumn":{}}});
    owner.save_view(saved.clone()).unwrap();
    let definitions=json!([{"id":"answer","prompt":"shared"}]);owner.save_enrichments(definitions.clone()).unwrap();
    owner.ensure_result_column(Column{id:"answer".into(),name:"Answer".into(),kind:VariableKind::Text,data_type:"VARCHAR".into(),spss:None}).unwrap();
    let original_id=owner.row_ids(&[],1,1).unwrap().remove(0);
    owner.apply_results(&[CellUpdate{row_id:original_id.clone(),column_id:"answer".into(),value:json!("approved"),expected_dataset_revision:owner.dataset().revision}]).unwrap();
    owner.publish_portable_results().unwrap().unwrap();
    let project:Value=serde_json::from_slice(&fs::read(owner.project_path()).unwrap()).unwrap();
    assert_eq!(project["formatVersion"],2);
    let shared=second.join("clients.csv");fs::copy(&source,&shared).unwrap();
    fs::copy(owner.project_path(),second.join("clients.csv.datolens.json")).unwrap();
    let snapshot=project["resultsFile"].as_str().unwrap();
    let target=second.join("clients.csv.datolens").join(snapshot);
    fs::create_dir_all(target.parent().unwrap()).unwrap();
    fs::copy(first.join("clients.csv.datolens").join(snapshot),&target).unwrap();
    drop(owner);
    let reopened=DataStore::open(&shared,None,&second.join("local-cache")).unwrap();
    assert_ne!(reopened.dataset().id,original_id.split(':').next().unwrap());
    assert_eq!(reopened.load_view().unwrap(),Some(saved));
    assert_eq!(reopened.load_enrichments().unwrap(),definitions);
    let new_id=reopened.row_ids(&[],1,1).unwrap().remove(0);
    assert_eq!(reopened.row_values(&new_id,&["answer".into()]).unwrap()["answer"],json!("approved"));
    drop(reopened);
    // A same-length change must not attach another file's filters or row values.
    fs::write(&shared,"id,amount\nA,10\nC,20\n").unwrap();
    assert!(matches!(DataStore::open(&shared,None,&second.join("changed-cache")),Err(Error::SourceChanged)));
}

#[test] fn concurrent_shared_views_keep_both_heads_until_one_is_chosen() {
    let root=TempDir::new().unwrap();
    let first=root.path().join("a");let second=root.path().join("b");
    fs::create_dir_all(&first).unwrap();fs::create_dir_all(&second).unwrap();
    let source=first.join("clients.csv");fs::write(&source,"id\nA\nB\n").unwrap();
    let mut a=DataStore::open(&source,None,&first.join("cache")).unwrap();
    let base=json!({"formatVersion":1,"columns":{"order":["id"],"hidden":[],"widths":{}},"sorting":[],"filters":[],"variablePanel":{"order":["id"],"hidden":[],"pinned":[]}});
    a.save_view(base.clone()).unwrap();
    let source_b=second.join("clients.csv");fs::copy(&source,&source_b).unwrap();
    fs::copy(a.project_path(),second.join("clients.csv.datolens.json")).unwrap();
    let b=DataStore::open(&source_b,None,&second.join("cache")).unwrap();
    let mut left=base.clone();left["variablePanel"]["search"]=json!("owner");a.save_view(left.clone()).unwrap();
    let mut right=base;right["variablePanel"]["search"]=json!("collaborator");b.save_view(right.clone()).unwrap();
    let revisions_b=second.join("clients.csv.datolens/revisions");
    let revisions_a=first.join("clients.csv.datolens/revisions");
    for entry in fs::read_dir(revisions_b).unwrap(){let entry=entry.unwrap();let destination=revisions_a.join(entry.file_name());if !destination.exists(){fs::copy(entry.path(),destination).unwrap();}}
    let heads=a.shared_revisions().unwrap().into_iter().filter(|v|v.head).collect::<Vec<_>>();
    assert_eq!(heads.len(),2);
    let other=heads.iter().find(|v|!v.active).unwrap().id.clone();
    a.select_shared_revision(&other).unwrap();
    assert_eq!(a.load_view().unwrap(),Some(right));
    assert_eq!(a.shared_revisions().unwrap().into_iter().filter(|v|v.head).count(),1);
}

#[test] fn choosing_shared_branch_replaces_result_schema_and_values() {
    let root=TempDir::new().unwrap();
    let first=root.path().join("first");let second=root.path().join("second");
    fs::create_dir_all(&first).unwrap();fs::create_dir_all(&second).unwrap();
    let source=first.join("clients.csv");fs::write(&source,"id\nA\nB\n").unwrap();
    let mut a=DataStore::open(&source,None,&first.join("cache")).unwrap();
    let view=json!({"formatVersion":1,"columns":{"order":["id"],"hidden":[],"widths":{}},"sorting":[],"filters":[],"variablePanel":{"order":["id"],"hidden":[],"pinned":[]}});
    a.save_view(view).unwrap();
    let source_b=second.join("clients.csv");fs::copy(&source,&source_b).unwrap();
    fs::copy(a.project_path(),second.join("clients.csv.datolens.json")).unwrap();
    let mut b=DataStore::open(&source_b,None,&second.join("cache")).unwrap();
    a.ensure_result_column(Column{id:"owner".into(),name:"Owner".into(),kind:VariableKind::Text,data_type:"VARCHAR".into(),spss:None}).unwrap();
    let row_a=a.row_ids(&[],0,1).unwrap().remove(0);
    a.apply_results(&[CellUpdate{row_id:row_a,column_id:"owner".into(),value:json!("left"),expected_dataset_revision:a.dataset().revision}]).unwrap();
    a.publish_portable_results().unwrap();
    b.ensure_result_column(Column{id:"collaborator".into(),name:"Collaborator".into(),kind:VariableKind::Text,data_type:"VARCHAR".into(),spss:None}).unwrap();
    let row_b=b.row_ids(&[],0,1).unwrap().remove(0);
    b.apply_results(&[CellUpdate{row_id:row_b,column_id:"collaborator".into(),value:json!("right"),expected_dataset_revision:b.dataset().revision}]).unwrap();
    b.publish_portable_results().unwrap();
    let project_b:Value=serde_json::from_slice(&fs::read(b.project_path()).unwrap()).unwrap();
    let snapshot=project_b["resultsFile"].as_str().unwrap();
    let snapshot_to=first.join("clients.csv.datolens").join(snapshot);
    fs::create_dir_all(snapshot_to.parent().unwrap()).unwrap();
    fs::copy(second.join("clients.csv.datolens").join(snapshot),snapshot_to).unwrap();
    let revisions_b=second.join("clients.csv.datolens/revisions");
    let revisions_a=first.join("clients.csv.datolens/revisions");
    for entry in fs::read_dir(revisions_b).unwrap(){let entry=entry.unwrap();let destination=revisions_a.join(entry.file_name());if !destination.exists(){fs::copy(entry.path(),destination).unwrap();}}
    let remote_head=a.shared_revisions().unwrap().into_iter().find(|v|v.head&&!v.active).unwrap();
    a.select_shared_revision(&remote_head.id).unwrap();
    assert!(a.dataset().columns.iter().any(|c|c.id=="collaborator"));
    assert!(!a.dataset().columns.iter().any(|c|c.id=="owner"));
    let row=a.row_ids(&[],0,1).unwrap().remove(0);
    assert_eq!(a.row_values(&row,&["collaborator".into()]).unwrap()["collaborator"],json!("right"));
    assert_eq!(a.shared_revisions().unwrap().into_iter().filter(|v|v.head).count(),1);
}

#[test] fn remote_save_does_not_get_silently_overwritten() {
    let root=TempDir::new().unwrap();
    let first=root.path().join("first");let second=root.path().join("second");
    fs::create_dir_all(&first).unwrap();fs::create_dir_all(&second).unwrap();
    let source=first.join("clients.csv");fs::write(&source,"id\nA\n").unwrap();
    let a=DataStore::open(&source,None,&first.join("cache")).unwrap();
    let view=json!({"formatVersion":1,"columns":{"order":["id"],"hidden":[],"widths":{}},"sorting":[],"filters":[],"variablePanel":{"order":["id"],"hidden":[],"pinned":[]}});
    a.save_view(view.clone()).unwrap();
    let remote_source=second.join("clients.csv");fs::copy(&source,&remote_source).unwrap();
    fs::copy(a.project_path(),second.join("clients.csv.datolens.json")).unwrap();
    let b=DataStore::open(&remote_source,None,&second.join("cache")).unwrap();
    let mut remote_view=view.clone();remote_view["variablePanel"]["search"]=json!("remote");
    b.save_view(remote_view.clone()).unwrap();
    fs::copy(b.project_path(),a.project_path()).unwrap();
    let mut local_view=view;local_view["variablePanel"]["search"]=json!("local");
    assert!(a.save_view(local_view).is_err());
    assert_eq!(a.load_view().unwrap(),Some(remote_view));
    let current=a.shared_revisions().unwrap().into_iter().find(|revision|revision.head).unwrap();
    assert!(!current.active);
}

#[test] fn legacy_project_is_migrated_without_losing_definitions_or_results() {
    let (d,mut s)=fixture();let ds=s.dataset();let row=s.row_ids(&[],0,1).unwrap().remove(0);
    s.ensure_result_column(Column{id:"answer".into(),name:"Answer".into(),kind:VariableKind::Text,data_type:"VARCHAR".into(),spss:None}).unwrap();
    s.apply_results(&[CellUpdate{row_id:row.clone(),column_id:"answer".into(),value:json!("saved result"),expected_dataset_revision:ds.revision.clone()}]).unwrap();
    let definitions=json!([{"id":"answer","prompt":"Saved definition"}]);
    s.save_view(view()).unwrap();s.save_enrichments(definitions.clone()).unwrap();
    let sidecar=s.project_path().to_owned();let legacy=d.path().join("cache").join(format!("{}.datolens.json",ds.id));
    fs::rename(&sidecar,&legacy).unwrap();let legacy_bytes=fs::read(&legacy).unwrap();drop(s);
    let reopened=DataStore::open(Path::new(&ds.source_path),None,&d.path().join("cache")).unwrap();
    assert!(!sidecar.exists());assert_eq!(reopened.load_view().unwrap(),Some(view()));
    reopened.save_view(view()).unwrap();assert!(sidecar.exists());assert_eq!(reopened.load_enrichments().unwrap(),definitions);
    assert_eq!(reopened.row_values(&row,&["answer".into()]).unwrap()["answer"],json!("saved result"));
    assert_eq!(fs::read(&legacy).unwrap(),legacy_bytes);
    let mut incompatible:Value=serde_json::from_slice(&fs::read(&sidecar).unwrap()).unwrap();incompatible["datasetId"]=json!("foreign");
    let bytes=serde_json::to_vec(&incompatible).unwrap();fs::write(&sidecar,&bytes).unwrap();
    assert!(reopened.load_view().is_err());assert!(reopened.save_view(view()).is_err());assert_eq!(fs::read(&sidecar).unwrap(),bytes);
}

#[test] fn xlsx_sheet_sidecars_are_independent_and_safe() {
    let d=TempDir::new().unwrap();let source=d.path().join("book.xlsx");let mut book=rust_xlsxwriter::Workbook::new();
    for name in ["Ventas Norte","Ventas Sur"] {let sheet=book.add_worksheet();sheet.set_name(name).unwrap();sheet.write_string(0,0,"value").unwrap();sheet.write_number(1,0,1.).unwrap();}
    book.save(&source).unwrap();let cache=d.path().join("cache");
    let mut paths=vec![];
    for (index,name) in ["Ventas Norte","Ventas Sur"].iter().enumerate() {
        let s=DataStore::open(&source,Some(name),&cache).unwrap();
        let v=json!({"formatVersion":1,"columns":{"order":["value"],"hidden":[],"widths":{"value":200+index}},"sorting":[],"filters":[],"variablePanel":{"order":["value"],"hidden":[],"pinned":[]}});
        s.save_view(v).unwrap();paths.push(s.project_path().to_owned());assert_eq!(s.project_path().parent().unwrap(),source.canonicalize().unwrap().parent().unwrap());
    }
    assert_ne!(paths[0],paths[1]);
    for (index,name) in ["Ventas Norte","Ventas Sur"].iter().enumerate() {
        let s=DataStore::open(&source,Some(name),&cache).unwrap();assert_eq!(s.load_view().unwrap().unwrap()["columns"]["widths"]["value"],json!(200+index));
    }
}

#[cfg(unix)]
struct ReadOnlyDir { path:std::path::PathBuf, permissions:fs::Permissions }
#[cfg(unix)]
impl ReadOnlyDir {
    fn new(path:&Path)->Self {
        use std::os::unix::fs::PermissionsExt;
        let permissions=fs::metadata(path).unwrap().permissions();
        fs::set_permissions(path,fs::Permissions::from_mode(0o555)).unwrap();
        Self{path:path.to_owned(),permissions}
    }
}
#[cfg(unix)]
impl Drop for ReadOnlyDir {fn drop(&mut self){fs::set_permissions(&self.path,self.permissions.clone()).unwrap();}}

#[cfg(unix)]
#[test] fn read_only_source_saves_locally_and_preserves_legacy() {
    let (d,s)=fixture();let ds=s.dataset();let source_bytes=fs::read(&ds.source_path).unwrap();let cache=d.path().join("cache");
    let definitions=json!([{"id":"answer","prompt":"Preserve me"}]);s.save_view(view()).unwrap();s.save_enrichments(definitions.clone()).unwrap();
    let legacy=cache.join(format!("{}.datolens.json",ds.id));fs::rename(s.project_path(),&legacy).unwrap();let legacy_bytes=fs::read(&legacy).unwrap();
    let mut latest=view();latest["variablePanel"]["relative"]=json!(false);
    let _read_only=ReadOnlyDir::new(d.path());
    let saved=s.save_view(latest.clone()).unwrap();
    assert!(!saved.beside_source);assert!(saved.warning.as_ref().unwrap().contains(&saved.path));assert!(Path::new(&saved.path).exists());assert!(!s.project_path().exists());
    drop(s);let reopened=DataStore::open(Path::new(&ds.source_path),None,&cache).unwrap();
    assert_eq!(reopened.load_view().unwrap(),Some(latest));assert_eq!(reopened.load_enrichments().unwrap(),definitions);
    assert_eq!(fs::read(&legacy).unwrap(),legacy_bytes);assert_eq!(fs::read(&ds.source_path).unwrap(),source_bytes);
}

#[cfg(unix)]
#[test] fn newer_local_save_restores_and_returns_to_source_when_writable() {
    let (d,s)=fixture();let ds=s.dataset();let cache=d.path().join("cache");
    s.save_view(view()).unwrap();let sidecar=s.project_path().to_owned();let original=fs::read(&sidecar).unwrap();
    let mut latest=view();latest["workspace"]=json!({"mode":"variables","variablesVisible":true,"enrichmentsVisible":false,"pageOffset":0});
    let read_only=ReadOnlyDir::new(d.path());
    assert!(!s.save_view(latest.clone()).unwrap().beside_source);
    let definitions=json!([{"id":"answer","prompt":"New local definition"}]);
    assert!(s.save_enrichments(definitions.clone()).unwrap_err().to_string().contains("guardados en este Mac"));
    assert_eq!(fs::read(&sidecar).unwrap(),original);
    drop(s);let reopened=DataStore::open(Path::new(&ds.source_path),None,&cache).unwrap();
    assert_eq!(reopened.load_view().unwrap(),Some(latest.clone()));assert_eq!(reopened.load_enrichments().unwrap(),definitions);
    drop(read_only);
    let saved=reopened.save_view(latest.clone()).unwrap();assert!(saved.beside_source);assert!(saved.warning.is_none());assert_eq!(Path::new(&saved.path),sidecar);
    // A subsequent write must also outrank the retained recovery file.
    latest["variablePanel"]["relative"]=json!(false);reopened.save_view(latest.clone()).unwrap();drop(reopened);
    let reopened=DataStore::open(Path::new(&ds.source_path),None,&cache).unwrap();assert_eq!(reopened.load_view().unwrap(),Some(latest.clone()));assert_eq!(reopened.load_enrichments().unwrap(),definitions);
    let mut foreign:Value=serde_json::from_slice(&fs::read(&sidecar).unwrap()).unwrap();foreign["datasetId"]=json!("foreign");let bytes=serde_json::to_vec(&foreign).unwrap();fs::write(&sidecar,&bytes).unwrap();
    assert!(reopened.load_view().is_err());assert!(reopened.save_view(latest).is_err());assert_eq!(fs::read(&sidecar).unwrap(),bytes);
}

#[cfg(unix)]
#[test] fn failed_source_and_local_write_keep_previous_saved_view() {
    let (d,s)=fixture();s.save_view(view()).unwrap();let original=fs::read(s.project_path()).unwrap();
    let _source_read_only=ReadOnlyDir::new(d.path());let _cache_read_only=ReadOnlyDir::new(&d.path().join("cache"));
    let mut latest=view();latest["variablePanel"]["relative"]=json!(false);
    let error=s.save_view(latest).unwrap_err().to_string();assert!(error.contains("ni en este Mac"));
    assert_eq!(s.load_view().unwrap(),Some(view()));assert_eq!(fs::read(s.project_path()).unwrap(),original);
}
