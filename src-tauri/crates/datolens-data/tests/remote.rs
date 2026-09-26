use datolens_data::*;
use duckdb::Connection;
use serde_json::json;
use std::{io::{Read,Write},net::{TcpListener,TcpStream,SocketAddr},path::{Path,PathBuf},sync::{Arc,Mutex,atomic::{AtomicBool,AtomicU64,Ordering}},thread,time::Duration};

#[derive(Clone,Copy)] enum Mode { Range, NoRange, WeakEtag, WrongRange }
#[derive(Clone,Debug)] struct Request { method:String, interval:Option<(usize,usize)>, matched:bool, status:u16 }
struct State { data:Vec<u8>, mode:Mode, revision:AtomicU64, change_data:AtomicBool, requests:Mutex<Vec<Request>> }
struct Server { addr:SocketAddr, state:Arc<State>, stop:Arc<AtomicBool>, worker:Option<thread::JoinHandle<()>> }
impl Server {
    fn new(data:Vec<u8>,mode:Mode)->Self {
        let listener=TcpListener::bind("127.0.0.1:0").unwrap();let addr=listener.local_addr().unwrap();listener.set_nonblocking(true).unwrap();
        let state=Arc::new(State{data,mode,revision:AtomicU64::new(1),change_data:AtomicBool::new(false),requests:Mutex::new(vec![])});
        let stop=Arc::new(AtomicBool::new(false));let worker_state=state.clone();let worker_stop=stop.clone();
        let worker=thread::spawn(move|| {let mut connections=vec![];while !worker_stop.load(Ordering::SeqCst) {
            match listener.accept() {Ok((stream,_))=>{let state=worker_state.clone();connections.push(thread::spawn(move||serve(stream,state)));},Err(error) if error.kind()==std::io::ErrorKind::WouldBlock=>thread::sleep(Duration::from_millis(2)),Err(_)=>break}
        }for connection in connections {connection.join().unwrap();}});
        Self{addr,state,stop,worker:Some(worker)}
    }
    fn url(&self)->String {format!("http://{}/table.parquet",self.addr)}
    fn transferred(&self)->usize {self.state.requests.lock().unwrap().iter().filter(|r|r.method=="GET"&&r.status==206).map(|r|r.interval.unwrap().1-r.interval.unwrap().0+1).sum()}
}
impl Drop for Server {fn drop(&mut self){self.stop.store(true,Ordering::SeqCst);self.worker.take().unwrap().join().unwrap();}}
fn serve(mut stream:TcpStream,state:Arc<State>) {
    // macOS accepted sockets can inherit the listener's nonblocking mode.
    stream.set_nonblocking(false).unwrap();
    stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();stream.set_write_timeout(Some(Duration::from_secs(5))).unwrap();
    let mut buffer=Vec::new();let mut chunk=[0;1024];
    while !buffer.windows(4).any(|v|v==b"\r\n\r\n") {let Ok(n)=stream.read(&mut chunk) else{return};if n==0{return}buffer.extend_from_slice(&chunk[..n]);if buffer.len()>16384{return}}
    let text=String::from_utf8_lossy(&buffer);let method=text.split_whitespace().next().unwrap().to_string();
    let header=|name:&str|text.lines().skip(1).find_map(|line|line.split_once(':').filter(|(key,_)|key.eq_ignore_ascii_case(name)).map(|(_,value)|value.trim().to_string()));
    let interval=header("range").and_then(|range| {let (start,end)=range.strip_prefix("bytes=")?.split_once('-')?;Some((start.parse::<usize>().ok()?,end.parse::<usize>().ok()?))});
    if method=="GET" && interval.is_some_and(|(start,_)|start>3 && start<state.data.len()/2) && state.change_data.swap(false,Ordering::SeqCst) {state.revision.fetch_add(1,Ordering::SeqCst);}
    let etag=format!("\"v{}\"",state.revision.load(Ordering::SeqCst));
    let matched=header("if-match").as_deref()==Some(etag.as_str());
    let status=if header("if-match").is_some()&&!matched {412} else if method=="HEAD"||matches!(state.mode,Mode::NoRange)||interval.is_none(){200}else{206};
    state.requests.lock().unwrap().push(Request{method:method.clone(),interval,matched,status});
    if status==412 {let _=stream.write_all(b"HTTP/1.1 412 Precondition Failed\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");return}
    let (start,end)=if status==206 {interval.unwrap()}else{(0,state.data.len()-1)};
    if end>=state.data.len()||start>end {eprintln!("invalid test-server range {start}-{end}, size {}",state.data.len());return}
    let advertised_etag=if matches!(state.mode,Mode::WeakEtag){format!("W/{etag}")}else{etag};
    let content_range=if status==206 {format!("Content-Range: bytes {}-{}/{}\r\n",if matches!(state.mode,Mode::WrongRange){start+1}else{start},end,state.data.len())}else{String::new()};
    let response=format!("HTTP/1.1 {} OK\r\nContent-Length: {}\r\nETag: {}\r\nAccept-Ranges: bytes\r\n{}Connection: close\r\n\r\n",status,end-start+1,advertised_etag,content_range);
    if stream.write_all(response.as_bytes()).is_err(){return}
    if method!="HEAD" {let _=stream.write_all(&state.data[start..=end]);}
}
fn fixture(dir:&Path)->Vec<u8> {
    let path=dir.join("remote.parquet");let conn=Connection::open_in_memory().unwrap();
    conn.execute_batch("SET threads=2; SET memory_limit='128MB'").unwrap();
    let escaped=path.to_string_lossy().replace('\'',"''");
    conn.execute_batch(&format!("COPY (SELECT i::UBIGINT AS id, (i%3)::INTEGER AS category, md5(i::VARCHAR)||md5((i+42)::VARCHAR) AS payload, md5((i+100000)::VARCHAR) AS noise FROM range(80000) t(i)) TO '{escaped}' (FORMAT PARQUET, COMPRESSION UNCOMPRESSED, ROW_GROUP_SIZE 2048)")).unwrap();
    std::fs::read(path).unwrap()
}
fn extension()->PathBuf {PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../vendor/httpfs/osx_arm64/httpfs.duckdb_extension")}
fn open(server:&Server,dir:&Path)->DataStore {DataStore::open_remote_parquet_with_progress(&server.url(),dir,&extension(),&|_|{}).unwrap()}
fn page(data:&DataStore,offset:u64,filters:Vec<Filter>)->Page {data.query_page(PageRequest{dataset_id:data.dataset().id,columns:vec!["id".into()],filters,sorting:vec![],offset,limit:5}).unwrap()}
fn view()->serde_json::Value {json!({"formatVersion":1,"analysisSampling":{"mode":"rows","rows":100},"filters":[],"sorting":[],"columns":{"order":["id"],"hidden":[],"widths":{}},"variablePanel":{"order":["id"],"hidden":[],"pinned":[]}})}

#[test]
fn range_open_pages_and_auto_project_only_requested_columns() {
    let dir=tempfile::tempdir().unwrap();let server=Server::new(fixture(dir.path()),Mode::Range);let total=server.state.data.len();
    let data=open(&server,&dir.path().join("cache"));assert!(data.is_remote());assert_eq!(data.source_bytes(),total as u64);assert_eq!(data.dataset().row_count,Some(80000));
    // Open reads only magic/footer metadata: no body chunks from the table.
    let requests=server.state.requests.lock().unwrap().clone();
    assert!(requests.iter().filter(|r|r.method=="GET").all(|r|r.status==206&&r.interval.is_some_and(|(start,_)|start==0||start>total-256*1024)),"{requests:?}");
    let before=server.transferred();
    let first=data.query_page(PageRequest{dataset_id:data.dataset().id,columns:data.dataset().columns.into_iter().map(|column|column.id).collect(),filters:vec![],sorting:vec![],offset:0,limit:100}).unwrap();assert_eq!(first.filtered_count,Some(80000));assert_eq!(first.rows[0].values["id"],json!(0));assert_eq!(first.rows.len(),100);
    let after_first_page=server.transferred();
    let later=page(&data,70000,vec![]);assert_eq!(later.rows[0].values["id"],json!(70000));assert_eq!(later.rows[0].id,format!("{}:70000",data.dataset().id));
    assert!(server.transferred()<total/2,"read {} of {} bytes",server.transferred(),total);
    let result=data.distributions_with_options(&["category".into()],&[],&DistributionOptions{statistics:Some(vec![]),..Default::default()}).unwrap();
    assert!(result.deferred_reason.is_none());assert_eq!(result.variables.len(),1);assert_eq!(result.variables[0].bins.iter().filter(|bin|bin.background>0).count(),3);
    let after_analysis=server.transferred();
    data.distributions_with_options(&["category".into()],&[],&DistributionOptions{statistics:Some(vec![]),..Default::default()}).unwrap();
    assert_eq!(server.transferred(),after_analysis,"cached profile must not read source values again");
    eprintln!("Remote byte evidence: source={total}, metadata_open={before}, after_first_100_rows_all_columns={after_first_page}, after_page_at_70000={}",server.transferred());
    assert!(server.state.requests.lock().unwrap().iter().filter(|r|r.method=="GET"&&r.interval.is_some_and(|(start,_)|start>3)).all(|r|r.matched));
}
#[test]
fn remote_ids_views_results_and_manual_analysis_persist() {
    let dir=tempfile::tempdir().unwrap();let server=Server::new(fixture(dir.path()),Mode::Range);let storage=dir.path().join("cache");
    let mut data=open(&server,&storage);let id=data.dataset().id;let first=page(&data,0,vec![]);let saved=data.save_view(view()).unwrap();assert!(!saved.beside_source);assert!(Path::new(&saved.path).starts_with(&storage));
    data.ensure_result_column(Column{id:"note".into(),name:"Note".into(),data_type:"VARCHAR".into(),kind:VariableKind::Text,spss:None}).unwrap();
    let revision=data.dataset().revision;
    data.apply_results(&[CellUpdate{row_id:first.rows[0].id.clone(),column_id:"note".into(),value:json!("kept"),expected_dataset_revision:revision}]).unwrap();
    data.save_view(view()).unwrap();
    let filter=Filter::Numeric{column:"id".into(),min:Some(70000.),max:None};let filtered=page(&data,0,vec![filter]);assert_eq!(filtered.filtered_count,Some(10000));
    let sample=data.distributions_with_options(&["category".into()],&[],&DistributionOptions{sampling:AnalysisSampling::Rows{rows:100},statistics:Some(vec![])}).unwrap();assert_eq!(sample.analyzed_rows,100);assert!(sample.deferred_reason.is_none());
    drop(data);let reopened=open(&server,&storage);assert_eq!(reopened.dataset().id,id);assert_eq!(page(&reopened,0,vec![]).rows[0].id,first.rows[0].id);assert_eq!(reopened.load_view().unwrap().unwrap(),view());
    assert_eq!(reopened.row_values(&first.rows[0].id,&["note".into()]).unwrap()["note"],json!("kept"));
    let before=server.transferred();let again=reopened.distributions_with_options(&["category".into()],&[],&DistributionOptions{sampling:AnalysisSampling::Rows{rows:100},statistics:Some(vec![])}).unwrap();assert_eq!(again.variables[0].bins.len(),sample.variables[0].bins.len());assert_eq!(server.transferred(),before);
}
#[test]
fn no_range_or_weak_validator_requires_explicit_host_download_only() {
    let dir=tempfile::tempdir().unwrap();let bytes=fixture(dir.path());
    for mode in [Mode::NoRange,Mode::WeakEtag] {
        let server=Server::new(bytes.clone(),mode);let result=DataStore::open_remote_parquet_with_progress(&server.url(),&dir.path().join("cache"),&extension(),&|_|{});
        assert!(matches!(result,Err(Error::RemoteDownloadRequired)));
        assert_eq!(server.state.requests.lock().unwrap().len(),1);
    }
    let server=Server::new(bytes,Mode::WrongRange);let result=DataStore::open_remote_parquet_with_progress(&server.url(),&dir.path().join("cache"),&extension(),&|_|{});
    assert!(matches!(result,Err(Error::Invalid(_))),"bad ranges must not silently fall back");
}
#[test]
fn changed_revision_never_reuses_ids_or_silently_downloads() {
    let dir=tempfile::tempdir().unwrap();let server=Server::new(fixture(dir.path()),Mode::Range);let storage=dir.path().join("cache");
    let data=open(&server,&storage);let old_id=data.dataset().id;data.save_view(view()).unwrap();
    server.state.revision.store(2,Ordering::SeqCst);assert!(matches!(data.check_source(),Err(Error::SourceChanged)));drop(data);
    let changed=open(&server,&storage);assert_ne!(changed.dataset().id,old_id);assert!(changed.load_view().unwrap().is_none());
    server.state.change_data.store(true,Ordering::SeqCst);
    let result=changed.query_page(PageRequest{dataset_id:changed.dataset().id,columns:vec!["payload".into()],filters:vec![],sorting:vec![],offset:10,limit:5});
    assert!(result.is_err());assert!(!matches!(result,Err(Error::RemoteDownloadRequired)));
}
#[test]
fn persistent_remote_urls_do_not_contain_credentials() {
    let dir=tempfile::tempdir().unwrap();
    for url in ["file:///tmp/source.parquet","https://user:password@example.org/data.parquet"] {
        let result=DataStore::open_remote_parquet_with_progress(url,dir.path(),&extension(),&|_|{});
        match result {Err(Error::Invalid(message))=>{assert!(!message.contains("secret-value"));assert!(!message.contains("password"));},_=>panic!("unsupported URL accepted")}
    }
    assert!(matches!(DataStore::open_remote_parquet_with_progress("https://example.org/data.parquet?api_key=secret-value",dir.path(),&extension(),&|_|{}),Err(Error::RemoteDownloadRequired)));
}

#[test]
fn lazy_sample_reads_only_requested_columns_and_offscreen_filter_dependencies() {
    let dir=tempfile::tempdir().unwrap();let server=Server::new(fixture(dir.path()),Mode::Range);
    let total=server.state.data.len();let data=open(&server,&dir.path().join("cache"));
    let opt=DistributionOptions{sampling:AnalysisSampling::Rows{rows:1000},statistics:Some(vec![])};
    let first=data.distributions_with_options(&["category".into()],&[],&opt).unwrap();
    assert_eq!(first.analyzed_rows,1000);assert!(first.deferred_reason.is_none());
    assert_eq!(first.variables[0].bins.iter().map(|bin|bin.background).sum::<u64>(),1000);
    let after_first=server.transferred();
    assert!(after_first<total/3,"unrequested payload/noise must stay remote: {after_first}/{total}");
    let filtered=data.distributions_with_options(&["category".into()],&[Filter::Numeric{column:"id".into(),min:Some(40000.),max:None}],&opt).unwrap();
    assert!(filtered.selected_count>350 && filtered.selected_count<650);
    assert!(server.transferred()<total/3,"filter only adds id values: {}/{total}",server.transferred());
    let before_cached=server.transferred();
    let again=data.distributions_with_options(&["category".into()],&[],&opt).unwrap();
    assert_eq!(server.transferred(),before_cached);assert_eq!(serde_json::to_value(first).unwrap(),serde_json::to_value(again).unwrap());
    eprintln!("Progressive remote sample bytes: source={total}, category={after_first}, with_id_filter={before_cached}");
}
