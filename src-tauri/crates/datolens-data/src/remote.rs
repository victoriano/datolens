//! Version-pinned HTTP Parquet. Only the host supplies the signed httpfs path.
use super::*;
use reqwest::{blocking::{Client, Response}, header, StatusCode, Url};
use std::time::Duration;

const MAX_FOOTER: u64 = 64 * 1024 * 1024;
fn load_httpfs(conn: &Connection, httpfs_path: &Path) -> Result<()> {
    // Distribution builds can link httpfs into the signed DuckDB library. Only
    // that explicit engine state permits a name-based LOAD; a cached/downloaded
    // extension must still use the host's exact pinned path and normal signature
    // validation. Automatic installation and loading remain disabled.
    let builtin: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM duckdb_extensions() WHERE extension_name='httpfs' AND install_mode='STATICALLY_LINKED')",
        [], |row| row.get(0),
    )?;
    if builtin {
        conn.execute_batch("LOAD httpfs")?;
    } else {
        let extension = fs::canonicalize(httpfs_path)?;
        conn.execute_batch(&format!("LOAD {}", literal(&extension.to_string_lossy())))?;
    }
    Ok(())
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(super) struct RemoteIdentity {
    resolved_url: String,
    etag: String,
    last_modified: Option<String>,
}
pub(super) struct RemoteSource {
    client: Client,
    identity: RemoteIdentity,
    bytes: u64,
}
fn network_error(_: reqwest::Error) -> Error {
    // reqwest errors may embed URL query strings; keep them out of UI/logs.
    Error::Invalid("No se pudo consultar el archivo remoto. Comprueba la conexión y la URL.".into())
}
fn invalid(message: &str) -> Error { Error::Invalid(message.into()) }
fn public_url(raw: &str) -> Result<Url> {
    let mut url=Url::parse(raw.trim()).map_err(|_|invalid("URL HTTP(S) no válida."))?;
    if raw.len()>8192 || !matches!(url.scheme(),"http"|"https") || url.host_str().is_none() || !url.username().is_empty() || url.password().is_some() {
        return Err(invalid("Usa una URL HTTP(S) sin usuario ni contraseña."));
    }
    // Persistent source URLs must not become a credential store.
    if url.query_pairs().any(|(key,_)| matches!(key.to_ascii_lowercase().as_str(),"token"|"access_token"|"api_key"|"apikey"|"key"|"signature"|"sig"|"x-amz-signature"|"x-amz-credential"|"x-goog-signature"|"x-goog-credential")) {
        return Err(Error::RemoteDownloadRequired);
    }
    url.set_fragment(None);
    Ok(url)
}
fn client() -> Result<Client> {
    Client::builder().connect_timeout(Duration::from_secs(10)).timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none()).build().map_err(network_error)
}
fn strong_etag(response: &Response) -> Option<String> {
    let value=response.headers().get(header::ETAG)?.to_str().ok()?;
    (value.len()>=2 && value.len()<=1024 && value.starts_with('"') && value.ends_with('"')).then(||value.into())
}
fn content_range(response: &Response) -> Result<(u64,u64,u64)> {
    let value=response.headers().get(header::CONTENT_RANGE).and_then(|v|v.to_str().ok()).ok_or_else(||invalid("Respuesta Range sin Content-Range."))?;
    let (bounds,total)=value.strip_prefix("bytes ").and_then(|v|v.split_once('/')).ok_or_else(||invalid("Content-Range no válido."))?;
    let (start,end)=bounds.split_once('-').ok_or_else(||invalid("Content-Range no válido."))?;
    let parse=|n:&str|n.parse::<u64>().map_err(|_|invalid("Content-Range no válido."));
    let (start,end,total)=(parse(start)?,parse(end)?,parse(total)?);
    if start>end || end>=total { return Err(invalid("Límites Content-Range no válidos.")); }
    Ok((start,end,total))
}
fn range(client:&Client,url:&str,start:u64,end:u64,expected:Option<(&str,u64)>) -> Result<(Response,u64)> {
    let mut current=public_url(url)?;
    let mut hops=0;
    let response=loop {
        let mut request=client.get(current.clone()).header(header::RANGE,format!("bytes={start}-{end}")).header(header::ACCEPT_ENCODING,"identity");
        if let Some((etag,_))=expected { request=request.header(header::IF_MATCH,etag); }
        let response=request.send().map_err(network_error)?;
        if !response.status().is_redirection() { break response; }
        // A pinned source cannot silently move between row-group requests.
        if expected.is_some() { return Err(Error::SourceChanged); }
        if hops>=5 { return Err(invalid("Demasiadas redirecciones en la fuente remota.")); }
        let location=response.headers().get(header::LOCATION).and_then(|value|value.to_str().ok()).ok_or_else(||invalid("Redirección sin destino."))?;
        let next=current.join(location).map_err(|_|invalid("Destino de redirección no válido."))?;
        if current.scheme()=="https" && next.scheme()!="https" { return Err(invalid("La redirección reduce la seguridad de la conexión.")); }
        current=public_url(next.as_str())?;
        hops+=1;
    };
    if response.status()==StatusCode::PRECONDITION_FAILED { return Err(Error::SourceChanged); }
    if response.status()==StatusCode::OK {
        // Drop immediately; never consume the server's unbounded 200 body here.
        return Err(if expected.is_some() { invalid("El servidor dejó de respetar las lecturas parciales.") } else { Error::RemoteDownloadRequired });
    }
    if response.status()!=StatusCode::PARTIAL_CONTENT { return Err(invalid("El servidor no pudo entregar el bloque solicitado.")); }
    if response.headers().get(header::CONTENT_ENCODING).and_then(|v|v.to_str().ok()).is_some_and(|v|v!="identity") { return Err(invalid("El servidor comprimió una respuesta Range; no puede verificarse.")); }
    let (actual_start,actual_end,total)=content_range(&response)?;
    if actual_start!=start || actual_end!=end { return Err(invalid("El servidor devolvió otro intervalo de bytes.")); }
    if let Some((etag,bytes))=expected {
        if total!=bytes || strong_etag(&response).as_deref()!=Some(etag) || response.url().as_str()!=url { return Err(Error::SourceChanged); }
    }
    if response.content_length().is_some_and(|n|n!=end-start+1) { return Err(invalid("Tamaño de bloque remoto inesperado.")); }
    Ok((response,total))
}
fn read_block(response:Response,bytes:u64) -> Result<Vec<u8>> {
    let mut result=Vec::with_capacity(bytes.min(MAX_FOOTER) as usize);
    response.take(bytes+1).read_to_end(&mut result)?;
    if result.len() as u64!=bytes { return Err(invalid("Bloque remoto incompleto o de tamaño inesperado.")); }
    Ok(result)
}
impl RemoteSource {
    fn inspect(raw:&str)->Result<(Self,String,String)> {
        let url=public_url(raw)?;
        let client=client()?;
        let (response,bytes)=range(&client,url.as_str(),0,3,None)?;
        let etag=strong_etag(&response).ok_or(Error::RemoteDownloadRequired)?;
        if bytes<12 { return Err(invalid("Archivo Parquet remoto demasiado corto.")); }
        let identity=RemoteIdentity{resolved_url:response.url().to_string(),etag,last_modified:response.headers().get(header::LAST_MODIFIED).and_then(|v|v.to_str().ok()).map(str::to_owned)};
        if read_block(response,4)?!=b"PAR1" { return Err(invalid("La URL no contiene un archivo Parquet compatible.")); }
        let remote=Self{client,identity,bytes};
        let tail=remote.read(bytes-8,bytes-1)?;
        if &tail[4..]!=b"PAR1" { return Err(invalid("El archivo remoto no tiene un pie Parquet válido.")); }
        let footer_len=u32::from_le_bytes(tail[..4].try_into().unwrap()) as u64;
        if footer_len>MAX_FOOTER || footer_len>bytes-12 { return Err(invalid("Metadatos Parquet remotos demasiado grandes o inválidos.")); }
        let footer=remote.read(bytes-8-footer_len,bytes-1)?;
        Ok((remote,url.to_string(),hash(&footer)))
    }
    fn read(&self,start:u64,end:u64)->Result<Vec<u8>> {
        let (response,_)=range(&self.client,&self.identity.resolved_url,start,end,Some((&self.identity.etag,self.bytes)))?;
        read_block(response,end-start+1)
    }
    pub(super) fn check(&self)->Result<()> {
        let response=self.client.head(&self.identity.resolved_url).header(header::IF_MATCH,&self.identity.etag).header(header::ACCEPT_ENCODING,"identity").send().map_err(network_error)?;
        if response.status()==StatusCode::METHOD_NOT_ALLOWED || response.status()==StatusCode::NOT_IMPLEMENTED {
            self.read(0,3)?;return Ok(());
        }
        if response.status()==StatusCode::PRECONDITION_FAILED { return Err(Error::SourceChanged); }
        if !response.status().is_success() { return Err(invalid("No se pudo validar la revisión del archivo remoto.")); }
        let length=response.headers().get(header::CONTENT_LENGTH).and_then(|value|value.to_str().ok()).and_then(|value|value.parse::<u64>().ok());
        if length.is_none() || strong_etag(&response).is_none() { self.read(0,3)?;return Ok(()); }
        if strong_etag(&response).as_deref()!=Some(&self.identity.etag) || length!=Some(self.bytes) || response.url().as_str()!=self.identity.resolved_url {
            return Err(Error::SourceChanged);
        }
        Ok(())
    }
}
impl DataStore {
    /// Opens one immutable HTTP(S) Parquet snapshot. No data profiles or sample
    /// construction at open; the host may download when Range/strong ETag is absent.
    pub fn open_remote_parquet_with_progress(url:&str,storage_dir:&Path,httpfs_path:&Path,progress:&dyn Fn(&str))->Result<Self> {
        progress("inspect");
        let (remote,url,footer_hash)=RemoteSource::inspect(url)?;
        let source=SourceSignature{path:url.clone(),bytes:remote.bytes,modified_ns:0,sample_hash:footer_hash,sheet:None,remote:Some(remote.identity.clone())};
        let revision=hash(&serde_json::to_vec(&source)?);
        let id=format!("ds_{}",&revision[..24]);
        fs::create_dir_all(storage_dir)?;
        let database_path=storage_dir.join(format!("{id}.duckdb"));
        let project_path=storage_dir.join(format!("{id}.remote.datolens.json"));
        let legacy_project_path=project_path.clone();
        let pending_project_path=storage_dir.join(format!("{id}.pending.datolens.json"));
        let conn=Connection::open(&database_path)?;
        conn.execute_batch("SET memory_limit='512MB'; SET threads=2; SET preserve_insertion_order=true; SET autoinstall_known_extensions=false; SET autoload_known_extensions=false;")?;
        load_httpfs(&conn, httpfs_path)?;
        // Parquet's projection-aware prefetch uses direct range I/O. Disabling it
        // falls back to HTTPFS 1 MiB read-ahead per row group and repeatedly reads
        // neighbouring, unrequested columns on narrow analysis queries.
        conn.execute_batch("SET force_download=false; SET force_download_threshold=0; SET disable_parquet_prefetching=false; SET enable_http_metadata_cache=false; SET enable_http_logging=false; SET http_retries=1; SET http_timeout=15;")?;
        conn.execute_batch(&format!("SET temp_directory={}",literal(&storage_dir.join(format!("{id}.spill")).to_string_lossy())))?;
        // The conditional applies to every DuckDB request, so a mid-query change
        // cannot mix row groups from different revisions (no persistent secret).
        conn.execute_batch(&format!("CREATE SECRET dl_remote_revision (TYPE http, SCOPE {}, EXTRA_HTTP_HEADERS MAP {{'If-Match':{},'Accept-Encoding':'identity'}})",literal(&remote.identity.resolved_url),literal(&remote.identity.etag)))?;
        conn.execute_batch("CREATE TABLE IF NOT EXISTS dl_meta (key VARCHAR PRIMARY KEY, value VARCHAR NOT NULL); CREATE TABLE IF NOT EXISTS dl_columns (id VARCHAR PRIMARY KEY, definition VARCHAR NOT NULL); CREATE TABLE IF NOT EXISTS dl_results (rid UBIGINT, col VARCHAR, value VARCHAR NOT NULL, PRIMARY KEY (rid,col));")?;
        let rid=format!("__dl_{}_row",&revision[..12]);
        let relation=format!("read_parquet({})",literal(&remote.identity.resolved_url));
        // Schema from footer only. VARCHAR categorization is deliberately not
        // inferred by reading the first 10,000 values of every source column.
        let source_columns={
            let mut statement=conn.prepare(&format!("DESCRIBE SELECT * FROM {relation}"))?;
            let rows=statement.query_map([],|row|Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?)))?.collect::<std::result::Result<Vec<_>,_>>()?;
            rows.into_iter().map(|(name,data_type)|Column{id:name.clone(),name,kind:kind_from_type(&data_type),data_type,spss:None}).collect::<Vec<_>>()
        };
        if source_columns.iter().any(|column|column.id==rid || column.id=="file_row_number") { return Err(invalid("Source column conflicts with reserved row identity")); }
        conn.execute("INSERT OR REPLACE INTO dl_meta VALUES ('source_columns',?)",params![serde_json::to_string(&source_columns)?])?;
        let projection=source_columns.iter().map(|column|ident(&column.id)).collect::<Vec<_>>().join(",");
        // Keep the virtual BIGINT ordinal free of casts to retain Parquet's
        // row-number pruning for page windows and exact row retrieval.
        conn.execute_batch(&format!("CREATE TEMP VIEW dl_base AS SELECT file_row_number AS {},{projection} FROM read_parquet({},file_row_number=true)",ident(&rid),literal(&remote.identity.resolved_url)))?;
        let row_count:u64=conn.query_row(&format!("SELECT num_rows FROM parquet_file_metadata({})",literal(&remote.identity.resolved_url)),[],|row|row.get(0))?;
        progress("prepare");
        let result_columns={
            let mut statement=conn.prepare("SELECT definition FROM dl_columns ORDER BY id")?;
            let definitions=statement.query_map([],|row|row.get::<_,String>(0))?.collect::<std::result::Result<Vec<_>,_>>()?;
            definitions.iter().map(|value|serde_json::from_str(value)).collect::<std::result::Result<Vec<Column>,_>>()?
        };
        let mut columns=source_columns.clone();columns.extend(result_columns.clone());
        let name=Url::parse(&url).ok().and_then(|url|url.path_segments()?.next_back().filter(|part|!part.is_empty()).map(str::to_owned)).unwrap_or_else(||"Remote Parquet".into());
        let dataset=Dataset{id,name,source_path:url,columns,sheet:None,row_count:Some(row_count),revision:revision.clone(),type_overrides:BTreeMap::new()};
        let mut store=Self{conn,dataset,source,source_columns,result_columns,derived_columns:vec![],rid,project_path,legacy_project_path,pending_project_path,database_path,base_revision:revision,type_revision:0,analysis_cache:RefCell::default(),portable_hash_cache:RefCell::default(),known_project_revision:RefCell::default(),known_primary_revision:RefCell::default(),remote:Some(remote)};
        store.refresh_view()?;
        if let Some(project)=store.read_project()? {
            if project.derived_columns.len()>128 || project.result_columns.len()>1000 { return Err(invalid("Demasiadas columnas guardadas.")); }
            for column in project.result_columns { store.ensure_result_column(column)?; }
            store.dataset.type_overrides=project.column_types;
            store.type_revision=project.type_revision;
            store.derived_columns=project.derived_columns;
            store.refresh_types()?;
        }
        store.check_source()?;
        Ok(store)
    }
}

#[cfg(test)]
mod distribution_tests {
    use super::*;

    #[test]
    #[ignore = "requires distribution libduckdb with httpfs statically linked"]
    fn builtin_httpfs_loads_without_an_external_extension_file() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("SET autoinstall_known_extensions=false; SET autoload_known_extensions=false").unwrap();
        let builtin: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM duckdb_extensions() WHERE extension_name='httpfs' AND install_mode='STATICALLY_LINKED')",
            [], |row| row.get(0),
        ).unwrap();
        assert!(builtin, "This explicit distribution check must use the built-in-httpfs library");
        let directory = tempfile::tempdir().unwrap();
        load_httpfs(&conn, &directory.path().join("absent.duckdb_extension")).unwrap();
        let loaded: bool = conn.query_row("SELECT loaded FROM duckdb_extensions() WHERE extension_name='httpfs'", [], |row| row.get(0)).unwrap();
        assert!(loaded);
        let unsigned: bool = conn.query_row("SELECT current_setting('allow_unsigned_extensions')", [], |row| row.get(0)).unwrap();
        assert!(!unsigned);
    }
}
