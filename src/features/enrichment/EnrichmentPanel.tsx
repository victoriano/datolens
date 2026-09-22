import { useEffect, useId, useRef, useState } from 'react';
import type { Column, Dataset, DesktopApi, EnrichmentDefinition, EnrichmentCell, Filter, RunPlan, RunRequest, RunStatus, SelectionScope, VariableKind } from '../../contracts/desktop-api';
import './enrichment.css';

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
const cellLabels: Record<EnrichmentCell['state'], string> = {pending:'Pendiente',running:'En curso',succeeded:'Lista',failed:'Error',stale:'Desactualizada',blocked:'Sin entradas',cancelled:'Cancelada'};
const stateLabels: Record<RunStatus['state'], string> = { queued: 'Preparada', running: 'En curso', paused: 'Pausada', completed: 'Completada', cancelled: 'Cancelada', failed: 'Terminada con errores' };
const newDefinition = (): EnrichmentDefinition => {
  const id = `enrich_${crypto.randomUUID()}`;
  return { id, name: '', provider: 'gemini', model: 'gemini-2.5-flash', prompt: '', inputColumns: [], outputColumn: id, outputKind: 'text', dependsOn: [], revision: 1 };
};
const toggle = (items: string[], id: string) => items.includes(id) ? items.filter(item => item !== id) : [...items, id];
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Mount with key={dataset.id}. Inputs are stable IDs, never visible page indices.
 * No network run is started until planRun has frozen the scope and the user starts it.
 * Definitions and results callbacks let the parent refresh dataset schema and pages.
 */
