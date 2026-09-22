use datolens_data::{CellUpdate, Column, DataStore, Dataset, Filter, VariableKind};
use datolens_enrichment::{CredentialStore, DataAccess, Engine, GeminiProvider, InputSnapshot};
use serde_json::Value;
use std::{collections::HashMap, path::{Path, PathBuf}, sync::{Arc, Mutex, MutexGuard}};

pub type Result<T> = std::result::Result<T, String>;
pub fn lock<T>(m: &Mutex<T>) -> Result<MutexGuard<'_, T>> { m.lock().map_err(|_| "Almacén local no disponible".into()) }
pub fn error(e: impl std::fmt::Display) -> String { e.to_string() }
pub struct Keychain;
const KEY_SERVICE: &str = "com.victoriano.datolens.providers";
impl Keychain {
    fn validate(provider: &str) -> Result<()> { if provider == "gemini" { Ok(()) } else { Err("Proveedor no compatible".into()) } }
    pub fn save(provider: &str, key: &str) -> Result<()> {
        Self::validate(provider)?;
        if key.trim().is_empty() { return Err("La clave está vacía".into()); }
        security_framework::passwords::set_generic_password(KEY_SERVICE, provider, key.trim().as_bytes()).map_err(|_| "No se pudo guardar la clave en Keychain".into())
    }
    pub fn has(provider: &str) -> Result<bool> {
        Self::validate(provider)?;
        match security_framework::passwords::get_generic_password(KEY_SERVICE, provider) { Ok(_) => Ok(true), Err(e) if e.code()==-25300 => Ok(false), Err(_) => Err("No se pudo acceder a Keychain".into()) }
    }
    pub fn remove(provider: &str) -> Result<()> {
        Self::validate(provider)?;
        match security_framework::passwords::delete_generic_password(KEY_SERVICE, provider) { Ok(())=>Ok(()), Err(e) if e.code()==-25300=>Ok(()),Err(_)=>Err("No se pudo eliminar la clave de Keychain".into()) }
    }
}
impl CredentialStore for Keychain {
    fn key(&self, provider: &str) -> Result<String> {
        Self::validate(provider)?;
        let bytes=security_framework::passwords::get_generic_password(KEY_SERVICE,provider).map_err(|_| "Introduce tu clave de Gemini en la aplicación".to_string())?;
        String::from_utf8(bytes).map_err(|_| "La clave de Keychain no es válida".into())
    }
}
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
pub struct Session { pub data:Arc<Mutex<DataStore>>,pub engine:Arc<Engine>, pub runners:Mutex<std::collections::HashSet<String>> }
pub struct AppService { pub storage:PathBuf, sessions:Mutex<HashMap<String,Arc<Session>>>, plans:Mutex<HashMap<String,Arc<Session>>> }
impl AppService {
    pub fn new(storage:PathBuf)->Self {Self{storage,sessions:Mutex::new(HashMap::new()),plans:Mutex::new(HashMap::new())}}
    pub fn open(&self,path:&Path,sheet:Option<&str>)->Result<Dataset> {
        // Opening and importing stays off the WebView thread. Serialize opens to avoid
        // two connections to the same per-dataset database during rapid drops.
        let path=std::fs::canonicalize(path).map_err(error)?;
        let mut sessions=lock(&self.sessions)?;
        if let Some(existing)=sessions.values().find(|s|lock(&s.data).is_ok_and(|d| d.dataset().source_path==path.to_string_lossy() && d.dataset().sheet.as_deref()==sheet)) {
            let data=lock(&existing.data)?;
            if data.check_source().is_ok() {let dataset=data.dataset();self.remember_source(&dataset)?;return Ok(dataset);}
        }
        let data=DataStore::open(&path,sheet,&self.storage).map_err(error)?;
        let dataset=data.dataset();
        if let Some(existing)=sessions.get(&dataset.id) {let dataset=lock(&existing.data)?.dataset();self.remember_source(&dataset)?;return Ok(dataset);}
        let data=Arc::new(Mutex::new(data));
        let engine=Arc::new(Engine::open(self.storage.join(format!("{}.jobs.sqlite",dataset.id)),Arc::new(DataAdapter(data.clone())),Arc::new(Keychain),Arc::new(GeminiProvider::new()?))?);
        let session=Arc::new(Session{data,engine,runners:Mutex::new(Default::default())});
        for definition in session.engine.list_definitions()? {ensure_output(&session,&definition)?;}
        for run in session.engine.list_runs()? { lock(&self.plans)?.insert(run.id.clone(),session.clone()); }
        sessions.insert(dataset.id.clone(),session);
        self.remember_source(&dataset)?;
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
    lock(&session.data)?.ensure_result_column(Column{id:definition.output_column.clone(),name:definition.name.clone(),data_type:String::new(),kind}).map_err(error)
}
pub fn scope_rows(session:&Session, filters:&[Filter])->Result<Vec<String>> {
    let data=lock(&session.data)?; let mut rows=vec![];
    loop { let page=data.row_ids(filters,rows.len() as u64,10000).map_err(error)?; let len=page.len();rows.extend(page); if rows.len()>100_000 {return Err("El alcance supera 100.000 filas. Aplica un filtro más preciso.".into());} if len<10000 {break;} }
    Ok(rows)
}
pub fn launch(session:Arc<Session>,id:String)->Result<()> {
    if !lock(&session.runners)?.insert(id.clone()) {return Ok(());}
    tauri::async_runtime::spawn_blocking(move || {let _=session.engine.run_to_completion(&id);if let Ok(mut runners)=session.runners.lock(){runners.remove(&id);} });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use datolens_data::{PageRequest,SortRule,ExportRequest,ExportFormat};
    use datolens_enrichment::{CellKey,Definition,MockProvider,RunMode,RunState};
    use serde_json::json;
    struct NoKeys;
    impl CredentialStore for NoKeys {fn key(&self,_:&str)->Result<String>{Err("No credentials in deterministic QA".into())}}
    fn definition(id:&str,input:&str,dep:Option<&str>)->Definition {
        Definition{id:id.into(),name:id.into(),provider:"gemini".into(),model:"fixture".into(),prompt:format!("Compute {{{{{input}}}}}"),input_columns:vec![input.into()],output_column:id.into(),output_kind:"numeric".into(),depends_on:dep.map(|s|vec![s.into()]).unwrap_or_default(),revision:1}
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
    fn native_data_scheduler_persistence_export_roundtrip() {
        let temp=tempfile::tempdir().unwrap();
        let source=temp.path().join("chain.csv");
        std::fs::write(&source,"id,amount,group\n9007199254740993,1,alpha\n9007199254740995,9,beta\n9007199254740997,4,alpha\n").unwrap();
        let storage=temp.path().join("projects");
        let data=Arc::new(Mutex::new(DataStore::open(&source,None,&storage).unwrap()));
        let dataset=lock(&data).unwrap().dataset();
        let engine=Arc::new(Engine::open(temp.path().join("jobs.sqlite"),Arc::new(DataAdapter(data.clone())),Arc::new(NoKeys),Arc::new(MockProvider::default())).unwrap());
        let session=Session{data:data.clone(),engine:engine.clone(),runners:Mutex::new(Default::default())};
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
