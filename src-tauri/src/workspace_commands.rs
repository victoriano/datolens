use crate::service::{AppService,Result,error,lock};
use datolens_data::{Dataset,ExportRequest,ExportFormat,workspace::materialize_query};
use serde::Deserialize;
use std::{path::PathBuf,sync::{Arc,atomic::{AtomicU64,Ordering}},time::{SystemTime,UNIX_EPOCH}};
use tauri::State;

#[derive(Deserialize)]
#[serde(rename_all="camelCase")]
pub struct QuerySource {dataset_id:String,alias:String}
#[derive(Deserialize)]
pub struct QueryRequest {name:String,sql:String,sources:Vec<QuerySource>}
struct Scratch(PathBuf);
impl Drop for Scratch {fn drop(&mut self){let _=std::fs::remove_dir_all(&self.0);}}
struct OutputDirectory {path:PathBuf,keep:bool}
impl Drop for OutputDirectory {fn drop(&mut self){if !self.keep {let _=std::fs::remove_dir_all(&self.path);}}}
static NEXT:AtomicU64=AtomicU64::new(0);

pub fn create_result(service:&AppService,request:QueryRequest)->Result<Dataset> {
    if request.sources.is_empty()||request.sources.len()>32 {return Err("Selecciona entre 1 y 32 tablas.".into());}
    let name=request.name.trim();
    if name.is_empty()||name.len()>120||name.chars().any(|c|c.is_control()||"/\\:".contains(c))||name=="."||name==".." {return Err("Escribe un nombre de resultado de hasta 120 caracteres, sin separadores de ruta.".into());}
    let stamp=SystemTime::now().duration_since(UNIX_EPOCH).map_err(error)?.as_nanos();
    let directory=service.storage.join("query-results").join(format!("{stamp}-{}",NEXT.fetch_add(1,Ordering::Relaxed)));
    std::fs::create_dir_all(&directory).map_err(error)?;
    let mut output=OutputDirectory{path:directory.clone(),keep:false};
    let scratch=Scratch(directory.join("scratch"));std::fs::create_dir(&scratch.0).map_err(error)?;
    let mut sources=Vec::new();let mut provenance=Vec::new();
    for (index,input) in request.sources.iter().enumerate() {
        let session=service.session(&input.dataset_id)?;
        let data=lock(&session.data)?;let dataset=data.dataset();
        let path=scratch.0.join(format!("source-{index}.parquet"));
        data.export(ExportRequest{path:path.to_string_lossy().into(),format:ExportFormat::Parquet,columns:dataset.columns.iter().map(|c|c.id.clone()).collect(),filters:vec![],sorting:vec![]}).map_err(error)?;
        provenance.push(serde_json::json!({"alias":input.alias,"datasetId":dataset.id,"revision":dataset.revision,"path":dataset.source_path,"sheet":dataset.sheet}));
        sources.push((input.alias.clone(),path));
    }
    let target=directory.join(format!("{name}.parquet"));
    materialize_query(&sources,&request.sql,&target,&scratch.0).map_err(error)?;
    std::fs::write(directory.join("query.json"),serde_json::to_vec_pretty(&serde_json::json!({"formatVersion":1,"name":name,"sql":request.sql,"sources":provenance})).map_err(error)?).map_err(error)?;
    let dataset=service.open(&target,None)?;
    output.keep=true;
    Ok(dataset)
}

#[tauri::command]
pub async fn create_query_dataset(service:State<'_,Arc<AppService>>,request:QueryRequest)->Result<Dataset> {
    let service=service.inner().clone();
    tauri::async_runtime::spawn_blocking(move||create_result(&service,request)).await.map_err(error)?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn result_is_registered_persistent_and_invalid_requests_leave_sources_untouched() {
        let dir=tempfile::tempdir().unwrap();let first=dir.path().join("customers.csv");let second=dir.path().join("orders.csv");
        std::fs::write(&first,"id,name\n1,Ana\n2,Luis\n").unwrap();std::fs::write(&second,"id,total\n1,25\n").unwrap();
        let service=AppService::new(dir.path().join("projects"));
        let a=service.open(&first,None).unwrap();let b=service.open(&second,None).unwrap();
        let request=||QueryRequest{name:"Joined customers".into(),sql:"SELECT a.name,b.total FROM t1 a LEFT JOIN t2 b USING(id)".into(),sources:vec![QuerySource{dataset_id:a.id.clone(),alias:"t1".into()},QuerySource{dataset_id:b.id.clone(),alias:"t2".into()}]};
        let result=create_result(&service,request()).unwrap();assert_eq!(result.row_count,Some(2));assert!(service.session(&result.id).is_ok());
        let path=PathBuf::from(&result.source_path);assert!(path.exists());assert!(path.parent().unwrap().join("query.json").exists());assert!(!path.parent().unwrap().join("scratch").exists());
        let mut invalid=request();invalid.name="../outside".into();assert!(create_result(&service,invalid).is_err());
        assert_eq!(std::fs::read_to_string(&first).unwrap(),"id,name\n1,Ana\n2,Luis\n");
        drop(service);
        let reopened=AppService::new(dir.path().join("projects")).open(&path,None).unwrap();assert_eq!(reopened.id,result.id);assert_eq!(reopened.row_count,Some(2));
    }
}
