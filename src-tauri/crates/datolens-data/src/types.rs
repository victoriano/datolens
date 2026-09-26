use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum VariableKind { Numeric, Date, Boolean, Categorical, Multivalued, Text }
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Column { pub id: String, pub name: String, pub data_type: String, pub kind: VariableKind,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub spss: Option<SpssColumn> }
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SpssColumn { pub label: Option<String>, pub value_labels: BTreeMap<String, String>, pub missing_values: Vec<String>, pub categorical: bool }
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Dataset {
    pub id: String, pub name: String, pub source_path: String,
    #[serde(skip_serializing_if = "Option::is_none")] pub sheet: Option<String>,
    pub columns: Vec<Column>, pub row_count: Option<u64>, pub revision: String,
    #[serde(default)] pub type_overrides: BTreeMap<String, VariableKind>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewSaveResult {
    pub path: String,
    pub beside_source: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct SharedRevision { pub id:String, pub saved_at_ms:u64, pub active:bool, pub head:bool }
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Row { pub id: String, pub values: BTreeMap<String, Value> }
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Filter {
    Numeric { column: String, #[serde(skip_serializing_if="Option::is_none")] min: Option<f64>, #[serde(skip_serializing_if="Option::is_none")] max: Option<f64> },
    Date { column: String, #[serde(skip_serializing_if="Option::is_none")] start: Option<String>, #[serde(skip_serializing_if="Option::is_none")] end: Option<String> },
    Categorical { column: String, selected: Vec<String> },
    Multivalued { column: String, selected: Vec<String>, #[serde(default, rename = "listEncoded")] list_encoded: bool },
    Text { column: String, terms: Vec<String>, mode: TextMode, #[serde(rename = "caseSensitive")] case_sensitive: bool },
}
impl Filter { pub fn column(&self) -> &str { match self { Self::Numeric{column,..}|Self::Date{column,..}|Self::Categorical{column,..}|Self::Multivalued{column,..}|Self::Text{column,..} => column } } }
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TextMode { Any, All }
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SortRule { pub id: String, pub desc: bool }
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageRequest { pub dataset_id: String, pub columns: Vec<String>, pub filters: Vec<Filter>, pub sorting: Vec<SortRule>, pub offset: u64, pub limit: u32 }
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Page { pub rows: Vec<Row>, pub filtered_count: Option<u64>, pub dataset_revision: String }
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bin {
    // For range null buckets value is explicitly null; range bins omit it.
    #[serde(skip_serializing_if = "Option::is_none")] pub value: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")] pub left: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub right: Option<f64>,
    pub background: u64, pub foreground: u64, pub r_background: f64, pub r_foreground: f64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Distribution { pub column: String, pub kind: VariableKind, pub bins: Vec<Bin>, pub truncated: bool, #[serde(skip_serializing_if="Option::is_none")] pub statistics: Option<VariableStatistics> }
/// Exact aggregates over selected analysis rows (which may be a sample). Count/distinct exclude missing values.
/// Quartiles use DuckDB quantile_cont (linear interpolation), never histogram bins.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VariableStatistics {
    pub count: u64, pub missing: u64, pub distinct: u64,
    pub min: Option<String>, pub p25: Option<String>, pub median: Option<String>,
    pub mean: Option<String>, pub p75: Option<String>, pub max: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct CastPreview {
    pub dataset_revision: String, pub invalid_count: u64, pub non_null_count: u64,
    pub physical_type: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct CastResult { pub dataset: Dataset, pub save: ViewSaveResult }
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Distributions { pub variables: Vec<Distribution>, pub selected_count: u64, pub total_rows: u64, pub analyzed_rows: u64, pub sampled: bool, pub automatic_rows: u64, #[serde(skip_serializing_if="Option::is_none")] pub deferred_reason: Option<String> }
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExportFormat { Csv, Parquet }
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRequest { pub path: String, pub format: ExportFormat, pub filters: Vec<Filter>, pub sorting: Vec<SortRule>, pub columns: Vec<String> }
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellUpdate { pub row_id: String, pub column_id: String, pub value: Value, pub expected_dataset_revision: String }

/// Sampling affects variable distributions only; row queries and exports stay exact.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(tag = "mode", rename_all = "lowercase")]
pub enum AnalysisSampling { #[default] Auto, Full, Rows { rows: u64 } }
#[derive(Debug, Clone, Default)]
pub struct DistributionOptions {
    pub sampling: AnalysisSampling,
    /// None preserves the legacy all-statistics API. Some([]) computes charts only.
    pub statistics: Option<Vec<String>>,
}
