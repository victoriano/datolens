use crate::service::{error, lock, AppService, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use datolens_data::plots::{PlotQuery, PlotResult};
use serde::Deserialize;
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn query_plot(service:State<'_,Arc<AppService>>,request:PlotQuery)->Result<PlotResult> {
    let session=service.session(&request.dataset_id)?;
    tauri::async_runtime::spawn_blocking(move || lock(&session.data)?.query_plot(request).map_err(error)).await.map_err(error)?
}
#[derive(Deserialize)]
#[serde(rename_all="lowercase")]
pub enum Format { Svg, Png, Csv }
#[derive(Deserialize)]
#[serde(rename_all="lowercase")]
pub enum Encoding { Utf8, Base64 }
#[derive(Deserialize)]
pub struct ExportPlot { path:String, format:Format, encoding:Encoding, content:String }
fn export_bytes(request:&ExportPlot)->Result<Vec<u8>> {
    if request.content.len()>70_000_000 {return Err("El gráfico supera el tamaño máximo de exportación.".into());}
    let bytes=match (&request.format,&request.encoding) {
        (Format::Png,Encoding::Base64)=>{
            let bytes=STANDARD.decode(&request.content).map_err(|_|"La imagen PNG no es válida")?;
            if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {return Err("La imagen PNG no es válida".into());}
            bytes
        },
        (Format::Svg|Format::Csv,Encoding::Utf8)=>request.content.as_bytes().to_vec(),
        _=>return Err("La codificación no corresponde al formato del gráfico.".into()),
    };
    if bytes.len()>50_000_000 {return Err("El gráfico supera el tamaño máximo de exportación.".into());}
    Ok(bytes)
}
#[tauri::command]
pub async fn export_plot(service:State<'_,Arc<AppService>>,request:ExportPlot)->Result<String> {
    let storage=service.storage.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let bytes=export_bytes(&request)?;
        crate::file_export::publish(&storage,std::path::Path::new(&request.path), |staged| {
            use std::io::Write;
            let mut file=std::fs::OpenOptions::new().write(true).create_new(true).open(staged).map_err(error)?;
            file.write_all(&bytes).map_err(error)
        })
    }).await.map_err(error)?
}
