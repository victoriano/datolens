use crate::types::*;
use crate::advanced_types::*;
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

fn client() -> Result<reqwest::blocking::Client> {
    reqwest::blocking::Client::builder().timeout(Duration::from_secs(60)).build().map_err(|_| "No se pudo crear el cliente HTTPS".into())
}
fn provider_error_detail(body: &Value) -> Option<String> {
    let message = body.pointer("/error/message")?.as_str()?;
    let message = message.chars().filter(|c| !c.is_control()).take(500).collect::<String>();
    (!message.is_empty()).then_some(message)
}
fn response_json(response: reqwest::blocking::Response, provider: &str) -> Result<Value> {
    let code = response.status();
    if !code.is_success() {
        let prefix = if code.as_u16() == 429 || code.is_server_error() { "retryable: " } else { "" };
        let message = response.json::<Value>().ok().and_then(|body| provider_error_detail(&body));
        return Err(match message {
            Some(message) => format!("{prefix}{provider} HTTP {}: {message}", code.as_u16()),
            _ => format!("{prefix}{provider} HTTP {}", code.as_u16()),
        });
    }
    response.json().map_err(|_| format!("Respuesta {provider} no válida"))
}
fn model_id(model: &str) -> Result<()> {
    if model.is_empty() || !model.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '.' | '_')) { return Err("Identificador de modelo inválido".into()); }
    Ok(())
}
fn api_key(credentials: &dyn CredentialStore, provider: &str) -> Result<String> {
    let key = credentials.key(provider)?;
    if key.trim().is_empty() { return Err(format!("Configura tu clave de {provider} en Datolens")); }
    Ok(key)
}
fn parse_gemini_text(text:&str, web:bool)->Result<Value> {
    let trimmed=text.trim();
    let json_text=if web && trimmed.contains("```json") {
        let (evidence,block)=trimmed.split_once("```json").ok_or("Falta el resultado JSON")?;
        if evidence.contains("```") || block.matches("```").count()!=1 {return Err("Gemini devolvió varios bloques de resultado".into());}
        block.trim_end().strip_suffix("```").ok_or("El resultado JSON debe cerrar la respuesta")?.trim()
    } else {
        trimmed.strip_prefix("```json").or_else(||trimmed.strip_prefix("```")).and_then(|s|s.trim_end().strip_suffix("```")).unwrap_or(trimmed).trim()
    };
    serde_json::from_str(json_text).map_err(|_| "Gemini devolvió JSON inválido".into())
}
fn gemini_request_body(model: &str, prompt: &str, schema: Value, web: bool, max_output_tokens: u32) -> Value {
    let mut body = json!({
        "contents": [{"role":"user","parts":[{"text":prompt}]}],
        "generationConfig": {"maxOutputTokens":max_output_tokens}
    });
    if model.starts_with("gemini-3.") {
        if !web {
            body["contents"][0]["parts"][0]["text"] = json!(format!("{prompt}\nReturn only one JSON value matching this schema exactly: {schema}"));
        }
    } else {
        body["generationConfig"]["responseMimeType"] = json!("application/json");
        body["generationConfig"]["responseJsonSchema"] = schema.clone();
        body["generationConfig"]["temperature"] = json!(0.2);
    }
    if web {
        // A schema-constrained call can omit grounding even with the search tool.
        // Google attaches citations to prose, but often not to JSON-only answers.
        // One grounded call returns brief evidence plus a final typed JSON block.
        body["tools"] = json!([{"google_search":{}}]);
        body["generationConfig"].as_object_mut().unwrap().remove("responseMimeType");
        body["generationConfig"].as_object_mut().unwrap().remove("responseJsonSchema");
        body["contents"][0]["parts"][0]["text"] = json!(format!("{prompt}\nUse Google Search now. First provide a brief factual explanation with source citations, at most 100 words. Then end with exactly one fenced ```json block containing an object matching this schema: {}. Its value must express only facts supported by the cited explanation. Return null if unverifiable. Nothing after the code block.",schema));
    }
    body
}
/// HTTP errors include only a bounded provider error message, never request bodies or credentials.
pub struct GeminiProvider { client: reqwest::blocking::Client }
impl GeminiProvider {
    pub fn new() -> Result<Self> { Ok(Self { client: client()? }) }
    /// Shared bounded structured request for explicitly invoked native analysis tools.
    /// Up to 8192 output tokens, 60s timeout, no web tool or hidden retries.
    pub fn generate_json(&self, model: &str, prompt: &str, schema: Value, credentials: &dyn CredentialStore, max_output_tokens: u32) -> Result<Value> {
        self.json_request_with_limit(model,prompt,schema,false,credentials,max_output_tokens.clamp(1,8192)).map(|(value,_)|value)
    }
    pub(crate) fn json_request(&self, model: &str, prompt: &str, schema: Value, web: bool, credentials: &dyn CredentialStore) -> Result<(Value, Value)> {
        self.json_request_with_limit(model,prompt,schema,web,credentials,4096)
    }
    fn json_request_with_limit(&self, model: &str, prompt: &str, schema: Value, web: bool, credentials: &dyn CredentialStore, max_output_tokens:u32) -> Result<(Value, Value)> {
        model_id(model)?;
        let body = gemini_request_body(model,prompt,schema,web,max_output_tokens);
        let response = self.client.post(format!("https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"))
            .header("x-goog-api-key", api_key(credentials,"gemini")?).json(&body).send().map_err(|_| "Error de conexión Gemini; la recepción remota puede ser ambigua".to_string())?;
        let payload = response_json(response,"Gemini")?;
        let candidate = payload.pointer("/candidates/0").ok_or("Gemini no devolvió un candidato")?;
        if candidate.get("finishReason").and_then(Value::as_str) != Some("STOP") { return Err("Gemini no completó la respuesta".into()); }
        let parts = candidate.pointer("/content/parts").and_then(Value::as_array).ok_or("Gemini no devolvió contenido")?;
        let text:String = parts.iter().filter(|p| p.get("thought").and_then(Value::as_bool) != Some(true)).filter_map(|p| p.get("text").and_then(Value::as_str)).collect();
        let parsed=parse_gemini_text(&text,web)?;
        Ok((parsed,payload))
    }
}

