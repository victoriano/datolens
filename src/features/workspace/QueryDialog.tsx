import { useEffect, useRef, useState } from 'react';
import type { Dataset, DesktopApi } from '../../contracts/desktop-api';
import type { WorkspaceSource } from '../../contracts/workspace';
import { useI18n } from '../../ui';
import { ModelPicker } from '../../ui/ModelPicker';
import { joinExample, type DatasetTab } from './model';

interface Props { api: DesktopApi; tabs: DatasetTab[]; onClose(): void; onResult(dataset: Dataset): void | Promise<void> }
export function QueryDialog({api,tabs,onClose,onResult}: Props) {
  const { language } = useI18n();
  const tr = (es:string,en:string) => language === 'en' ? en : es;
  const [selected,setSelected]=useState<string[]>(() => tabs.map(tab=>tab.key));
  const [schemas,setSchemas]=useState<Record<string,Dataset>>({});
  const [message,setMessage]=useState('');
  const [sql,setSql]=useState('');
  const [name,setName]=useState(tr('Resultado','Result'));
  const [explanation,setExplanation]=useState('');
  const [prepared,setPrepared]=useState('');
  const [manual,setManual]=useState(false);
  const [sqlOpen,setSqlOpen]=useState(false);
  const [edited,setEdited]=useState(false);
  const [busy,setBusy]=useState<'generate'|'run'|null>(null);
  const [error,setError]=useState('');
  const [connected,setConnected]=useState<boolean|null>(null);
  const [checkingKey,setCheckingKey]=useState(true);
  const [model,setModel]=useState('gemini-3.8-flash');
  const [models,setModels]=useState(['gemini-3.8-flash']);
  const [modelsLoading,setModelsLoading]=useState(false);
  const dialog=useRef<HTMLDialogElement>(null);
  const question=useRef<HTMLTextAreaElement>(null);
  const alive=useRef(true);
  const tables=tabs.map((tab,index)=>({...tab,alias:`t${index+1}`,dataset:schemas[tab.key]??tab.dataset}));
  const context=JSON.stringify([message,model,selected]);
  const ready=manual || prepared===context;
  const locked=busy!==null;
  useEffect(()=>{alive.current=true;dialog.current?.showModal();question.current?.focus();void checkKey();return()=>{alive.current=false;};},[]);
  useEffect(()=>{const refresh=()=>void checkKey();window.addEventListener('datolens:provider-keys-changed',refresh);return()=>window.removeEventListener('datolens:provider-keys-changed',refresh);},[api]);
  useEffect(()=>{if(connected&&api.analysisModels)void loadModels();},[connected,api.analysisModels]);
  async function checkKey() {
    setCheckingKey(true);
    try {const present=await api.hasProviderKey('gemini');if(alive.current)setConnected(present);}
    catch(e){if(alive.current){setConnected(null);setError(String(e));}}
    finally {if(alive.current)setCheckingKey(false);}
  }
  useEffect(()=>{
    let cancelled=false;
    void(async()=>{for(const tab of tabs.filter(tab=>selected.includes(tab.key))) {
      try {const value=await api.openDataset({path:tab.path,sheet:tab.sheet});if(cancelled)return;if(value)setSchemas(current=>({...current,[tab.key]:value}));}
      catch(e){if(!cancelled)setError(String(e));}
    }})();return()=>{cancelled=true;};
  },[api,JSON.stringify(selected)]);
  async function sources():Promise<WorkspaceSource[]> {
    const result:WorkspaceSource[]=[];
    for(const tab of tables.filter(tab=>selected.includes(tab.key))) {
      const value=await api.openDataset({path:tab.path,sheet:tab.sheet});
      if(!value)throw new Error(tr('No se pudo abrir una tabla.','Could not open a table.'));
      result.push({datasetId:value.id,alias:tab.alias});
    }
    return result;
  }
  async function generate() {
    if(!api.suggestWorkspaceQuery||locked)return;
    setBusy('generate');setError('');setPrepared('');
    try {
      const proposal=await api.suggestWorkspaceQuery({message,model,sources:await sources(),previousSql:sql||undefined,language});
      if(!alive.current)return;
      setSql(proposal.sql);setName(proposal.name);setExplanation(proposal.explanation);setPrepared(context);setEdited(false);
    } catch(e){if(alive.current)setError(e instanceof Error?e.message:String(e));}
    finally {if(alive.current)setBusy(null);}
  }
  async function run() {
    if(!api.createQueryDataset||locked||!ready)return;
    setBusy('run');setError('');
    try {const result=await api.createQueryDataset({name,sql,sources:await sources()});if(alive.current){await onResult(result);onClose();}}
    catch(e){if(alive.current)setError(e instanceof Error?e.message:String(e));}
    finally {if(alive.current)setBusy(null);}
  }
  async function loadModels() {
    if(!api.analysisModels)return;setModelsLoading(true);setError('');
    try{const list=await api.analysisModels('gemini');if(alive.current){const available=[...new Set(list.map(item=>item.id).filter(id=>id.startsWith('gemini-')))];if(available.length){setModels(available);if(!available.includes(model))setModel(available[0]);}}}
    catch(e){if(alive.current)setError(String(e));}
    finally{if(alive.current)setModelsLoading(false);}
  }
  function writeSql() {setManual(true);setSqlOpen(true);if(!sql)setSql(joinExample(tables.filter(tab=>selected.includes(tab.key))));setError('');}
  return <dialog ref={dialog} className="dl-query-dialog" onCancel={event=>{if(locked)event.preventDefault();else onClose();}}>
    <header><div><h2>{tr('Crear dataset','Create dataset')}</h2><p>{tr('Describe qué quieres obtener de tus tablas.','Describe what you want to get from your tables.')}</p></div><button disabled={locked} aria-label={tr('Cerrar consulta','Close query')} onClick={onClose}>×</button></header>
    <div className="dl-query-body"><aside><h3>{tr('Usar estas tablas','Use these tables')}</h3>{tables.map(tab=><section className="dl-query-source" key={tab.key}><label><input type="checkbox" disabled={locked} checked={selected.includes(tab.key)} onChange={e=>setSelected(current=>e.target.checked?[...current,tab.key]:current.filter(key=>key!==tab.key))}/><span title={tab.path}>{tab.sheet||tab.name}</span></label>{selected.includes(tab.key)&&<details><summary>{tr('Columnas','Columns')} ({tab.dataset?.columns.length??'…'})</summary><code>{tab.alias}</code>{tab.dataset?.columns.map(column=><code key={column.id}>{column.id} <small>{column.dataType}</small></code>)}</details>}</section>)}</aside>
    <div className="dl-query-editor">
      {!manual&&<><label className="dl-query-question">{tr('¿Qué dataset quieres crear?','What dataset would you like to create?')}<textarea ref={question} value={message} maxLength={8000} disabled={locked} placeholder={tr('Por ejemplo: combina clientes y pedidos y calcula cuánto ha gastado cada cliente, incluyendo a los que no han comprado.','For example: join customers and orders and calculate how much each customer has spent, including those with no purchases.')} onChange={e=>setMessage(e.target.value)}/></label>
      <div className="dl-query-ai"><span>{checkingKey?tr('Comprobando clave…','Checking key…'):connected?tr('Gemini conectado','Gemini connected'):tr('Conecta Gemini para preparar tu consulta','Connect Gemini to prepare your query')}</span>{!checkingKey&&<button disabled={locked} onClick={()=>window.dispatchEvent(new Event('datolens:open-settings'))}>{tr('Ajustes de IA…','AI settings…')}</button>}{connected===null&&!checkingKey&&<button onClick={()=>void checkKey()}>{tr('Reintentar','Retry')}</button>}</div>
      {connected&&<details className="dl-query-model"><summary>{tr('Modelo Gemini para generar SQL','Gemini model for SQL generation')} · {model}</summary><ModelPicker label={tr('Modelo','Model')} value={model} disabled={locked||modelsLoading} onChange={setModel} options={models.map(id=>({id,provider:'gemini'}))}/>{modelsLoading&&<small role="status">{tr('Cargando modelos disponibles…','Loading available models…')}</small>}{api.analysisModels&&<button disabled={locked||modelsLoading} onClick={()=>void loadModels()}>{tr('Actualizar modelos','Refresh models')}</button>}<small>{tr('Jev se usa para clasificar y puntuar datos; su API actual no genera consultas SQL.','Jev classifies and scores data; its current API does not generate SQL queries.')}</small></details>}
      <p className="dl-query-privacy">{tr('Una llamada a Gemini con tu descripción, SQL previa y esquema seleccionado. No se envían filas. Puede consumir saldo de tu API.','One Gemini call with your description, previous SQL and selected schema. No rows are sent. This may use your API balance.')}</p></>}
      {(!manual&&ready&&explanation)&&<div className="dl-query-proposal" role="status"><strong>{tr('Consulta preparada','Query ready')}</strong><p>{explanation}</p>{edited&&<p>{tr('Has editado la SQL; se ejecutará tu versión.','You edited the SQL; your version will be executed.')}</p>}</div>}
      {(ready||manual)&&<label>{tr('Nombre del nuevo dataset','New dataset name')}<input value={name} maxLength={120} disabled={locked} onChange={e=>setName(e.target.value)}/></label>}
      {(sql||manual)&&<details className="dl-query-sql" open={sqlOpen} onToggle={e=>setSqlOpen(e.currentTarget.open)}><summary>{tr('Ver y editar SQL','View and edit SQL')}</summary><label>SQL<textarea spellCheck={false} value={sql} disabled={locked} onChange={e=>{setSql(e.target.value);setEdited(true);}}/></label>{manual&&<button disabled={locked||!selected.length} onClick={()=>setSql(joinExample(tables.filter(tab=>selected.includes(tab.key))))}>{tr('Insertar ejemplo de JOIN','Insert JOIN example')}</button>}</details>}
      {!manual?<button className="dl-query-manual" disabled={locked} onClick={writeSql}>{tr('Escribir SQL manualmente','Write SQL manually')}</button>:<button disabled={locked} onClick={()=>{setManual(false);setSqlOpen(false);setPrepared('');}}>{tr('Describir en lenguaje natural','Describe in natural language')}</button>}
      <p>{tr('El resultado se calcula localmente con todas las filas, sin los filtros de la vista. Se guarda como un dataset independiente.','The result is computed locally from all rows, without view filters, and saved as an independent dataset.')}</p>
      <details className="dl-query-limits"><summary>{tr('Límites de ejecución','Execution limits')}</summary><p>{tr('Hasta 32 tablas, 1 millón de filas de resultado y 30 s de ejecución SQL.','Up to 32 tables, 1 million result rows and 30 seconds of SQL execution.')}</p></details>
      {error&&<p className="dl-query-error" role="alert">{error}</p>}
    </div></div>
    <footer><span role="status">{busy==='generate'?tr('Preparando consulta…','Preparing query…'):busy==='run'?tr('Creando dataset…','Creating dataset…'):tr(`${selected.length} tablas seleccionadas`,`${selected.length} tables selected`)}</span><button disabled={locked} onClick={onClose}>{tr('Cancelar','Cancel')}</button>{!manual&&!ready?<button className="dl-query-run" disabled={locked||!connected||!message.trim()||!selected.length||selected.length>32||!api.suggestWorkspaceQuery} onClick={()=>void generate()}>{tr('Preparar consulta','Prepare query')}</button>:<><button className="dl-query-run" disabled={locked||!name.trim()||!sql.trim()||!selected.length||selected.length>32} onClick={()=>void run()}>{tr('Crear dataset','Create dataset')}</button></>}</footer>
  </dialog>;
}
