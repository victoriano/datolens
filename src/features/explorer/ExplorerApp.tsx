import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Dataset, DesktopApi, Distributions, Filter, Page, ViewState } from '../../contracts/desktop-api';
import { DataTable } from './DataTable';
import { Variables } from './Variables';
import { EMPTY_SELECTION, PAGE_SIZE, kindSymbol, moveItem, reconcileView, selectionTSV, type ExplorerSelection } from './model';
import '../../styles/explorer.css';
export interface EnrichmentPanelContext { dataset: Dataset; selection: ExplorerSelection; filters: Filter[]; onDataChanged: () => void }
export interface ExplorerAppProps { api: DesktopApi; renderEnrichmentPanel?: (context: EnrichmentPanelContext) => ReactNode }
interface ExplorerError { message: string; retry?: () => void }
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
export function ExplorerApp({ api, renderEnrichmentPanel }: ExplorerAppProps) {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [view, setView] = useState<ViewState | null>(null);
  const [page, setPage] = useState<Page | null>(null);
  const [distributions, setDistributions] = useState<Distributions | null>(null);
  const [offset, setOffset] = useState(0);
  const [selection, setSelection] = useState<ExplorerSelection>(EMPTY_SELECTION);
  const [opening, setOpening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [chartsBusy, setChartsBusy] = useState(false);
  const [error, setError] = useState<ExplorerError | null>(null);
  const [notice, setNotice] = useState('');
  const [saveState, setSaveState] = useState('Vista guardada');
  const [sheets, setSheets] = useState<{ path: string; names: string[] } | null>(null);
  const [revision, setRevision] = useState(0);
  const [showEnrichments, setShowEnrichments] = useState(false);
  const [showVariables, setShowVariables] = useState(true);
  const [sortDrag, setSortDrag] = useState<number | null>(null);
  const openSequence = useRef(0);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const savedView = useRef('');
  const pendingViews = useRef(new Map<string, string>());
  const activeDatasetId = useRef<string | null>(null); activeDatasetId.current = dataset?.id ?? null;
  const open = useCallback(async function openSource(path?: string, sheet?: string): Promise<void> {
    const sequence = ++openSequence.current;
    setOpening(true); setError(null); setNotice('');
    let retryPath = path;
    try {
      const chosen = path ?? (api.selectDatasetPath ? await api.selectDatasetPath() : undefined);
      if (chosen === null || sequence !== openSequence.current) return;
      retryPath = chosen;
      if (chosen && /\.xlsx$/i.test(chosen) && !sheet) {
        const names = await api.listSheets(chosen);
        if (sequence !== openSequence.current) return;
        if (names.length > 1) { setSheets({ path: chosen, names }); return; }
        sheet = names[0];
      }
      const next = await api.openDataset(chosen ? { path: chosen, sheet } : undefined);
      if (!next || sequence !== openSequence.current) return;
      // Wait for pending writes before restoring this same dataset.
      await saveQueue.current.catch(() => {});
      let restored: ViewState | null = null;
      try { restored = await api.loadView(next.id); } catch (e) { setNotice(`No se pudo restaurar la vista: ${message(e)}`); }
      if (sequence !== openSequence.current) return;
      const nextView = reconcileView(next, restored);
      savedView.current = JSON.stringify(nextView);
      setDataset(next); setView(nextView); setPage(null); setDistributions(null); setOffset(0); setSelection(EMPTY_SELECTION); setSheets(null); setSaveState('Vista guardada'); setRevision(r => r + 1);
    } catch (e) { if (sequence === openSequence.current) setError({ message: message(e), retry: () => { void openSource(retryPath, sheet); } }); }
    finally { if (sequence === openSequence.current) setOpening(false); }
  }, [api]);
  useEffect(() => {
    if (!api.getLastSource) return;
    let cancelled = false;
    // StrictMode may read twice; only the live effect may open, and a user's
    // explicit open/drop always takes precedence over a late restoration.
    void api.getLastSource().then(source => {
      if (!cancelled && source && openSequence.current === 0) void open(source.path, source.sheet);
    }).catch(e => { if (!cancelled && openSequence.current === 0) setNotice(`No se pudo recuperar el último archivo: ${message(e)}`); });
    return () => { cancelled = true; };
  }, [api, open]);
  useEffect(() => {
    if (!api.onFileDrop) return;
    let disposed = false; let unsubscribe: (() => void) | undefined;
    void api.onFileDrop(path => { if (!disposed) void open(path); }).then(fn => { if (disposed) fn(); else unsubscribe = fn; }).catch(e => { if (!disposed) setError({ message: message(e) }); });
    return () => { disposed = true; unsubscribe?.(); };
  }, [api, open]);
  const visibleColumns = useMemo(() => !dataset || !view ? [] : view.columns.order.filter(id => !view.columns.hidden.includes(id)).map(id => dataset.columns.find(c => c.id === id)!).filter(Boolean), [dataset, view?.columns.order, view?.columns.hidden]);
  const columnIds = JSON.stringify(visibleColumns.map(c => c.id));
  const filtersKey = JSON.stringify(view?.filters ?? []);
  const sortingKey = JSON.stringify(view?.sorting ?? []);
  const distributionIds = JSON.stringify(dataset && view ? view.variablePanel.order.filter(id => !view.variablePanel.hidden.includes(id)) : []);
  useEffect(() => {
    if (!dataset || !view) return;
    let cancelled = false;
    setBusy(true); setError(null);
    void api.queryPage({ datasetId: dataset.id, columns: JSON.parse(columnIds), filters: JSON.parse(filtersKey), sorting: JSON.parse(sortingKey), offset, limit: PAGE_SIZE }).then(result => {
      if (cancelled) return;
      if (result.filteredCount !== null && offset >= result.filteredCount && offset > 0) { setOffset(Math.max(0, Math.ceil(result.filteredCount / PAGE_SIZE) - 1) * PAGE_SIZE); return; }
      setPage(result);
    }).catch(e => { if (!cancelled) { setPage(null); setError({ message: `No se pudieron consultar las filas: ${message(e)}`, retry: () => setRevision(r => r + 1) }); } }).finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [api, dataset?.id, columnIds, filtersKey, sortingKey, offset, revision]);
  useEffect(() => {
    if (!dataset || !view) return;
    let cancelled = false; setChartsBusy(true);
    void api.getDistributions({ datasetId: dataset.id, columns: JSON.parse(distributionIds), filters: JSON.parse(filtersKey) }).then(result => { if (!cancelled) setDistributions(result); }).catch(e => { if (!cancelled) { setDistributions(null); setError({ message: `No se pudieron calcular las distribuciones: ${message(e)}`, retry: () => setRevision(r => r + 1) }); } }).finally(() => { if (!cancelled) setChartsBusy(false); });
    return () => { cancelled = true; };
  }, [api, dataset?.id, distributionIds, filtersKey, revision]);
  // Queue every committed view mutation immediately; sequential writes cannot restore an older snapshot.
  useEffect(() => {
    if (!dataset || !view) return;
    const serialized = JSON.stringify(view);
    if (serialized === savedView.current) return;
    savedView.current = serialized;
    setSaveState('Guardando vista…');
    const id = dataset.id;
    pendingViews.current.set(id, serialized);
    saveQueue.current = saveQueue.current.catch(() => {}).then(async () => {
      // Coalesce rapid resize events while retaining the last view of each dataset.
      if (pendingViews.current.get(id) !== serialized) return;
      await api.saveView(id, view);
      if (activeDatasetId.current === id && pendingViews.current.get(id) === serialized) setSaveState('Vista guardada');
    }).catch(e => { if (activeDatasetId.current === id) { setSaveState('Vista sin guardar'); setError({ message: `No se pudo guardar la vista: ${message(e)}`, retry: () => { savedView.current = ''; setView(v => v ? { ...v } : null); } }); } });
  }, [api, dataset?.id, view]);
  const onView = useCallback((update: (view: ViewState) => ViewState) => setView(current => current ? update(current) : null), []);
  const onFilter = useCallback((id: string, filter?: Filter) => {
    setOffset(0);
    onView(current => ({ ...current, filters: [...current.filters.filter(f => f.column !== id), ...(filter ? [filter] : [])] }));
  }, [onView]);
  const onDataChanged = useCallback((): void => {
    setRevision(r => r + 1);
    const refresh = (api as DesktopApi & { getDataset?: (id: string) => Promise<Dataset> }).getDataset;
    if (dataset && refresh) void refresh(dataset.id).then(next => { if (activeDatasetId.current !== next.id) return; setDataset(next); setView(current => current ? reconcileView(next, current) : current); }).catch(e => { if (activeDatasetId.current === dataset.id) setError({ message: message(e), retry: onDataChanged }); });
  }, [api, dataset]);
  const copy = async (): Promise<void> => {
    if (!page || busy) return;
    try { await navigator.clipboard.writeText(selectionTSV(page.rows, visibleColumns, selection)); setNotice('Valores de la selección visible copiados.'); } catch (e) { setError({ message: `No se pudo copiar: ${message(e)}`, retry: () => { void copy(); } }); }
  };
  const exportFile = async (format: 'csv' | 'parquet'): Promise<void> => {
    if (!dataset || !view) return;
    try { setNotice('Exportando…'); const path = await api.exportDataset({ datasetId: dataset.id, format, filters: view.filters, sorting: view.sorting, columns: visibleColumns.map(c => c.id) }); setNotice(path ? `Exportado: ${path}` : 'Exportación cancelada.'); } catch (e) { setError({ message: message(e), retry: () => { void exportFile(format); } }); setNotice(''); }
  };
  const count = page?.filteredCount;
  return <main className="dl-explorer" onDragOver={e => { e.preventDefault(); }}><header className="dl-app-header"><div className="dl-brand"><span className="dl-brand-mark">▥</span><strong>datolens</strong><span className="dl-local-badge">LOCAL</span></div>{dataset && <div className="dl-file-title" title={dataset.sourcePath}>{dataset.name}{dataset.sheet && <small> / {dataset.sheet}</small>}</div>}<div className="dl-header-actions">{dataset && <small className="dl-save-state" role="status">{saveState}</small>}<button disabled={opening} onClick={() => void open()}>{opening ? 'Abriendo…' : 'Abrir archivo'}</button></div></header>
    {error && <div className="dl-banner dl-error" role="alert"><span>{error.message}</span>{error.retry && <button disabled={opening} onClick={() => { setError(null); error.retry?.(); }}>Reintentar</button>}<button aria-label="Cerrar error" onClick={() => setError(null)}>×</button></div>}{notice && <div className="dl-banner" role="status"><span>{notice}</span><button aria-label="Cerrar aviso" onClick={() => setNotice('')}>×</button></div>}
    {sheets && <div className="dl-dialog-backdrop"><section className="dl-sheet-dialog" role="dialog" aria-modal="true" aria-labelledby="dl-sheet-title"><h2 id="dl-sheet-title">Selecciona una hoja</h2><p>Cada hoja se abre como una tabla independiente.</p>{sheets.names.map(name => <button key={name} disabled={opening} onClick={() => void open(sheets.path, name)}>{name}<span>→</span></button>)}<button onClick={() => setSheets(null)}>Cancelar</button></section></div>}
    {!dataset || !view ? <section className="dl-empty"><div className="dl-empty-glyph">▦</div><h1>Explora tus datos.<br /><span>Desde tu Mac.</span></h1><p>Abre un archivo para filtrar, comparar variables<br />y enriquecer las filas que elijas.</p><button className="dl-primary" onClick={() => void open()} disabled={opening}>{opening ? 'Preparando tabla…' : 'Abrir archivo'}</button><small>CSV · XLSX · Parquet</small>{api.onFileDrop && <p className="dl-drop-hint">También puedes arrastrar aquí un archivo</p>}</section> : <>
      <div className="dl-workspace-toolbar"><div className="dl-view-tabs"><button aria-pressed={showVariables} onClick={() => setShowVariables(!showVariables)}>☷ Variables</button><span className="dl-toolbar-divider" /><strong>Tabla</strong><span className="dl-count">{count === null || count === undefined ? '…' : count.toLocaleString('es')} <span>de {dataset.rowCount?.toLocaleString('es') ?? '…'} filas</span></span></div><div className="dl-table-actions"><details className="dl-popover"><summary>Columnas <span>{visibleColumns.length}</span></summary><div className="dl-column-menu">{view.columns.order.map((id, index) => { const col = dataset.columns.find(c => c.id === id); if (!col) return null; return <div key={id}><label><input type="checkbox" checked={!view.columns.hidden.includes(id)} onChange={e => onView(v => ({ ...v, columns: { ...v.columns, hidden: e.target.checked ? v.columns.hidden.filter(c => c !== id) : [...v.columns.hidden, id] } }))} /><span>{kindSymbol[col.kind]} {col.name}</span></label><button aria-label={`Subir ${col.name}`} disabled={index === 0} onClick={() => onView(v => ({ ...v, columns: { ...v.columns, order: moveItem(v.columns.order, index, index - 1) } }))}>↑</button><button aria-label={`Bajar ${col.name}`} disabled={index === view.columns.order.length - 1} onClick={() => onView(v => ({ ...v, columns: { ...v.columns, order: moveItem(v.columns.order, index, index + 1) } }))}>↓</button></div>; })}</div></details><details className="dl-popover"><summary>Exportar ↗</summary><div className="dl-export-menu"><button onClick={() => void exportFile('csv')}>CSV · vista filtrada</button><button onClick={() => void exportFile('parquet')}>Parquet · vista filtrada</button></div></details>{renderEnrichmentPanel && <button className={showEnrichments ? 'dl-primary' : ''} aria-pressed={showEnrichments} onClick={() => setShowEnrichments(!showEnrichments)}>✧ Enriquecer</button>}</div></div>
      {(view.filters.length > 0 || view.sorting.length > 0) && <div className="dl-filter-bar">{view.filters.map(filter => <button className="dl-filter-chip" key={filter.column} title={JSON.stringify(filter)} onClick={() => onFilter(filter.column)}>{dataset.columns.find(c => c.id === filter.column)?.name} · {'selected' in filter ? filter.selected.join(', ') : filter.kind === 'numeric' ? `${filter.min?.toLocaleString('es', { maximumSignificantDigits: 6 }) ?? '−∞'} – ${filter.max?.toLocaleString('es', { maximumSignificantDigits: 6 }) ?? '∞'}` : filter.kind === 'date' ? `${filter.start?.slice(0, 10) ?? '…'} – ${filter.end?.slice(0, 10) ?? '…'}` : filter.terms.join(', ')} <span>×</span></button>)}{view.filters.length > 0 && <button className="dl-link" onClick={() => { setOffset(0); onView(v => ({ ...v, filters: [] })); }}>Limpiar filtros</button>}{view.sorting.length > 0 && <div className="dl-sort-rules"><span>Orden</span>{view.sorting.map((rule, index) => <div className="dl-sort-rule" draggable key={rule.id} onDragStart={() => setSortDrag(index)} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (sortDrag !== null) onView(v => ({ ...v, sorting: moveItem(v.sorting, sortDrag, index) })); setSortDrag(null); }}><span title="Arrastra para cambiar prioridad">⠿ {index + 1}</span><button onClick={() => onView(v => ({ ...v, sorting: v.sorting.map(r => r.id === rule.id ? { ...r, desc: !r.desc } : r) }))}>{dataset.columns.find(c => c.id === rule.id)?.name} {rule.desc ? '↓' : '↑'}</button><button aria-label={`Quitar orden ${rule.id}`} onClick={() => onView(v => ({ ...v, sorting: v.sorting.filter(r => r.id !== rule.id) }))}>×</button></div>)}</div>}</div>}
      <div className="dl-workspace">{showVariables && <Variables columns={dataset.columns} view={view} distributions={distributions?.variables ?? []} analyzedRows={distributions?.analyzedRows ?? 0} busy={chartsBusy} onView={onView} onFilter={onFilter} />}<section className="dl-table-region"><DataTable columns={visibleColumns} page={page} view={view} busy={busy} selection={selection} onSelection={setSelection} onView={onView} offset={offset} onCopy={() => void copy()} /><footer className="dl-table-footer"><div>{selection.cells.length || selection.rowIds.length ? <><strong>{selection.cells.length ? `${selection.cells.length} celdas` : `${selection.rowIds.length} filas`}</strong><button onClick={() => void copy()}>Copiar visibles ⌘C</button><button onClick={() => setSelection(EMPTY_SELECTION)}>Limpiar selección</button></> : <span>Clic selecciona · ⇧ rango · ⌘ selección múltiple</span>}</div><div className="dl-pagination"><span>{page?.rows.length ? offset + 1 : 0}–{offset + (page?.rows.length ?? 0)}</span><button disabled={busy || offset === 0} onClick={() => setOffset(n => Math.max(0, n - PAGE_SIZE))} aria-label="Página anterior">←</button><button disabled={busy || (count !== null && count !== undefined ? offset + PAGE_SIZE >= count : (page?.rows.length ?? 0) < PAGE_SIZE)} onClick={() => setOffset(n => n + PAGE_SIZE)} aria-label="Página siguiente">→</button></div></footer>{distributions?.sampled && <div className="dl-sample-note">Distribuciones calculadas sobre una muestra de {distributions.analyzedRows.toLocaleString('es')} filas. La tabla consulta todo el archivo.</div>}</section>{renderEnrichmentPanel && <aside className="dl-enrichment-slot" hidden={!showEnrichments}>{renderEnrichmentPanel({ dataset, selection, filters: view.filters, onDataChanged })}</aside>}</div>
    </>}
  </main>;
}