#[cfg(test)]
mod response_tests {
    use super::*;
    #[test]
    fn gemini_3_uses_prompt_schema_without_rejected_generation_config() {
        let schema = json!({"type":"object","properties":{"value":{"type":"string"}},"required":["value"]});
        let body = gemini_request_body("gemini-3.8-flash","Choose a color",schema.clone(),false,8192);
        assert_eq!(body["generationConfig"]["maxOutputTokens"],8192);
        assert!(body["contents"][0]["parts"][0]["text"].as_str().unwrap().contains(&schema.to_string()));
        assert!(body.get("tools").is_none());
        assert!(body["generationConfig"].get("responseMimeType").is_none());
        assert!(body["generationConfig"].get("responseJsonSchema").is_none());
        assert!(body["generationConfig"].get("temperature").is_none());
    }
    #[test]
    fn gemini_2_uses_structured_json_fields() {
        let schema = json!({"type":"object","properties":{"value":{"type":"string"}},"required":["value"]});
        let body = gemini_request_body("gemini-2.5-flash","Choose a color",schema.clone(),false,4096);
        assert_eq!(body["generationConfig"]["responseMimeType"], "application/json");
        assert_eq!(body["generationConfig"]["responseJsonSchema"], schema);
        assert_eq!(body["generationConfig"]["temperature"],json!(0.2));
    }
    #[test]
    fn grounded_request_keeps_search_without_structured_format() {
        let body = gemini_request_body("gemini-2.5-flash","Look up a fact",json!({"type":"object"}),true,4096);
        assert!(body["generationConfig"].get("responseMimeType").is_none());
        assert!(body["generationConfig"].get("responseJsonSchema").is_none());
        assert_eq!(body["tools"],json!([{"google_search":{}}]));
        assert!(body["contents"][0]["parts"][0]["text"].as_str().unwrap().contains("exactly one fenced ```json"));
        assert_eq!(body["generationConfig"]["temperature"],json!(0.2));
    }
    #[test]
    fn provider_error_details_are_bounded_and_exclude_other_fields() {
        let body = json!({"error":{"message":"Invalid field\nresponseJsonSchema","details":[{"request":"secret"}]}});
        assert_eq!(provider_error_detail(&body).as_deref(), Some("Invalid fieldresponseJsonSchema"));
        assert_eq!(provider_error_detail(&json!({"error":{"message":"x".repeat(600)}})).unwrap().len(), 500);
        assert!(provider_error_detail(&json!({"error":{"details":["secret"]}})).is_none());
    }
    #[test]
    fn grounded_json_requires_one_complete_final_block() {
        assert_eq!(parse_gemini_text("Según la fuente abre a las 10.\n```json\n{\"value\":10}\n```",true).unwrap(),json!({"value":10}));
        assert!(parse_gemini_text("```json\n{\"value\":10}\n``` texto posterior",true).is_err());
        assert!(parse_gemini_text("```json\n{\"value\":10}\n```\n```json\n{\"value\":11}\n```",true).is_err());
        assert!(parse_gemini_text("Texto\n```json\n{\"value\":10}\n```",false).is_err());
    }
}
impl Provider for GeminiProvider {
    fn suggest_column(&self,request:&ColumnSuggestRequest,credentials:&dyn CredentialStore)->Result<ColumnProposal>{crate::composer::suggest_column(self,request,credentials)}
    fn generate(&self, request: &ProviderRequest, credentials: &dyn CredentialStore) -> Result<Value> { self.generate_detailed(request,credentials).map(|r|r.value) }
    fn generate_detailed(&self, request: &ProviderRequest, credentials: &dyn CredentialStore) -> Result<ProviderOutput> {
        let d = &request.definition;
        if d.provider != "gemini" { return Err("Proveedor no compatible".into()); }
        validate_options(d)?;
        let prompt = if d.options.web_search { format!("{}\nBusca en Google. Usa fuentes verificables; no inventes datos. Si no puedes verificar el valor solicitado, devuelve null.",request.prompt) } else {request.prompt.clone()};
        let mut value_schema = output_schema(&d.output_kind)?;
        if d.options.web_search { let kind=value_schema["type"].clone();value_schema["type"]=json!([kind,"null"]); }
        let (parsed,payload) = self.json_request(&d.model,&prompt,json!({"type":"object","properties":{"value":value_schema},"required":["value"],"additionalProperties":false}),d.options.web_search,credentials)?;
        let value = parsed.get("value").ok_or("Falta value en la respuesta Gemini")?.clone();
        if value.is_null() { return Err("No se encontró una respuesta verificable para esta fila.".into()); }
        validate_output(&d.output_kind,&value)?;
        let mut output = ProviderOutput::plain(value,d);
        output.model = payload.get("modelVersion").and_then(Value::as_str).unwrap_or(&d.model).into();
        if let Some(chunks) = payload.pointer("/candidates/0/groundingMetadata/groundingChunks").and_then(Value::as_array) {
            for chunk in chunks {
                if let Some(url) = chunk.pointer("/web/uri").and_then(Value::as_str).filter(|u| u.starts_with("https://") || u.starts_with("http://")) {
                    output.sources.push(Source{url:url.into(),title:chunk.pointer("/web/title").and_then(Value::as_str).unwrap_or("Fuente").into()});
                }
            }
        }
        output.search_suggestions = payload.pointer("/candidates/0/groundingMetadata/searchEntryPoint/renderedContent").and_then(Value::as_str).map(str::to_string);
        if d.options.web_search && output.sources.is_empty() { return Err("Gemini no aportó fuentes web. La respuesta no se aplicó.".into()); }
        Ok(output)
    }
    fn suggest(&self, request: &SuggestRequest, credentials: &dyn CredentialStore) -> Result<EnrichmentProposal> { crate::composer::suggest(self,request,credentials) }
}

