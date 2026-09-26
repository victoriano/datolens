//! Blocking, Send data service. Hosts must call on a blocking worker behind a Mutex.
//! SQL formulas are parsed and allowlisted before execution, including on reopen.
mod types;
mod sql;
mod store;
mod sav;
pub mod plots;
pub mod workspace;
pub use types::*;
pub use store::DataStore;
pub use store::derived::{DerivedDefinition,DerivedPreview,DerivedPreviewRow,DerivedCreated};
pub type Result<T> = std::result::Result<T, Error>;
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")] Invalid(String),
    #[error("El servidor requiere descargar el archivo para abrirlo de forma fiable.")] RemoteDownloadRequired,
    #[error("Source changed; reopen the file to create a new dataset revision")] SourceChanged,
    #[error(transparent)] Database(#[from] duckdb::Error),
    #[error(transparent)] Io(#[from] std::io::Error),
    #[error(transparent)] Json(#[from] serde_json::Error),
    #[error("Spreadsheet: {0}")] Spreadsheet(String),
    #[error("SPSS: {0}")] Spss(String),
}
