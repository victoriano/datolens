import { VariableChecklist } from '../../ui/VariablePicker';
import { useI18n } from '../../ui';
import { useEffect, useId, useRef, useState } from 'react';
import type { Column, Dataset, DesktopApi, EnrichmentDefinition, EnrichmentCell, Filter, RunPlan, RunRequest, RunStatus, SelectionScope, VariableKind } from '../../contracts/desktop-api';
import './enrichment.css';
import './composer.css';
import { EnrichmentComposer } from './EnrichmentComposer';
import { EvidenceDetails } from './EvidenceDetails';

export interface EnrichmentPanelProps {
  api: DesktopApi;
  dataset: Dataset;
  selectedRowIds?: string[];
  selectedCells?: Array<{ rowId: string; columnId: string }>;
  filters?: Filter[];
  onDefinitionsChange?: (definitions: EnrichmentDefinition[]) => void;
  onResultsChange?: () => void;
}
const kinds: Array<[VariableKind, string]> = [['text', 'Texto'], ['categorical', 'Categoría'], ['numeric', 'Número'], ['boolean', 'Sí / no'], ['date', 'Fecha'], ['multivalued', 'Lista de textos']];
const cellLabels: Record<EnrichmentCell['state'], string> = {pending:'Pendiente',running:'En curso',succeeded:'Completada',failed:'Error',stale:'Desactualizada',blocked:'Sin entradas',cancelled:'Cancelada'};
const stateLabels: Record<RunStatus['state'], string> = { queued: 'Preparada', running: 'En curso', paused: 'Pausada', completed: 'Completada', cancelled: 'Cancelada', failed: 'Terminada con errores' };
const toggle = (items: string[], id: string) => items.includes(id) ? items.filter(item => item !== id) : [...items, id];
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Mount with key={dataset.id}. Inputs are stable IDs, never visible page indices.
 * No network run is started until planRun has frozen the scope and the user starts it.
 * Definitions and results callbacks let the parent refresh dataset schema and pages.
 */
