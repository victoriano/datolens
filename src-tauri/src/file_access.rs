//! Persistent, app-scoped access to user-selected files. Bookmark bytes stay native.
use crate::service::{error, Result};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, io::Write, path::{Component, Path, PathBuf}, sync::{Arc, Mutex, Weak}};

const RESELECT: &str = "No se pudo recuperar el permiso del archivo. Vuelve a seleccionarlo con Abrir archivo.";

pub struct SourceAccess {
    pub path: PathBuf,
    // Released after the last native session/operation using this source ends.
    _scope: Box<dyn Send + Sync>,
}
struct Resolved {
    path: PathBuf,
    stale: bool,
    scope: Box<dyn Send + Sync>,
}
trait Backend: Send + Sync {
    fn capture(&self, path: &Path) -> Result<Vec<u8>>;
    fn resolve(&self, bytes: &[u8]) -> Result<Resolved>;
}
#[derive(Default, Deserialize, Serialize)]
struct Saved {
    version: u32,
    entries: HashMap<PathBuf, String>,
}
#[derive(Default)]
struct State {
    saved: Option<Saved>,
    active: HashMap<PathBuf, Weak<SourceAccess>>,
}
pub struct FileAccess {
    storage: PathBuf,
    backend: Option<Box<dyn Backend>>,
    state: Mutex<State>,
}
impl FileAccess {
    pub fn new(storage: PathBuf) -> Self {
        #[cfg(target_os = "macos")]
        let backend = native::sandboxed().then(|| Box::new(native::Mac) as Box<dyn Backend>);
        #[cfg(not(target_os = "macos"))]
        let backend = None;
        Self { storage, backend, state: Mutex::new(State::default()) }
    }
    /// Called immediately after the picker, while Powerbox access is still valid.
    /// A fresh selection replaces a revoked/stale grant instead of trusting it.
    pub fn remember_selection(&self, path: &Path) -> Result<()> {
        self.acquire_inner(path, true).map(|_| ())
    }
    pub fn acquire(&self, path: &Path) -> Result<Arc<SourceAccess>> {
        self.acquire_inner(path, false)
    }
    fn acquire_inner(&self, path: &Path, selected: bool) -> Result<Arc<SourceAccess>> {
        let internal = path.starts_with(&self.storage) && !path.components().any(|part| part == Component::ParentDir);
        let Some(backend) = self.backend.as_ref().filter(|_| !internal) else {
            return Ok(Arc::new(SourceAccess { path: path.into(), _scope: Box::new(()) }));
        };
        let mut state = self.state.lock().map_err(|_| "Almacén de permisos no disponible.")?;
        if !selected {
            if let Some(access) = state.active.get(path).and_then(Weak::upgrade) { return Ok(access); }
        }
        if state.saved.is_none() {
            let file = self.storage.join("source-bookmarks.json");
            let saved = match std::fs::read(&file) {
                Ok(bytes) => {
                    let saved: Saved = serde_json::from_slice(&bytes).map_err(|_| "El almacén de permisos de archivos no es válido.")?;
                    if saved.version != 1 { return Err("Versión de permisos de archivos no compatible.".into()); }
                    saved
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Saved { version: 1, ..Saved::default() },
                Err(_) => return Err("No se pudo leer el almacén de permisos de archivos.".into()),
            };
            state.saved = Some(saved);
        }
        let saved = state.saved.as_ref().unwrap();
        let existing = if selected { None } else { saved.entries.get(path) };
        let fresh = existing.is_none();
        let bytes = match existing {
            Some(value) => STANDARD.decode(value).map_err(|_| RESELECT)?,
            None => backend.capture(path)?,
        };
        let resolved = backend.resolve(&bytes)?;
        // Own the guard before any subsequent fallible operation, including saving.
        let access = Arc::new(SourceAccess { path: resolved.path, _scope: resolved.scope });
        let refreshed = if resolved.stale { backend.capture(&access.path)? } else { bytes };
        if fresh || resolved.stale || access.path != path {
            let mut next = Saved { version: 1, entries: state.saved.as_ref().unwrap().entries.clone() };
            let encoded = STANDARD.encode(refreshed);
            // Keep the former path as an alias so persisted tabs can find a moved file.
            next.entries.insert(path.into(), encoded.clone());
            next.entries.insert(access.path.clone(), encoded);
            self.persist(&next)?;
            state.saved = Some(next);
        }
        state.active.retain(|_, access| access.strong_count() != 0);
        state.active.insert(path.into(), Arc::downgrade(&access));
        state.active.insert(access.path.clone(), Arc::downgrade(&access));
        Ok(access)
    }
    fn persist(&self, saved: &Saved) -> Result<()> {
        std::fs::create_dir_all(&self.storage).map_err(error)?;
        // NamedTempFile is private (0600 on macOS); persist atomically replaces the file.
        let mut temporary = tempfile::NamedTempFile::new_in(&self.storage).map_err(error)?;
        temporary.write_all(&serde_json::to_vec(saved).map_err(error)?).map_err(error)?;
        temporary.as_file().sync_all().map_err(error)?;
        temporary.persist(self.storage.join("source-bookmarks.json")).map_err(|_| "No se pudo guardar el permiso del archivo.")?;
        Ok(())
    }
}

#[cfg(target_os = "macos")]
mod native {
    use super::*;
    use core_foundation::{base::{CFAllocatorRef, CFTypeRef, CFRelease, TCFType}, boolean::CFBoolean,
        data::CFData, error::CFErrorRef, string::{CFString, CFStringRef}, url::*};
    use std::ptr;
    #[link(name = "Security", kind = "framework")]
    extern "C" {
        fn SecTaskCreateFromSelf(allocator: CFAllocatorRef) -> CFTypeRef;
        fn SecTaskCopyValueForEntitlement(task: CFTypeRef, key: CFStringRef, error: *mut CFErrorRef) -> CFTypeRef;
    }
    pub fn sandboxed() -> bool {
        unsafe {
            let task = SecTaskCreateFromSelf(ptr::null());
            if task.is_null() { return false; }
            let key = CFString::new("com.apple.security.app-sandbox");
            let value = SecTaskCopyValueForEntitlement(task, key.as_concrete_TypeRef(), ptr::null_mut());
            CFRelease(task);
            if value.is_null() { return false; }
            let enabled = core_foundation::base::CFEqual(value, CFBoolean::true_value().as_CFTypeRef()) != 0;
            CFRelease(value);
            enabled
        }
    }
    pub struct Mac;
    struct Scope(CFURL);
    // CFURL is immutable. The scope applies process-wide; Arc ensures that exactly
    // one stop is paired with its successful start, after all worker users finish.
    unsafe impl Send for Scope {}
    unsafe impl Sync for Scope {}
    impl Drop for Scope {
        fn drop(&mut self) { unsafe { CFURLStopAccessingSecurityScopedResource(self.0.as_concrete_TypeRef()); } }
    }
    fn bookmark(url: &CFURL) -> Result<Vec<u8>> {
        unsafe {
            let data = CFURLCreateBookmarkData(ptr::null(), url.as_concrete_TypeRef(), kCFURLBookmarkCreationWithSecurityScope, ptr::null(), ptr::null(), ptr::null_mut());
            if data.is_null() { return Err("No se pudo guardar el permiso del archivo. Vuelve a seleccionarlo con Abrir archivo.".into()); }
            let data: CFData = TCFType::wrap_under_create_rule(data);
            Ok(data.bytes().to_vec())
        }
    }
    impl Backend for Mac {
        fn capture(&self, path: &Path) -> Result<Vec<u8>> {
            let url = CFURL::from_path(path, false).ok_or(RESELECT)?;
            bookmark(&url)
        }
        fn resolve(&self, bytes: &[u8]) -> Result<Resolved> {
            let data = CFData::from_buffer(bytes);
            let mut stale = 0;
            unsafe {
                let raw = CFURLCreateByResolvingBookmarkData(ptr::null(), data.as_concrete_TypeRef(),
                    kCFURLBookmarkResolutionWithSecurityScope | kCFURLBookmarkResolutionWithoutUIMask | kCFURLBookmarkResolutionWithoutMountingMask,
                    ptr::null(), ptr::null(), &mut stale, ptr::null_mut());
                if raw.is_null() { return Err(RESELECT.into()); }
                let url: CFURL = TCFType::wrap_under_create_rule(raw);
                if CFURLStartAccessingSecurityScopedResource(url.as_concrete_TypeRef()) == 0 { return Err(RESELECT.into()); }
                let scope = Scope(url);
                // Only canonicalize after start; this also records /private/tmp
                // aliases exactly as DataStore and persisted tabs will use them.
                let path = std::fs::canonicalize(scope.0.to_path().ok_or(RESELECT)?).map_err(|_| RESELECT)?;
                Ok(Resolved { path, stale: stale != 0, scope: Box::new(scope) })
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    #[derive(Default)]
    struct Counts { starts: AtomicUsize, stops: AtomicUsize, captures: AtomicUsize, stale: AtomicBool, moved: Mutex<Option<PathBuf>> }
    struct Mock(Arc<Counts>);
    struct Scope(Arc<Counts>);
    impl Drop for Scope { fn drop(&mut self) { self.0.stops.fetch_add(1, Ordering::SeqCst); } }
    impl Backend for Mock {
        fn capture(&self, path: &Path) -> Result<Vec<u8>> {
            self.0.captures.fetch_add(1, Ordering::SeqCst);
            Ok(path.to_string_lossy().as_bytes().to_vec())
        }
        fn resolve(&self, bytes: &[u8]) -> Result<Resolved> {
            let path = String::from_utf8(bytes.to_vec()).map_err(error)?;
            self.0.starts.fetch_add(1, Ordering::SeqCst);
            let path = self.0.moved.lock().unwrap().clone().unwrap_or_else(|| path.into());
            Ok(Resolved { path, stale: self.0.stale.swap(false, Ordering::SeqCst), scope: Box::new(Scope(self.0.clone())) })
        }
    }
    fn store(storage: PathBuf, counts: &Arc<Counts>) -> FileAccess {
        FileAccess { storage, backend: Some(Box::new(Mock(counts.clone()))), state: Mutex::new(State::default()) }
    }
    #[test]
    fn sessions_and_worksheets_share_one_scope_until_last_user_finishes() {
        let temp = tempfile::tempdir().unwrap();
        let counts = Arc::new(Counts::default());
        let access = store(temp.path().into(), &counts);
        let first = access.acquire(Path::new("/external/book.xlsx")).unwrap();
        let second = access.acquire(Path::new("/external/book.xlsx")).unwrap();
        assert!(Arc::ptr_eq(&first, &second));
        assert_eq!(counts.starts.load(Ordering::SeqCst), 1);
        drop(first);
        assert_eq!(counts.stops.load(Ordering::SeqCst), 0);
        drop(second);
        assert_eq!(counts.stops.load(Ordering::SeqCst), 1);
        // No strong guard is leaked by the cache.
        drop(access.acquire(Path::new("/external/book.xlsx")).unwrap());
        assert_eq!(counts.stops.load(Ordering::SeqCst), 2);
    }
    #[test]
    fn picker_capture_survives_restart_and_stale_bookmarks_are_renewed() {
        let temp = tempfile::tempdir().unwrap();
        let counts = Arc::new(Counts::default());
        let access = store(temp.path().into(), &counts);
        access.remember_selection(Path::new("/external/data.csv")).unwrap();
        drop(access);
        let access = store(temp.path().into(), &counts);
        drop(access.acquire(Path::new("/external/data.csv")).unwrap());
        assert_eq!(counts.captures.load(Ordering::SeqCst), 1);
        counts.stale.store(true, Ordering::SeqCst);
        drop(access.acquire(Path::new("/external/data.csv")).unwrap());
        assert_eq!(counts.captures.load(Ordering::SeqCst), 2);
        assert_eq!(counts.starts.load(Ordering::SeqCst), counts.stops.load(Ordering::SeqCst));
        #[cfg(unix)] {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(temp.path().join("source-bookmarks.json")).unwrap().permissions().mode() & 0o777, 0o600);
        }
    }
    #[test]
    fn failed_persistence_releases_scope_and_does_not_cache_a_grant() {
        let temp = tempfile::tempdir().unwrap();
        // A directory at the final filename makes the atomic replacement fail.
        std::fs::create_dir(temp.path().join("source-bookmarks.json")).unwrap();
        let counts = Arc::new(Counts::default());
        let access = store(temp.path().into(), &counts);
        access.state.lock().unwrap().saved = Some(Saved { version: 1, ..Saved::default() });
        assert!(access.acquire(Path::new("/external/data.csv")).is_err());
        assert_eq!(counts.starts.load(Ordering::SeqCst), 1);
        assert_eq!(counts.stops.load(Ordering::SeqCst), 1);
        assert!(access.state.lock().unwrap().active.is_empty());
    }
    #[test]
    fn moved_source_keeps_the_old_tab_alias_and_renews_the_saved_grant() {
        let temp = tempfile::tempdir().unwrap();
        let counts = Arc::new(Counts::default());
        let old = Path::new("/external/old.csv");
        let new = Path::new("/external/renamed.csv");
        let access = store(temp.path().into(), &counts);
        access.remember_selection(old).unwrap();
        *counts.moved.lock().unwrap() = Some(new.into());
        counts.stale.store(true, Ordering::SeqCst);
        let restored = access.acquire(old).unwrap();
        assert_eq!(restored.path, new);
        assert!(Arc::ptr_eq(&restored, &access.acquire(new).unwrap()));
        drop(restored);
        drop(access);
        *counts.moved.lock().unwrap() = None;
        let access = store(temp.path().into(), &counts);
        assert_eq!(access.acquire(old).unwrap().path, new);
        assert_eq!(counts.captures.load(Ordering::SeqCst), 2);
        assert_eq!(counts.starts.load(Ordering::SeqCst), counts.stops.load(Ordering::SeqCst));
    }
    #[test]
    fn internal_sources_do_not_request_or_store_bookmarks() {
        let temp = tempfile::tempdir().unwrap();
        let counts = Arc::new(Counts::default());
        let access = store(temp.path().into(), &counts);
        drop(access.acquire(&temp.path().join("remote-sources/data.csv")).unwrap());
        assert_eq!(counts.starts.load(Ordering::SeqCst), 0);
        assert!(!temp.path().join("source-bookmarks.json").exists());
    }
}
