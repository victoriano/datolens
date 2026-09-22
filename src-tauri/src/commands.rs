use crate::service::*;
use datolens_data::{DataStore,Dataset,Distributions,Filter,Page,PageRequest,ExportRequest};
use datolens_enrichment::{Cell,CellKey,Definition,RunMode,RunPlan,RunStatus};
use serde::Deserialize;
use serde_json::Value;
use std::{path::Path,sync::Arc};
use tauri::State;
type S<'a> = State<'a,Arc<AppService>>;
async fn blocking<T:Send+'static>(f:impl FnOnce()->Result<T>+Send+'static)->Result<T> {tauri::async_runtime::spawn_blocking(f).await.map_err(error)?}

#[tauri::command]
pub async fn open_dataset(service:S<'_>,path:String,sheet:Option<String>)->Result<Dataset> {let s=service.inner().clone();blocking(move||s.open(Path::new(&path),sheet.as_deref())).await}
#[tauri::command]
pub async fn list_sheets(path:String)->Result<Vec<String>> {blocking(move||DataStore::list_sheets(Path::new(&path)).map_err(error)).await}
#[tauri::command]
pub async fn get_dataset(service:S<'_>,dataset_id:String)->Result<Dataset> {let s=service.session(&dataset_id)?;blocking(move||Ok(lock(&s.data)?.dataset())).await}
#[tauri::command]
pub async fn query_page(service:S<'_>,request:PageRequest)->Result<Page> {let s=service.session(&request.dataset_id)?;blocking(move||lock(&s.data)?.query_page(request).map_err(error)).await}
#[derive(Deserialize)]
#[serde(rename_all="camelCase")]
pub struct DistributionRequest {dataset_id:String,columns:Vec<String>,filters:Vec<Filter>}
#[tauri::command]
pub async fn get_distributions(service:S<'_>,request:DistributionRequest)->Result<Distributions> {let s=service.session(&request.dataset_id)?;blocking(move||lock(&s.data)?.distributions(&request.columns,&request.filters).map_err(error)).await}
#[tauri::command]
pub async fn load_view(service:S<'_>,dataset_id:String)->Result<Option<Value>> {let s=service.session(&dataset_id)?;blocking(move||lock(&s.data)?.load_view().map_err(error)).await}
#[tauri::command]
pub async fn save_view(service:S<'_>,dataset_id:String,view:Value)->Result<()> {let s=service.session(&dataset_id)?;blocking(move||lock(&s.data)?.save_view(view).map_err(error)).await}
#[derive(Deserialize)]
#[serde(rename_all="camelCase")]
pub struct ExportEnvelope { dataset_id:String, #[serde(flatten)] request:ExportRequest }
#[tauri::command]
pub async fn export_dataset(service:S<'_>,request:ExportEnvelope)->Result<String> {let s=service.session(&request.dataset_id)?;blocking(move||lock(&s.data)?.export(request.request).map_err(error)).await}
#[tauri::command]
pub async fn list_enrichments(service:S<'_>,dataset_id:String)->Result<Vec<Definition>> {let s=service.session(&dataset_id)?;blocking(move||s.engine.list_definitions()).await}
#[tauri::command]
pub async fn save_enrichment(service:S<'_>,dataset_id:String,definition:Definition)->Result<()> {
    let s=service.session(&dataset_id)?;
    blocking(move||{
        // Reject source collisions before mutating durable definitions.
        let old=s.engine.list_definitions()?;
        let dataset=lock(&s.data)?.dataset();
        if dataset.columns.iter().any(|c|c.id==definition.output_column) && !old.iter().any(|d|d.id==definition.id && d.output_column==definition.output_column) {return Err("Elige un ID de columna nuevo para el enriquecimiento".into());}
        for col in &definition.input_columns {if !dataset.columns.iter().any(|c|&c.id==col) {return Err(format!("Columna de entrada desconocida: {col}"));}}
        if let Some(column)=dataset.columns.iter().find(|c|c.id==definition.output_column) {
            let kind=serde_json::to_value(&column.kind).map_err(error)?;
            if column.name!=definition.name || kind.as_str()!=Some(definition.output_kind.as_str()) {return Err("Conserva el nombre y tipo de la columna existente, o crea un enriquecimiento nuevo".into());}
        }
        let existed=old.iter().any(|d|d.id==definition.id);
        s.engine.save_definition(definition.clone())?;
        if let Err(e)=ensure_output(&s,&definition) {
            if !existed {let _=s.engine.delete_definition(&definition.id);}
            return Err(format!("No se pudo preparar la columna de resultados: {e}"));
        }
        let definitions=s.engine.list_definitions()?;
        lock(&s.data)?.save_enrichments(serde_json::to_value(definitions).map_err(error)?).map_err(|e|format!("Definición guardada; no se pudo actualizar el archivo de proyecto: {e}"))?;
        Ok(())
    }).await
}
#[tauri::command]
pub async fn delete_enrichment(service:S<'_>,dataset_id:String,enrichment_id:String)->Result<()> {let s=service.session(&dataset_id)?;blocking(move||{s.engine.delete_definition(&enrichment_id)?;let definitions=s.engine.list_definitions()?;lock(&s.data)?.save_enrichments(serde_json::to_value(definitions).map_err(error)?).map_err(error)}).await}
#[tauri::command]
pub async fn save_provider_key(provider:String,key:String)->Result<()> {blocking(move||Keychain::save(&provider,&key)).await}
#[tauri::command]
pub async fn has_provider_key(provider:String)->Result<bool> {blocking(move||Keychain::has(&provider)).await}
#[tauri::command]
pub async fn remove_provider_key(provider:String)->Result<()> {blocking(move||Keychain::remove(&provider)).await}
#[derive(Deserialize)]
#[serde(tag="kind",rename_all="lowercase")]
pub enum Scope {
 Cells{cells:Vec<ScopeCell>},
 Rows{#[serde(rename="rowIds")] row_ids:Vec<String>,#[serde(rename="enrichmentIds")] enrichment_ids:Vec<String>},
 Filtered{filters:Vec<Filter>,#[serde(rename="enrichmentIds")] enrichment_ids:Vec<String>},
 All{#[serde(rename="enrichmentIds")] enrichment_ids:Vec<String>}
}
#[derive(Deserialize)]
#[serde(rename_all="camelCase")]
pub struct ScopeCell {row_id:String,column_id:String}
#[derive(Deserialize)]
#[serde(rename_all="camelCase")]
pub struct RunRequest {dataset_id:String,scope:Scope,mode:RunMode,include_prerequisites:bool,include_dependents:bool,concurrency:Option<usize>,max_calls:Option<usize>}
#[tauri::command]
pub async fn plan_run(service:S<'_>,request:RunRequest)->Result<RunPlan> {
 let app=service.inner().clone(); let s=app.session(&request.dataset_id)?;
 blocking(move||{
  let definitions=s.engine.list_definitions()?;
  let cells=match request.scope {
    Scope::Cells{cells}=>cells.into_iter().map(|cell|{
        let d=definitions.iter().find(|d|d.output_column==cell.column_id).ok_or_else(||format!("La columna {} no es un enriquecimiento",cell.column_id))?;
        Ok(CellKey{row_id:cell.row_id,enrichment_id:d.id.clone()})
    }).collect::<Result<Vec<_>>>()?,
    other=>{
      let (rows,ids)=match other {
       Scope::Rows{row_ids,enrichment_ids}=>(row_ids,enrichment_ids),
       Scope::Filtered{filters,enrichment_ids}=>(scope_rows(&s,&filters)?,enrichment_ids),
       Scope::All{enrichment_ids}=>(scope_rows(&s,&[])?,enrichment_ids),_=>unreachable!()
      };
      if rows.len().saturating_mul(ids.len())>100_000 {return Err("El plan supera 100.000 celdas. Reduce el alcance.".into());}
      rows.into_iter().flat_map(|row|ids.iter().map(move|id|CellKey{row_id:row.clone(),enrichment_id:id.clone()})).collect()
    }
  };
  let plan=s.engine.plan(cells,request.mode,request.include_prerequisites,request.include_dependents,request.concurrency.unwrap_or(3),request.max_calls.unwrap_or(1000).min(100_000))?;
  app.remember_plan(plan.id.clone(),s)?;Ok(plan)
 }).await
}
#[tauri::command]
pub async fn start_run(service:S<'_>,plan_id:String)->Result<RunStatus> {let s=service.plan_session(&plan_id)?;blocking(move||{let status=s.engine.start(&plan_id)?;launch(s,plan_id)?;Ok(status)}).await}
#[tauri::command]
pub async fn get_run_status(service:S<'_>,run_id:String)->Result<RunStatus> {let s=service.plan_session(&run_id)?;blocking(move||s.engine.status(&run_id)).await}
#[tauri::command]
pub async fn pause_run(service:S<'_>,run_id:String)->Result<()> {let s=service.plan_session(&run_id)?;blocking(move||s.engine.pause(&run_id)).await}
#[tauri::command]
pub async fn resume_run(service:S<'_>,run_id:String)->Result<()> {let s=service.plan_session(&run_id)?;blocking(move||{s.engine.resume(&run_id)?;launch(s,run_id)}).await}
#[tauri::command]
pub async fn cancel_run(service:S<'_>,run_id:String)->Result<()> {let s=service.plan_session(&run_id)?;blocking(move||s.engine.cancel(&run_id)).await}
#[tauri::command]
pub async fn list_runs(service:S<'_>,dataset_id:String)->Result<Vec<RunStatus>> {let s=service.session(&dataset_id)?;blocking(move||s.engine.list_runs()).await}
#[tauri::command]
pub async fn get_cells(service:S<'_>,dataset_id:String,cells:Vec<CellKey>)->Result<Vec<Cell>> {let s=service.session(&dataset_id)?;blocking(move||s.engine.get_cells(&cells)).await}
#[tauri::command]
pub async fn get_cell_history(service:S<'_>,dataset_id:String,cell:CellKey)->Result<Vec<Cell>> {let s=service.session(&dataset_id)?;blocking(move||s.engine.history(&cell)).await}

#[tauri::command]
pub async fn get_last_source(service:S<'_>)->Result<Option<Value>> {
 let path=service.storage.join("last-source.json");
 blocking(move||{if !path.exists(){return Ok(None);} let value:Value=serde_json::from_slice(&std::fs::read(path).map_err(error)?).map_err(error)?; Ok(Some(value))}).await
}
