use datolens_data::{DataStore, plots::PlotQuery};
use serde_json::{json, Value};
use std::fs;

fn query(store:&DataStore, extra:Value)->datolens_data::Result<datolens_data::plots::PlotResult>{
    let mut request=json!({"datasetId":store.dataset().id,"filters":[],"mode":"aggregate","dimensions":[{"column":"group","binning":"exact"}],"measures":[{"stat":"count"}],"limit":100,"includeMissing":false});
    request.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
    store.query_plot(serde_json::from_value::<PlotQuery>(request).unwrap())
}
fn fixture()->(tempfile::TempDir,DataStore){
    let dir=tempfile::tempdir().unwrap();let file=dir.path().join("plots.csv");
    fs::write(&file,"group,x,y,when,d0\nA,1,2,2025-01-01,9007199254740993\nA,2,4,2025-01-02,9007199254740994\nB,3,6,2025-02-01,9007199254740995\nB,4,8,2025-02-02,9007199254740996\nB,4,8,2025-02-03,9007199254740997\nC,,10,2025-03-01,9007199254740998\n").unwrap();
    let store=DataStore::open(&file,None,&dir.path().join("cache")).unwrap();(dir,store)
}
#[test]fn grouping_filters_and_native_statistics(){
    let (_dir,store)=fixture();
    let result=query(&store,json!({"filters":[{"column":"x","kind":"numeric","min":2}],"measures":[{"column":"y","stat":"sum"},{"column":"y","stat":"median"},{"column":"y","stat":"q1"},{"column":"y","stat":"q3"},{"stat":"count"}]})).unwrap();
    assert_eq!(result.total_rows,6);assert_eq!(result.matched_rows,4);assert_eq!(result.plotted_rows,4);assert_eq!(result.rows.len(),2);
    assert_eq!(result.rows[1]["m0"],"22");assert_eq!(result.rows[1]["m1"],"8.0");assert_eq!(result.rows[1]["m2"],"7.0");assert_eq!(result.rows[1]["m3"],"8.0");
    assert_eq!(result.dataset_revision,store.dataset().revision);
}
#[test]fn quantile_ties_width_missing_and_constants(){
    let (_dir,store)=fixture();
    for binning in ["width","quantile"]{
        let one=query(&store,json!({"dimensions":[{"column":"x","binning":binning,"bins":1}]})).unwrap();
        assert_eq!(one.rows.len(),1);
        assert_eq!(one.rows[0]["m0"],"5");
        let r=query(&store,json!({"dimensions":[{"column":"x","binning":binning,"bins":4}]})).unwrap();
        let count:u64=r.rows.iter().map(|row|row["m0"].as_str().unwrap().parse::<u64>().unwrap()).sum();
        assert_eq!(count,5);assert_eq!(r.plotted_rows,5);
        let constant=query(&store,json!({"filters":[{"column":"x","kind":"numeric","min":4,"max":4}],"dimensions":[{"column":"x","binning":binning,"bins":4}]})).unwrap();
        assert_eq!(constant.rows.len(),1);assert_eq!(constant.rows[0]["m0"],"2");
    }
    let r=query(&store,json!({"dimensions":[{"column":"x","binning":"width","bins":2}],"includeMissing":true})).unwrap();
    assert_eq!(r.plotted_rows,6);assert!(r.rows.iter().any(|r|r["d0"].is_null()));
}
#[test]fn dates_precision_aliases_and_totals(){
    let (_dir,store)=fixture();
    let months=query(&store,json!({"dimensions":[{"column":"when","binning":"date","interval":"month"}]})).unwrap();
    assert_eq!(months.rows.len(),3);assert_eq!(months.rows[1]["m0"],"3");
    assert!(months.rows[0]["d0End"].as_str().unwrap().starts_with("2025-02-01"));
    let ids=query(&store,json!({"dimensions":[{"column":"d0","binning":"exact"}]})).unwrap();
    assert_eq!(ids.rows[0]["d0"],"9007199254740993");
    let totals=query(&store,json!({"dimensions":[],"measures":[{"column":"y","stat":"mean"}]})).unwrap();
    assert!((totals.rows[0]["m0"].as_str().unwrap().parse::<f64>().unwrap()-38.0/6.0).abs()<1e-10);
}
#[test]fn limits_points_and_global_regression(){
    let (_dir,store)=fixture();
    let points=query(&store,json!({"mode":"points","dimensions":[],"measures":[],"pointColumns":["x","y","group","","d0"],"limit":2})).unwrap();
    assert!(points.truncated);assert_eq!(points.selection_method,"firstRows");assert_eq!(points.plotted_rows,5);assert_eq!(points.rows[0]["id"],"0");assert_eq!(points.rows[0]["d4"],"9007199254740993");
    assert_eq!(points.statistics.as_ref().unwrap()["slope"],2.0);
    let groups=query(&store,json!({"sort":"count","descending":true,"limit":1})).unwrap();assert!(groups.truncated);assert_eq!(groups.rows[0]["d0"],"B");
    assert!(query(&store,json!({"limit":10001})).is_err());
    assert!(query(&store,json!({"dimensions":[{"column":"x","binning":"width","bins":0}]})).is_err());
    assert!(query(&store,json!({"dimensions":[{"column":"x","binning":"width","bins":101}]})).is_err());
    assert!(query(&store,json!({"measures":[{"column":"y","stat":"percentile","percentile":90}]})).is_err());
    assert!(query(&store,json!({"dimensions":[{"column":"x\"; DROP TABLE dl_data; --","binning":"exact"}]})).is_err());
}
#[test]fn empty_and_constant_regression_are_null(){
    let (_dir,store)=fixture();
    for min in [4,100]{let r=query(&store,json!({"mode":"points","pointColumns":["x","y"],"filters":[{"column":"x","kind":"numeric","min":min}],"dimensions":[],"measures":[]})).unwrap();assert!(r.statistics.as_ref().unwrap()["correlation"].is_null());}
}
#[test]fn pivot_totals_keep_all_dimension_eligibility_and_recompute_median(){
    let (_dir,store)=fixture();
    let result=query(&store,json!({"dimensions":[{"column":"group","binning":"exact"},{"column":"x","binning":"width","bins":3}],"groupDimensions":[],"measures":[{"stat":"count"},{"column":"y","stat":"median"}]})).unwrap();
    assert_eq!(result.rows.len(),1);assert_eq!(result.rows[0]["m0"],"5");assert_eq!(result.rows[0]["m1"],"6.0");assert_eq!(result.plotted_rows,5);
    let rows=query(&store,json!({"dimensions":[{"column":"group","binning":"exact"},{"column":"x","binning":"width","bins":3}],"groupDimensions":[0]})).unwrap();
    assert_eq!(rows.rows.len(),2);assert!(!rows.rows[0].contains_key("d1"));
    assert!(query(&store,json!({"groupDimensions":[7]})).is_err());
    assert!(query(&store,json!({"groupDimensions":[0,0]})).is_err());
}
