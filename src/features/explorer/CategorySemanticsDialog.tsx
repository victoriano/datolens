import { useEffect, useMemo, useRef, useState } from 'react';
import type { Bin, Column, Dataset, DesktopApi, ViewState } from '../../contracts/desktop-api';
import { useI18n } from '../../ui';
import { isCategoricalKind } from './category-colors';
import { applySemanticEdits, categoryLabel, categoryValues, semanticScope, validateColorProposal, validateOrderProposal, type SemanticEdit } from './category-semantics';
import { SemanticAiSettings } from './SemanticAiSettings';
import { runSemanticQueue } from './semantic-queue';
import './category-colors.css';
import './category-order.css';

type Mode = 'order' | 'colors' | 'both';
type Prepared = { column: Column; bins: Bin[]; truncated: boolean; error?: string };
type Job = { id: string; column: Column; kind: 'order' | 'colors'; values: string[]; allValues: string[] };
type Proposal = { selected: boolean; explanation?: string; error?: string; order?: string[]; colors?: Array<{ value: string; color: string; reason: string }> };

export function CategorySemanticsDialog({ api, dataset, columns, view, onView, onClose }: {
  api: DesktopApi; dataset: Dataset; columns: Column[]; view: ViewState;
  onView: (update: (view: ViewState) => ViewState) => void; onClose: () => void;
}) {
  const { language } = useI18n(), en = language === 'en';
  const candidates = useMemo(() => columns.filter(column => isCategoricalKind(column.kind)), [columns]);
  const dialog = useRef<HTMLDialogElement>(null);
  const version = useRef(0), inFlight = useRef(false), stopped = useRef(false);
  const [selected, setSelected] = useState(() => new Set(candidates.map(column => column.id)));
  const [mode, setMode] = useState<Mode>('both');
  const [replaceOrders, setReplaceOrders] = useState(false), [replaceColors, setReplaceColors] = useState(false);
  const [model, setModel] = useState('gemini-2.5-flash'), [context, setContext] = useState('');
  const [budget, setBudget] = useState('20'), [query, setQuery] = useState('');
  const [prepared, setPrepared] = useState<Prepared[]>([]), [ready, setReady] = useState(false);
  const [proposals, setProposals] = useState<Record<string, Proposal>>({});
  const [working, setWorking] = useState<'prepare' | 'generate' | null>(null);
  const [progress, setProgress] = useState(''), [error, setError] = useState('');
  const [needsKey, setNeedsKey] = useState(false), [stopping, setStopping] = useState(false);
  const identity = `${dataset.id}:${dataset.revision}`;
  const initialIdentity = useRef(identity);
  useEffect(() => { dialog.current?.showModal(); return () => { version.current++; stopped.current = true; }; }, []);
  useEffect(() => { if (identity !== initialIdentity.current) { version.current++; stopped.current = true; dialog.current?.close(); } }, [identity]);
  const close = () => { version.current++; stopped.current = true; dialog.current?.close(); };
  const stop = () => { stopped.current = true; setStopping(true); };

  const plan = useMemo(() => {
    const jobs: Job[] = [], notes = new Map<string, string[]>();
    for (const row of prepared) {
      const { column } = row;
      const addNote = (note: string) => notes.set(column.id, [...(notes.get(column.id) ?? []), note]);
      if (row.error) { addNote(row.error); continue; }
      const values = categoryValues(row.bins);
      if (mode !== 'colors') {
        const scope = semanticScope(column, values, context);
        if (!replaceOrders && view.categoryOrders?.[column.id]?.length) addNote(en ? 'Custom order preserved.' : 'Orden personalizado conservado.');
        else if (row.truncated || !scope.complete || scope.values.length < 2) addNote(en ? 'Order skipped: needs a complete scale of 2–100 valid categories.' : 'Orden omitido: necesita una escala completa de 2–100 categorías válidas.');
        else jobs.push({ id: JSON.stringify([column.id, 'order']), column, kind: 'order', values: scope.values, allValues: categoryValues(row.bins, view.categoryOrders?.[column.id]) });
      }
      if (mode !== 'order') {
        const scope = semanticScope(column, values, context, replaceColors ? {} : view.categoryColors?.[column.id]);
        if (scope.values.length) jobs.push({ id: JSON.stringify([column.id, 'colors']), column, kind: 'colors', values: scope.values, allValues: values });
        else addNote(en ? 'Colors preserved; no eligible values.' : 'Colores conservados; no hay valores elegibles.');
        if (row.truncated || !scope.complete) addNote(en ? `Colors: ${scope.values.length} loaded values in scope; remaining values stay unchanged.` : `Colores: ámbito de ${scope.values.length} valores cargados; los restantes conservan su color.`);
      }
    }
    return { jobs, notes };
  }, [prepared, mode, replaceOrders, replaceColors, context, view.categoryOrders, view.categoryColors, en]);
  const pending = plan.jobs.filter(job => !Object.hasOwn(proposals, job.id));
  const maxCalls = Math.min(10_000, Math.max(0, Math.floor(Number(budget) || 0)));
  const nextCount = Math.min(maxCalls, pending.length);
  const proposalCount = (count: number) => `${count} ${en ? (count === 1 ? 'proposal' : 'proposals') : (count === 1 ? 'propuesta' : 'propuestas')}`;
  const selectedCount = Object.values(proposals).filter(proposal => proposal.selected && !proposal.error).length;
  const errors = Object.values(proposals).filter(proposal => !!proposal.error).length;
  const matching = candidates.filter(column => `${column.name} ${column.id}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const displayed = (ready ? prepared.filter(row => matching.some(column => column.id === row.column.id)).map(row => row.column) : matching).slice(0, 200);

  const prepare = async () => {
    if (inFlight.current || !selected.size) return;
    inFlight.current = true; stopped.current = false;
    const run = ++version.current;
    setWorking('prepare'); setStopping(false); setError(''); setPrepared([]); setProposals({});
    const chosen = candidates.filter(column => selected.has(column.id));
    try {
      for (const [index, column] of chosen.entries()) {
        if (stopped.current || run !== version.current) break;
        setProgress(`${index + 1} / ${chosen.length} · ${column.name}`);
        let row: Prepared;
        try {
          const result = await api.getDistributions({ datasetId: dataset.id, columns: [column.id], filters: [], sampling: { mode: 'full' }, statistics: [] });
          const distribution = result.variables.find(item => item.column === column.id);
          if (!distribution || result.deferredReason) throw new Error(en ? 'Categories unavailable.' : 'Categorías no disponibles.');
          row = { column, bins: distribution.bins, truncated: !!distribution.truncated };
        } catch (e) { row = { column, bins: [], truncated: false, error: e instanceof Error ? e.message : String(e) }; }
        if (run !== version.current) return;
        setPrepared(current => [...current, row]);
      }
      if (run === version.current) setReady(true);
    } finally { inFlight.current = false; if (run === version.current) { setWorking(null); setProgress(''); setStopping(false); } }
  };

  const generate = async () => {
    if (inFlight.current || !nextCount) return;
    inFlight.current = true; stopped.current = false;
    const run = ++version.current, queue = pending.slice(0, maxCalls);
    setWorking('generate'); setStopping(false); setError(''); setNeedsKey(false);
    try {
      const hasKey = await api.hasProviderKey('gemini');
      if (run !== version.current) return;
      if (!hasKey) { setNeedsKey(true); return; }
      await runSemanticQueue<Job, Proposal>({ jobs: queue, maxCalls, shouldStop: () => stopped.current || run !== version.current, run: async (job, index) => {
        setProgress(`${index + 1} / ${queue.length} · ${job.column.name} · ${job.kind === 'order' ? (en ? 'order' : 'orden') : (en ? 'colors' : 'colores')}`);
        let proposal: Proposal;
        try {
          const request = { datasetId: dataset.id, column: job.column.id, values: job.values, model, language, context: context.trim() || undefined };
          if (job.kind === 'order') {
            if (!api.suggestCategoryOrder) throw new Error(en ? 'AI ordering unavailable.' : 'Orden IA no disponible.');
            const result = validateOrderProposal(await api.suggestCategoryOrder(request), job.values, job.column.id, dataset.revision);
            proposal = { selected: result.ordinal, explanation: result.explanation, order: result.ordinal ? [...result.order, ...job.allValues.filter(value => !result.order.includes(value))] : undefined };
          } else {
            if (!api.suggestCategoryColors) throw new Error(en ? 'AI colors unavailable.' : 'Colores IA no disponibles.');
            const result = await api.suggestCategoryColors(request);
            const colors = validateColorProposal(result, job.values, job.column.id, dataset.revision);
            proposal = { selected: colors.length > 0, colors, explanation: result.explanation };
          }
        } catch (e) { proposal = { selected: false, error: e instanceof Error ? e.message : String(e) }; }
        return proposal;
      }, onResult: (job, result) => {
        if (run !== version.current) return;
        const proposal = 'value' in result ? result.value : { selected: false, error: String(result.error) };
        setProposals(current => ({ ...current, [job.id]: proposal }));
      } });
    } catch (e) { if (run === version.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { inFlight.current = false; if (run === version.current) { setWorking(null); setProgress(''); setStopping(false); } }
  };

  const apply = () => {
    if (working) return;
    const edits: SemanticEdit[] = plan.jobs.flatMap(job => {
      const result = proposals[job.id];
      return result?.selected && !result.error ? [{ column: job.column.id, order: result.order, colors: result.colors ? Object.fromEntries(result.colors.map(item => [item.value, item.color])) : undefined }] : [];
    });
    onView(current => applySemanticEdits(current, edits, replaceOrders, replaceColors)); close();
  };

  return <dialog ref={dialog} className="dl-category-color-dialog dl-semantic-dialog" aria-labelledby="dl-semantic-title" onClose={onClose} onCancel={() => { version.current++; stopped.current = true; }} onClick={e => { if (e.target === dialog.current) close(); }}>
    <form onSubmit={e => { e.preventDefault(); apply(); }}>
      <header><div><h2 id="dl-semantic-title">{en ? 'Category semantics with AI' : 'Semántica de categorías con IA'}</h2><p>{en ? 'Review ordinal scales and meaningful colors across your variables.' : 'Revisa escalas ordinales y colores con significado en tus variables.'}</p></div><button type="button" className="dl-category-color-close" aria-label={en ? 'Close' : 'Cerrar'} onClick={close}>×</button></header>
      <section className="dl-semantic-settings">
        <div className="dl-semantic-options"><label>{en ? 'Suggest' : 'Proponer'}<select value={mode} disabled={!!working || ready} onChange={e => setMode(e.target.value as Mode)}><option value="both">{en ? 'Order and colors' : 'Orden y colores'}</option><option value="order">{en ? 'Ordinal order' : 'Orden ordinal'}</option><option value="colors">{en ? 'Semantic colors' : 'Colores semánticos'}</option></select></label><label>{en ? 'Maximum calls per run' : 'Máximo de llamadas por tanda'}<input type="number" min="1" max="10000" step="1" value={budget} disabled={!!working} onChange={e => setBudget(e.target.value)} /></label></div>
        <SemanticAiSettings api={api} en={en} disabled={!!working || ready} model={model} onModel={setModel} context={context} onContext={setContext} />
        <div className="dl-semantic-preserve">{mode !== 'colors' && <label><input type="checkbox" checked={replaceOrders} disabled={!!working || ready} onChange={e => setReplaceOrders(e.target.checked)} />{en ? 'Replace custom orders' : 'Reemplazar órdenes personalizados'}</label>}{mode !== 'order' && <label><input type="checkbox" checked={replaceColors} disabled={!!working || ready} onChange={e => setReplaceColors(e.target.checked)} />{en ? 'Replace custom colors' : 'Reemplazar colores personalizados'}</label>}</div>
        <p>{ready ? (en ? `${plan.jobs.length} requests planned across ${prepared.length} prepared variables. Only selected names, codes, labels and context go to Google Gemini. No rows or counts.` : `${plan.jobs.length} solicitudes previstas en ${prepared.length} variables preparadas. Solo se envían a Google Gemini los nombres, códigos, etiquetas y contexto seleccionados. Sin filas ni conteos.`) : (en ? 'Select variables, then load their categories locally. Generation starts only when you request proposals.' : 'Selecciona variables y carga sus categorías en local. La generación empieza cuando solicites las propuestas.')}</p>
      </section>
      <div className="dl-semantic-search"><input type="search" autoFocus aria-label={en ? 'Search variables' : 'Buscar variables'} placeholder={en ? 'Search variables…' : 'Buscar variables…'} value={query} onChange={e => setQuery(e.target.value)} />{!ready && <><button type="button" disabled={!!working} onClick={() => setSelected(new Set(candidates.map(column => column.id)))}>{en ? 'All' : 'Todas'}</button><button type="button" disabled={!!working} onClick={() => setSelected(new Set())}>{en ? 'None' : 'Ninguna'}</button></>}<span>{ready ? `${proposalCount(selectedCount)} ${en ? 'selected' : selectedCount === 1 ? 'seleccionada' : 'seleccionadas'}` : `${selected.size} / ${candidates.length}`}</span></div>
      <div className="dl-semantic-variables" aria-busy={!!working}>
        {displayed.map(column => <div className="dl-semantic-variable" key={column.id}>
          {!ready ? <label><input type="checkbox" disabled={!!working} checked={selected.has(column.id)} onChange={e => setSelected(current => { const next = new Set(current); if (e.target.checked) next.add(column.id); else next.delete(column.id); return next; })} /><strong>{column.name}</strong>{view.categoryOrders?.[column.id]?.length ? <small>{en ? 'Custom order' : 'Orden personalizado'}</small> : null}</label> : <>
            <strong>{column.name}</strong>
            {plan.notes.get(column.id)?.map((note, i) => <p className="dl-semantic-note" key={i}>{note}</p>)}
            {plan.jobs.filter(job => job.column.id === column.id).map(job => {
              const result = proposals[job.id], hasChange = !!result?.order?.length || !!result?.colors?.length;
              return <div className="dl-semantic-proposal" key={job.id}>
                <label><input type="checkbox" disabled={!!working || !hasChange} checked={result?.selected ?? false} onChange={e => setProposals(current => ({ ...current, [job.id]: { ...current[job.id], selected: e.target.checked } }))} /><span>{job.kind === 'order' ? (en ? 'Ordinal order' : 'Orden ordinal') : (en ? 'Semantic colors' : 'Colores semánticos')}</span><small>{result ? result.error ? (en ? 'Failed' : 'Error') : hasChange ? (en ? 'Review' : 'Revisar') : (en ? 'No change proposed' : 'Sin cambio propuesto') : `${job.values.length} ${en ? 'values · pending' : 'valores · pendiente'}`}</small></label>
                {result?.error && <p role="alert" className="dl-category-color-error">{result.error}</p>}
                {result?.order && <p className="dl-semantic-order-preview">{result.order.map(value => categoryLabel(column, value) || '∅').join(' → ')}</p>}
                {!!result?.colors?.length && <div className="dl-semantic-swatches">{result.colors.map(item => <span key={item.value} title={item.reason}><i className="dl-category-color-swatch" style={{ backgroundColor: item.color }} />{categoryLabel(column, item.value)}</span>)}</div>}
                {result?.explanation && <p className="dl-semantic-note">{result.explanation}</p>}
              </div>;
            })}
          </>}
        </div>)}
        {matching.length > 200 && <p>{en ? 'Showing up to 200 matching variables. Search to find others; all selected variables are included.' : 'Se muestran hasta 200 variables coincidentes. Busca para ver otras; se incluyen todas las seleccionadas.'}</p>}
        {!displayed.length && <p>{en ? 'No matching categorical variables.' : 'No hay variables categóricas coincidentes.'}</p>}
      </div>
      <div className="dl-semantic-run">
        {working ? <><span role="status">{progress}</span><button type="button" disabled={stopping} onClick={stop}>{stopping ? (en ? 'Stopping after current request…' : 'Deteniendo tras la solicitud actual…') : (en ? 'Stop' : 'Detener')}</button></> : ready ? <><button type="button" onClick={() => { setReady(false); setPrepared([]); setProposals({}); setError(''); }}>{en ? 'New selection' : 'Nueva selección'}</button>{errors > 0 && <button type="button" onClick={() => setProposals(current => Object.fromEntries(Object.entries(current).filter(([, result]) => !result.error)))}>{en ? `Queue ${errors} failed requests again` : `Volver a poner ${errors} fallos en cola`}</button>}<span>{pending.length} {en ? 'pending' : 'pendientes'}</span><button type="button" className="dl-primary" disabled={!nextCount} onClick={() => void generate()}>{en ? `Generate ${proposalCount(nextCount)}` : `Generar ${proposalCount(nextCount)}`}</button></> : <><span>{en ? 'Includes hidden variables; reads categories from all rows.' : 'Incluye variables ocultas; lee las categorías de todas las filas.'}</span><button type="button" className="dl-primary" disabled={!selected.size} onClick={() => void prepare()}>{en ? 'Prepare categories' : 'Preparar categorías'}</button></>}
      </div>
      {needsKey && <p className="dl-order-note" role="status">{en ? 'Add a Gemini key in Settings.' : 'Añade una clave de Gemini en Ajustes.'} <button type="button" onClick={() => window.dispatchEvent(new Event('datolens:open-settings'))}>{en ? 'Open Settings' : 'Abrir Ajustes'}</button></p>}
      {error && <p className="dl-order-note dl-category-color-error" role="alert">{error}</p>}
      <footer><p>{en ? 'Proposals stay in draft until you apply them.' : 'Las propuestas quedan en borrador hasta que las apliques.'}</p><span /><button type="button" onClick={close}>{en ? 'Cancel' : 'Cancelar'}</button><button type="submit" className="dl-primary" disabled={!!working || !selectedCount}>{en ? `Apply ${proposalCount(selectedCount)}` : `Aplicar ${proposalCount(selectedCount)}`}</button></footer>
    </form>
  </dialog>;
}
