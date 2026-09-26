use datolens_data::*;
use serde_json::json;
use std::fs;
use tempfile::TempDir;

fn fixture(rows: u64) -> (TempDir, DataStore) {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("ordered.csv");
    let mut csv = String::from("id,amount,group,tags\n");
    for i in 0..rows { csv.push_str(&format!("{},{},{},\"[a,a,b]\"\n", 9_007_199_254_740_993u64 + i, i, if i < rows / 2 { "A" } else { "B" })); }
    fs::write(&path, csv).unwrap();
    let store = DataStore::open(&path, None, &dir.path().join("cache")).unwrap();
    (dir, store)
}
fn options(rows: u64) -> DistributionOptions { DistributionOptions { sampling: AnalysisSampling::Rows { rows }, statistics: Some(vec![]) } }
fn page(store: &DataStore, filters: Vec<Filter>) -> Page {
    store.query_page(PageRequest { dataset_id: store.dataset().id, columns: vec!["id".into()], filters, sorting: vec![], offset: 0, limit: 10 }).unwrap()
}

#[test]
fn sample_is_stable_representative_and_never_limits_table_or_export() {
    let (dir, store) = fixture(10_000);
    let original = page(&store, vec![]);
    let ids = vec!["group".into(), "amount".into(), "tags".into()];
    let a = store.distributions_with_options(&ids, &[], &options(1_000)).unwrap();
    assert_eq!((a.total_rows, a.analyzed_rows, a.selected_count, a.sampled), (10_000, 1_000, 1_000, true));
    assert!(a.variables.iter().all(|v| v.statistics.is_none()));
    assert_eq!(a.variables[0].bins.iter().map(|b| b.background).sum::<u64>(), 1_000);
    // The source is ordered by group; a LIMIT prefix would have no B values.
    for bin in &a.variables[0].bins { assert!(bin.background > 350 && bin.background < 650); }
    let filter = vec![Filter::Categorical { column: "group".into(), selected: vec!["B".into()] }];
    let b = store.distributions_with_options(&ids, &filter, &options(1_000)).unwrap();
    assert_eq!(b.selected_count, a.variables[0].bins.iter().find(|b| b.value == Some(json!("B"))).unwrap().background);
    for (before, after) in a.variables.iter().zip(&b.variables) {
        assert_eq!(before.bins.iter().map(|b| b.background).collect::<Vec<_>>(), after.bins.iter().map(|b| b.background).collect::<Vec<_>>());
    }
    assert_eq!(a.variables[2].bins[0].background, 1_000); // duplicate list elements count once
    assert_eq!(serde_json::to_value(store.distributions_with_options(&ids, &[], &options(1_000)).unwrap()).unwrap(), serde_json::to_value(&a).unwrap());
    let full_page = page(&store, filter.clone());
    assert_eq!(full_page.filtered_count, Some(5_000));
    assert_eq!(page(&store, vec![]).rows[0].id, original.rows[0].id);
    assert_eq!(page(&store, vec![]).rows[0].values["id"], json!("9007199254740993"));
    let later = store.query_page(PageRequest { dataset_id: store.dataset().id, columns: vec!["amount".into()], filters: vec![], sorting: vec![], offset: 9_995, limit: 10 }).unwrap();
    assert_eq!(later.filtered_count, Some(10_000));
    assert_eq!(later.rows.len(), 5);
    assert_eq!(later.rows[0].values["amount"], json!(9_995));
    let path = dir.path().join("all-filtered.parquet");
    store.export(ExportRequest { path: path.to_string_lossy().into(), format: ExportFormat::Parquet, filters: filter, sorting: vec![], columns: vec!["id".into()] }).unwrap();
    assert_eq!(DataStore::open(&path, None, &dir.path().join("export-cache")).unwrap().dataset().row_count, Some(5_000));
    let source = store.dataset().source_path;
    drop(store);
    let reopened = DataStore::open(std::path::Path::new(&source), None, &dir.path().join("cache")).unwrap();
    assert_eq!(serde_json::to_value(reopened.distributions_with_options(&ids, &[], &options(1_000)).unwrap()).unwrap(), serde_json::to_value(a).unwrap());
}

#[test]
fn auto_full_manual_resize_and_requested_statistics_use_the_correct_population() {
    let (_dir, store) = fixture(120_000);
    let ids = vec!["group".into(), "amount".into()];
    let auto = store.distributions_with_options(&ids, &[], &DistributionOptions { statistics: Some(vec![]), ..Default::default() }).unwrap();
    assert!(auto.sampled);
    assert_eq!(auto.analyzed_rows, auto.automatic_rows);
    let mut opt = options(500);
    opt.statistics = Some(vec!["amount".into()]);
    let sample = store.distributions_with_options(&ids, &[], &opt).unwrap();
    assert_eq!(sample.analyzed_rows, 500);
    assert!(sample.variables[0].statistics.is_none());
    assert_eq!(sample.variables[1].statistics.as_ref().unwrap().count, 500);
    let full = store.distributions(&ids, &[]).unwrap();
    assert!(!full.sampled);
    assert_eq!(full.analyzed_rows, 120_000);
    assert_eq!(full.variables[1].statistics.as_ref().unwrap().mean.as_deref(), Some("59999.5"));
    let again = store.distributions_with_options(&ids, &[], &opt).unwrap();
    assert_eq!(serde_json::to_value(&sample).unwrap(), serde_json::to_value(again).unwrap());
    assert!(store.distributions_with_options(&ids, &[], &options(0)).is_err());
    assert!(store.distributions_with_options(&ids, &[], &options(5_000_001)).is_err());
}

