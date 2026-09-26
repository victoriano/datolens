use serde::{Deserialize, Serialize};
use crate::advanced_types::*;
use serde_json::Value;
use std::collections::BTreeMap;

pub type Result<T> = std::result::Result<T, String>;
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Definition {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub model: String,
    pub prompt: String,
    pub input_columns: Vec<String>,
    pub output_column: String,
    pub output_kind: String,
    pub depends_on: Vec<String>,
    pub revision: u64,
    // Preserve the pre-options definition encoding used by existing cell fingerprints.
    #[serde(default, skip_serializing_if = "EnrichmentOptions::is_default")]
    pub options: EnrichmentOptions,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub struct CellKey { pub row_id: String, pub enrichment_id: String }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum CellState { Pending, Running, Succeeded, Failed, Stale, Blocked, Cancelled }
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Cell {
    pub key: CellKey,
    pub state: CellState,
    pub generation: u64,
    pub definition_revision: u64,
    pub fingerprint: String,
    #[serde(default)]
    pub input_snapshot: BTreeMap<String,Value>,
    pub value: Option<Value>,
    pub error: Option<String>,
    pub attempts: u32,
    pub applied: bool,
    #[serde(default)]
    pub evidence: Option<ProviderOutput>,
}
impl Cell {
    pub fn new(key: CellKey) -> Self { Self { key, state: CellState::Pending, generation: 0, definition_revision: 0, fingerprint: String::new(), input_snapshot: BTreeMap::new(), value: None, error: None, attempts: 0, applied: false, evidence: None } }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum RunState { Queued, Running, Paused, Completed, Cancelled, Failed }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum RunMode { Pending, Regenerate }
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunPlan {
    pub id: String,
    pub dataset_revision: String,
    pub cell_count: usize,
    pub estimated_calls: usize,
    pub missing_inputs: Vec<String>,
    pub cells: Vec<CellKey>,
    pub mode: RunMode,
    pub concurrency: usize,
    pub max_calls: usize,
    pub definition_revisions: BTreeMap<String, u64>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunStatus {
    pub id: String,
    pub state: RunState,
    pub succeeded: usize,
    pub failed: usize,
    pub pending: usize,
    pub error: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct Job { pub plan: RunPlan, pub state: RunState, pub calls: usize, pub error: Option<String> }
#[derive(Clone, Debug)]
pub struct InputSnapshot { pub revision: String, pub values: BTreeMap<String, Value> }

/// Implementations must read ONLY the requested source columns for a stable row ID.
/// apply_result is idempotent: stable dataset/row/column, never a visual row index.
/// Engine owns the durable result; this callback materializes it for queries/export.
pub trait DataAccess: Send + Sync {
    fn dataset_revision(&self) -> Result<String>;
    fn read_inputs(&self, row_id: &str, columns: &[String]) -> Result<InputSnapshot>;
    fn apply_result(&self, row_id: &str, column_id: &str, value: &Value, fingerprint: &str) -> Result<()>;
}
pub trait CredentialStore: Send + Sync { fn key(&self, provider: &str) -> Result<String>; }
#[derive(Clone, Debug)]
pub struct ProviderRequest { pub definition: Definition, pub row_id: String, pub prompt: String, pub inputs: BTreeMap<String, Value> }
pub trait Provider: Send + Sync {
    fn suggest_column(&self, _request:&ColumnSuggestRequest, _credentials:&dyn CredentialStore)->Result<ColumnProposal> {
        Err("Este proveedor no configura columnas mediante chat".into())
    }
    fn generate(&self, request: &ProviderRequest, credentials: &dyn CredentialStore) -> Result<Value>;
    fn generate_detailed(&self, request: &ProviderRequest, credentials: &dyn CredentialStore) -> Result<ProviderOutput> {
        self.generate(request,credentials).map(|value|ProviderOutput::plain(value,&request.definition))
    }
    fn suggest(&self, _request:&SuggestRequest, _credentials:&dyn CredentialStore)->Result<EnrichmentProposal> {
        Err("Este proveedor no configura enriquecimientos mediante chat".into())
    }
}
