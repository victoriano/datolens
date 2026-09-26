use datolens_data::{CellUpdate, Column, DataStore, Dataset, Filter, VariableKind};
use datolens_enrichment::{DataAccess, Engine, MultiProvider, InputSnapshot};
use serde_json::Value;
use std::{collections::HashMap, path::{Path, PathBuf}, sync::{Arc, Mutex, MutexGuard}};

pub type Result<T> = std::result::Result<T, String>;
pub fn lock<T>(m: &Mutex<T>) -> Result<MutexGuard<'_, T>> { m.lock().map_err(|_| "Almacén local no disponible".into()) }
pub fn error(e: impl std::fmt::Display) -> String { e.to_string() }
pub use crate::credentials::Keychain;
pub struct DataAdapter(pub Arc<Mutex<DataStore>>);
impl DataAccess for DataAdapter {
    fn dataset_revision(&self) -> Result<String> { let data=lock(&self.0)?; data.check_source().map_err(error)?; Ok(data.dataset().revision) }
    fn read_inputs(&self, row_id: &str, columns: &[String]) -> Result<InputSnapshot> {
        let data=lock(&self.0)?;
        Ok(InputSnapshot { revision:data.dataset().revision, values:data.row_values(row_id,columns).map_err(error)? })
    }
    fn apply_result(&self,row_id:&str,column_id:&str,value:&Value,_fingerprint:&str)->Result<()> {
        let data=lock(&self.0)?;
        data.apply_results(&[CellUpdate {row_id:row_id.into(),column_id:column_id.into(),value:value.clone(),expected_dataset_revision:data.dataset().revision}]).map_err(error)
    }
}
pub struct Session { pub data:Arc<Mutex<DataStore>>,pub engine:Arc<Engine>, pub runners:Mutex<std::collections::HashSet<String>>, pub portable_warnings:Mutex<HashMap<String,String>>, _source_access:Option<Arc<crate::file_access::SourceAccess>> }
pub struct AppService { pub storage:PathBuf, pub file_access:crate::file_access::FileAccess, httpfs_path:Option<PathBuf>, sessions:Mutex<HashMap<String,Arc<Session>>>, plans:Mutex<HashMap<String,Arc<Session>>> }
impl AppService {
    pub fn new(storage:PathBuf)->Self {Self{file_access:crate::file_access::FileAccess::new(storage.clone()),storage,httpfs_path:None,sessions:Mutex::new(HashMap::new()),plans:Mutex::new(HashMap::new())}}
    pub fn with_httpfs_path(mut self,path:PathBuf)->Self {self.httpfs_path=Some(path);self}
    pub fn open(&self,path:&Path,sheet:Option<&str>)->Result<Dataset> {
        self.open_with_progress(path,sheet,&|_| {})
    }
    pub fn open_with_progress(&self,path:&Path,sheet:Option<&str>,progress:&dyn Fn(&str))->Result<Dataset> {
        // Opening and importing stays off the WebView thread. Serialize opens to avoid
        // two connections to the same per-dataset database during rapid drops.
        let access=self.file_access.acquire(path)?;
        let path=std::fs::canonicalize(&access.path).map_err(error)?;
        let mut sessions=lock(&self.sessions)?;
        if let Some(existing)=sessions.values().find(|s|lock(&s.data).is_ok_and(|d| d.dataset().source_path==path.to_string_lossy() && d.dataset().sheet.as_deref()==sheet)) {
            progress("prepare");
            let data=lock(&existing.data)?;
            if data.check_source().is_ok() {let dataset=data.dataset();self.remember_source(&dataset)?;progress("ready");return Ok(dataset);}
        }
        let data=DataStore::open_with_progress(&path,sheet,&self.storage,progress).map_err(error)?;
        self.register_store(data,&mut sessions,progress,Some(access))
    }
    /// None asks the importer to download a snapshot when range/identity guarantees
    /// are unavailable. Other errors preserve the original failure without fallback.
    pub fn open_remote_parquet(&self,url:&str,progress:&dyn Fn(&str))->Result<Option<Dataset>> {
        let extension=self.httpfs_path.as_deref().ok_or("No está disponible la extensión Parquet remota de esta instalación.")?;
        let mut sessions=lock(&self.sessions)?;
        if let Some(existing)=sessions.values().find(|s|lock(&s.data).is_ok_and(|d|d.dataset().source_path==url)) {
            let data=lock(&existing.data)?;
            data.check_source().map_err(error)?;
            let dataset=data.dataset();self.remember_source(&dataset)?;progress("ready");return Ok(Some(dataset));
        }
        let data=match DataStore::open_remote_parquet_with_progress(url,&self.storage,extension,progress) {
            Ok(data)=>data,
            Err(datolens_data::Error::RemoteDownloadRequired)=>return Ok(None),
            Err(e)=>return Err(error(e)),
        };
        self.register_store(data,&mut sessions,progress,None).map(Some)
    }
    fn register_store(&self,data:DataStore,sessions:&mut HashMap<String,Arc<Session>>,progress:&dyn Fn(&str),source_access:Option<Arc<crate::file_access::SourceAccess>>)->Result<Dataset> {
        let dataset=data.dataset();
        if let Some(existing)=sessions.get(&dataset.id) {let dataset=lock(&existing.data)?.dataset();self.remember_source(&dataset)?;progress("ready");return Ok(dataset);}
        let shared_definitions=data.shared_enrichments().map_err(error)?;
        let data=Arc::new(Mutex::new(data));
        let engine=Arc::new(Engine::open(self.storage.join(format!("{}.jobs.sqlite",dataset.id)),Arc::new(DataAdapter(data.clone())),Arc::new(Keychain),Arc::new(MultiProvider::new()?))?);
        if let Some(definitions)=shared_definitions {
            let definitions=serde_json::from_value(definitions).map_err(error)?;
            engine.restore_definitions(definitions)?;
        }
        let session=Arc::new(Session{data,engine,runners:Mutex::new(Default::default()),portable_warnings:Mutex::new(Default::default()),_source_access:source_access});
        for definition in session.engine.list_definitions()? {ensure_output(&session,&definition)?;}
        progress("restore");
        for run in session.engine.list_runs()? { lock(&self.plans)?.insert(run.id.clone(),session.clone()); }
        sessions.insert(dataset.id.clone(),session);
        self.remember_source(&dataset)?;
        progress("ready");
        Ok(dataset)
    }
    fn remember_source(&self,dataset:&Dataset)->Result<()> {
        let last=serde_json::json!({"path":dataset.source_path,"sheet":dataset.sheet});
        let temporary=self.storage.join("last-source.tmp");
        std::fs::write(&temporary,serde_json::to_vec(&last).map_err(error)?).map_err(error)?;
        std::fs::rename(&temporary,self.storage.join("last-source.json")).map_err(error)
    }
    pub fn session(&self,id:&str)->Result<Arc<Session>> {lock(&self.sessions)?.get(id).cloned().ok_or_else(||"Abre primero el archivo de datos".into())}
    pub fn plan_session(&self,id:&str)->Result<Arc<Session>> {lock(&self.plans)?.get(id).cloned().ok_or_else(||"Ejecución desconocida; vuelve a abrir el archivo".into())}
    pub fn remember_plan(&self,id:String,s:Arc<Session>)->Result<()> { lock(&self.plans)?.insert(id,s); Ok(()) }
}
pub fn ensure_output(session:&Session,definition:&datolens_enrichment::Definition)->Result<()> {
    let kind:VariableKind=serde_json::from_value(Value::String(definition.output_kind.clone())).map_err(error)?;
    lock(&session.data)?.ensure_result_column(Column{id:definition.output_column.clone(),name:definition.name.clone(),data_type:String::new(),kind,spss:None}).map_err(error)
}
pub fn scope_rows(session:&Session, filters:&[Filter])->Result<Vec<String>> {
    let data=lock(&session.data)?; let mut rows=vec![];
    loop { let page=data.row_ids(filters,rows.len() as u64,10000).map_err(error)?; let len=page.len();rows.extend(page); if rows.len()>100_000 {return Err("El alcance supera 100.000 filas. Aplica un filtro más preciso.".into());} if len<10000 {break;} }
    Ok(rows)
}
pub fn launch(session:Arc<Session>,id:String)->Result<()> {
    if !lock(&session.runners)?.insert(id.clone()) {return Ok(());}
    tauri::async_runtime::spawn_blocking(move || {
        let completed=session.engine.run_to_completion(&id);
        if completed.is_ok() {
            let saved=lock(&session.data).and_then(|data|data.publish_portable_results().map_err(error));
            let warning=match saved {Ok(Some(result))=>result.warning,Ok(None)=>None,Err(error)=>Some(format!("Resultados guardados en este Mac; no se pudieron compartir: {error}"))};
            if let Some(warning)=warning {if let Ok(mut messages)=session.portable_warnings.lock(){messages.insert(id.clone(),warning);}}
        }
        if let Ok(mut runners)=session.runners.lock(){runners.remove(&id);}
    });
    Ok(())
}

