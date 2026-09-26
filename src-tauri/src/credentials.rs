use datolens_enrichment::CredentialStore;
use std::{collections::HashMap, io::{Read, Write}, path::PathBuf, process::{Command, Stdio}, sync::{Mutex, OnceLock}};
use zeroize::Zeroizing;

type Result<T> = std::result::Result<T, String>;
type Secret = Zeroizing<String>;
const MAX_KEY: usize = 8192;
const UNVERIFIED_APP: &str = "El componente de credenciales no pudo verificar esta versión de Datolens. Cierra y vuelve a abrir la app. Tus claves siguen guardadas en el Llavero.";
const HELPER_STOPPED: &str = "El componente local de credenciales se cerró inesperadamente. Cierra y vuelve a abrir Datolens. Tus claves siguen guardadas en el Llavero.";

fn decode_response(response: &[u8]) -> Result<(i32, Zeroizing<Vec<u8>>)> {
    if response.len() < 6 || response.len() > MAX_KEY + 6 {
        return Err("Respuesta de credenciales no válida".into());
    }
    let status = i32::from_be_bytes(response[..4].try_into().unwrap());
    let length = u16::from_be_bytes(response[4..6].try_into().unwrap()) as usize;
    if response.len() != length + 6 { return Err("Respuesta de credenciales no válida".into()); }
    Ok((status, Zeroizing::new(response[6..].to_vec())))
}

fn helper_exit_error(code: Option<i32>) -> &'static str {
    if code == Some(77) { UNVERIFIED_APP } else { HELPER_STOPPED }
}

trait Backend: Send + Sync {
    fn read(&self, provider: &str, retry: bool) -> Result<Secret>;
    fn save(&self, provider: &str, key: &str) -> Result<()>;
    fn has(&self, provider: &str) -> Result<bool>;
    fn remove(&self, provider: &str) -> Result<()>;
}

struct Credentials<B> {
    backend: B,
    // Serialize first access, including failures: a parallel batch must never
    // queue multiple macOS prompts. Only an explicit retry clears a denial.
    values: Mutex<HashMap<String, Result<Secret>>>,
}

fn validate(provider: &str) -> Result<()> {
    if matches!(provider, "gemini" | "jev") { Ok(()) } else { Err("Proveedor no compatible".into()) }
}

impl<B: Backend> Credentials<B> {
    fn new(backend: B) -> Self { Self { backend, values: Mutex::new(HashMap::new()) } }
    fn key(&self, provider: &str, retry: bool) -> Result<String> {
        validate(provider)?;
        let mut values = self.values.lock().map_err(|_| "Almacén de credenciales no disponible")?;
        if retry && values.get(provider).is_some_and(|value| value.is_err()) { values.remove(provider); }
        let value = values.entry(provider.into()).or_insert_with(|| self.backend.read(provider, retry));
        value.as_ref().map(|key| key.to_string()).map_err(Clone::clone)
    }
    fn save(&self, provider: &str, key: &str) -> Result<()> {
        validate(provider)?;
        let key = key.trim();
        if key.is_empty() || key.len() > MAX_KEY { return Err("La clave está vacía o es demasiado larga".into()); }
        let mut values = self.values.lock().map_err(|_| "Almacén de credenciales no disponible")?;
        self.backend.save(provider, key)?;
        values.insert(provider.into(), Ok(Zeroizing::new(key.into())));
        Ok(())
    }
    fn has(&self, provider: &str) -> Result<bool> {
        validate(provider)?;
        self.backend.has(provider)
    }
    fn remove(&self, provider: &str) -> Result<()> {
        validate(provider)?;
        let mut values = self.values.lock().map_err(|_| "Almacén de credenciales no disponible")?;
        values.remove(provider);
        self.backend.remove(provider)
    }
}

