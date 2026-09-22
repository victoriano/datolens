use crate::types::*;
use serde_json::{json, Value};
use std::{collections::BTreeSet, time::Duration};

pub fn output_schema(kind: &str) -> Result<Value> {
    Ok(match kind {
        "numeric" => json!({"type":"number"}),
        "boolean" => json!({"type":"boolean"}),
        "multivalued" => json!({"type":"array","items":{"type":"string"}}),
        "date" => json!({"type":"string","format":"date"}),
        "categorical" | "text" => json!({"type":"string"}),
        _ => return Err(format!("Tipo de salida desconocido: {kind}")),
    })
}
pub fn validate_output(kind: &str, value: &Value) -> Result<()> {
    let valid = match kind {
        "numeric" => value.is_number(), "boolean" => value.is_boolean(),
        "multivalued" => value.as_array().is_some_and(|a| a.iter().all(Value::is_string)),
        "date" => value.as_str().is_some_and(valid_date),
        "categorical" | "text" => value.is_string(), _ => false,
    };
    if valid { Ok(()) } else { Err(format!("La respuesta no cumple el tipo {kind}")) }
}
fn valid_date(s: &str) -> bool {
    let p: Vec<_> = s.split('-').collect();
    if p.len() != 3 || p[0].len() != 4 || p[1].len() != 2 || p[2].len() != 2 { return false; }
    let Ok(y) = p[0].parse::<u32>() else { return false; };
    let Ok(m) = p[1].parse::<u32>() else { return false; };
    let Ok(d) = p[2].parse::<u32>() else { return false; };
    let days = match m { 1|3|5|7|8|10|12 => 31, 4|6|9|11 => 30, 2 if y%4==0 && (y%100!=0 || y%400==0) => 29, 2 => 28, _ => 0 };
    y > 0 && d > 0 && d <= days
}
/// No request bodies, keys, HTTP bodies or provider responses are included in errors.
/// Retries are explicit calls counted by the scheduler (no hidden billable retry).
pub struct GeminiProvider { client: reqwest::blocking::Client }
impl GeminiProvider {
    pub fn new() -> Result<Self> {
        Ok(Self { client: reqwest::blocking::Client::builder().timeout(Duration::from_secs(60)).build().map_err(|_| "No se pudo crear el cliente HTTPS")? })
    }
}
impl Provider for GeminiProvider {
    fn generate(&self, request: &ProviderRequest, credentials: &dyn CredentialStore) -> Result<Value> {
        let def = &request.definition;
        if def.provider != "gemini" { return Err("Proveedor no compatible".into()); }
        if def.model.is_empty() || !def.model.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.' || c == '_') { return Err("Identificador de modelo inválido".into()); }
        let key = credentials.key("gemini")?;
        if key.trim().is_empty() { return Err("Configura tu clave Gemini en Datolens".into()); }
        let body = json!({
            "contents":[{"role":"user","parts":[{"text":request.prompt}]}],
            "generationConfig":{"responseMimeType":"application/json", "responseJsonSchema": {
                "type":"object", "properties":{"value":output_schema(&def.output_kind)?}, "required":["value"], "additionalProperties":false
            }, "maxOutputTokens":2048}
        });
        let response = self.client.post(format!("https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent", def.model))
            .header("x-goog-api-key", key).json(&body).send().map_err(|_| "Error de conexión Gemini; la recepción remota puede ser ambigua".to_string())?;
        let code = response.status();
        if !code.is_success() {
            return Err(if code.as_u16() == 429 || code.is_server_error() { format!("retryable: Gemini HTTP {}", code.as_u16()) } else { format!("Gemini HTTP {}", code.as_u16()) });
        }
        let payload: Value = response.json().map_err(|_| "Respuesta Gemini no válida")?;
        let candidate = payload.pointer("/candidates/0").ok_or("Gemini no devolvió un candidato")?;
        if candidate.get("finishReason").and_then(Value::as_str) != Some("STOP") { return Err("Gemini no completó la respuesta".into()); }
        let parts = candidate.pointer("/content/parts").and_then(Value::as_array).ok_or("Gemini no devolvió contenido")?;
        let text: String = parts.iter().filter(|p| p.get("thought").and_then(Value::as_bool) != Some(true)).filter_map(|p| p.get("text").and_then(Value::as_str)).collect();
        let parsed: Value = serde_json::from_str(&text).map_err(|_| "Gemini devolvió JSON inválido")?;
        let value = parsed.get("value").ok_or("Falta value en la respuesta Gemini")?.clone();
        validate_output(&def.output_kind, &value)?;
        Ok(value)
    }
}
/// Explicit test provider: never selected as a fallback for Gemini.
#[derive(Default)]
pub struct MockProvider { pub failing_rows: BTreeSet<String> }
impl Provider for MockProvider {
    fn generate(&self, r: &ProviderRequest, _: &dyn CredentialStore) -> Result<Value> {
        if self.failing_rows.contains(&r.row_id) { return Err("Fallo simulado de esta fila".into()); }
        Ok(match r.definition.output_kind.as_str() {
            "numeric" => json!(r.inputs.values().filter_map(Value::as_f64).sum::<f64>() + 1.0),
            "boolean" => json!(true), "multivalued" => json!([format!("mock:{}", r.row_id)]),
            "date" => json!("2026-09-22"), _ => json!(format!("mock:{}:{}", r.definition.id, r.row_id)),
        })
    }
}
