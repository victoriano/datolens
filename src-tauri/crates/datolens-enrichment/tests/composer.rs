use datolens_enrichment::*;
use serde_json::{json,Value};
use std::{collections::BTreeMap,sync::{Arc,atomic::{AtomicUsize,Ordering}}};
fn definition()->Definition{Definition{id:"sector".into(),name:"Sector".into(),provider:"jev".into(),model:"jev-latest".into(),prompt:"Classify `description`".into(),input_columns:vec!["description".into()],output_column:"sector".into(),output_kind:"categorical".into(),depends_on:vec![],revision:1,options:EnrichmentOptions{question_type:Some("choice".into()),choices:BTreeMap::from([("Software".into(),"Software companies".into()),("Other".into(),"Everything else".into())]),..Default::default()}}}
#[test]fn typed_jev_body_and_confidence(){let d=definition();let request=ProviderRequest{definition:d.clone(),row_id:"row".into(),prompt:"must not be used as state".into(),inputs:BTreeMap::from([("description".into(),json!("Builds software"))])};let body=jev_body(&request).unwrap();assert_eq!(body["state"]["description"],"Builds software");assert_eq!(body["questions"]["value"]["type"],"choice");let output=parse_jev(&json!({"model":"jev-1.13.0","answers":{"value":{"type":"choice","choice":"Software","confidence":0.91}}}),&d).unwrap();assert_eq!(output.value,json!("Software"));assert_eq!(output.confidence,Some(0.91));assert_eq!(output.model,"jev-1.13.0");assert!(parse_jev(&json!({"answers":{"value":{"type":"choice","choice":"Unknown"}}}),&d).is_err());}
#[test]fn jev_score_and_probability_are_validated(){let mut d=definition();d.output_kind="numeric".into();d.options.question_type=Some("score".into());d.options.levels=vec!["Low".into(),"High".into()];assert_eq!(parse_jev(&json!({"answers":{"value":{"type":"score","score":0.7}}}),&d).unwrap().value,json!(0.7));assert!(parse_jev(&json!({"answers":{"value":{"type":"score","score":3}}}),&d).is_err());d.options.question_type=Some("noul".into());d.output_kind="boolean".into();d.options.threshold=Some(0.8);let out=parse_jev(&json!({"answers":{"value":{"type":"noul","noul":0.6}}}),&d).unwrap();assert_eq!(out.value,json!(false));assert_eq!(out.probability,Some(0.6));}
#[test]fn provider_routing_is_capability_driven(){let mut d=definition();route_definition(&mut d,"web").unwrap();assert_eq!(d.provider,"gemini");assert_eq!(d.model,"gemini-3.8-flash");assert!(d.options.web_search);route_definition(&mut d,"extract").unwrap();assert_eq!(d.model,"gemini-3.8-flash");assert!(!d.options.web_search);route_definition(&mut d,"choice").unwrap();assert_eq!(d.provider,"jev");assert!(!d.options.web_search);d.options.web_search=true;assert!(validate_options(&d).is_err());d.provider="gemini".into();d.model="gemini-2.5-flash".into();assert!(validate_options(&d).is_err());}
#[test]fn schema_only_proposal_rejects_hallucinated_column(){let request=SuggestRequest{message:"Classify".into(),columns:vec![SuggestColumn{id:"description".into(),name:"Description".into(),kind:"text".into()}],language:"en".into(),previous:None};let base=json!({"name":"Sector","prompt":"Classify {{description}}","inputColumns":["description"],"outputKind":"categorical","task":"choice","choices":[{"label":"A","description":"A"},{"label":"Other","description":"Other"}],"levels":[],"explanation":"Uses Jev to classify your descriptions."});let proposal=proposal_from_json(base.clone(),&request).unwrap();assert_eq!(proposal.definition.provider,"jev");let mut bad=base;bad["inputColumns"]=json!(["private_key"]);assert!(proposal_from_json(bad,&request).is_err());}
struct Keys;impl CredentialStore for Keys{fn key(&self,_:&str)->Result<String>{Err("No credentials in unit tests".into())}}
struct Data{writes:AtomicUsize}
impl DataAccess for Data{
fn dataset_revision(&self)->Result<String>{Ok("v1".into())}
fn read_inputs(&self,row:&str,columns:&[String])->Result<InputSnapshot>{if row=="missing"{return Err("No row".into());}Ok(InputSnapshot{revision:"v1".into(),values:columns.iter().map(|c|(c.clone(),json!("Builds software"))).collect()})}
fn apply_result(&self,_:&str,_:&str,_:&Value,_:&str)->Result<()>{self.writes.fetch_add(1,Ordering::SeqCst);Ok(())}}
#[test]fn preview_limits_real_scope_and_never_persists(){let data=Arc::new(Data{writes:AtomicUsize::new(0)});let engine=Engine::open(":memory:",data.clone(),Arc::new(Keys),Arc::new(MockProvider::default())).unwrap();let d=definition();let report=engine.preview(&d,&["row1".into(),"missing".into(),"row2".into()]).unwrap();assert_eq!(report.calls,2);assert_eq!(report.rows.len(),3);assert!(report.rows[1].error.is_some());assert!(report.rows[0].error.is_none());assert_eq!(data.writes.load(Ordering::SeqCst),0);assert!(engine.list_definitions().unwrap().is_empty());assert!(engine.list_runs().unwrap().is_empty());assert!(engine.history(&CellKey{row_id:"row1".into(),enrichment_id:d.id.clone()}).unwrap().is_empty());assert!(engine.preview(&d,&["1".into(),"2".into(),"3".into(),"4".into()]).is_err());}
#[test]fn legacy_definitions_load_with_default_options(){let mut value=serde_json::to_value(definition()).unwrap();value["provider"]=json!("gemini");value.as_object_mut().unwrap().remove("options");let old:Definition=serde_json::from_value(value).unwrap();assert_eq!(old.options,EnrichmentOptions::default());}
#[test]fn jev_templates_reference_state_without_copying_data_into_instructions(){
    let mut definition=definition();definition.prompt="Clasifica {{ description }}".into();
    let request=ProviderRequest{definition,row_id:"1".into(),prompt:"unused".into(),inputs:BTreeMap::from([("description".into(),json!("Private input"))])};
    let body=jev_body(&request).unwrap();
    assert_eq!(body["questions"]["value"]["instructions"],"Clasifica state[\"description\"]");
    assert_eq!(body["state"]["description"],"Private input");
}

