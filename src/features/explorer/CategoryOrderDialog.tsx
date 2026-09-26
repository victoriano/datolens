import { useEffect, useMemo, useRef, useState } from 'react';
import type { Bin, Column, Dataset, DesktopApi, ViewState } from '../../contracts/desktop-api';
import { useI18n } from '../../ui';
import { categoryColorRanks, getCategoryColor } from './category-colors';
import { categoryLabel, categoryValues, semanticScope, setCategoryOrder, validateOrderProposal } from './category-semantics';
import { usePointerReorder } from './usePointerReorder';
import { moveItem } from './model';
import { SemanticAiSettings } from './SemanticAiSettings';
import './category-colors.css';
import './category-order.css';

export function CategoryOrderDialog({ column, bins, truncated, view, api, dataset, onView, onClose }: {
  column: Column; bins: Bin[]; truncated?: boolean; view: ViewState; api?: DesktopApi; dataset?: Dataset;
  onView: (update: (view: ViewState) => ViewState) => void; onClose: () => void;
}) {
  const { language, defaultCategoryPalette } = useI18n(), en = language === 'en';
  const dialog = useRef<HTMLDialogElement>(null);
  const version = useRef(0);
  const inFlight = useRef(false);
  const [sourceBins, setSourceBins] = useState(bins);
  const [partial, setPartial] = useState(!!truncated);
  const [loading, setLoading] = useState(!!api && !!dataset);
  const [generating, setGenerating] = useState(false);
  const [draft, setDraft] = useState(() => categoryValues(bins, view.categoryOrders?.[column.id]));
  const [reset, setReset] = useState(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState('');
  const [needsKey, setNeedsKey] = useState(false);
  const [context, setContext] = useState('');
  const [model, setModel] = useState('gemini-2.5-flash');
  const [query, setQuery] = useState('');
  const identity = `${dataset?.id}:${dataset?.revision}:${column.id}`;
  const initialIdentity = useRef(identity);
  const savedOrder = view.categoryOrders?.[column.id];
  useEffect(() => {
    dialog.current?.showModal();
    const run = ++version.current;
    if (api && dataset) void api.getDistributions({ datasetId: dataset.id, columns: [column.id], filters: [], sampling: { mode: 'full' }, statistics: [] }).then(result => {
      if (run !== version.current) return;
      const distribution = result.variables.find(item => item.column === column.id);
      if (!distribution || result.deferredReason) throw new Error(en ? 'Could not load all categories.' : 'No se pudieron cargar las categorías.');
      setSourceBins(distribution.bins); setPartial(!!distribution.truncated);
      setDraft(categoryValues(distribution.bins, savedOrder));
    }).catch(e => { if (run === version.current) { setError(String(e)); setPartial(true); } }).finally(() => { if (run === version.current) setLoading(false); });
    return () => { version.current++; };
  }, []);
  useEffect(() => { if (identity !== initialIdentity.current) { version.current++; dialog.current?.close(); } }, [identity]);
  const ranks = useMemo(() => categoryColorRanks(sourceBins, column.spss?.missingValues), [sourceBins, column.spss]);
  const scope = semanticScope(column, categoryValues(sourceBins), context);
  const busy = loading || generating;
  const move = (from: string, to: string) => {
    if (busy) return;
    setDraft(values => moveItem(values, values.indexOf(from), values.indexOf(to))); setReset(false);
  };
  // Encoded IDs also support the empty category and arbitrary raw values.
  const filtered = draft.filter(value => `${value} ${categoryLabel(column, value)}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const reorder = usePointerReorder(filtered.map(value => JSON.stringify(value)), (from, to) => move(JSON.parse(from), JSON.parse(to)));
  const close = () => { version.current++; dialog.current?.close(); };
  const suggest = async () => {
    if (!api?.suggestCategoryOrder || !dataset || busy || inFlight.current || partial || !scope.complete || scope.values.length < 2) return;
    const run = ++version.current; inFlight.current = true;
    setGenerating(true); setError(''); setNeedsKey(false); setSummary('');
    try {
      const hasKey = await api.hasProviderKey('gemini');
      if (run !== version.current) return;
      if (!hasKey) { setNeedsKey(true); return; }
      const result = validateOrderProposal(await api.suggestCategoryOrder({ datasetId: dataset.id, column: column.id, values: scope.values, model, language, context: context.trim() || undefined }), scope.values, column.id, dataset.revision);
      if (run !== version.current) return;
      setSummary(result.explanation);
      if (result.ordinal) { setDraft(current => [...result.order, ...current.filter(value => !result.order.includes(value))]); setReset(false); }
    } catch (e) { if (run === version.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { inFlight.current = false; if (run === version.current) setGenerating(false); }
  };
  return <dialog ref={dialog} className="dl-category-color-dialog dl-category-order-dialog" aria-labelledby="dl-category-order-title" onClose={onClose} onCancel={() => { version.current++; }} onClick={e => { if (e.target === dialog.current) close(); }}>
    <form onSubmit={e => { e.preventDefault(); if (busy) return; onView(current => setCategoryOrder(current, column.id, reset ? undefined : draft)); close(); }}>
      <header><div><h2 id="dl-category-order-title">{en ? 'Order categories' : 'Ordenar categorías'}</h2><p>{column.name}</p></div><button type="button" className="dl-category-color-close" aria-label={en ? 'Close' : 'Cerrar'} onClick={close}>×</button></header>
      <div className="dl-order-intro"><p>{en ? 'Drag a category, or focus its handle and use ↑ ↓. The chart follows this order even when you filter.' : 'Arrastra una categoría o usa ↑ ↓ sobre su asa. El gráfico conserva este orden al filtrar.'}</p><div><input autoFocus type="search" aria-label={en ? 'Search categories' : 'Buscar categorías'} placeholder={en ? 'Search categories…' : 'Buscar categorías…'} value={query} onChange={e => setQuery(e.target.value)} /><button type="button" disabled={busy || !draft.length} onClick={() => { setDraft(current => [...current].reverse()); setReset(false); }}>{en ? 'Reverse order' : 'Invertir orden'}</button></div></div>
      <div className="dl-order-list" ref={reorder.root} role="list" aria-label={en ? 'Category order' : 'Orden de categorías'} aria-busy={busy}>
        {filtered.map(value => <div role="listitem" key={value} data-reorder-id={JSON.stringify(value)} className={`dl-order-row ${reorder.className(JSON.stringify(value))}`}>
          <button type="button" disabled={busy} className="dl-grip" {...reorder.handle(JSON.stringify(value))} aria-label={`${en ? 'Move' : 'Mover'} ${categoryLabel(column, value) || (en ? 'empty string' : 'cadena vacía')}`} title={en ? 'Drag or use ↑ ↓' : 'Arrastra o usa ↑ ↓'}>⠿</button>
          <span className="dl-order-position">{draft.indexOf(value) + 1}</span><i className="dl-category-color-swatch" style={{ backgroundColor: column.spss?.missingValues.includes(value) ? 'var(--dl-chart-background)' : getCategoryColor(value, view.categoryColors?.[column.id], view.categoryPalettes?.[column.id] ?? defaultCategoryPalette, ranks) }} />
          <span className="dl-category-color-value"><strong>{categoryLabel(column, value) || (en ? '(empty string)' : '(cadena vacía)')}</strong>{categoryLabel(column, value) !== value && <small>{JSON.stringify(value)}</small>}</span>
        </div>)}
        {!filtered.length && <p>{loading ? (en ? 'Loading categories…' : 'Cargando categorías…') : (en ? 'No matching categories.' : 'No hay categorías coincidentes.')}</p>}
      </div>
      <div className="dl-order-note" role="status">{loading ? (en ? 'Loading categories from all rows…' : 'Cargando categorías de todas las filas…') : `${draft.length} ${en ? 'categories' : 'categorías'}`}{partial && <p>{en ? 'The 256 most frequent categories are available. Other values follow the saved order; AI ordering needs a complete scale.' : 'Se muestran las 256 categorías más frecuentes. Los demás valores van después del orden guardado; la IA necesita una escala completa.'}</p>}{sourceBins.some(bin => bin.value === null) && <p>{en ? 'Null values always stay at the end.' : 'Los valores nulos siempre quedan al final.'}</p>}{reset && <p>{en ? 'Frequency order will be restored on Apply.' : 'Al aplicar se restaurará el orden por frecuencia.'}</p>}</div>
      <section className="dl-category-color-ai">
        <div className="dl-category-color-ai-heading"><strong>{en ? 'Semantic order with AI' : 'Orden semántico con IA'}</strong><small>{en ? 'For agreement scales, frequency, intensity or stages.' : 'Para escalas de acuerdo, frecuencia, intensidad o etapas.'}</small></div>
        <SemanticAiSettings api={api} en={en} disabled={busy} model={model} onModel={setModel} context={context} onContext={setContext} />
        <div className="dl-category-color-ai-action"><small>{en ? `1 request to Gemini · ${scope.values.length} codes and labels · no rows` : `1 solicitud a Gemini · ${scope.values.length} códigos y etiquetas · sin filas`}</small><button type="button" className="dl-category-color-suggest" disabled={busy || partial || !scope.complete || scope.values.length < 2 || !api?.suggestCategoryOrder} onClick={() => void suggest()}>{generating ? (en ? 'Suggesting…' : 'Sugiriendo…') : (en ? 'Suggest order' : 'Sugerir orden con IA')}</button></div>
        {(!scope.complete || scope.values.length < 2) && <p>{en ? 'AI needs 2–100 non-missing categories within the text limit.' : 'La IA requiere entre 2 y 100 categorías válidas dentro del límite de texto.'}</p>}
        {needsKey && <p>{en ? 'Add a Gemini key in Settings.' : 'Añade una clave de Gemini en Ajustes.'} <button type="button" onClick={() => window.dispatchEvent(new Event('datolens:open-settings'))}>{en ? 'Open Settings' : 'Abrir Ajustes'}</button></p>}
        {summary && <p className="dl-category-color-ai-result" role="status">{summary}</p>}
        {error && <p role="alert" className="dl-category-color-error">{error}</p>}
      </section>
      <footer><button type="button" className="dl-category-color-reset" disabled={busy} onClick={() => { setDraft(categoryValues(sourceBins)); setReset(true); setSummary(''); }}>{en ? 'Restore frequency' : 'Restablecer frecuencia'}</button><span /><button type="button" onClick={close}>{en ? 'Cancel' : 'Cancelar'}</button><button type="submit" className="dl-primary" disabled={busy || (!draft.length && !reset)}>{en ? 'Apply' : 'Aplicar'}</button></footer>
    </form>
  </dialog>;
}
