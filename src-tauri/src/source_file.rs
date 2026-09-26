use crate::service::{error, lock, AppService, Result};
use std::{path::Path, sync::Arc};
use tauri::State;

#[tauri::command]
pub async fn reveal_dataset_source(
    service: State<'_, Arc<AppService>>,
    dataset_id: String,
) -> Result<()> {
    // Resolve the source from the open session, rather than accepting an
    // arbitrary path or shell command from the webview.
    let session = service.session(&dataset_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let source = lock(&session.data)?.dataset().source_path;
        reveal_source(Path::new(&source))
    })
    .await
    .map_err(error)?
}

#[cfg(target_os = "macos")]
fn reveal_source(path: &Path) -> Result<()> {
    if !path.is_file() {
        return Err("No se encuentra el archivo original. Puede haberse movido o eliminado.".into());
    }
    // Finder opens the containing folder with the source file selected. Passing
    // a separate argument preserves spaces and special characters in its name.
    let result = std::process::Command::new("/usr/bin/open")
        .arg("-R")
        .arg(path)
        .output()
        .map_err(|e| format!("No se pudo abrir Finder: {e}"))?;
    if result.status.success() {
        Ok(())
    } else {
        Err("Finder no pudo mostrar la ubicación del archivo.".into())
    }
}

#[cfg(not(target_os = "macos"))]
fn reveal_source(_path: &Path) -> Result<()> {
    Err("Mostrar el archivo en Finder solo está disponible en macOS.".into())
}