pub struct JevProvider { client: reqwest::blocking::Client }
impl JevProvider { pub fn new() -> Result<Self> { Ok(Self{client:client()?}) } }
pub fn jev_body(request: &ProviderRequest) -> Result<Value> {
    let d=&request.definition; validate_options(d)?;
    let question_type=d.options.question_type.as_deref().ok_or("Falta tipo de pregunta Jev")?;
    // Templates become references to state fields, never interpolated data in instructions.
    let mut instructions=String::new();let mut tail=d.prompt.as_str();
    while let Some(start)=tail.find("{{") {
        instructions.push_str(&tail[..start]);let rest=&tail[start+2..];
        let end=rest.find("}}").ok_or("Referencia Jev incompleta")?;let id=rest[..end].trim();
        if !d.input_columns.iter().any(|column|column==id){return Err("Referencia Jev no seleccionada".into());}
        instructions.push_str(&format!("state[{}]",serde_json::to_string(id).map_err(|_|"Referencia inválida")?));
        tail=&rest[end+2..];
    }
    instructions.push_str(tail);
    let mut question=json!({"type":question_type,"instructions":instructions});
    if question_type=="choice" { question["criteria"]=serde_json::to_value(&d.options.choices).map_err(|_|"Opciones inválidas")?; }
    if question_type=="score" { question["criteria"]=json!(d.options.levels); }
    Ok(json!({"model":d.model,"state":request.inputs,"questions":{"value":question}}))
}
pub fn parse_jev(payload: &Value, definition: &Definition) -> Result<ProviderOutput> {
    validate_options(definition)?;
    let answer=payload.pointer("/answers/value").ok_or("Jev no devolvió la respuesta solicitada")?;
    let kind=definition.options.question_type.as_deref().unwrap_or("");
    if answer.get("type").and_then(Value::as_str)!=Some(kind) { return Err("Tipo de respuesta Jev inesperado".into()); }
    let number=|field:&str| answer.get(field).and_then(Value::as_f64).filter(|v|v.is_finite()).ok_or_else(||format!("Jev no devolvió {field} válido"));
    let value=match kind {
        "choice"=>{let choice=answer.get("choice").and_then(Value::as_str).filter(|s|definition.options.choices.contains_key(*s)).ok_or("Jev devolvió una opción desconocida")?;json!(choice)},
        "score"=>{let score=number("score")?;if score<0.0 || score>(definition.options.levels.len()-1) as f64{return Err("Score Jev fuera de sus niveles".into());}json!(score)},
        "noul"=>{let p=number("noul")?;if !(0.0..=1.0).contains(&p){return Err("Probabilidad Jev inválida".into());}if definition.output_kind=="boolean"{json!(p>=definition.options.threshold.unwrap_or(0.5))}else{json!(p)}},
        _=>return Err("Tipo de pregunta Jev inválido".into()),
    };
    validate_output(&definition.output_kind,&value)?;
    let mut out=ProviderOutput::plain(value,definition);
    out.model=payload.get("model").and_then(Value::as_str).unwrap_or(&definition.model).into();
    out.confidence=answer.get("confidence").and_then(Value::as_f64).filter(|v|(0.0..=1.0).contains(v));
    out.probability=answer.get("noul").and_then(Value::as_f64);
    Ok(out)
}
impl Provider for JevProvider {
    fn generate(&self, request: &ProviderRequest, credentials: &dyn CredentialStore) -> Result<Value> { self.generate_detailed(request,credentials).map(|r|r.value) }
    fn generate_detailed(&self, request: &ProviderRequest, credentials: &dyn CredentialStore) -> Result<ProviderOutput> {
        if request.definition.provider!="jev" {return Err("Proveedor no compatible".into());}
        let body=jev_body(request)?;
        let response=self.client.post("https://api.typesafe.ai/v1/systemone").bearer_auth(api_key(credentials,"jev")?).json(&body).send().map_err(|_|"Error de conexión Jev; la recepción remota puede ser ambigua".to_string())?;
        parse_jev(&response_json(response,"Jev")?,&request.definition)
    }
}
pub struct MultiProvider { gemini: GeminiProvider, jev: JevProvider }
impl MultiProvider { pub fn new()->Result<Self>{Ok(Self{gemini:GeminiProvider::new()?,jev:JevProvider::new()?})} }
impl Provider for MultiProvider {
    fn suggest_column(&self,r:&ColumnSuggestRequest,c:&dyn CredentialStore)->Result<ColumnProposal>{self.gemini.suggest_column(r,c)}
    fn generate(&self,r:&ProviderRequest,c:&dyn CredentialStore)->Result<Value>{self.generate_detailed(r,c).map(|v|v.value)}
    fn generate_detailed(&self,r:&ProviderRequest,c:&dyn CredentialStore)->Result<ProviderOutput>{match r.definition.provider.as_str(){"gemini"=>self.gemini.generate_detailed(r,c),"jev"=>self.jev.generate_detailed(r,c),_=>Err("Proveedor no compatible".into())}}
    fn suggest(&self,r:&SuggestRequest,c:&dyn CredentialStore)->Result<EnrichmentProposal>{self.gemini.suggest(r,c)}
}
/// Explicit test provider, never selected as a production fallback.
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