export function EnrichmentPanel({ api, dataset, selectedRowIds = [], selectedCells = [], filters = [], onDefinitionsChange, onResultsChange }: EnrichmentPanelProps) {
  const uid = useId();
  const [definitions, setDefinitions] = useState<EnrichmentDefinition[]>([]);
  const [draft, setDraft] = useState<EnrichmentDefinition | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [key, setKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
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
  const selectionSignature = JSON.stringify([selectedRowIds, selectedCells, filters]);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    Promise.all([api.listEnrichments(dataset.id), api.hasProviderKey('gemini'), api.listRuns(dataset.id)]).then(([items, configured, runs]) => {
      if (cancelled) return;
      setDefinitions(items); setHasKey(configured); setChosen(items.map(item => item.id));
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
  const inputOptions: Column[] = [...dataset.columns];
  for (const d of definitions) if (!inputOptions.some(c => c.id === d.outputColumn)) inputOptions.push({ id: d.outputColumn, name: d.name, dataType: d.outputKind, kind: d.outputKind });
  const columnName = (id: string) => inputOptions.find(column => column.id === id)?.name ?? id;
  function buildScope(): SelectionScope {
    if (scopeKind === 'cells') return { kind: 'cells', cells: selectedCells.filter(cell => definitions.some(d => chosen.includes(d.id) && d.outputColumn === cell.columnId)) };
    if (scopeKind === 'rows') return { kind: 'rows', rowIds: [...selectedRowIds], enrichmentIds: [...chosen] };
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

  return <section className="enrichment-panel" aria-label="Enriquecimientos">
    <header className="enrichment-header"><div><h2>Enriquecimientos</h2><p>De columnas locales a nuevas respuestas.</p></div><button type="button" onClick={() => setDraft(newDefinition())}>+ Crear</button></header>
    <div className="enrichment-provider"><span className={`enrichment-dot ${hasKey ? 'ready' : ''}`} /><strong>Gemini</strong><span>{hasKey ? 'Clave configurada' : 'Sin clave'}</span><button type="button" onClick={() => setKeyOpen(!keyOpen)}>{keyOpen ? 'Cerrar' : 'Configurar'}</button></div>
    {keyOpen && <form className="enrichment-key" onSubmit={e => { e.preventDefault(); void action(async () => { await api.saveProviderKey('gemini', key.trim()); setKey(''); setHasKey(true); setKeyOpen(false); }); }}>
      <label htmlFor={`${uid}-key`}>Tu clave de Gemini</label><input id={`${uid}-key`} type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} placeholder="Se guarda en el Llavero de macOS" />
      <small>Solo se enviarán el prompt y las columnas de entrada seleccionadas para cada fila.</small>
      <div className="enrichment-actions"><button disabled={busy || !key.trim()} type="submit">Guardar clave</button>{hasKey && <button disabled={busy} type="button" onClick={() => void action(async () => { await api.removeProviderKey('gemini'); setHasKey(false); setKey(''); })}>Eliminar clave</button>}</div>
    </form>}
    {error && <div role="alert" className="enrichment-error">{error}</div>}
    {!definitions.length && !draft && <div className="enrichment-empty"><strong>Crea la primera columna</strong><p>Elige sus entradas, escribe una instrucción y revisa cuántas llamadas necesitará antes de ejecutar.</p></div>}
    <div className="enrichment-definitions">{definitions.map(def => <div className="enrichment-definition" key={def.id}>
      <label><input type="checkbox" checked={chosen.includes(def.id)} onChange={() => setChosen(toggle(chosen, def.id))} /><span><strong>{def.name}</strong><small>{def.inputColumns.map(columnName).join(' + ') || 'Sin columnas de entrada'} → {columnName(def.outputColumn)}</small></span></label>
      <button type="button" aria-label={`Editar ${def.name}`} onClick={() => setDraft({ ...def, inputColumns: [...def.inputColumns], dependsOn: [...def.dependsOn] })}>Editar</button>
    </div>)}</div>
    {draft && <form className="enrichment-editor" onSubmit={e => { e.preventDefault(); void action(async () => {
      if (!draft.name.trim() || !draft.prompt.trim() || !draft.model.trim()) throw new Error('Completa nombre, modelo y prompt.');
      const existed = definitions.some(d => d.id === draft.id);
      await api.saveEnrichment(dataset.id, draft); await reloadDefinitions();
      if (!existed) setChosen(previous => [...previous, draft.id]); setDraft(null);
    }); }}>
      <h3>{definitions.some(d => d.id === draft.id) ? 'Editar columna' : 'Nueva columna'}</h3>
      <label htmlFor={`${uid}-name`}>Nombre de la columna</label><input id={`${uid}-name`} disabled={definitions.some(d => d.id === draft.id)} required value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="Sector de la empresa" />
      {definitions.some(d => d.id === draft.id) && <small>El nombre y el tipo de una columna existente se conservan. Crea otra columna si necesitas cambiarlos.</small>}
      <div className="enrichment-two"><div><label htmlFor={`${uid}-model`}>Modelo Gemini</label><input id={`${uid}-model`} required value={draft.model} onChange={e => setDraft({ ...draft, model: e.target.value })} /></div><div><label htmlFor={`${uid}-type`}>Tipo de respuesta</label><select id={`${uid}-type`} disabled={definitions.some(d => d.id === draft.id)} value={draft.outputKind} onChange={e => setDraft({ ...draft, outputKind: e.target.value as VariableKind })}>{kinds.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div></div>
      <fieldset><legend>Columnas que se enviarán</legend><div className="enrichment-checklist">{inputOptions.filter(c => c.id !== draft.outputColumn).map(c => <label key={c.id}><input type="checkbox" checked={draft.inputColumns.includes(c.id)} onChange={() => changeInputs(c.id)} />{c.name}</label>)}</div></fieldset>
      <label htmlFor={`${uid}-prompt`}>Instrucción</label><textarea id={`${uid}-prompt`} required rows={4} value={draft.prompt} onChange={e => setDraft({ ...draft, prompt: e.target.value })} placeholder="Clasifica la empresa en un único sector." />
      <small>Inserta una referencia por ID: {draft.inputColumns.map(id => <button className="enrichment-token" type="button" key={id} onClick={() => setDraft({ ...draft, prompt: `${draft.prompt} {{${id}}}` })}>{`{{${id}}}`}</button>)}</small>
      {definitions.some(d => d.id !== draft.id) && <fieldset><legend>Esperar a estos enriquecimientos</legend><div className="enrichment-checklist">{definitions.filter(d => d.id !== draft.id).map(d => <label key={d.id}><input type="checkbox" checked={draft.dependsOn.includes(d.id)} disabled={draft.inputColumns.includes(d.outputColumn)} onChange={() => setDraft({ ...draft, dependsOn: toggle(draft.dependsOn, d.id) })} />{d.name}</label>)}</div></fieldset>}
      <div className="enrichment-actions"><button disabled={busy} className="enrichment-primary" type="submit">Guardar columna</button><button type="button" onClick={() => setDraft(null)}>Cerrar</button>{definitions.some(d => d.id === draft.id) && <button disabled={busy || active} className="enrichment-delete" type="button" onClick={() => void action(async () => { await api.deleteEnrichment(dataset.id, draft.id); await reloadDefinitions(); setDraft(null); })}>Eliminar</button>}</div>
    </form>}
    {!!definitions.length && <div className="enrichment-run">
      <h3>Ejecutar</h3><label htmlFor={`${uid}-scope`}>Alcance</label><select id={`${uid}-scope`} value={scopeKind} onChange={e => setScopeKind(e.target.value as typeof scopeKind)}>
        <option value="rows">Filas seleccionadas ({selectedRowIds.length})</option><option value="cells">Celdas / rango seleccionado ({selectedCells.length})</option><option value="filtered">Filas que cumplen los filtros</option><option value="all">Todas las filas · columnas elegidas</option>
      </select>
      <div className="enrichment-mode" role="group" aria-label="Modo de ejecución"><button type="button" aria-pressed={mode === 'pending'} onClick={() => setMode('pending')}>Completar pendientes</button><button type="button" aria-pressed={mode === 'regenerate'} onClick={() => setMode('regenerate')}>Regenerar</button></div>
      <p className="enrichment-hint">{mode === 'pending' ? 'Conserva los resultados vigentes; completa errores y celdas desactualizadas.' : 'Vuelve a llamar al modelo y conserva las versiones anteriores en el historial.'}</p>
      <label className="enrichment-inline"><input type="checkbox" checked={prerequisites} onChange={e => setPrerequisites(e.target.checked)} />Incluir requisitos</label>
      <label className="enrichment-inline"><input type="checkbox" checked={dependents} onChange={e => setDependents(e.target.checked)} />Incluir dependientes</label>
      <div className="enrichment-two"><div><label htmlFor={`${uid}-limit`}>Máximo de llamadas</label><input id={`${uid}-limit`} type="number" min={1} step={1} value={maxCalls} onChange={e => setMaxCalls(Number(e.target.value))} /></div><div><label htmlFor={`${uid}-parallel`}>En paralelo</label><input id={`${uid}-parallel`} type="number" min={1} max={8} step={1} value={concurrency} onChange={e => setConcurrency(Number(e.target.value))} /></div></div>
      <small>El límite incluye reintentos. El coste depende del modelo y del tamaño de las entradas y respuestas.</small>
      <button type="button" disabled={busy || active || !chosen.length} onClick={() => void action(prepare)}>Calcular alcance</button>
      {plan && <div className="enrichment-plan"><strong>{plan.cellCount.toLocaleString()} celdas · {plan.estimatedCalls.toLocaleString()} llamadas previstas</strong><p>Selección congelada por fila. Máximo autorizado: {maxCalls.toLocaleString()} llamadas.</p>
        {!!plan.missingInputs.length && <div role="status"><strong>Entradas pendientes</strong><ul>{plan.missingInputs.slice(0, 8).map((item, index) => <li key={index}>{item}</li>)}</ul>{plan.missingInputs.length > 8 && <small>Y {plan.missingInputs.length - 8} más.</small>}</div>}
        {plan.estimatedCalls > maxCalls && <p className="enrichment-error">Aumenta el límite o reduce el alcance.</p>}
        <button className="enrichment-primary" type="button" disabled={busy || active || !hasKey || !plan.cellCount || plan.estimatedCalls > maxCalls} onClick={() => void action(async () => { const status = await api.startRun(plan.id); setRun(status); setPlan(null); })}>Ejecutar con Gemini</button>{!hasKey && <small>Configura tu clave para ejecutar.</small>}
      </div>}
    </div>}
    {savedRuns.length > 0 && <div><label htmlFor={`${uid}-saved-run`}>Ejecuciones guardadas</label><select id={`${uid}-saved-run`} value={run?.id ?? ''} onChange={e => { const saved = savedRuns.find(item => item.id === e.target.value); if (saved) void action(async () => setRun(await api.getRunStatus(saved.id))); }} disabled={active}>
      {run && !savedRuns.some(item => item.id === run.id) && <option value={run.id}>Ejecución actual</option>}
      {savedRuns.map(item => <option key={item.id} value={item.id}>{stateLabels[item.state]} · {item.succeeded} listas · {item.id.slice(-8)}</option>)}
    </select></div>}
    {run && <div className="enrichment-progress" role="status"><div><strong>{stateLabels[run.state]}</strong><span>{run.succeeded} listas · {run.failed} errores · {run.pending} pendientes</span></div><progress max={Math.max(1, run.succeeded + run.failed + run.pending)} value={run.succeeded + run.failed} />{run.error && <p>{run.error}</p>}
      {active && <div className="enrichment-actions">{run.state === 'running' && <button disabled={busy} type="button" onClick={() => void action(async () => { await api.pauseRun(run.id); setRun(await api.getRunStatus(run.id)); })}>Pausar</button>}{run.state === 'paused' && <button disabled={busy} type="button" onClick={() => void action(async () => { await api.resumeRun(run.id); setRun(await api.getRunStatus(run.id)); })}>Reanudar</button>}<button disabled={busy} type="button" onClick={() => void action(async () => { await api.cancelRun(run.id); setRun(await api.getRunStatus(run.id)); })}>Cancelar</button></div>}
      {run.state === 'paused' && <small>Las llamadas ya enviadas pueden terminar. Al reabrir tras una interrupción, una petición remota puede repetirse.</small>}
    </div>}
    {!!cells.length && <div className="enrichment-cell-status"><h3>Celdas seleccionadas · primeras 50</h3>{cells.map(cell => {
      const id = JSON.stringify(cell.key);
      return <div key={id} className="enrichment-cell-row"><div><strong>{definitions.find(d => d.id === cell.key.enrichmentId)?.name ?? cell.key.enrichmentId}</strong><small>Fila {cell.key.rowId}</small><span data-cell-state={cell.state}>{cellLabels[cell.state]} · intento {cell.attempts}</span>{cell.error && <p>{cell.error}</p>}</div><button type="button" disabled={busy} onClick={() => void action(async () => setCellHistory({key: id, cells: await api.getCellHistory(dataset.id, cell.key)}))}>Historial</button>
      {cellHistory?.key === id && <ol className="enrichment-history">{cellHistory.cells.length ? cellHistory.cells.map((entry,index) => <li key={index}><strong>Versión {entry.definitionRevision} · {cellLabels[entry.state]}</strong><pre>{entry.value === null ? 'Sin respuesta guardada' : JSON.stringify(entry.value, null, 2)}</pre>{entry.error && <small>{entry.error}</small>}</li>) : <li>Aún no hay respuestas guardadas.</li>}</ol>}</div>;
    })}</div>}
  </section>;
}
