import { VariableChecklist } from '../../ui/VariablePicker';
import { useI18n, t } from '../../ui';
import { useEffect, useId, useRef, useState } from 'react';
import { EvidenceDetails } from './EvidenceDetails';
import { DerivedColumnCard } from './DerivedColumnCard';
import type { ColumnProposal } from '../../contracts/derived-columns';
import type { Dataset, DesktopApi, EnrichmentDefinition, Filter, CellValue } from '../../contracts/desktop-api';

// Structural extension keeps the component independently buildable while IPC lands.
export interface ComposerOptions { webSearch?: boolean; questionType?: 'choice' | 'score' | 'noul' | null; choices?: Record<string,string>; levels?: string[]; threshold?: number | null }
export type ComposerDefinition = EnrichmentDefinition & { options?: ComposerOptions };
export interface Evidence { value: CellValue; provider: string; model: string; confidence?: number | null; probability?: number | null; sources: Array<{title:string;url:string}>; searchSuggestions?: string | null }
export interface SampleRow { rowId: string; inputs: Record<string,CellValue>; value: CellValue | null; error: string | null; evidence: Evidence | null }
export interface Sample { definitionFingerprint: string; datasetRevision: string; calls: number; rows: SampleRow[] }
interface ComposerApi {
  suggestEnrichment(request:{datasetId:string;message:string;language:'es'|'en';previous?:ComposerDefinition}):Promise<{definition:ComposerDefinition;explanation:string}>;
  previewEnrichment(request:{datasetId:string;definition:ComposerDefinition;rowIds?:string[];filters?:Filter[]}):Promise<Sample>;
}
interface Props {
  api: DesktopApi; dataset: Dataset; definitions: EnrichmentDefinition[];
  rowIds: string[]; filters: Filter[]; keys: Record<string,boolean>; keysLoading:boolean;
  onSaved:(definition:EnrichmentDefinition)=>Promise<void>;
  onDerivedCreated?:()=>void;
  onConfigure:(provider:string)=>void;
}
const describeValue = (value:CellValue) => value === null ? t('Vacío') : typeof value === 'boolean' ? value ? t('Sí') : 'No' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const providerName = (provider:string) => provider === 'jev' ? 'Jev' : 'Gemini';

