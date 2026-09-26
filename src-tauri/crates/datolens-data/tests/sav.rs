use ambers::{Compression, MissingSpec, SpssMetadata, Value as SpssValue};
use arrow::{array::{Date32Array, Float64Array, StringArray}, record_batch::RecordBatch};
use datolens_data::{DataStore, ExportFormat, ExportRequest, Filter, PageRequest, VariableKind};
use serde_json::json;
use std::{fs, sync::Arc};

#[test]
fn sav_streaming_labels_filters_persistence_and_export() {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("microdatos.sav");
    let batch = RecordBatch::try_from_iter(vec![
        ("P1", Arc::new(Float64Array::from(vec![Some(1.0), Some(2.0), Some(99.0), None])) as _),
        ("PESO", Arc::new(Float64Array::from(vec![Some(1.25), Some(0.75), Some(1.0), Some(1.0)])) as _),
        ("TEXTO", Arc::new(StringArray::from(vec![Some("Sí"), Some("Niño"), Some("No contesta"), None])) as _),
        ("FECHA", Arc::new(Date32Array::from(vec![Some(20_000), Some(20_001), None, Some(20_003)])) as _),
    ]).unwrap();
    let mut meta = SpssMetadata::from_arrow_schema(batch.schema().as_ref());
    meta.variable_labels.insert("P1".into(), "¿Qué opción prefiere?".into());
    let labels = meta.variable_value_labels.entry("P1".into()).or_default();
    labels.insert(SpssValue::Numeric(1.0), "Sí".into());
    labels.insert(SpssValue::Numeric(2.0), "No".into());
    labels.insert(SpssValue::Numeric(99.0), "No contesta".into());
    meta.variable_missing_values.insert("P1".into(), vec![MissingSpec::Value(99.0)]);
    ambers::write_sav(&source, &batch, &meta, Compression::Bytecode, None).unwrap();
    let original = fs::read(&source).unwrap();
    let cache = dir.path().join("cache");
    let store = DataStore::open(&source, None, &cache).unwrap();
    let dataset = store.dataset();
    assert_eq!(dataset.row_count, Some(4));
    let q = dataset.columns.iter().find(|c| c.id == "P1").unwrap();
    assert_eq!(q.kind, VariableKind::Categorical);
    assert!(q.name.contains("¿Qué opción prefiere?"));
    assert_eq!(q.spss.as_ref().unwrap().value_labels["2"], "No");
    assert_eq!(q.spss.as_ref().unwrap().missing_values, vec!["99"]);
    let request = |filters| PageRequest { dataset_id: dataset.id.clone(), columns: vec!["P1".into(), "PESO".into(), "TEXTO".into(), "FECHA".into()], filters, sorting: vec![], offset: 0, limit: 10 };
    let page = store.query_page(request(vec![])).unwrap();
    assert_eq!(page.rows[0].values["P1"], json!("1"));
    assert_eq!(page.rows[0].values["PESO"], json!(1.25));
    assert_eq!(page.rows[1].values["TEXTO"], json!("Niño"));
    assert!(page.rows[0].values["FECHA"].as_str().unwrap().starts_with("2024-"));
    assert_eq!(page.rows[3].values["P1"], json!(null));
    let filtered = store.query_page(request(vec![Filter::Categorical { column: "P1".into(), selected: vec!["99".into()] }])).unwrap();
    assert_eq!(filtered.rows.len(), 1);
    assert_eq!(filtered.rows[0].values["TEXTO"], json!("No contesta"));
    store.save_view(json!({"formatVersion":1,"columns":{"order":["P1"]},"sorting":[],"filters":[],"variablePanel":{}})).unwrap();
    let exported = dir.path().join("selected.csv");
    store.export(ExportRequest { path: exported.to_string_lossy().into(), format: ExportFormat::Csv, filters: vec![], sorting: vec![], columns: vec!["P1".into(), "PESO".into()] }).unwrap();
    assert!(fs::read_to_string(&exported).unwrap().contains("99"));
    drop(store);
    let reopened = DataStore::open(&source, None, &cache).unwrap();
    assert_eq!(reopened.dataset().columns.iter().find(|c| c.id == "P1").unwrap().spss.as_ref().unwrap().value_labels["99"], "No contesta");
    assert_eq!(reopened.load_view().unwrap().unwrap()["formatVersion"], 1);
    assert_eq!(fs::read(&source).unwrap(), original);
}

#[test]
#[ignore = "Set DATOLENS_REAL_SAV_PATH to a local SPSS file and run explicitly"]
fn real_sav_opens_and_queries_without_changing_source() {
    let path = std::path::PathBuf::from(std::env::var("DATOLENS_REAL_SAV_PATH").expect("Set DATOLENS_REAL_SAV_PATH"));
    let before = fs::read(&path).unwrap();
    let cache = tempfile::tempdir().unwrap();
    let started = std::time::Instant::now();
    let store = DataStore::open(&path, None, cache.path()).unwrap();
    let elapsed = started.elapsed();
    let dataset = store.dataset();
    assert!(dataset.row_count.unwrap_or(0) > 0);
    assert!(!dataset.columns.is_empty());
    let first = dataset.columns.iter().take(3).map(|c| c.id.clone()).collect();
    let page = store.query_page(PageRequest { dataset_id: dataset.id.clone(), columns: first, filters: vec![], sorting: vec![], offset: 0, limit: 5 }).unwrap();
    assert!(!page.rows.is_empty());
    let labelled = dataset.columns.iter().filter(|c| c.spss.as_ref().is_some_and(|m| !m.value_labels.is_empty())).count();
    assert!(labelled > 0);
    if let Some(column) = dataset.columns.iter().find(|c| c.kind == VariableKind::Categorical && c.spss.as_ref().is_some_and(|m| !m.value_labels.is_empty())) {
        let distribution = store.distributions(&[column.id.clone()], &[]).unwrap();
        assert_eq!(distribution.total_rows, dataset.row_count.unwrap());
        let code = distribution.variables[0].bins.iter().find_map(|bin| bin.value.as_ref().and_then(|value| value.as_str())).unwrap();
        let filtered = store.query_page(PageRequest { dataset_id: dataset.id.clone(), columns: vec![column.id.clone()], filters: vec![Filter::Categorical { column: column.id.clone(), selected: vec![code.into()] }], sorting: vec![], offset: 0, limit: 5 }).unwrap();
        assert!(!filtered.rows.is_empty());
    }
    assert_eq!(fs::read(&path).unwrap(), before);
    println!("REAL_SAV rows={} columns={} labelled_columns={} open_ms={} first_page_rows={}", dataset.row_count.unwrap(), dataset.columns.len(), labelled, elapsed.as_millis(), page.rows.len());
}
