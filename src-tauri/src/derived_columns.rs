use crate::service::{error,lock,AppService,Result};
use datolens_data::{DerivedCreated,DerivedDefinition,DerivedPreview,Filter};
use datolens_enrichment::{ColumnProposal,ColumnSuggestRequest,SuggestColumn};
use serde::Deserialize;
use std::sync::Arc;
use tauri::State;

#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct SuggestEnvelope {dataset_id:String,message:String,#[serde(default = "default_language")] language:String,previous:Option<ColumnProposal>}
fn default_language()->String { "es".into() }
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct PreviewEnvelope {dataset_id:String,formula:DerivedDefinition,row_ids:Option<Vec<String>>,#[serde(default)] filters:Vec<Filter>}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct CreateEnvelope {dataset_id:String,formula:DerivedDefinition,expected_revision:String,expected_fingerprint:String}

#[tauri::command]
pub async fn suggest_column(service:State<'_,Arc<AppService>>,request:SuggestEnvelope)->Result<ColumnProposal> {
    let session=service.session(&request.dataset_id)?;
    tauri::async_runtime::spawn_blocking(move||{
        let dataset={let data=lock(&session.data)?;data.check_source().map_err(error)?;data.dataset()};
        if dataset.columns.len()>128 {return Err("El asistente admite un esquema de hasta 128 columnas.".into());}
        let columns=dataset.columns.iter().map(|column|Ok(SuggestColumn{id:column.id.clone(),name:column.name.clone(),kind:serde_json::to_value(&column.kind).map_err(error)?.as_str().ok_or("Tipo desconocido")?.into()})).collect::<Result<Vec<_>>>()?;
        let proposal=session.engine.suggest_column(ColumnSuggestRequest{message:request.message,columns,language:request.language,previous:request.previous})?;
        let data=lock(&session.data)?;data.check_source().map_err(error)?;
        if data.dataset().revision!=dataset.revision || data.dataset().columns!=dataset.columns {return Err("Los datos cambiaron durante la propuesta. Vuelve a diseñarla.".into());}
        if let ColumnProposal::Formula{formula,..}=&proposal {
            // Never return a suggested executable formula without native AST/type validation.
            let definition=DerivedDefinition{id:formula.id.clone(),name:formula.name.clone(),expression:formula.expression.clone()};
            data.preview_derived_column(&definition,Some(&[]),&[]).map_err(error)?;
        }
        Ok(proposal)
    }).await.map_err(error)?
}
#[tauri::command]
pub async fn preview_derived_column(service:State<'_,Arc<AppService>>,request:PreviewEnvelope)->Result<DerivedPreview> {
    let session=service.session(&request.dataset_id)?;
    tauri::async_runtime::spawn_blocking(move||lock(&session.data)?.preview_derived_column(&request.formula,request.row_ids.as_deref(),&request.filters).map_err(error)).await.map_err(error)?
}
#[tauri::command]
pub async fn create_derived_column(service:State<'_,Arc<AppService>>,request:CreateEnvelope)->Result<DerivedCreated> {
    let session=service.session(&request.dataset_id)?;
    tauri::async_runtime::spawn_blocking(move||lock(&session.data)?.create_derived_column(request.formula,&request.expected_revision,&request.expected_fingerprint).map_err(error)).await.map_err(error)?
}
