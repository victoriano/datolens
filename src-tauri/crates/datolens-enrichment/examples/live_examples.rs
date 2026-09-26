//! Explicit real-provider smoke test. Run only with --live; at most 8 paid requests.
//! Inputs are synthetic public examples. Credentials read in memory, never printed.
use datolens_enrichment::*;
use serde_json::{json,Value};
use std::{collections::BTreeMap, sync::Arc, process::Command};
struct Keys;
impl CredentialStore for Keys {
    fn key(&self,provider:&str)->Result<String>{
        let variable=match provider{"gemini"=>"DATOLENS_TEST_GEMINI_REF","jev"=>"DATOLENS_TEST_JEV_REF",_=>return Err("Unknown provider".into())};
        let reference=std::env::var(variable).map_err(|_|format!("Missing 1Password reference {variable}"))?;
        let output=Command::new("op").args(["read",&reference,"--no-newline"]).output().map_err(|_|"Could not read credential")?;
        if !output.status.success(){return Err("1Password credential unavailable".into());}
        String::from_utf8(output.stdout).map(|s|s.trim().into()).map_err(|_|"Invalid credential encoding".into())
    }
}
struct Data;
impl DataAccess for Data {
    fn dataset_revision(&self)->Result<String>{Ok("synthetic-live-v1".into())}
    fn read_inputs(&self,row:&str,columns:&[String])->Result<InputSnapshot>{
        let description=match row{"1"=>"Piso de 3 habitaciones con ascensor en Barcelona.","2"=>"Casa unifamiliar de 4 habitaciones con jardín en Sevilla.","3"=>"Estudio de 1 habitación en Madrid.",_=>return Err("Unknown row".into())};
        let all:BTreeMap<String,Value>=BTreeMap::from([("description".into(),json!(description)),("place".into(),json!("Museo del Prado, Madrid, España"))]);
        Ok(InputSnapshot{revision:"synthetic-live-v1".into(),values:columns.iter().filter_map(|c|all.get(c).map(|v|(c.clone(),v.clone()))).collect()})
    }
    fn apply_result(&self,_:&str,_:&str,_:&Value,_:&str)->Result<()>{Err("Preview must not write results".into())}
}
fn def(id:&str,provider:&str,kind:&str,prompt:&str)->Definition{Definition{id:id.into(),name:id.into(),provider:provider.into(),model:if provider=="jev"{"jev-latest"}else{"gemini-3.8-flash"}.into(),prompt:prompt.into(),input_columns:vec!["description".into()],output_column:id.into(),output_kind:kind.into(),depends_on:vec![],revision:1,options:Default::default()}}
fn main()->Result<()> {
    if !std::env::args().any(|arg|arg=="--live"){return Err("Pass --live to authorize up to 8 real API requests".into());}
    let provider=Arc::new(MultiProvider::new()?);
    let engine=Engine::open(":memory:",Arc::new(Data),Arc::new(Keys),provider)?;
    if std::env::args().any(|arg|arg=="--web-only") {
        let mut web=def("Horario de domingo","gemini","text","Busca ahora en la web oficial el horario de visita del domingo para {{place}}. Devuelve una frase breve en español.");
        web.model="gemini-3.8-flash".into();web.input_columns=vec!["place".into()];web.options.web_search=true;
        println!("{}",serde_json::to_string_pretty(&engine.preview(&web,&["1".into()])?).map_err(|_|"Serialize")?);return Ok(());
    }
    let mut category=def("Tipo de vivienda","jev","categorical","Clasifica el tipo de vivienda que describe `description`.");
    category.options.question_type=Some("choice".into());
    category.options.choices=BTreeMap::from([("Piso".into(),"Piso o apartamento convencional, no estudio".into()),("Casa".into(),"Casa unifamiliar".into()),("Otro".into(),"Estudio u otro tipo".into())]);
    let rows=vec!["1".into(),"2".into(),"3".into()];
    let classification=engine.preview(&category,&rows)?;
    let extraction=engine.preview(&def("Habitaciones","gemini","numeric","Extrae el número explícito de habitaciones de {{description}}."),&rows)?;
    let mut web=def("Horario de domingo","gemini","text","Busca ahora en la web oficial el horario de visita del domingo para {{place}}. Devuelve una frase breve en español.");
    web.model="gemini-3.8-flash".into();web.input_columns=vec!["place".into()];web.options.web_search=true;
    let research=engine.preview(&web,&["1".into()])?;
    let suggestion=engine.suggest(SuggestRequest{message:"Clasifica las viviendas como Piso, Casa u Otro usando la descripción.".into(),columns:vec![SuggestColumn{id:"description".into(),name:"Descripción".into(),kind:"text".into()}],language:"es".into(),previous:None});
    let output=json!({"fixture":"synthetic housing descriptions, no private dataset","maxCalls":8,"jev":classification,"geminiExtraction":extraction,"geminiWeb":research,"chat":suggestion});
    println!("{}",serde_json::to_string_pretty(&output).map_err(|_|"Serialize report")?);
    Ok(())
}
