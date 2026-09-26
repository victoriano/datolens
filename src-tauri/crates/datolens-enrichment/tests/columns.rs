use datolens_enrichment::*;
use serde_json::{json,Value};
use std::sync::Arc;

struct NoAccess;
impl CredentialStore for NoAccess {fn key(&self,_:&str)->Result<String>{panic!("SQL must not read credentials")}}
impl DataAccess for NoAccess {
    fn dataset_revision(&self)->Result<String>{panic!("planner must not read rows")}
    fn read_inputs(&self,_:&str,_:&[String])->Result<InputSnapshot>{panic!("planner must not read rows")}
    fn apply_result(&self,_:&str,_:&str,_:&Value,_:&str)->Result<()>{panic!("planner must not write rows")}
}
impl Provider for NoAccess {fn generate(&self,_:&ProviderRequest,_:&dyn CredentialStore)->Result<Value>{panic!("SQL must not call an AI provider")}}
#[test]
fn explicit_sql_design_requires_neither_credentials_nor_provider_and_refines_identity() {
    let engine=Engine::open(":memory:",Arc::new(NoAccess),Arc::new(NoAccess),Arc::new(NoAccess)).unwrap();
    let first=engine.suggest_column(ColumnSuggestRequest{message:"SQL: price / NULLIF(area,0)".into(),columns:vec![],language:"en".into(),previous:None}).unwrap();
    let ColumnProposal::Formula{formula:first_formula,..}=&first else{panic!("Expected local formula")};
    assert_eq!(first_formula.expression,"price / NULLIF(area,0)");
    let second=engine.suggest_column(ColumnSuggestRequest{message:"sql: round(price / NULLIF(area,0),2)".into(),columns:vec![],language:"en".into(),previous:Some(first.clone())}).unwrap();
    let ColumnProposal::Formula{formula:second_formula,..}=second else{panic!("Expected local formula")};
    assert_eq!(first_formula.id,second_formula.id);assert!(engine.list_definitions().unwrap().is_empty());
    let next=engine.suggest_column(ColumnSuggestRequest{message:"SQL: 2+2".into(),columns:vec![SuggestColumn{id:first_formula.id.clone(),name:first_formula.name.clone(),kind:"numeric".into()}],language:"en".into(),previous:None}).unwrap();
    let ColumnProposal::Formula{formula,..}=next else{panic!("Expected local formula")};assert_eq!(formula.name,"Columna calculada 2");assert_ne!(formula.id,first_formula.id);
}
#[test]
fn planner_can_propose_sql_without_constructing_an_ai_enrichment() {
    let request=ColumnSuggestRequest{message:"Calcula el precio por m2".into(),columns:vec![SuggestColumn{id:"price".into(),name:"Price".into(),kind:"numeric".into()}],language:"es".into(),previous:None};
    let result=column_proposal_from_json(json!({"task":"sql","name":"Precio por m²","expression":"price / NULLIF(area,0)","explanation":"Cálculo local"}),&request).unwrap();
    let serialized=serde_json::to_value(result).unwrap();assert_eq!(serialized["kind"],"formula");assert!(serialized.get("definition").is_none());
    // Unknown references are intentionally not trusted here; the native DuckDB
    // parser/binder checks them before this proposal crosses the IPC boundary.
    assert!(column_proposal_from_json(json!({"task":"sql","name":"","expression":"1"}),&request).is_err());
}