export function EnrichmentPanel({ api, dataset, selectedRowIds = [], selectedCells = [], filters = [], onDefinitionsChange, onResultsChange }: EnrichmentPanelProps) {
  const { t, locale } = useI18n();
  const uid = useId();
  const [definitions, setDefinitions] = useState<EnrichmentDefinition[]>([]);
  const [draft, setDraft] = useState<EnrichmentDefinition | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [key, setKey] = useState('');
  const [keys, setKeys] = useState<Record<string,boolean>>({gemini:false,jev:false});
  const [keysLoading,setKeysLoading]=useState(true);
  const [keyProvider,setKeyProvider]=useState('gemini');
  const [keyOpen, setKeyOpen] = useState(false);
  const [keyAccessConfirmed,setKeyAccessConfirmed]=useState(false);
  const [scopeKind, setScopeKind] = useState<'rows' | 'cells' | 'filtered' | 'all'>('rows');
  const [mode, setMode] = useState<'pending' | 'regenerate'>('pending');
  const [prerequisites, setPrerequisites] = useState(false);
  const [dependents, setDependents] = useState(false);
  const [maxCalls, setMaxCalls] = useState(100);
  const [concurrency, setConcurrency] = useState(2);
  const [plan, setPlan] = useState<RunPlan | null>(null);
  const [run, setRun] = useState<RunStatus | null>(null);
  const [savedRuns, setSavedRuns] = useState<RunStatus[]>([]);
  const [cells, setCells] = useState<EnrichmentCell[]>([]);
  const [cellHistory, setCellHistory] = useState<{key: string; cells: EnrichmentCell[]} | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const callbacks = useRef({ onDefinitionsChange, onResultsChange });
  callbacks.current = { onDefinitionsChange, onResultsChange };
  const mounted = useRef(true);
  const pollFailures = useRef(0);
  const active = !!run && ['queued', 'running', 'paused'].includes(run.state);
  const chosenSignature = chosen.join('|');
  const selectedRows=selectedRowIds.length?selectedRowIds:[...new Set(selectedCells.map(cell=>cell.rowId))];
  const selectionSignature = JSON.stringify([selectedRowIds, selectedCells, filters]);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    setKeysLoading(true);
    Promise.all([api.hasProviderKey('gemini'),api.hasProviderKey('jev')]).then(configured=>{
      if(!cancelled)setKeys({gemini:configured[0],jev:configured[1]});
    }).catch(e=>!cancelled&&setError(errorText(e))).finally(()=>{if(!cancelled)setKeysLoading(false);});
    Promise.all([api.listEnrichments(dataset.id), api.listRuns(dataset.id)]).then(([items, runs]) => {
      if (cancelled) return;
      setDefinitions(items); setChosen(items.map(item => item.id));
      setSavedRuns(runs.filter(item => item.state !== 'queued'));
      setRun(runs.find(item => ['running', 'paused'].includes(item.state)) ?? runs.find(item => item.state !== 'queued') ?? null);
    }).catch(e => !cancelled && setError(errorText(e)));
    return () => { cancelled = true; mounted.current = false; };
  }, [api, dataset.id]);

  useEffect(() => { setPlan(null); }, [scopeKind, mode, prerequisites, dependents, maxCalls, concurrency, chosenSignature, selectionSignature, dataset.revision]);
  useEffect(() => {
    if (!run || !active) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const status = await api.getRunStatus(run.id);
        if (cancelled) return;
        pollFailures.current = 0;
        setRun(status);
        if (status.succeeded !== run.succeeded || !['queued', 'running', 'paused'].includes(status.state)) callbacks.current.onResultsChange?.();
      } catch (e) {
        if (!cancelled && ++pollFailures.current >= 3) setError(`No se pudo actualizar el estado: ${errorText(e)}`);
      }
      if (!cancelled) timer = setTimeout(poll, 1200);
    };
    timer = setTimeout(poll, 700);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [api, run?.id, run?.succeeded, active]);

  useEffect(() => {
    let cancelled = false;
    const keys = selectedCells.flatMap(cell => definitions.filter(d => d.outputColumn === cell.columnId).map(d => ({rowId: cell.rowId, enrichmentId: d.id}))).slice(0, 50);
    if (!keys.length) { setCells([]); setCellHistory(null); return; }
    api.getCells(dataset.id, keys).then(items => { if (!cancelled) setCells(items); }).catch(e => !cancelled && setError(errorText(e)));
    return () => { cancelled = true; };
  }, [api, dataset.id, selectionSignature, definitions, run?.succeeded, run?.failed, run?.state]);

  async function action(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { if (mounted.current) setError(errorText(e)); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function reloadDefinitions() {
    const items = await api.listEnrichments(dataset.id);
    setDefinitions(items); setChosen(previous => previous.filter(id => items.some(item => item.id === id)));
    callbacks.current.onDefinitionsChange?.(items); setPlan(null);
  }
  const hasChosenKeys=!keysLoading&&definitions.filter(d=>chosen.includes(d.id)).every(d=>keys[d.provider]);
  const inputOptions: Column[] = [...dataset.columns];
  for (const d of definitions) if (!inputOptions.some(c => c.id === d.outputColumn)) inputOptions.push({ id: d.outputColumn, name: d.name, dataType: d.outputKind, kind: d.outputKind });
  const columnName = (id: string) => inputOptions.find(column => column.id === id)?.name ?? id;
  function buildScope(): SelectionScope {
    if (scopeKind === 'cells') return { kind: 'cells', cells: selectedCells.filter(cell => definitions.some(d => chosen.includes(d.id) && d.outputColumn === cell.columnId)) };
    if (scopeKind === 'rows') return { kind: 'rows', rowIds: [...selectedRows], enrichmentIds: [...chosen] };
    if (scopeKind === 'filtered') return { kind: 'filtered', filters, enrichmentIds: [...chosen] };
    return { kind: 'all', enrichmentIds: [...chosen] };
  }
  async function prepare() {
    const scope = buildScope();
    if (!chosen.length) throw new Error('Selecciona al menos un enriquecimiento.');
    if (scope.kind === 'rows' && !scope.rowIds.length) throw new Error('Selecciona filas en la tabla.');
    if (scope.kind === 'cells' && !scope.cells.length) throw new Error('Selecciona celdas de las columnas de enriquecimiento elegidas.');
    if (!Number.isInteger(maxCalls) || maxCalls < 1 || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error('Revisa los límites de llamadas y concurrencia.');
    // Optional native limits extend the baseline contract without frontend-only enforcement.
    const request: RunRequest = { datasetId: dataset.id, scope, mode, includePrerequisites: prerequisites, includeDependents: dependents, maxCalls, concurrency };
    setPlan(await api.planRun(request));
  }
  function changeInputs(id: string) {
    if (!draft) return;
    const inputColumns = toggle(draft.inputColumns, id);
    const inferred = definitions.filter(d => inputColumns.includes(d.outputColumn)).map(d => d.id);
    setDraft({ ...draft, inputColumns, dependsOn: [...new Set([...draft.dependsOn, ...inferred])] });
  }

  return <section className="enrichment-panel" aria-label={t("Enriquecimientos")}>
    <header className="enrichment-header"><div><h2>{t("Enriquecer")}</h2></div><details className="ec-provider-menu"><summary aria-label={t("Configurar proveedores")} aria-disabled={keysLoading} aria-busy={keysLoading} onClick={event=>{if(keysLoading)event.preventDefault();}}><span className={`enrichment-dot ${keys.gemini&&keys.jev?'ready':''}`}/>{keysLoading?t('Comprobando claves…'):keys.gemini&&keys.jev?t('Claves guardadas'):t('Conectar')} ⌄</summary><div>{['gemini','jev'].map(provider=><button key={provider} type="button" onClick={()=>{setKeyProvider(provider);setKeyAccessConfirmed(false);setKeyOpen(true);setKey('');}}>{provider==='jev'?'Jev':'Gemini'} <span>{keys[provider]?'✓':t('Configurar')}</span></button>)}</div></details></header>
    {keyOpen && <form className="enrichment-key" onSubmit={e => { e.preventDefault(); void action(async () => { await api.saveProviderKey(keyProvider, key.trim()); setKey(''); setKeys(previous=>({...previous,[keyProvider]:true})); setKeyOpen(false); }); }}>
      <label htmlFor={`${uid}-key`}>{t("Tu clave de ")}{keyProvider==='jev'?'Jev · TypeSafe':'Gemini'}</label><input id={`${uid}-key`} type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} placeholder={t("Se guarda en el Llavero de macOS")} />
      <div className="enrichment-actions"><button disabled={busy || !key.trim()} type="submit">{t("Guardar")}</button><button type="button" onClick={()=>{setKey('');setKeyOpen(false);}}>{t("Cerrar")}</button>{keys[keyProvider] && <button disabled={busy} type="button" onClick={() => void action(async () => { setKeyAccessConfirmed(false);await api.checkProviderKeyAccess(keyProvider);setKeyAccessConfirmed(true); })}>{t("Comprobar acceso al Llavero")}</button>}{keys[keyProvider] && <button disabled={busy} type="button" onClick={() => void action(async () => { await api.removeProviderKey(keyProvider); setKeys(previous=>({...previous,[keyProvider]:false}));setKey(''); })}>{t("Eliminar")}</button>}</div>
      {keyAccessConfirmed && <small role="status">{t('Acceso al Llavero confirmado. Ya puedes volver a intentarlo.')}</small>}
      {keys[keyProvider] && <small>{t('La clave está guardada. Comprobar acceso vuelve a pedir permiso a macOS si hace falta; no realiza ninguna llamada a la API.')}</small>}
      {error?.includes('No se autorizó el acceso a la clave en el Llavero') && <small>{t('Si no aparece el aviso, abre Acceso a Llaveros con Spotlight, busca com.victoriano.datolens.providers y revisa Control de acceso.')}</small>}
    </form>}
    <EnrichmentComposer api={api} dataset={dataset} definitions={definitions} rowIds={selectedRows} filters={filters} keys={keys} keysLoading={keysLoading} onDerivedCreated={()=>callbacks.current.onResultsChange?.()} onConfigure={provider=>{setKeyProvider(provider);setKeyOpen(true);setKey('');}} onSaved={async definition=>{
      await reloadDefinitions();setChosen([definition.id]);
      const kind=selectedRows.length?'rows':filters.length?'filtered':'all';setScopeKind(kind);
      const scope:SelectionScope=kind==='rows'?{kind:'rows',rowIds:[...selectedRows],enrichmentIds:[definition.id]}:kind==='filtered'?{kind:'filtered',filters,enrichmentIds:[definition.id]}:{kind:'all',enrichmentIds:[definition.id]};
      const prepared=await api.planRun({datasetId:dataset.id,scope,mode:'pending',includePrerequisites:false,includeDependents:false,maxCalls,concurrency});
      setPlan(prepared);
    }}/>
    {error && <div role="alert" className="enrichment-error">{t(error)}</div>}
    {!!definitions.length && <div className="ec-section-label">{t("COLUMNAS PREPARADAS")}</div>}
    <div className="enrichment-definitions">{definitions.map(def => <div className="enrichment-definition" key={def.id}>
      <label><input type="checkbox" checked={chosen.includes(def.id)} onChange={() => setChosen(toggle(chosen, def.id))} /><span><strong>{def.name}</strong><small>{def.inputColumns.map(columnName).join(' + ') || t('Sin columnas de entrada')} → {columnName(def.outputColumn)}</small></span></label>
      <button type="button" aria-label={t("Editar {value0}", { value0: def.name })} onClick={() => setDraft({ ...def, inputColumns: [...def.inputColumns], dependsOn: [...def.dependsOn] })}>{t("Editar")}</button>
    </div>)}</div>
    {draft && <form className="enrichment-editor" onSubmit={e => { e.preventDefault(); void action(async () => {
      if (!draft.name.trim() || !draft.prompt.trim() || !draft.model.trim()) throw new Error('Completa nombre, modelo y prompt.');
      const existed = definitions.some(d => d.id === draft.id);
      await api.saveEnrichment(dataset.id, draft); await reloadDefinitions();
      if (!existed) setChosen(previous => [...previous, draft.id]); setDraft(null);
    }); }}>
      <h3>{definitions.some(d => d.id === draft.id) ? t('Editar columna') : t('Nueva columna')}</h3>
      <label htmlFor={`${uid}-name`}>{t("Nombre de la columna")}</label><input id={`${uid}-name`} disabled={definitions.some(d => d.id === draft.id)} required value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder={t("Sector de la empresa")} />
      {definitions.some(d => d.id === draft.id) && <small>{t("El nombre y el tipo de una columna existente se conservan. Crea otra columna si necesitas cambiarlos.")}</small>}
      <div className="enrichment-two"><div><label htmlFor={`${uid}-model`}>{t("Modelo")}</label><input id={`${uid}-model`} required value={draft.model} onChange={e => setDraft({ ...draft, model: e.target.value })} /></div><div><label htmlFor={`${uid}-type`}>{t("Tipo de respuesta")}</label><select id={`${uid}-type`} disabled={definitions.some(d => d.id === draft.id)} value={draft.outputKind} onChange={e => setDraft({ ...draft, outputKind: e.target.value as VariableKind })}>{kinds.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></div></div>
      <fieldset><legend>{t("Columnas que se enviarán")}</legend><VariableChecklist label={t("Columnas que se enviarán")} columns={inputOptions.filter(c=>c.id!==draft.outputColumn)} value={draft.inputColumns} onChange={ids=>{const changed=[...ids,...draft.inputColumns].find(id=>ids.includes(id)!==draft.inputColumns.includes(id));if(changed)changeInputs(changed);}}/></fieldset>
      <label htmlFor={`${uid}-prompt`}>{t("Instrucción")}</label><textarea id={`${uid}-prompt`} required rows={4} value={draft.prompt} onChange={e => setDraft({ ...draft, prompt: e.target.value })} placeholder={t("Clasifica la empresa en un único sector.")} />
      <small>{t("Inserta una referencia por ID: ")}{draft.inputColumns.map(id => <button className="enrichment-token" type="button" key={id} onClick={() => setDraft({ ...draft, prompt: `${draft.prompt} {{${id}}}` })}>{`{{${id}}}`}</button>)}</small>
      {definitions.some(d => d.id !== draft.id) && <fieldset><legend>{t("Esperar a estos enriquecimientos")}</legend><div className="enrichment-checklist">{definitions.filter(d => d.id !== draft.id).map(d => <label key={d.id}><input type="checkbox" checked={draft.dependsOn.includes(d.id)} disabled={draft.inputColumns.includes(d.outputColumn)} onChange={() => setDraft({ ...draft, dependsOn: toggle(draft.dependsOn, d.id) })} />{d.name}</label>)}</div></fieldset>}
      <div className="enrichment-actions"><button disabled={busy} className="enrichment-primary" type="submit">{t("Guardar columna")}</button><button type="button" onClick={() => setDraft(null)}>{t("Cerrar")}</button>{definitions.some(d => d.id === draft.id) && <button disabled={busy || active} className="enrichment-delete" type="button" onClick={() => void action(async () => { await api.deleteEnrichment(dataset.id, draft.id); await reloadDefinitions(); setDraft(null); })}>{t("Eliminar")}</button>}</div>
    </form>}
    {!!definitions.length && <div className="enrichment-run">
      <h3>{t("Aplicar a más filas")}</h3><label htmlFor={`${uid}-scope`}>{t("Alcance")}</label><select id={`${uid}-scope`} value={scopeKind} onChange={e => setScopeKind(e.target.value as typeof scopeKind)}>
        <option value="rows">{t("Filas seleccionadas (")}{selectedRows.length})</option><option value="cells">{t("Celdas / rango seleccionado (")}{selectedCells.length})</option><option value="filtered">{t("Filas que cumplen los filtros")}</option><option value="all">{t("Todas las filas · columnas elegidas")}</option>
      </select>
      <details className="ec-details"><summary>{t("Opciones de ejecución ")}<span>⌄</span></summary>
      <div className="enrichment-mode" role="group" aria-label={t("Modo de ejecución")}><button type="button" aria-pressed={mode === 'pending'} onClick={() => setMode('pending')}>{t("Completar pendientes")}</button><button type="button" aria-pressed={mode === 'regenerate'} onClick={() => setMode('regenerate')}>{t("Regenerar")}</button></div>
      <p className="enrichment-hint">{mode === 'pending' ? t('Conserva los resultados vigentes; completa errores y celdas desactualizadas.') : t('Vuelve a llamar al modelo y conserva las versiones anteriores en el historial.')}</p>
      <label className="enrichment-inline"><input type="checkbox" checked={prerequisites} onChange={e => setPrerequisites(e.target.checked)} />{t("Incluir requisitos")}</label>
      <label className="enrichment-inline"><input type="checkbox" checked={dependents} onChange={e => setDependents(e.target.checked)} />{t("Incluir dependientes")}</label>
      </details>
      <div className="enrichment-two"><div><label htmlFor={`${uid}-limit`}>{t("Máximo de llamadas")}</label><input id={`${uid}-limit`} type="number" min={1} step={1} value={maxCalls} onChange={e => setMaxCalls(Number(e.target.value))} /></div><div><label htmlFor={`${uid}-parallel`}>{t("En paralelo")}</label><input id={`${uid}-parallel`} type="number" min={1} max={8} step={1} value={concurrency} onChange={e => setConcurrency(Number(e.target.value))} /></div></div>
      <small>{t("El límite incluye reintentos. El coste depende del modelo y del tamaño de las entradas y respuestas.")}</small>
      <button type="button" disabled={busy || active || !chosen.length} onClick={() => void action(prepare)}>{t("Calcular alcance")}</button>
      {plan && <div className="enrichment-plan"><strong>{plan.cellCount.toLocaleString(locale)}{t(" celdas · ")}{plan.estimatedCalls.toLocaleString(locale)}{t(" llamadas previstas")}</strong><p>{t("Selección congelada por fila. Máximo autorizado: ")}{maxCalls.toLocaleString(locale)}{t(" llamadas.")}</p>
        {!!plan.missingInputs.length && <div role="status"><strong>{t("Entradas pendientes")}</strong><ul>{plan.missingInputs.slice(0, 8).map((item, index) => <li key={index}>{item}</li>)}</ul>{plan.missingInputs.length > 8 && <small>{t("Y ")}{plan.missingInputs.length - 8}{t(" más.")}</small>}</div>}
        {plan.estimatedCalls > maxCalls && <p className="enrichment-error">{t("Aumenta el límite o reduce el alcance.")}</p>}
        <button className="enrichment-primary" type="button" disabled={busy || active || !hasChosenKeys || !plan.cellCount || plan.estimatedCalls > maxCalls} onClick={() => void action(async () => { const status = await api.startRun(plan.id); setRun(status); setPlan(null); })}>{t("Ejecutar enriquecimiento")}</button>{!hasChosenKeys && <small>{t("Configura tu clave para ejecutar.")}</small>}
      </div>}
    </div>}
    {savedRuns.length > 0 && <div><label htmlFor={`${uid}-saved-run`}>{t("Ejecuciones guardadas")}</label><select id={`${uid}-saved-run`} value={run?.id ?? ''} onChange={e => { const saved = savedRuns.find(item => item.id === e.target.value); if (saved) void action(async () => setRun(await api.getRunStatus(saved.id))); }} disabled={active}>
      {run && !savedRuns.some(item => item.id === run.id) && <option value={run.id}>{t("Ejecución actual")}</option>}
      {savedRuns.map(item => <option key={item.id} value={item.id}>{t(stateLabels[item.state])} · {item.succeeded}{t(" listas · ")}{item.id.slice(-8)}</option>)}
    </select></div>}
    {run && <div className="enrichment-progress" role="status"><div><strong>{t(stateLabels[run.state])}</strong><span>{run.succeeded}{t(" listas · ")}{run.failed}{t(" errores · ")}{run.pending}{t(" pendientes")}</span></div><progress max={Math.max(1, run.succeeded + run.failed + run.pending)} value={run.succeeded + run.failed} />{run.error && <p>{t(run.error)}</p>}
      {active && <div className="enrichment-actions">{run.state === 'running' && <button disabled={busy} type="button" onClick={() => void action(async () => { await api.pauseRun(run.id); setRun(await api.getRunStatus(run.id)); })}>{t("Pausar")}</button>}{run.state === 'paused' && <button disabled={busy} type="button" onClick={() => void action(async () => { await api.resumeRun(run.id); setRun(await api.getRunStatus(run.id)); })}>{t("Reanudar")}</button>}<button disabled={busy} type="button" onClick={() => void action(async () => { await api.cancelRun(run.id); setRun(await api.getRunStatus(run.id)); })}>{t("Cancelar")}</button></div>}
      {run.state === 'paused' && <small>{t("Las llamadas ya enviadas pueden terminar. Al reabrir tras una interrupción, una petición remota puede repetirse.")}</small>}
    </div>}
    {!!cells.length && <div className="enrichment-cell-status"><h3>{t("Celdas seleccionadas · primeras 50")}</h3>{cells.map(cell => {
      const id = JSON.stringify(cell.key);
      return <div key={id} className="enrichment-cell-row"><div><strong>{definitions.find(d => d.id === cell.key.enrichmentId)?.name ?? cell.key.enrichmentId}</strong><small>{t("Fila ")}{cell.key.rowId}</small><span data-cell-state={cell.state}>{t(cellLabels[cell.state])}{t(" · intento ")}{cell.attempts}</span>{cell.error && <p>{t(cell.error)}</p>}<EvidenceDetails evidence={cell.evidence} label={t("fila {value0}", { value0: cell.key.rowId })}/></div><button type="button" disabled={busy} onClick={() => void action(async () => setCellHistory({key: id, cells: await api.getCellHistory(dataset.id, cell.key)}))}>{t("Historial")}</button>
      {cellHistory?.key === id && <ol className="enrichment-history">{cellHistory.cells.length ? cellHistory.cells.map((entry,index) => <li key={index}><strong>{t("Versión ")}{entry.definitionRevision} · {t(cellLabels[entry.state])}</strong><pre>{entry.value === null ? t('Sin respuesta guardada') : JSON.stringify(entry.value, null, 2)}</pre>{entry.error && <small>{t(entry.error)}</small>}<EvidenceDetails evidence={entry.evidence} label={t("versión {value0}", { value0: index+1 })}/></li>) : <li>{t("Aún no hay respuestas guardadas.")}</li>}</ol>}</div>;
    })}</div>}
  </section>;
}