pub fn visible_run_status(session:&Session,id:&str)->Result<datolens_enrichment::RunStatus> {
    let mut status=session.engine.status(id)?;
    if status.state!=datolens_enrichment::RunState::Running && lock(&session.runners)?.contains(id) {
        status.state=datolens_enrichment::RunState::Running;
    }
    if let Some(warning)=lock(&session.portable_warnings)?.get(id){status.error=Some(warning.clone());}
    Ok(status)
}
pub fn select_shared_revision(session:&Session,id:&str)->Result<Dataset> {
    if !lock(&session.runners)?.is_empty(){return Err("Espera a que termine el enriquecimiento antes de cambiar de versión.".into());}
    let definitions={
        let mut data=lock(&session.data)?;
        data.select_shared_revision(id).map_err(error)?;
        let definitions=data.shared_enrichments().map_err(error)?.unwrap_or_else(||serde_json::json!([]));
        serde_json::from_value(definitions).map_err(error)?
    };
    session.engine.restore_definitions(definitions)?;
    for definition in session.engine.list_definitions()? {ensure_output(session,&definition)?;}
    Ok(lock(&session.data)?.dataset())
}

#[cfg(test)]
mod tests {
    use super::*;
    use datolens_data::{PageRequest,SortRule,ExportRequest,ExportFormat};
    use datolens_enrichment::{CellKey,CredentialStore,Definition,MockProvider,RunMode,RunState};
    use serde_json::json;
    struct NoKeys;
    impl CredentialStore for NoKeys {fn key(&self,_:&str)->Result<String>{Err("No credentials in deterministic QA".into())}}
    fn definition(id:&str,input:&str,dep:Option<&str>)->Definition {
        Definition{id:id.into(),name:id.into(),provider:"gemini".into(),model:"fixture".into(),prompt:format!("Compute {{{{{input}}}}}"),input_columns:vec![input.into()],output_column:id.into(),output_kind:"numeric".into(),depends_on:dep.map(|s|vec![s.into()]).unwrap_or_default(),revision:1,options:Default::default()}
    }
    #[test]
    fn most_recent_source_updates_when_reopening_cached_dataset() {
        let temp=tempfile::tempdir().unwrap();let first=temp.path().join("first.csv");let second=temp.path().join("second.csv");
        std::fs::write(&first,"value\n1\n").unwrap();std::fs::write(&second,"value\n2\n").unwrap();
        let service=AppService::new(temp.path().join("projects"));
        service.open(&first,None).unwrap();service.open(&second,None).unwrap();service.open(&first,None).unwrap();
        let saved:Value=serde_json::from_slice(&std::fs::read(service.storage.join("last-source.json")).unwrap()).unwrap();
        assert_eq!(saved["path"],json!(first.canonicalize().unwrap().to_string_lossy()));
    }
    #[test]
    fn shared_project_definitions_and_results_open_from_another_path() {
        let temp=tempfile::tempdir().unwrap();
        let first=temp.path().join("owner");let second=temp.path().join("collaborator");
        std::fs::create_dir_all(&first).unwrap();std::fs::create_dir_all(&second).unwrap();
        let source=first.join("clients.csv");std::fs::write(&source,"amount\n1\n2\n").unwrap();
        let owner=AppService::new(first.join("cache"));let dataset=owner.open(&source,None).unwrap();
        let session=owner.session(&dataset.id).unwrap();
        let definition=definition("answer","amount",None);
        session.engine.save_definition(definition.clone()).unwrap();ensure_output(&session,&definition).unwrap();
        let row=lock(&session.data).unwrap().row_ids(&[],1,1).unwrap().remove(0);
        let view=json!({"formatVersion":1,"columns":{"order":["amount"],"hidden":[],"widths":{}},"sorting":[],"filters":[],"variablePanel":{"order":["amount"],"hidden":[],"pinned":[]}});
        {
            let data=lock(&session.data).unwrap();
            data.save_view(view.clone()).unwrap();
            data.save_enrichments(serde_json::to_value([definition.clone()]).unwrap()).unwrap();
            data.apply_results(&[CellUpdate{row_id:row,column_id:"answer".into(),value:json!(4.0),expected_dataset_revision:dataset.revision.clone()}]).unwrap();
            data.publish_portable_results().unwrap();
        }
        let source_copy=second.join("clients.csv");std::fs::copy(&source,&source_copy).unwrap();
        let sidecar=second.join("clients.csv.datolens.json");std::fs::copy(first.join("clients.csv.datolens.json"),&sidecar).unwrap();
        let project:Value=serde_json::from_slice(&std::fs::read(&sidecar).unwrap()).unwrap();
        let snapshot=project["resultsFile"].as_str().unwrap();
        let target=second.join("clients.csv.datolens").join(snapshot);
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        std::fs::copy(first.join("clients.csv.datolens").join(snapshot),target).unwrap();
        let collaborator=AppService::new(second.join("cache"));let reopened=collaborator.open(&source_copy,None).unwrap();
        let session=collaborator.session(&reopened.id).unwrap();
        assert_eq!(session.engine.list_definitions().unwrap(),vec![definition]);
        let data=lock(&session.data).unwrap();
        assert_eq!(data.load_view().unwrap(),Some(view));
        let row=data.row_ids(&[],1,1).unwrap().remove(0);
        assert_eq!(data.row_values(&row,&["answer".into()]).unwrap()["answer"],json!(4.0));
    }
    #[test]
    fn native_data_scheduler_persistence_export_roundtrip() {
        let temp=tempfile::tempdir().unwrap();
        let source=temp.path().join("chain.csv");
        std::fs::write(&source,"id,amount,group\n9007199254740993,1,alpha\n9007199254740995,9,beta\n9007199254740997,4,alpha\n").unwrap();
        let storage=temp.path().join("projects");
        let data=Arc::new(Mutex::new(DataStore::open(&source,None,&storage).unwrap()));
        let dataset=lock(&data).unwrap().dataset();
        let engine=Arc::new(Engine::open(temp.path().join("jobs.sqlite"),Arc::new(DataAdapter(data.clone())),Arc::new(NoKeys),Arc::new(MockProvider::default())).unwrap());
        let session=Session{data:data.clone(),engine:engine.clone(),runners:Mutex::new(Default::default()),portable_warnings:Mutex::new(Default::default()),_source_access:None};
        for d in [definition("A","amount",None),definition("B","A",Some("A")),definition("C","B",Some("B"))] {engine.save_definition(d.clone()).unwrap();ensure_output(&session,&d).unwrap();}
        let rows=lock(&data).unwrap().row_ids(&[],0,10).unwrap();
        let plan=engine.plan(vec![CellKey{row_id:rows[0].clone(),enrichment_id:"C".into()}],RunMode::Pending,true,false,3,10).unwrap();
        assert_eq!(plan.cell_count,3);engine.start(&plan.id).unwrap();
        // Reordering never changes the target IDs while this job is active.
        let page=lock(&data).unwrap().query_page(PageRequest{dataset_id:dataset.id.clone(),columns:vec!["id".into(),"amount".into()],filters:vec![],sorting:vec![SortRule{id:"amount".into(),desc:true}],offset:0,limit:10}).unwrap();
        assert_ne!(page.rows[0].id,rows[0]);
        assert_eq!(engine.run_to_completion(&plan.id).unwrap().state,RunState::Completed);
        let values=lock(&data).unwrap().row_values(&rows[0],&["id".into(),"C".into()]).unwrap();
        assert_eq!(values["id"],json!("9007199254740993"));assert_eq!(values["C"],json!(4.0));
        let exported=temp.path().join("enriched.parquet");
        lock(&data).unwrap().export(ExportRequest{path:exported.to_string_lossy().into(),format:ExportFormat::Parquet,columns:vec!["id".into(),"amount".into(),"A".into(),"B".into(),"C".into()],filters:vec![],sorting:vec![]}).unwrap();
        let reopened=DataStore::open(&exported,None,&temp.path().join("roundtrip")).unwrap();
        let p=reopened.query_page(PageRequest{dataset_id:reopened.dataset().id,columns:vec!["C".into()],filters:vec![],sorting:vec![],offset:0,limit:10}).unwrap();
        assert_eq!(p.rows[0].values["C"],json!(4.0));assert_eq!(p.rows[1].values["C"],Value::Null);
        drop(session);drop(engine);
        let recovered=Engine::open(temp.path().join("jobs.sqlite"),Arc::new(DataAdapter(data.clone())),Arc::new(NoKeys),Arc::new(MockProvider::default())).unwrap();
        assert_eq!(recovered.status(&plan.id).unwrap().succeeded,3);
        let pending=recovered.plan(vec![CellKey{row_id:rows[0].clone(),enrichment_id:"C".into()}],RunMode::Pending,true,false,3,10).unwrap();
        assert_eq!(pending.estimated_calls,0);
        recovered.save_definition(definition("A","amount",None)).unwrap();
        assert_eq!(recovered.cell(&CellKey{row_id:rows[0].clone(),enrichment_id:"C".into()}).unwrap().state,datolens_enrichment::CellState::Stale);
    }
}