export function EnrichmentComposer({api,dataset,definitions,rowIds,filters,keys,keysLoading,onSaved,onDerivedCreated,onConfigure}:Props) {
  const { t, locale, language } = useI18n();
  const tr=(es:string,en:string)=>language==='en'?en:es;
  const uid=useId();
  const service=api as DesktopApi & Partial<ComposerApi>;
  const [message,setMessage]=useState('');
  const [conversation,setConversation]=useState<string[]>([]);
  const [proposal,setProposal]=useState<ColumnProposal|null>(null);
  const [sample,setSample]=useState<Sample|null>(null);
  const [phase,setPhase]=useState<'idle'|'design'|'preview'|'save'>('idle');
  const [error,setError]=useState('');
  const [checkingKey,setCheckingKey]=useState(false);
  const [saved,setSaved]=useState(false);
  const [choicesText,setChoicesText]=useState<string|null>(null);
  const sequence=useRef(0);
  const mounted=useRef(true);
  const sampleScope=JSON.stringify([rowIds,filters,dataset.revision]);
  const draft=proposal?.kind==='enrichment'?proposal.definition:undefined;
  const directSql=/^sql:/i.test(message.trim());
  const pending=phase!=='idle'||(keysLoading&&!directSql);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;sequence.current++;};},[]);
  useEffect(()=>{sequence.current++;setSample(null);setSaved(false);setPhase('idle');},[sampleScope]);
  const columnName=(id:string)=>dataset.columns.find(c=>c.id===id)?.name ?? definitions.find(d=>d.outputColumn===id)?.name ?? id;
  function edit(definition:ComposerDefinition) { sequence.current++;setProposal(current=>current?.kind==='enrichment'?{...current,definition}:current);setSample(null);setSaved(false);setError(''); }
  async function design() {
    if(!message.trim() || pending)return;
    if(saved){setProposal(null);setSample(null);setSaved(false);}
    if(!directSql&&!keys.gemini){onConfigure('gemini');return;}
    const token=++sequence.current;const question=message.trim();setPhase('design');setError('');setSample(null);setSaved(false);
    try {
      let result:ColumnProposal;
      if(api.suggestColumn) result=await api.suggestColumn({datasetId:dataset.id,message:question,language,previous:saved?undefined:proposal??undefined});
      else {if(!service.suggestEnrichment||directSql)throw new Error('El asistente requiere la versión actualizada de Datolens.');result={kind:'enrichment',...await service.suggestEnrichment({datasetId:dataset.id,message:question,language,previous:saved?undefined:draft})};}
      if(!mounted.current||token!==sequence.current)return;
      setProposal(result);setChoicesText(null);setConversation(previous=>[...previous.slice(-2),question]);setMessage('');
    } catch(e){if(mounted.current&&token===sequence.current)setError(String(e));}
    finally {if(mounted.current&&token===sequence.current)setPhase('idle');}
  }
  async function preview() {
    if(!draft||pending)return;
    if(!keys[draft.provider]){onConfigure(draft.provider);return;}
    const token=++sequence.current;setPhase('preview');setError('');setSample(null);
    try {
      if(!service.previewEnrichment)throw new Error('La vista previa requiere la versión actualizada de Datolens.');
      const result=await service.previewEnrichment({datasetId:dataset.id,definition:draft,rowIds:rowIds.length?[...new Set(rowIds)].slice(0,3):undefined,filters});
      if(!mounted.current||token!==sequence.current)return;
      if(result.datasetRevision!==dataset.revision)throw new Error('El archivo cambió. Vuelve a abrirlo antes de probar.');
      setSample(result);
    } catch(e){if(mounted.current&&token===sequence.current)setError(String(e));}
    finally {if(mounted.current&&token===sequence.current)setPhase('idle');}
  }
  async function save() {
    if(!draft||!sample||!sample.rows.some(row=>!row.error)||pending)return;
    const token=++sequence.current;setPhase('save');setError('');
    try {await api.saveEnrichment(dataset.id,draft);if(!mounted.current||token!==sequence.current)return;await onSaved(draft);if(mounted.current&&token===sequence.current)setSaved(true);}
    catch(e){if(mounted.current&&token===sequence.current)setError(String(e));}
    finally {if(mounted.current&&token===sequence.current)setPhase('idle');}
  }
  function chooseProvider(provider:string) {
    if(!draft)return;
    const options={...draft.options};
    if(provider==='gemini'){edit({...draft,provider,model:'gemini-3.8-flash',options:{...options,questionType:null}});return;}
    const categorical=draft.outputKind==='categorical';
    edit({...draft,provider:'jev',model:'jev-latest',outputKind:categorical?'categorical':draft.outputKind==='boolean'?'boolean':'numeric',options:{...options,webSearch:false,questionType:categorical?'choice':'noul',threshold:0.5}});
  }
  const suggestions=[{icon:'◈',text:'Clasificar registros',prompt:'Clasifica estos registros en categorías útiles y concretas a partir de sus descripciones.'},{icon:'◎',text:'Detectar una condición',prompt:'Detecta si cada registro describe una oportunidad interesante. Propón una condición concreta basada en las columnas disponibles.'},{icon:'↗',text:'Investigar en la web',prompt:'Busca en la web la página oficial de cada entidad. Usa solo las columnas que permitan identificarla y no inventes resultados.'}];
  return <div className="enrichment-composer">
    {!proposal&&<div className="ec-intro"><div className="ec-emblem" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2"><path d="M12 1.5c0 5.8 4.7 10.5 10.5 10.5C16.7 12 12 16.7 12 22.5 12 16.7 7.3 12 1.5 12 7.3 12 12 7.3 12 1.5Z" /></svg></div><h3>{t("Una idea.")}<br/><span>{t("Una nueva columna.")}</span></h3><p>{t("Cuéntame qué quieres saber.")}<br/>{t("Yo preparo cómo conseguirlo.")}</p></div>}
    {!!conversation.length&&<div className="ec-conversation" aria-label={t("Conversación")}>{conversation.map((question,index)=><p key={index} className="ec-user-message">{question}</p>)}</div>}
    <form className={`ec-input ${phase==='design'?'ec-thinking':''}`} onSubmit={event=>{event.preventDefault();void design();}}>
      <label className="ec-sr-only" htmlFor={`${uid}-request`}>{t("Describe la columna que quieres conseguir")}</label>
      <textarea id={`${uid}-request`} rows={proposal?2:3} maxLength={4000} placeholder={proposal?tr('Afina la idea o describe otra columna…','Refine your idea or describe another column…'):tr('«Calcula el precio por m²» o «Clasifica estas descripciones»','“Calculate price per m²” or “Classify these descriptions”')} value={message} disabled={phase!=='idle'} onChange={event=>setMessage(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&(event.metaKey||event.ctrlKey)){event.preventDefault();void design();}}}/>
      <div className="ec-input-footer"><span>{phase==='design'?t('Diseñando tu columna…'):directSql?tr('DuckDB · local · sin API key','DuckDB · local · no API key'):keysLoading?t('Comprobando claves…'):t('Gemini · 1 llamada · solo nombres de columnas')}</span><button type="submit" disabled={pending||!message.trim()||(directSql&&!message.trim().slice(4).trim())} aria-label={proposal?t('Refinar propuesta'):t('Diseñar columna')}>{phase==='design'?<span className="ec-spinner"/>:'↑'}</button></div>
    </form>
    {!proposal&&<div className="ec-suggestions"><button type="button" disabled={phase!=='idle'} onClick={()=>setMessage('SQL: ')}><span>ƒx</span>{tr('Escribir una fórmula SQL','Write a SQL formula')}<span>↗</span></button>{suggestions.map(s=><button key={s.text} type="button" disabled={pending} onClick={()=>setMessage(t(s.prompt))}><span>{s.icon}</span>{t(s.text)}<span>↗</span></button>)}</div>}
    {error&&<div role="alert" className="enrichment-error"><p>{t(error.replace(/^Error:\s*/,''))}</p>{error.includes('No se autorizó el acceso a la clave en el Llavero')&&<><p>{tr('Pulsa «Comprobar acceso» para volver a mostrar el permiso de macOS. Si no aparece, abre Acceso a Llaveros con Spotlight y revisa el acceso del elemento «com.victoriano.datolens.providers».','Choose “Check access” to request the macOS permission again. If no dialog appears, open Keychain Access with Spotlight and review access to “com.victoriano.datolens.providers”.')}</p><button type="button" disabled={checkingKey} onClick={()=>{setCheckingKey(true);void api.checkProviderKeyAccess(draft?.provider??'gemini').then(()=>setError('')).catch(e=>setError(String(e))).finally(()=>setCheckingKey(false));}}>{checkingKey?tr('Comprobando…','Checking…'):tr('Comprobar acceso al Llavero','Check Keychain access')}</button></>}</div>}
    {proposal?.kind==='formula'&&<DerivedColumnCard key={proposal.formula.id} api={api} dataset={dataset} formula={proposal.formula} explanation={proposal.explanation} rowIds={rowIds} filters={filters} onChange={formula=>setProposal(current=>current?.kind==='formula'?{...current,formula}:current)} onCreated={()=>{setSaved(true);onDerivedCreated?.();}} onReset={()=>{setProposal(null);setConversation([]);setMessage('');setSample(null);setError('');setSaved(false);}}/>}
    {proposal&&draft&&<div className="ec-proposal">
      <div className="ec-proposal-heading"><div><span className="ec-eyebrow">{t("TU NUEVA COLUMNA")}</span><h3>{draft.name}</h3></div><span className={`ec-model-badge ${draft.provider}`}>{draft.provider==='jev'?'◈':'✧'} {providerName(draft.provider)}{draft.options?.webSearch?' + web':''}</span></div>
      <p className="ec-explanation">{proposal.explanation}</p>
      <div className="ec-flow"><div>{draft.inputColumns.map(id=><span key={id} title={id}>{columnName(id)}</span>)}</div><b aria-hidden="true">→</b><strong>{draft.name}</strong></div>
      <details className="ec-details"><summary>{t("Ajustar instrucciones y modelo ")}<span>⌄</span></summary>
        <fieldset disabled={pending||saved}>
          <label htmlFor={`${uid}-name`}>{t("Nombre")}</label><input id={`${uid}-name`} value={draft.name} onChange={event=>edit({...draft,name:event.target.value})}/>
          <label htmlFor={`${uid}-provider`}>{t("Proveedor")}</label><select id={`${uid}-provider`} value={draft.provider} onChange={event=>chooseProvider(event.target.value)}><option value="jev">{t("Jev · clasificar, puntuar, decidir")}</option><option value="gemini">{t("Gemini · extraer, escribir, investigar")}</option></select>
          {draft.provider==='gemini'&&<label className="enrichment-inline"><input type="checkbox" checked={!!draft.options?.webSearch} onChange={event=>edit({...draft,model:'gemini-3.8-flash',options:{...draft.options,webSearch:event.target.checked}})}/>{t("Buscar información en la web")}</label>}
          {draft.provider==='jev'&&<><label htmlFor={`${uid}-question`}>{t("Tipo de decisión")}</label><select id={`${uid}-question`} value={draft.options?.questionType??'noul'} onChange={event=>{const kind=event.target.value as 'choice'|'score'|'noul';edit({...draft,outputKind:kind==='choice'?'categorical':'numeric',options:{...draft.options,questionType:kind}});}}><option value="choice">{t("Una categoría")}</option><option value="score">{t("Puntuación por niveles")}</option><option value="noul">{t("Probabilidad de una condición")}</option></select>
          {draft.options?.questionType==='choice'&&<><label htmlFor={`${uid}-choices`}>{t("Opciones · una por línea")}</label><textarea id={`${uid}-choices`} rows={4} value={choicesText??Object.entries(draft.options.choices??{}).map(([label,description])=>description?`${label}: ${description}`:label).join('\n')} onChange={event=>{setChoicesText(event.target.value);edit({...draft,options:{...draft.options,choices:Object.fromEntries(event.target.value.split('\n').filter(Boolean).map(line=>{const colon=line.indexOf(':');return colon<0?[line.trim(),'']:[line.slice(0,colon).trim(),line.slice(colon+1).trim()];}))}});}}/></>}
          {draft.options?.questionType==='score'&&<><label htmlFor={`${uid}-levels`}>{t("Niveles de 0 a ")}{Math.max(0,(draft.options.levels?.length??1)-1)}{t(" · uno por línea")}</label><textarea id={`${uid}-levels`} rows={4} value={(draft.options.levels??[]).join('\n')} onChange={event=>edit({...draft,options:{...draft.options,levels:event.target.value.split('\n')}})}/></>}
          {draft.options?.questionType==='noul'&&<><label htmlFor={`${uid}-decision`}>{t("Resultado")}</label><select id={`${uid}-decision`} value={draft.outputKind} onChange={event=>edit({...draft,outputKind:event.target.value as 'numeric'|'boolean'})}><option value="numeric">{t("Probabilidad · 0 a 1")}</option><option value="boolean">{t("Sí o no")}</option></select>{draft.outputKind==='boolean'&&<><label htmlFor={`${uid}-threshold`}>{t("Umbral para sí")}</label><input id={`${uid}-threshold`} type="number" min="0" max="1" step="0.05" value={draft.options.threshold??0.5} onChange={event=>edit({...draft,options:{...draft.options,threshold:Number(event.target.value)}})}/></>}</>}
          </>}
          <label htmlFor={`${uid}-instructions`}>{t("Instrucción por fila")}</label><textarea id={`${uid}-instructions`} rows={4} value={draft.prompt} onChange={event=>edit({...draft,prompt:event.target.value})}/>
          <div><span>{t("Columnas que se enviarán")}</span><VariableChecklist label={t("Columnas que se enviarán")} columns={dataset.columns.filter(c=>c.id!==draft.outputColumn)} value={draft.inputColumns} onChange={inputColumns=>edit({...draft,inputColumns,dependsOn:definitions.filter(d=>inputColumns.includes(d.outputColumn)).map(d=>d.id)})}/></div>
        </fieldset>
      </details>
      {!saved&&<><button type="button" className="ec-preview-button" disabled={pending||!draft.inputColumns.length} onClick={()=>void preview()}>{phase==='preview'?<><span className="ec-spinner"/>{t("Probando con datos reales…")}</>:<><span>▷</span>{sample?t('Volver a probar'):t('Probar hasta 3 filas')}<small>{t("Máx. 3 llamadas")}</small></>}</button><p className="ec-privacy">{rowIds.length?t('De tu selección'):filters.length?t('Respetando tus filtros'):t('Primeras filas del archivo')}{t(". Solo se envían las entradas indicadas. ")}{draft.options?.webSearch?t('La búsqueda web puede tener coste adicional.'):''}</p></>}
      {phase==='preview'&&<div className="ec-skeleton" aria-label={t("Generando ejemplos")}>{[0,1,2].map(i=><div key={i}><span/><span/></div>)}</div>}
      {sample&&<div className="ec-sample"><div className="ec-sample-title"><span className="ec-live-dot"/><strong>{t("Resultados reales")}</strong><span>{sample.rows.filter(row=>!row.error).length}/{sample.rows.length}{t(" listas")}</span></div>
        {!sample.rows.length&&<p>{t("No hay filas en este alcance. Cambia la selección o los filtros.")}</p>}
        {sample.rows.map((row,index)=><article key={row.rowId} className={`ec-sample-row ${row.error?'has-error':''}`} style={{animationDelay:`${index*75}ms`}}>
          <div className="ec-sample-input">{Object.entries(row.inputs).map(([id,value])=><div key={id}><small>{columnName(id)}</small><span title={describeValue(value)}>{describeValue(value)}</span></div>)}</div>
          <div className="ec-sample-output"><span className="ec-result-arrow">↳</span><div>{row.error?<p role="status">{t(row.error)}</p>:<strong>{describeValue(row.value)}</strong>}
            <EvidenceDetails evidence={row.evidence} label={t("fila {value0}", { value0: index+1 })}/>
          </div></div>
        </article>)}
        {!saved&&sample.rows.some(row=>!row.error)&&<button type="button" className="enrichment-primary ec-use-button" disabled={pending} onClick={()=>void save()}>{phase==='save'?t('Preparando…'):t('Usar esta columna y revisar alcance')}<span>→</span></button>}
        {saved&&<><p className="ec-saved" role="status">{t("✓ Columna preparada. Revisa el alcance antes de ejecutar.")}</p><button type="button" className="ec-another" onClick={()=>{sequence.current++;setProposal(null);setSample(null);setConversation([]);setMessage('');setSaved(false);}}>{t("+ Crear otra columna")}</button></>}
        <p className="ec-footnote">{sample.calls}{t(" llamadas reales. La vista previa no modifica tu tabla ni ejecuta el resto del archivo.")}</p>
      </div>}
    </div>}
  </div>;
}
