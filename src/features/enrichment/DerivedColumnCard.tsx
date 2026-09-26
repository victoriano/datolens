import { useEffect, useId, useRef, useState } from 'react';
import type { Dataset, DesktopApi, Filter, CellValue } from '../../contracts/desktop-api';
import type { DerivedCreated, DerivedDefinition, DerivedPreview } from '../../contracts/derived-columns';
import { useI18n } from '../../ui';

interface Props {
  api:DesktopApi; dataset:Dataset; formula:DerivedDefinition; explanation:string;
  rowIds:string[]; filters:Filter[]; onChange:(formula:DerivedDefinition)=>void;
  onCreated:()=>void; onReset:()=>void;
}
export function DerivedColumnCard({api,dataset,formula,explanation,rowIds,filters,onChange,onCreated,onReset}:Props) {
  const {language,locale}=useI18n();const tr=(es:string,en:string)=>language==='en'?en:es;
  const uid=useId();const sequence=useRef(0);const mounted=useRef(true);
  const [preview,setPreview]=useState<DerivedPreview|null>(null);
  const [loading,setLoading]=useState(false);const [creating,setCreating]=useState(false);
  const [error,setError]=useState('');const [created,setCreated]=useState<DerivedCreated|null>(null);
  const scope=JSON.stringify([dataset.id,dataset.revision,dataset.columns,rowIds,filters,formula]);
  // Preview identity is checked synchronously too: an edit must disable confirmation
  // in the render before its effect runs, not just when the next preview resolves.
  const [previewScope,setPreviewScope]=useState('');
  const valid=preview!==null&&previewScope===scope&&!loading&&!creating;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;sequence.current++;};},[]);
  useEffect(()=>{
    if(created)return;
    const token=++sequence.current;setPreview(null);setError('');setLoading(true);
    const timer=setTimeout(()=>{
      if(!api.previewDerivedColumn){setError(tr('Abre la versión actualizada de Datolens.','Open the latest version of Datolens.'));setLoading(false);return;}
      api.previewDerivedColumn({datasetId:dataset.id,formula,rowIds:rowIds.length?[...new Set(rowIds)].slice(0,3):undefined,filters}).then(result=>{
        if(mounted.current&&token===sequence.current){setPreview(result);setPreviewScope(scope);}
      }).catch(e=>{if(mounted.current&&token===sequence.current)setError(String(e).replace(/^Error:\s*/,''));})
        .finally(()=>{if(mounted.current&&token===sequence.current)setLoading(false);});
    },250);
    return()=>{clearTimeout(timer);sequence.current++;};
  },[api,scope,created]);
  async function create() {
    if(!valid||!preview||!api.createDerivedColumn)return;
    setCreating(true);setError('');const token=++sequence.current;
    try {
      const result=await api.createDerivedColumn({datasetId:dataset.id,formula,expectedRevision:preview.datasetRevision,expectedFingerprint:preview.fingerprint});
      onCreated();
      if(!mounted.current||token!==sequence.current)return;
      setCreated(result);
    }catch(e){if(mounted.current&&token===sequence.current)setError(String(e).replace(/^Error:\s*/,''));}
    finally{if(mounted.current&&token===sequence.current)setCreating(false);}
  }
  const describe=(value:CellValue)=>value===null?tr('Vacío','Empty'):typeof value==='boolean'?(value?tr('Sí','Yes'):tr('No','No')):typeof value==='object'?JSON.stringify(value):String(value);
  if(created)return <div className="ec-derived-created" role="status"><span className="ec-derived-check">✓</span><h3>{created.column.name}</h3><p>{tr('Columna creada. Ya está disponible en la tabla y los gráficos.','Column created. It is ready in the table and charts.')}</p>{created.save.warning&&<p className="enrichment-error">{created.save.warning}</p>}<button type="button" onClick={onReset}>{tr('Crear otra columna','Create another column')} <span>→</span></button></div>;
  return <section className="ec-proposal ec-derived" aria-label={tr('Columna calculada','Calculated column')}>
    <div className="ec-proposal-heading"><span className="ec-eyebrow">{tr('TU NUEVA COLUMNA','YOUR NEW COLUMN')}</span><span className="ec-model-badge ec-local-badge">ƒx DuckDB · {tr('local','local')}</span></div>
    <label className="ec-sr-only" htmlFor={`${uid}-name`}>{tr('Nombre de la columna','Column name')}</label>
    <input id={`${uid}-name`} className="ec-derived-name" maxLength={160} value={formula.name} disabled={creating} onChange={e=>onChange({...formula,name:e.target.value})}/>
    <p className="ec-explanation">{explanation}</p>
    <label className="ec-derived-label" htmlFor={`${uid}-sql`}>{tr('Fórmula SQL','SQL formula')}<span>{tr('Editable','Editable')}</span></label>
    <textarea id={`${uid}-sql`} className="ec-sql" rows={3} spellCheck={false} autoCapitalize="off" maxLength={8000} value={formula.expression} disabled={creating} onChange={e=>onChange({...formula,expression:e.target.value})}/>
    <div className="ec-derived-proof"><span>⌁</span><span>{tr('Se calcula en este Mac. Sin llamadas de IA por fila.','Calculated on this Mac. No AI calls per row.')}</span></div>
    {error&&<p role="alert" className="enrichment-error">{error}</p>}
    <div className="ec-sample ec-local-sample" aria-busy={loading}>
      <div className="ec-sample-title"><span className="ec-live-dot"/><strong>{tr('Vista previa local','Local preview')}</strong>{loading?<span className="ec-spinner"/>:<span>{preview?.rows.length??0} {tr('ejemplos','examples')}</span>}</div>
      {preview?.rows.map(row=><article key={row.rowId} className="ec-sample-row"><div className="ec-sample-input">{Object.entries(row.inputs).map(([id,value])=><div key={id}><small title={id}>{dataset.columns.find(c=>c.id===id)?.name??id}</small><span>{describe(value)}</span></div>)}</div><div className="ec-sample-output"><span className="ec-result-arrow">↳</span><strong>{describe(row.value)}</strong></div></article>)}
      {preview&&!preview.rows.length&&<p className="ec-privacy">{tr('No hay filas en esta muestra. La fórmula está validada.','There are no rows in this sample. The formula is valid.')}</p>}
    </div>
    <button type="button" className="enrichment-primary ec-use-button" disabled={!valid} onClick={()=>void create()}>{creating?tr('Creando columna…','Creating column…'):tr('Crear columna','Create column')}<span>→</span></button>
    <p className="ec-footnote">{tr('Se añadirá a las','It will be added to all')} {(preview?.totalRows??dataset.rowCount??0).toLocaleString(locale)} {tr('filas, aunque haya una selección o filtros.','rows, including rows outside the current selection or filters.')} {tr('Se recalcula cuando cambian sus entradas. Los cálculos no válidos quedan vacíos.','It recalculates when its inputs change. Invalid calculations stay empty.')}</p>
  </section>;
}
