//! Blocking, Send data service. Hosts must call on a blocking worker behind a Mutex.
//! All SQL is generated from validated structured requests, never project-supplied SQL.
mod types;
mod sql;
mod store;
pub use types::*;
pub use store::DataStore;
pub type Result<T> = std::result::Result<T, Error>;
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")] Invalid(String),
    #[error("Source changed; reopen the file to create a new dataset revision")] SourceChanged,
    #[error(transparent)] Database(#[from] duckdb::Error),
    #[error(transparent)] Io(#[from] std::io::Error),
    #[error(transparent)] Json(#[from] serde_json::Error),
    #[error("Spreadsheet: {0}")] Spreadsheet(String),
}