struct LocalHelper;
impl LocalHelper {
    fn path() -> Result<PathBuf> {
        let executable = std::env::current_exe().map_err(|_| "No se pudo localizar Datolens")?;
        let bundled = executable.with_file_name("datolens-credentials");
        if bundled.is_file() { return Ok(bundled); }
        Err("Falta el componente local de credenciales. Abre la app creada con scripts/build-macos.sh.".into())
    }
    fn call(&self, op: u8, provider: &str, key: &[u8]) -> Result<(i32, Zeroizing<Vec<u8>>)> {
        validate(provider)?;
        if key.len() > MAX_KEY { return Err("La clave es demasiado larga".into()); }
        let mut child = Command::new(Self::path()?)
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null())
            .spawn().map_err(|_| "No se pudo abrir el almacén local de credenciales")?;
        let operation: Result<Zeroizing<Vec<u8>>> = (|| {
            let mut input = child.stdin.take().ok_or("No se pudo acceder al almacén local")?;
            let length = (key.len() as u16).to_be_bytes();
            input.write_all(&[1, op, u8::from(provider == "jev"), 0, length[0], length[1]])
                .and_then(|_| input.write_all(key)).map_err(|_| "No se pudo acceder al almacén local")?;
            drop(input);
            let mut response = Zeroizing::new(Vec::new());
            child.stdout.take().ok_or("No se pudo acceder al almacén local")?
                .take((MAX_KEY + 7) as u64).read_to_end(&mut response)
                .map_err(|_| "No se pudo leer la respuesta del almacén local")?;
            if response.len() > MAX_KEY + 6 { return Err("Respuesta de credenciales no válida".into()); }
            Ok(response)
        })();
        if operation.is_err() { let _ = child.kill(); }
        // Empty EOF may be an intentional denial. Wait for its real exit code
        // before classifying it; killing first hid crashes and protocol errors
        // behind an inaccurate signature error.
        let exit = child.wait();
        let response = operation?;
        let exit = exit.map_err(|_| HELPER_STOPPED)?;
        if !exit.success() { return Err(helper_exit_error(exit.code()).into()); }
        decode_response(&response)
    }
}

fn status_error(status: i32, provider: &str) -> String {
    match status {
        -25300 => format!("Introduce tu clave de {provider} en Ajustes"),
        -128 | -25293 | -25308 | -25291 => "No se autorizó el acceso a la clave en el Llavero. Abre Ajustes → Proveedores de IA → Autorizar acceso para reintentarlo una vez.".into(),
        _ => "No se pudo acceder al Llavero de macOS. Reintenta el acceso desde Ajustes.".into(),
    }
}

impl Backend for LocalHelper {
    fn read(&self, provider: &str, retry: bool) -> Result<Secret> {
        let (status, data) = self.call(if retry { 5 } else { 1 }, provider, &[])?;
        if status != 0 { return Err(status_error(status, provider)); }
        let key = std::str::from_utf8(&data).map_err(|_| "La clave del Llavero no es válida")?;
        if key.trim().is_empty() { return Err("La clave del Llavero está vacía".into()); }
        Ok(Zeroizing::new(key.into()))
    }
    fn save(&self, provider: &str, key: &str) -> Result<()> {
        let (status, _) = self.call(2, provider, key.as_bytes())?;
        if status == 0 { Ok(()) } else { Err(status_error(status, provider)) }
    }
    fn has(&self, provider: &str) -> Result<bool> {
        let (status, _) = self.call(3, provider, &[])?;
        match status { 0 => Ok(true), -25300 => Ok(false), _ => Err(status_error(status, provider)) }
    }
    fn remove(&self, provider: &str) -> Result<()> {
        let (status, _) = self.call(4, provider, &[])?;
        if status == 0 { Ok(()) } else { Err(status_error(status, provider)) }
    }
}

fn credentials() -> &'static Credentials<LocalHelper> {
    static STORE: OnceLock<Credentials<LocalHelper>> = OnceLock::new();
    STORE.get_or_init(|| Credentials::new(LocalHelper))
}