struct EvidenceProvider;
impl Provider for EvidenceProvider {
    fn generate(&self,_:&ProviderRequest,_:&dyn CredentialStore)->Result<Value>{Ok(json!("Software"))}
    fn generate_detailed(&self,r:&ProviderRequest,_:&dyn CredentialStore)->Result<ProviderOutput>{
        let mut output=ProviderOutput::plain(json!("Software"),&r.definition);
        output.model="verified-test-model".into();
        output.confidence=Some(0.91);
        output.sources=vec![Source{title:"Fixture".into(),url:"https://example.com/source".into()}];
        Ok(output)
    }
}
#[test]
fn provider_evidence_survives_restart_and_regeneration_history() {
    let path=std::env::temp_dir().join(format!("datolens-evidence-{}-{}.sqlite",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
    let data=Arc::new(Data{writes:AtomicUsize::new(0)});
    let cell=CellKey{row_id:"row1".into(),enrichment_id:"sector".into()};
    {
        let engine=Engine::open(&path,data.clone(),Arc::new(Keys),Arc::new(EvidenceProvider)).unwrap();
        engine.save_definition(definition()).unwrap();
        for mode in [RunMode::Pending,RunMode::Regenerate] {
            let plan=engine.plan(vec![cell.clone()],mode,false,false,1,1).unwrap();
            engine.start(&plan.id).unwrap();
            engine.run_to_completion(&plan.id).unwrap();
        }
    }
    let engine=Engine::open(&path,data,Arc::new(Keys),Arc::new(EvidenceProvider)).unwrap();
    assert_eq!(engine.cell(&cell).unwrap().evidence.unwrap().model,"verified-test-model");
    let history=engine.history(&cell).unwrap();assert_eq!(history.len(),2);
    for version in history {
        let evidence=version.evidence.unwrap();
        assert_eq!(evidence.confidence,Some(0.91));
        assert_eq!(evidence.sources[0].url,"https://example.com/source");
    }
    drop(engine);std::fs::remove_file(path).unwrap();
}

#[test]
fn legacy_completed_cells_remain_current_without_new_provider_calls() {
    use sha2::{Digest,Sha256};
    let path=std::env::temp_dir().join(format!("datolens-legacy-{}-{}.sqlite",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
    let data=Arc::new(Data{writes:AtomicUsize::new(0)});
    let mut d=definition();d.provider="gemini".into();d.model="test-model".into();d.options=Default::default();
    let key=CellKey{row_id:"row1".into(),enrichment_id:d.id.clone()};
    let engine=Engine::open(&path,data.clone(),Arc::new(Keys),Arc::new(MockProvider::default())).unwrap();
    engine.save_definition(d.clone()).unwrap();
    let plan=engine.plan(vec![key.clone()],RunMode::Pending,false,false,1,1).unwrap();
    engine.start(&plan.id).unwrap();engine.run_to_completion(&plan.id).unwrap();
    let mut cell=engine.cell(&key).unwrap();let old_value=cell.value.clone();drop(engine);
    // Exact pre-options encoding: preserve struct field order, which participates in hashes.
    let encoded=serde_json::to_string(&d).unwrap();
    let legacy_definition=encoded.rfind(",\"options\":").map(|index|format!("{}}}",&encoded[..index])).unwrap_or(encoded);
    let legacy_input=format!("[{},\"v1\",{{\"description\":\"Builds software\"}},[]]",legacy_definition);
    cell.fingerprint=format!("{:x}",Sha256::digest(legacy_input.as_bytes()));
    let db=rusqlite::Connection::open(&path).unwrap();
    db.execute("UPDATE definitions SET body=?1 WHERE id=?2",rusqlite::params![legacy_definition,d.id]).unwrap();
    db.execute("UPDATE cells SET body=?1 WHERE id=?2",rusqlite::params![serde_json::to_string(&cell).unwrap(),serde_json::to_string(&key).unwrap()]).unwrap();drop(db);
    let engine=Engine::open(&path,data.clone(),Arc::new(Keys),Arc::new(MockProvider::default())).unwrap();
    let plan=engine.plan(vec![key.clone()],RunMode::Pending,false,false,1,1).unwrap();
    assert_eq!(plan.estimated_calls,0,"Legacy fingerprints must not require paid regeneration");
    assert_eq!(engine.cell(&key).unwrap().value,old_value);
    assert_eq!(engine.history(&key).unwrap().len(),1);
    drop(engine);std::fs::remove_file(path).unwrap();
}
