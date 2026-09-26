//! Manual regression against the reported public file, using the native engine.
use datolens_data::{DataStore, PageRequest};
use std::{path::PathBuf, time::Instant};
fn main() {
    let dir = tempfile::tempdir().unwrap();
    let extension = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../vendor/httpfs/osx_arm64/httpfs.duckdb_extension");
    let start = Instant::now();
    let store = DataStore::open_remote_parquet_with_progress("https://data.pisa.victoriano.me/pisa_espana_2000_2025_estudiantes_todas_las_columnas.parquet", dir.path(), &extension, &|stage| eprintln!("{stage}")).unwrap();
    let ds = store.dataset();
    println!("opened {:?}: rows={:?}, columns={}", start.elapsed(), ds.row_count, ds.columns.len());
    let all = std::env::args().any(|arg| arg == "--all");
    for (col_start, offset) in [(0, 0), (1000, 100), (4900, 191200)] {
        let columns = if all { ds.columns.iter().map(|c| c.id.clone()).collect() } else { ds.columns.iter().skip(col_start).take(16).map(|c| c.id.clone()).collect() };
        let start = Instant::now();
        let page = store.query_page(PageRequest { dataset_id: ds.id.clone(), columns, filters: vec![], sorting: vec![], offset, limit: 100 }).unwrap();
        assert_eq!(page.rows.len(), (191254-offset).min(100) as usize);
        assert_eq!(page.rows[0].id, format!("{}:{offset}", ds.id));
        assert_eq!(page.filtered_count, Some(191254));
        println!("column={col_start}, offset={offset}, rows={}, fields={}, first={:?}, elapsed={:?}",page.rows.len(),page.rows[0].values.len(),page.rows[0].values,start.elapsed());
        if all { break; }
    }
}