pub struct Keychain;
impl Keychain {
    pub fn save(provider: &str, key: &str) -> Result<()> { credentials().save(provider, key) }
    pub fn has(provider: &str) -> Result<bool> { credentials().has(provider) }
    pub fn remove(provider: &str) -> Result<()> { credentials().remove(provider) }
    pub fn check_access(provider: &str) -> Result<()> { credentials().key(provider, true).map(|key| { let _key = Zeroizing::new(key); }) }
}
impl CredentialStore for Keychain {
    fn key(&self, provider: &str) -> Result<String> { credentials().key(provider, false) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering::SeqCst};
    #[derive(Default)]
    struct Fake {
        reads: AtomicUsize,
        fail: AtomicBool,
        key: Mutex<Option<String>>,
    }
    impl Backend for Fake {
        fn read(&self, _: &str, _: bool) -> Result<Secret> {
            self.reads.fetch_add(1, SeqCst);
            if self.fail.load(SeqCst) { return Err("Access denied".into()); }
            self.key.lock().unwrap().clone().map(Zeroizing::new).ok_or("Missing".into())
        }
        fn save(&self, _: &str, key: &str) -> Result<()> {
            if self.fail.load(SeqCst) { return Err("Save failed".into()); }
            *self.key.lock().unwrap() = Some(key.into()); Ok(())
        }
        fn has(&self, _: &str) -> Result<bool> { Ok(self.key.lock().unwrap().is_some()) }
        fn remove(&self, _: &str) -> Result<()> { *self.key.lock().unwrap() = None; Ok(()) }
    }
    fn store() -> Credentials<Fake> {
        let fake = Fake::default();
        *fake.key.lock().unwrap() = Some("synthetic-credential".into());
        Credentials::new(fake)
    }
    #[test]
    fn crashes_and_invalid_responses_are_not_reported_as_signature_rejections() {
        assert_eq!(helper_exit_error(Some(77)), UNVERIFIED_APP);
        for code in [None, Some(64), Some(1)] { assert_eq!(helper_exit_error(code), HELPER_STOPPED); }
        for response in [vec![], vec![0; 5], vec![0, 0, 0, 0, 0, 1], vec![0; MAX_KEY + 7]] {
            assert_eq!(decode_response(&response).unwrap_err(), "Respuesta de credenciales no válida");
        }
    }
    #[test]
    fn protocol_preserves_keychain_status_and_validated_payload() {
        let missing = (-25300_i32).to_be_bytes();
        let (status, data) = decode_response(&[missing[0], missing[1], missing[2], missing[3], 0, 0]).unwrap();
        assert_eq!(status, -25300);
        assert!(data.is_empty());
        let (status, data) = decode_response(&[0, 0, 0, 0, 0, 3, b'k', b'e', b'y']).unwrap();
        assert_eq!(status, 0);
        assert_eq!(&*data, b"key");
    }
    #[test]
    fn parallel_models_and_datasets_share_one_credential_read() {
        let store = store();
        std::thread::scope(|scope| {
            for _ in 0..32 { let store = &store; scope.spawn(move || assert_eq!(store.key("gemini", false).unwrap(), "synthetic-credential")); }
        });
        assert_eq!(store.backend.reads.load(SeqCst), 1);
    }
    #[test]
    fn denied_access_is_not_reprompted_until_explicit_retry() {
        let store = store(); store.backend.fail.store(true, SeqCst);
        for _ in 0..20 { assert!(store.key("gemini", false).is_err()); }
        assert_eq!(store.backend.reads.load(SeqCst), 1);
        store.backend.fail.store(false, SeqCst);
        assert!(store.key("gemini", false).is_err());
        assert!(store.key("gemini", true).is_ok());
        assert_eq!(store.backend.reads.load(SeqCst), 2);
        assert!(store.key("gemini", true).is_ok());
        assert_eq!(store.backend.reads.load(SeqCst), 2);
    }
    #[test]
    fn save_primes_cache_and_replace_updates_it_without_reading_keychain() {
        let store = store();
        store.save("gemini", "  new-synthetic  ").unwrap();
        assert_eq!(store.key("gemini", false).unwrap(), "new-synthetic");
        store.save("gemini", "replacement").unwrap();
        assert_eq!(store.key("gemini", false).unwrap(), "replacement");
        assert_eq!(store.backend.reads.load(SeqCst), 0);
    }
    #[test]
    fn failed_save_preserves_last_persisted_key() {
        let store = store(); store.key("gemini", false).unwrap();
        store.backend.fail.store(true, SeqCst);
        assert!(store.save("gemini", "not-saved").is_err());
        assert_eq!(store.key("gemini", false).unwrap(), "synthetic-credential");
    }
    #[test]
    fn removal_drops_cached_secret_and_cannot_resurrect_it() {
        let store = store(); store.key("gemini", false).unwrap();
        store.remove("gemini").unwrap();
        assert!(!store.has("gemini").unwrap());
        assert!(store.key("gemini", false).is_err());
        store.save("gemini", "restored").unwrap();
        assert_eq!(store.key("gemini", false).unwrap(), "restored");
    }
    #[test]
    fn presence_never_decrypts_and_providers_have_separate_slots() {
        let store = store();
        assert!(store.has("gemini").unwrap());
        assert_eq!(store.backend.reads.load(SeqCst), 0);
        store.key("gemini", false).unwrap(); store.key("jev", false).unwrap();
        assert_eq!(store.backend.reads.load(SeqCst), 2);
        assert!(store.key("unknown", false).is_err());
        assert!(store.save("gemini", " ").is_err());
        assert!(store.save("gemini", &"x".repeat(MAX_KEY + 1)).is_err());
    }
}
