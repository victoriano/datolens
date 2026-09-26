use datolens_data::*;
use serde_json::json;
use std::fs;
use tempfile::TempDir;

#[test]
fn inferred_dialect_quotes_newlines_and_quoted_identifiers_are_replayed_losslessly() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("l'été.csv");
    fs::write(&path, "label;price;date;we'ird\r\n\"a;b\";1.25;31/12/2024;9007199254740993\r\n\"two\r\nlines\";2.5;01/01/2025;9007199254740995\r\n\"say \"\"hi\"\"\";3;02/01/2025;123456789012345678901234567890\r\n").unwrap();
    let store = DataStore::open(&path, None, &dir.path().join("cache")).unwrap();
    let dataset = store.dataset();
    let page = store.query_page(PageRequest { dataset_id: dataset.id, columns: dataset.columns.iter().map(|c| c.id.clone()).collect(), filters: vec![], sorting: vec![], offset: 0, limit: 10 }).unwrap();
    assert_eq!(page.rows.len(), 3);
    assert_eq!(page.rows[0].values["label"], json!("a;b"));
    assert_eq!(page.rows[1].values["label"], json!("two\r\nlines"));
    assert_eq!(page.rows[2].values["label"], json!("say \"hi\""));
    assert_eq!(page.rows[0].values["date"], json!("2024-12-31"));
    assert_eq!(page.rows[0].values["price"], json!(1.25));
    assert_eq!(page.rows[2].values["we'ird"], json!("123456789012345678901234567890"));
}

#[test]
fn late_date_disambiguation_is_kept_after_the_first_sniff_window() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("dates.csv");
    let mut csv = String::from("id,date\n");
    for i in 0..25_000 { csv.push_str(&format!("{i},01/02/2024\n")); }
    csv.push_str("25000,31/12/2024\n");
    fs::write(&path,csv).unwrap();
    let store = DataStore::open(&path,None,&dir.path().join("cache")).unwrap();
    let page = store.query_page(PageRequest { dataset_id:store.dataset().id,columns:vec!["date".into()],filters:vec![],sorting:vec![],offset:25_000,limit:1 }).unwrap();
    assert_eq!(page.rows[0].values["date"],json!("2024-12-31"));
}
