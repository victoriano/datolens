use crate::types::{Definition, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct EnrichmentOptions {
    pub web_search: bool,
    pub question_type: Option<String>,
    pub choices: BTreeMap<String, String>,
    pub levels: Vec<String>,
    pub threshold: Option<f64>,
}
impl EnrichmentOptions {
    pub fn is_default(&self)->bool { self==&Self::default() }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Source { pub title: String, pub url: String }
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderOutput {
    pub value: Value,
    pub provider: String,
    pub model: String,
    pub confidence: Option<f64>,
    pub probability: Option<f64>,
    #[serde(default)] pub sources: Vec<Source>,
    pub search_suggestions: Option<String>,
}
impl ProviderOutput {
    pub fn plain(value: Value, definition: &Definition) -> Self {
        Self { value, provider: definition.provider.clone(), model: definition.model.clone(), confidence: None, probability: None, sources: vec![], search_suggestions: None }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SuggestColumn { pub id: String, pub name: String, pub kind: String }
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SuggestRequest {
    pub message: String,
    pub columns: Vec<SuggestColumn>,
    pub language: String,
    pub previous: Option<Definition>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EnrichmentProposal { pub definition: Definition, pub explanation: String }
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct FormulaDefinition { pub id:String, pub name:String, pub expression:String }
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag="kind", rename_all="camelCase")]
pub enum ColumnProposal {
    Enrichment { definition:Definition, explanation:String },
    Formula { formula:FormulaDefinition, explanation:String },
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ColumnSuggestRequest { pub message:String, pub columns:Vec<SuggestColumn>, pub language:String, pub previous:Option<ColumnProposal> }
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewRow {
    pub row_id: String,
    pub inputs: BTreeMap<String, Value>,
    pub value: Option<Value>,
    pub error: Option<String>,
    pub evidence: Option<ProviderOutput>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewResult {
    pub definition_fingerprint: String,
    pub dataset_revision: String,
    pub calls: usize,
    pub rows: Vec<PreviewRow>,
}

pub fn validate_options(def: &Definition) -> Result<()> {
    if def.provider == "gemini" {
        if def.options.web_search && !def.model.starts_with("gemini-3") {
            return Err("Para la búsqueda web de Datolens, usa Gemini 3, por ejemplo gemini-3.8-flash.".into());
        }
        return Ok(());
    }
    if def.provider != "jev" { return Err("Proveedor no compatible. Elige Gemini o Jev.".into()); }
    if def.options.web_search { return Err("Jev evalúa tus columnas. Para buscar en la web, elige Gemini.".into()); }
    match def.options.question_type.as_deref() {
        Some("choice") => {
            if def.output_kind != "categorical" || !(2..=255).contains(&def.options.choices.len()) || def.options.choices.keys().any(|s|s.trim().is_empty()) {
                return Err("Jev Choice necesita una salida categórica y entre 2 y 255 opciones.".into());
            }
        }
        Some("score") => {
            if def.output_kind != "numeric" || !(2..=10).contains(&def.options.levels.len()) || def.options.levels.iter().any(|s|s.trim().is_empty()) {
                return Err("Jev Score necesita una salida numérica y entre 2 y 10 niveles descritos.".into());
            }
        }
        Some("noul") => {
            if !["numeric", "boolean"].contains(&def.output_kind.as_str()) { return Err("Jev Noul devuelve probabilidad o sí/no.".into()); }
            if def.options.threshold.is_some_and(|t| !(0.0..=1.0).contains(&t)) { return Err("El umbral debe estar entre 0 y 1.".into()); }
        }
        _ => return Err("Configura Choice, Score o Noul para usar Jev.".into()),
    }
    Ok(())
}
