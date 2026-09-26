use crate::service::AppService;
use serde::Serialize;
use std::{collections::HashSet, path::{Path, PathBuf}, sync::{Arc, Mutex}};
use tauri::{Emitter, Manager, State, Url};

const SUPPORTED_EXTENSIONS: &[&str] = &["csv", "xlsx", "parquet", "sav"];

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenFileBatch {
    id: u64,
    paths: Vec<String>,
    errors: Vec<String>,
}

#[derive(Default)]
struct Inbox {
    next_id: u64,
    batches: Vec<OpenFileBatch>,
}

#[derive(Default)]
pub struct OpenFileInbox(Mutex<Inbox>);

fn supported(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| SUPPORTED_EXTENSIONS.iter().any(|allowed| extension.eq_ignore_ascii_case(allowed)))
}

fn local_paths(urls: &[Url]) -> (Vec<PathBuf>, Vec<String>) {
    let mut paths = Vec::new();
    let mut errors = Vec::new();
    let mut unique = HashSet::new();
    for url in urls {
        let Ok(path) = url.to_file_path() else {
            errors.push(format!("Datolens solo puede abrir archivos locales: {url}"));
            continue;
        };
        if !supported(&path) {
            errors.push(format!("Formato no compatible: {}", path.file_name().unwrap_or_default().to_string_lossy()));
            continue;
        }
        if unique.insert(path.clone()) {
            paths.push(path);
        }
    }
    (paths, errors)
}

pub fn receive(app: &tauri::AppHandle, urls: &[Url]) {
    let (paths, mut errors) = local_paths(urls);
    let service = app.state::<Arc<AppService>>();
    let paths = paths.into_iter().filter_map(|path| {
        match service.file_access.remember_selection(&path) {
            Ok(()) => Some(path.to_string_lossy().into_owned()),
            Err(error) => {
                errors.push(format!("No se pudo autorizar {}: {error}", path.file_name().unwrap_or_default().to_string_lossy()));
                None
            }
        }
    }).collect::<Vec<_>>();
    if paths.is_empty() && errors.is_empty() { return; }

    let inbox = app.state::<OpenFileInbox>();
    let Ok(mut inbox) = inbox.0.lock() else { return; };
    inbox.next_id += 1;
    let batch = OpenFileBatch { id: inbox.next_id, paths, errors };
    inbox.batches.push(batch.clone());
    drop(inbox);

    let _ = app.emit("opened-files", &batch);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[tauri::command]
pub fn take_opened_files(inbox: State<'_, OpenFileInbox>) -> Vec<OpenFileBatch> {
    inbox.0.lock().map(|mut inbox| inbox.batches.drain(..).collect()).unwrap_or_default()
}

#[tauri::command]
pub fn acknowledge_opened_files(inbox: State<'_, OpenFileInbox>, ids: Vec<u64>) {
    if let Ok(mut inbox) = inbox.0.lock() {
        let ids = ids.into_iter().collect::<HashSet<_>>();
        inbox.batches.retain(|batch| !ids.contains(&batch.id));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_supported_file_urls_case_insensitively_and_deduplicates() {
        let csv = Url::from_file_path("/tmp/My data.CSV").unwrap();
        let parquet = Url::from_file_path("/tmp/table.parquet").unwrap();
        let (paths, errors) = local_paths(&[csv.clone(), parquet, csv]);
        assert!(errors.is_empty());
        assert_eq!(paths, vec![PathBuf::from("/tmp/My data.CSV"), PathBuf::from("/tmp/table.parquet")]);
    }

    #[test]
    fn rejects_remote_and_unsupported_urls() {
        let remote = Url::parse("https://example.com/data.csv").unwrap();
        let text = Url::from_file_path("/tmp/notes.txt").unwrap();
        let (paths, errors) = local_paths(&[remote, text]);
        assert!(paths.is_empty());
        assert_eq!(errors.len(), 2);
    }
}
