//! Compare the real native opening + 59-variable workload; no source writes.
use datolens_data::{DataStore, Filter, PageRequest, AnalysisSampling, DistributionOptions};
use serde_json::json;
use std::{path::PathBuf, time::Instant};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let path = PathBuf::from(args.get(1).expect("source path"));
    let cache = PathBuf::from(args.get(2).expect("isolated benchmark cache directory"));
    let options = DistributionOptions { sampling: if args.get(3).is_some_and(|s| s == "full") { AnalysisSampling::Full } else { AnalysisSampling::Auto }, statistics: Some(vec![]) };
    let start = Instant::now();
    let store = DataStore::open(&path, None, &cache).unwrap();
    let open_ms = start.elapsed().as_millis();
    let ds = store.dataset();
    let ids: Vec<_> = ds.columns.iter().map(|c| c.id.clone()).collect();
    let request = PageRequest { dataset_id: ds.id.clone(), columns: ids.clone(), filters: vec![], sorting: vec![], offset: 0, limit: 100 };
    let start = Instant::now();
    let page = store.query_page(request.clone()).unwrap();
    println!("{}", json!({"stage":"open","open_ms":open_ms,"page_ms":start.elapsed().as_millis(),"rows":ds.row_count,"columns":ids.len(),"returned":page.rows.len()}));
    let filters = vec![Filter::Categorical { column: "agency".into(), selected: vec!["NYPD".into()] }];
    for (name, filters) in [("initial", vec![]), ("filtered", filters)] {
        let start = Instant::now();
        let d = store.distributions_with_options(&ids, &filters, &options).unwrap();
        println!("{}", json!({"stage":name,"ms":start.elapsed().as_millis(),"analyzed":d.analyzed_rows,"selected":d.selected_count,"sampled":d.sampled}));
        let start = Instant::now();
        let p = store.query_page(PageRequest { filters, ..request.clone() }).unwrap();
        println!("{}", json!({"stage":format!("{name}_page"),"ms":start.elapsed().as_millis(),"selected":p.filtered_count}));
    }
}