#[test]
fn sample_cache_refreshes_after_cast_and_cell_updates_and_survives_view_save() {
    let (_dir, mut store) = fixture(100);
    let opt = options(50);
    let ids = vec!["amount".into()];
    store.distributions_with_options(&ids, &[], &opt).unwrap();
    let rev = store.dataset().revision;
    store.cast_column("amount", Some(VariableKind::Categorical), &rev).unwrap();
    assert_eq!(store.distributions_with_options(&ids, &[], &opt).unwrap().variables[0].kind, VariableKind::Categorical);
    store.ensure_result_column(Column { id: "score".into(), name: "score".into(), data_type: String::new(), kind: VariableKind::Numeric, spss: None }).unwrap();
    let ids = vec!["score".into()];
    let opt = DistributionOptions { sampling: AnalysisSampling::Rows { rows: 50 }, statistics: None };
    assert_eq!(store.distributions_with_options(&ids, &[], &opt).unwrap().variables[0].statistics.as_ref().unwrap().count, 0);
    let updates: Vec<_> = store.row_ids(&[], 0, 100).unwrap().into_iter().map(|row_id| CellUpdate { row_id, column_id: "score".into(), value: json!(42), expected_dataset_revision: store.dataset().revision }).collect();
    store.apply_results(&updates).unwrap();
    let result = store.distributions_with_options(&ids, &[], &opt).unwrap();
    assert_eq!(result.variables[0].statistics.as_ref().unwrap().count, 50);
    assert_eq!(result.variables[0].statistics.as_ref().unwrap().mean.as_deref(), Some("42.0"));
    store.save_view(json!({"formatVersion":1,"filters":[],"sorting":[],"columns":{},"variablePanel":{},"analysisSampling":{"mode":"rows","rows":50}})).unwrap();
    assert_eq!(store.load_view().unwrap().unwrap()["analysisSampling"]["rows"], 50);
    let source = store.dataset().source_path;
    let cache = store.database_path().parent().unwrap().to_owned();
    drop(store);
    let reopened = DataStore::open(std::path::Path::new(&source), None, &cache).unwrap();
    assert_eq!(reopened.distributions_with_options(&ids, &[], &opt).unwrap().variables[0].statistics.as_ref().unwrap().count, 50);
}

#[test]
fn small_and_empty_datasets_and_empty_selections_have_valid_counts() {
    let (_dir, store) = fixture(5);
    let result = store.distributions_with_options(&["amount".into()], &[], &options(100)).unwrap();
    assert!(!result.sampled);
    assert_eq!(result.analyzed_rows, 5);
    let empty = store.distributions_with_options(&["amount".into()], &[Filter::Numeric { column: "amount".into(), min: Some(999.), max: None }], &options(2)).unwrap();
    assert_eq!(empty.selected_count, 0);
    assert!(empty.variables[0].bins.iter().all(|bin| bin.r_foreground == 0.));
    let (_dir, store) = fixture(0);
    let result = store.distributions_with_options(&[], &[], &options(100)).unwrap();
    assert_eq!((result.total_rows, result.analyzed_rows, result.selected_count, result.sampled), (0, 0, 0, false));
}

#[test]
fn wide_sample_projects_columns_lazily_including_offscreen_filters_and_reopens() {
    use duckdb::Connection;
    let dir=TempDir::new().unwrap(); let path=dir.path().join("wide.parquet");
    let conn=Connection::open_in_memory().unwrap();
    let projection=(0..300).map(|i|format!("(i+{i})::DOUBLE AS c{i}")).collect::<Vec<_>>().join(",");
    conn.execute_batch(&format!("COPY (SELECT {projection} FROM range(10000) t(i)) TO '{}' (FORMAT PARQUET, ROW_GROUP_SIZE 2048)",path.display())).unwrap();
    let cache=dir.path().join("cache"); let store=DataStore::open(&path,None,&cache).unwrap();
    let database=store.database_path().to_owned();
    let opt=DistributionOptions{statistics:Some(vec![]),..Default::default()};
    let a=store.distributions_with_options(&["c0".into(),"c1".into()],&[],&opt).unwrap();
    assert!(a.sampled);assert_eq!(a.analyzed_rows,a.automatic_rows);
    drop(store);
    let schema_count=||Connection::open(&database).unwrap().query_row("SELECT count(*) FROM pragma_table_info('dl_analysis_sample')",[],|r|r.get::<_,u64>(0)).unwrap();
    assert_eq!(schema_count(),3,"only row id and two requested columns");
    let store=DataStore::open(&path,None,&cache).unwrap();
    let filter=vec![Filter::Numeric{column:"c299".into(),min:Some(5299.),max:None}];
    let b=store.distributions_with_options(&["c0".into()],&filter,&opt).unwrap();
    drop(store);
    assert_eq!(schema_count(),4,"offscreen filter adds only its own column");
    assert!(b.selected_count>1500 && b.selected_count<2500);
    assert_eq!(a.variables[0].bins.iter().map(|bin|bin.background).collect::<Vec<_>>(),b.variables[0].bins.iter().map(|bin|bin.background).collect::<Vec<_>>());
    let reopened=DataStore::open(&path,None,&cache).unwrap();
    let again=reopened.distributions_with_options(&["c0".into()],&filter,&opt).unwrap();
    assert_eq!(serde_json::to_value(&b).unwrap(),serde_json::to_value(&again).unwrap());
    let inspect=Connection::open(&database).unwrap();
    assert_eq!(inspect.query_row("SELECT count(*) FROM pragma_table_info('dl_analysis_sample')",[],|r|r.get::<_,u64>(0)).unwrap(),4);
}
