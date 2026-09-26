use crate::service::{error, lock, AppService, Result};
use datolens_data::{DataStore, Filter};
use datolens_enrichment::{Definition, EnrichmentProposal, PreviewResult, SuggestColumn, SuggestRequest};
use serde::Deserialize;
use std::sync::Arc;
use tauri::State;

#[derive(Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct SuggestEnvelope { dataset_id:String, message:String, #[serde(default = "default_language")] language:String, previous:Option<Definition> }
fn default_language()->String { "es".into() }
#[derive(Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct PreviewEnvelope {
    dataset_id:String, definition:Definition,
    row_ids:Option<Vec<String>>,
    #[serde(default)] filters:Vec<Filter>,
}
fn preview_rows(data:&DataStore, request:&PreviewEnvelope)->Result<Vec<String>> {
    data.check_source().map_err(error)?;
    let dataset=data.dataset();
    if request.definition.input_columns.iter().any(|id|!dataset.columns.iter().any(|column|&column.id==id)) {return Err("La propuesta utiliza una columna desconocida.".into());}
    match &request.row_ids {
        Some(ids) if ids.len()>3=>Err("La vista previa admite como máximo 3 filas.".into()),
        Some(ids)=>Ok(ids.clone()),
        None=>data.row_ids(&request.filters,0,3).map_err(error),
    }
}

#[tauri::command]
pub async fn suggest_enrichment(service:State<'_,Arc<AppService>>, request:SuggestEnvelope)->Result<EnrichmentProposal> {
    let session=service.session(&request.dataset_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        if request.message.trim().is_empty() || request.message.len()>4000 { return Err("Describe la columna en un máximo de 4.000 caracteres.".into()); }
        let dataset={let data=lock(&session.data)?;data.check_source().map_err(error)?;data.dataset()};
        if dataset.columns.len()>128 { return Err("El asistente admite un esquema de hasta 128 columnas.".into()); }
        let columns=dataset.columns.iter().map(|column|Ok(SuggestColumn {
            id:column.id.clone(),name:column.name.clone(),
            kind:serde_json::to_value(&column.kind).map_err(error)?.as_str().ok_or("Tipo desconocido")?.into(),
        })).collect::<Result<Vec<_>>>()?;
        let result=session.engine.suggest(SuggestRequest{message:request.message,columns,language:request.language,previous:request.previous})?;
        let data=lock(&session.data)?;data.check_source().map_err(error)?;
        if data.dataset().revision!=dataset.revision {return Err("Los datos cambiaron durante la propuesta. Vuelve a diseñarla.".into());}
        Ok(result)
    }).await.map_err(error)?
}

#[tauri::command]
pub async fn preview_enrichment(service:State<'_,Arc<AppService>>, request:PreviewEnvelope)->Result<PreviewResult> {
    let session=service.session(&request.dataset_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let rows={let data=lock(&session.data)?;preview_rows(&data,&request)?};
        session.engine.preview(&request.definition,&rows)
    }).await.map_err(error)?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn automatic_preview_only_selects_three_matching_rows_and_rejects_unknown_inputs() {
        let temp=tempfile::tempdir().unwrap();
        let source=temp.path().join("scope.csv");
        std::fs::write(&source,"id,city\n1,Other\n2,Madrid\n3,Madrid\n4,Other\n5,Madrid\n6,Madrid\n").unwrap();
        let data=DataStore::open(&source,None,&temp.path().join("projects")).unwrap();
        let mut request:PreviewEnvelope=serde_json::from_value(json!({
            "datasetId":data.dataset().id,
            "definition":{"id":"test","name":"Test","provider":"gemini","model":"fixture","prompt":"{{city}}","inputColumns":["city"],"outputColumn":"test","outputKind":"text","dependsOn":[],"revision":1},
            "filters":[{"column":"city","kind":"categorical","selected":["Madrid"]}]
        })).unwrap();
        let rows=preview_rows(&data,&request).unwrap();
        assert_eq!(rows.len(),3);
        let values:Vec<_>=rows.iter().map(|id|data.row_values(id,&["id".into()]).unwrap()["id"].clone()).collect();
        assert_eq!(values,vec![json!(2),json!(3),json!(5)]);
        request.row_ids=Some(vec!["a".into();4]);
        assert!(preview_rows(&data,&request).is_err());
        request.row_ids=None;request.definition.input_columns=vec!["private_missing".into()];
        assert!(preview_rows(&data,&request).is_err());
    }
}
