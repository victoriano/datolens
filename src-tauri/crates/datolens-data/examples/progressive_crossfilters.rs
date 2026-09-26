//! Live/native timings for viewport-only crossfilters and lazy sample projection.
use datolens_data::*;
use std::{path::PathBuf, time::Instant};
use serde_json::json;
fn main() {
    let args: Vec<_> = std::env::args().collect();
    let source = args.get(1).map(String::as_str).unwrap_or("https://data.pisa.victoriano.me/pisa_espana_2000_2025_estudiantes_todas_las_columnas.parquet");
    let temp = tempfile::tempdir().unwrap();
    let cache = args.get(2).map(PathBuf::from).unwrap_or_else(|| temp.path().to_owned());
    let extension = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../vendor/httpfs/osx_arm64/httpfs.duckdb_extension");
    let now = Instant::now();
    let store = if source.starts_with("http") { DataStore::open_remote_parquet_with_progress(source, &cache, &extension, &|_| {}).unwrap() } else { DataStore::open(std::path::Path::new(source), None, &cache).unwrap() };
    let ds=store.dataset();
    println!("{}",json!({"stage":"open","ms":now.elapsed().as_millis(),"columns":ds.columns.len(),"rows":ds.row_count}));
    let opt=DistributionOptions{sampling:AnalysisSampling::Auto,statistics:Some(vec![])};
    for (name,start,filters) in [("first_2",0,vec![]),("next_2",2,vec![]),("next_2",4,vec![]),("far_columns",ds.columns.len()-2,vec![]),("cached_first_2",0,vec![]),("filtered_first_2",0,vec![Filter::Numeric{column:ds.columns.last().unwrap().id.clone(),min:Some(500.),max:None}])] {
        let ids=ds.columns.iter().skip(start).take(2).map(|c|c.id.clone()).collect::<Vec<_>>();
        let now=Instant::now();
        let result=store.distributions_with_options(&ids,&filters,&opt).unwrap();
        println!("{}",json!({"stage":name,"ms":now.elapsed().as_millis(),"analyzed":result.analyzed_rows,"selected":result.selected_count,"columns":ids,"bins":result.variables.iter().map(|v|v.bins.len()).collect::<Vec<_>>(),"deferred":result.deferred_reason}));
        assert_eq!(result.variables.len(),2);assert!(result.deferred_reason.is_none());
        assert!(result.variables.iter().all(|v|v.bins.iter().map(|b|b.background).sum::<u64>()<=result.analyzed_rows));
    }
}
