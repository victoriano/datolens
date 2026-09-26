//! Explicit user-requested remote imports. Response bodies never enter the WebView.
use crate::service::{error, AppService, Result};
use datolens_data::Dataset;
use reqwest::{blocking::{Client, Response}, redirect::Policy, Url};
use serde::Serialize;
use std::{io::{Read, Write}, path::PathBuf, sync::Arc, time::{Duration, Instant}};
use tauri::{Emitter, State};

const MAX_DOWNLOAD_BYTES: u64 = 8 * 1024 * 1024 * 1024;
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteProgress {
    pub phase: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub received_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_bytes: Option<u64>,
}
impl RemoteProgress {
    fn phase(phase: &str) -> Self { Self { phase: phase.into(), received_bytes: None, total_bytes: None } }
}
pub fn is_remote_source(path: &str) -> bool {
    path.get(..7).is_some_and(|s| s.eq_ignore_ascii_case("http://"))
        || path.get(..8).is_some_and(|s| s.eq_ignore_ascii_case("https://"))
}
fn validated_url(raw: &str) -> Result<Url> {
    if raw.len() > 8192 { return Err("La URL supera la longitud admitida.".into()); }
    let url = Url::parse(raw.trim()).map_err(|_| "Introduce una URL HTTP o HTTPS válida.")?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none()
        || !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() {
        return Err("La URL debe usar HTTP/HTTPS, sin usuario, contraseña ni fragmento.".into());
    }
    Ok(url)
}
fn extension(name: &str) -> Option<&'static str> {
    match name.rsplit('.').next()?.to_ascii_lowercase().as_str() {
        "csv" => Some("csv"), "xlsx" => Some("xlsx"), "sav" => Some("sav"), "parquet" => Some("parquet"), _ => None,
    }
}
fn url_name(url: &Url) -> &str { url.path_segments().and_then(|mut p| p.next_back()).unwrap_or("") }
fn response_format(response: &Response) -> Option<&'static str> {
    extension(url_name(response.url())).or_else(|| {
        let content_type = response.headers().get(reqwest::header::CONTENT_TYPE)?.to_str().ok()?.split(';').next()?.trim();
        match content_type {
            "text/csv" | "application/csv" => Some("csv"),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" => Some("xlsx"),
            "application/vnd.apache.parquet" | "application/x-parquet" => Some("parquet"),
            "application/x-spss-sav" => Some("sav"), _ => None,
        }
    }).or_else(|| {
        let disposition = response.headers().get(reqwest::header::CONTENT_DISPOSITION)?.to_str().ok()?;
        disposition.split(';').find_map(|part| part.trim().strip_prefix("filename=").and_then(|name| extension(name.trim_matches('"'))))
    })
}
fn safe_name(url: &Url, format: &str) -> String {
    let original = url_name(url);
    let stem = original.rsplit_once('.').map(|p| p.0).unwrap_or(original);
    let cleaned: String = stem.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_')).take(100).collect();
    format!("{}.{}", if cleaned.is_empty() { "dataset" } else { &cleaned }, format)
}
fn client() -> Result<Client> {
    Client::builder().connect_timeout(Duration::from_secs(20)).timeout(Duration::from_secs(30 * 60))
        .redirect(Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 { return attempt.error("Demasiadas redirecciones"); }
            let url = attempt.url();
            if !matches!(url.scheme(), "http" | "https") || !url.username().is_empty() || url.password().is_some()
                || (attempt.previous().last().is_some_and(|p| p.scheme() == "https") && url.scheme() != "https") {
                return attempt.error("Redirección no admitida");
            }
            attempt.follow()
        })).build().map_err(|_| "No se pudo preparar la conexión remota.".into())
}
struct Download { directory: tempfile::TempDir, path: PathBuf }
fn download_response(mut response: Response, storage: &std::path::Path, format: &str, max_bytes: u64, progress: &dyn Fn(RemoteProgress)) -> Result<Download> {
    let total = response.content_length();
    if total.is_some_and(|n| n > max_bytes) { return Err("El archivo remoto supera el límite de descarga de 8 GiB.".into()); }
    let parent = storage.join("remote-sources");
    std::fs::create_dir_all(&parent).map_err(error)?;
    // The source is published to the app only after its response finishes. On any
    // HTTP/disk/parse failure the temporary directory removes the incomplete file.
    let directory = tempfile::Builder::new().prefix("source-").tempdir_in(parent).map_err(error)?;
    let path = directory.path().join(safe_name(response.url(), format));
    let mut file = std::fs::OpenOptions::new().create_new(true).write(true).open(&path).map_err(error)?;
    let mut received = 0u64;
    let mut buffer = [0u8; 64 * 1024];
    let mut last_update = Instant::now();
    progress(RemoteProgress { phase: "download".into(), received_bytes: Some(0), total_bytes: total });
    loop {
        let count = response.read(&mut buffer).map_err(|_| "Se interrumpió la descarga del archivo remoto.")?;
        if count == 0 { break; }
        received = received.checked_add(count as u64).ok_or("Archivo remoto demasiado grande.")?;
        if received > max_bytes { return Err("El archivo remoto supera el límite de descarga de 8 GiB.".into()); }
        file.write_all(&buffer[..count]).map_err(|_| "No se pudo guardar la descarga. Comprueba el espacio disponible.")?;
        if last_update.elapsed() >= Duration::from_millis(150) {
            progress(RemoteProgress { phase: "download".into(), received_bytes: Some(received), total_bytes: total });
            last_update = Instant::now();
        }
    }
    if received == 0 || total.is_some_and(|n| n != received) { return Err("La descarga está vacía o incompleta.".into()); }
    file.sync_all().map_err(|_| "No se pudo completar la escritura de la descarga.")?;
    progress(RemoteProgress { phase: "download".into(), received_bytes: Some(received), total_bytes: total });
    Ok(Download { directory, path })
}
pub fn import_source(service: &AppService, raw: &str, progress: &dyn Fn(RemoteProgress)) -> Result<Dataset> {
    let url = validated_url(raw)?;
    progress(RemoteProgress::phase("inspect"));
    let known_parquet = extension(url_name(&url)) == Some("parquet");
    // A query string may contain a signed access token. Range mode persists its
    // source URL for reopening, so use a local snapshot instead in that case.
    let can_persist_url = url.query().is_none();
    if known_parquet && can_persist_url {
        if let Some(dataset) = service.open_remote_parquet(url.as_str(), &|phase| progress(RemoteProgress::phase(phase)))? { return Ok(dataset); }
    }
    let response = client()?.get(url.clone()).header(reqwest::header::ACCEPT_ENCODING, "identity").send()
        .map_err(|_| "No se pudo descargar la URL. Comprueba la conexión y el enlace.")?;
    if !response.status().is_success() { return Err(format!("El servidor respondió con HTTP {}.", response.status().as_u16())); }
    // This request did not ask for a range. Accepting an unsolicited 206 could
    // silently import only the first rows of an otherwise valid CSV.
    if response.status() == reqwest::StatusCode::PARTIAL_CONTENT {
        return Err("El servidor devolvió solo parte del archivo; no se ha importado la descarga.".into());
    }
    let format = response_format(&response).or_else(|| extension(url_name(&url)))
        .ok_or("La URL debe apuntar a un archivo CSV, XLSX, SAV o Parquet.")?;
    if format == "parquet" && !known_parquet && can_persist_url {
        // Headers identified a Parquet endpoint without a filename. This response
        // has not been consumed; consult the range reader before downloading it.
        if let Some(dataset) = service.open_remote_parquet(url.as_str(), &|phase| progress(RemoteProgress::phase(phase)))? { return Ok(dataset); }
    }
    let download = download_response(response, &service.storage, format, MAX_DOWNLOAD_BYTES, progress)?;
    let dataset = service.open_with_progress(&download.path, None, &|phase| progress(RemoteProgress::phase(phase)))?;
    let _ = download.directory.keep();
    Ok(dataset)
}
#[tauri::command]
pub async fn import_dataset_url(service: State<'_, Arc<AppService>>, app: tauri::AppHandle, url: String, request_id: Option<String>) -> Result<Dataset> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || import_source(&service, &url, &|progress| {
        if let Some(id) = &request_id {
            let mut payload = serde_json::to_value(progress).unwrap_or_default();
            payload["requestId"] = serde_json::json!(id);
            let _ = app.emit("dataset-open-progress", payload);
        }
    })).await.map_err(error)?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use datolens_data::PageRequest;
    fn serve_once(path: &str, headers: &str, body: &[u8]) -> String {
        serve_responses(path, headers, body, 1)
    }
    fn serve_responses(path: &str, headers: &str, body: &[u8], count: usize) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let bytes = [headers.as_bytes(), b"\r\n\r\n", body].concat();
        std::thread::spawn(move || {
          for _ in 0..count {
            let (mut socket, _) = listener.accept().unwrap();
            socket.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
            let mut request = Vec::new();
            let mut byte = [0u8; 1];
            while !request.ends_with(b"\r\n\r\n") {
                if socket.read(&mut byte).unwrap_or(0) == 0 { return; }
                request.push(byte[0]);
                if request.len() > 16_384 { return; }
            }
            let _ = socket.write_all(&bytes);
          }
        });
        format!("http://{address}/{path}")
    }
    #[test]
    fn downloads_csv_natively_preserves_integer_identity_and_reopens_locally() {
        let fixture = b"id,city\n9007199254740993,Madrid\n9007199254740995,Sevilla\n";
        let url = serve_once("customers.csv?signature=not-a-real-secret", &format!("HTTP/1.1 200 OK\r\nContent-Type: text/csv\r\nContent-Length: {}\r\nConnection: close", fixture.len()), fixture);
        let temp = tempfile::tempdir().unwrap();
        let service = AppService::new(temp.path().join("projects"));
        let events = std::cell::RefCell::new(Vec::new());
        let dataset = import_source(&service, &url, &|event| events.borrow_mut().push(event)).unwrap();
        assert_eq!(dataset.row_count, Some(2));
        assert!(std::path::Path::new(&dataset.source_path).starts_with(temp.path().canonicalize().unwrap()));
        assert!(!dataset.source_path.contains("signature"));
        assert_eq!(std::fs::read(&dataset.source_path).unwrap(), fixture);
        let session = service.session(&dataset.id).unwrap();
        let data = crate::service::lock(&session.data).unwrap();
        let page = data.query_page(PageRequest { dataset_id: dataset.id.clone(), columns: vec!["id".into()], filters: vec![], sorting: vec![], offset: 0, limit: 10 }).unwrap();
        assert_eq!(page.rows[0].values["id"], serde_json::json!("9007199254740993"));
        assert!(events.borrow().iter().any(|p| p.phase == "download" && p.received_bytes == Some(fixture.len() as u64)));
        drop(data);drop(session);drop(service);
        let reopened = AppService::new(temp.path().join("projects")).open(std::path::Path::new(&dataset.source_path), None).unwrap();
        assert_eq!(reopened.id, dataset.id);
    }
    #[test]
    fn oversized_stream_without_length_removes_partial_download() {
        let url = serve_once("large.csv", "HTTP/1.1 200 OK\r\nConnection: close", b"column\n12345678901234567890\n");
        let response = client().unwrap().get(url).send().unwrap();
        let temp = tempfile::tempdir().unwrap();
        assert!(download_response(response, temp.path(), "csv", 8, &|_| {}).is_err());
        assert_eq!(std::fs::read_dir(temp.path().join("remote-sources")).unwrap().count(), 0);
    }
    #[test]
    fn parquet_without_range_support_downloads_and_opens_a_local_snapshot() {
        use datolens_data::{DataStore, ExportFormat, ExportRequest};
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("source.csv");
        std::fs::write(&source, "id,amount\n9007199254740993,12\n9007199254740995,20\n").unwrap();
        let data = DataStore::open(&source, None, &temp.path().join("fixture-cache")).unwrap();
        let parquet = temp.path().join("fixture.parquet");
        data.export(ExportRequest { path: parquet.to_string_lossy().into(), format: ExportFormat::Parquet, columns: vec!["id".into(), "amount".into()], filters: vec![], sorting: vec![] }).unwrap();
        let body = std::fs::read(parquet).unwrap();
        // Intentionally ignores Range, returning 200. The first response must be
        // dropped by the range probe; the second is the explicit full download.
        let url = serve_responses("fixture.parquet", &format!("HTTP/1.1 200 OK\r\nContent-Type: application/vnd.apache.parquet\r\nContent-Length: {}\r\nConnection: close", body.len()), &body, 2);
        let service = AppService::new(temp.path().join("app-cache")).with_httpfs_path(temp.path().join("not-needed-for-download"));
        let dataset = import_source(&service, &url, &|_| {}).unwrap();
        assert_eq!(dataset.row_count, Some(2));
        assert!(!is_remote_source(&dataset.source_path));
        assert_eq!(std::fs::read(dataset.source_path).unwrap(), body);
        let signed_url = serve_once("fixture.parquet?token=private-sentinel", &format!("HTTP/1.1 200 OK\r\nContent-Type: application/vnd.apache.parquet\r\nContent-Length: {}\r\nConnection: close", body.len()), &body);
        let signed = import_source(&service, &signed_url, &|_| {}).unwrap();
        assert!(!is_remote_source(&signed.source_path));
        assert!(!signed.source_path.contains("private-sentinel"));
    }
    #[test]
    fn url_validation_and_http_errors_do_not_expose_url_credentials() {
        for url in ["file:///etc/passwd", "https://user:pass@example.org/a.csv", "https://example.org/a.csv#fragment", "not a url"] {
            assert!(validated_url(url).is_err());
        }
        let url = serve_once("data.csv?key=private-sentinel", "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close", b"");
        let temp = tempfile::tempdir().unwrap();
        let service = AppService::new(temp.path().join("projects"));
        let failure = import_source(&service, &url, &|_| {}).unwrap_err();
        assert!(failure.contains("403"));
        assert!(!failure.contains("private-sentinel"));
        assert!(!service.storage.join("remote-sources").exists());
        let partial = b"id\n1\n";
        let url = serve_once("partial.csv", &format!("HTTP/1.1 206 Partial Content\r\nContent-Length: {}\r\nContent-Range: bytes 0-4/100\r\nConnection: close", partial.len()), partial);
        assert!(import_source(&service, &url, &|_| {}).unwrap_err().contains("solo parte"));
        assert!(!service.storage.join("remote-sources").exists());
    }
    #[test]
    fn download_names_cannot_escape_the_generated_directory() {
        let url = validated_url("https://example.org/%2e%2e%2fsecret.xlsx?token=private").unwrap();
        let name = safe_name(&url, "xlsx");
        assert!(!name.contains('/'));
        assert!(!name.contains(".."));
        assert!(!name.contains("private"));
        assert!(name.ends_with(".xlsx"));
    }
}
