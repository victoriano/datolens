use datolens_data::{DataStore,Filter,PageRequest,SortRule};
use serde_json::json;
use std::{path::PathBuf,time::Instant};
fn main() {
    let args:Vec<String>=std::env::args().collect();
    let path=PathBuf::from(args.get(1).expect("source path"));
    let storage=tempfile::tempdir().unwrap();
    let begin=Instant::now();let store=DataStore::open(&path,None,storage.path()).unwrap();let open_ms=begin.elapsed().as_millis();
    let ds=store.dataset();let columns=ds.columns.iter().map(|c|c.id.clone()).collect();
    let mut request=PageRequest{dataset_id:ds.id.clone(),columns,filters:vec![],sorting:vec![],offset:0,limit:100};
    let page=store.query_page(request.clone()).unwrap();assert_eq!(page.rows.len(),100);let first_page_ms=begin.elapsed().as_millis();
    request.filters=vec![Filter::Numeric{column:"amount".into(),min:Some(ds.row_count.unwrap() as f64/4.),max:None}];
    request.sorting=vec![SortRule{id:"category".into(),desc:true},SortRule{id:"id".into(),desc:true}];
    let begin=Instant::now();let result=store.query_page(request).unwrap();let filter_sort_ms=begin.elapsed().as_millis();
    assert_eq!(result.filtered_count,Some(ds.row_count.unwrap()/2));
    let begin=Instant::now();let distribution=store.distributions(&["category".into(),"amount".into()],&[]).unwrap();let distributions_ms=begin.elapsed().as_millis();
    assert_eq!(distribution.total_rows,ds.row_count.unwrap());
    println!("{}",json!({"path":path,"rows":ds.row_count,"bytes":std::fs::metadata(&path).unwrap().len(),"open_ms":open_ms,"first_page_including_open_ms":first_page_ms,"filter_sort_ms":filter_sort_ms,"distributions_ms":distributions_ms,"conditions":"fresh_project_source_previously_generated_OS_cache_not_flushed"}));
}
