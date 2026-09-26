import { useI18n } from '../../ui';
import { projectPresentation, setUiPreferences } from '../../ui/preferences';
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Dataset, DatasetOpenProgress, DatasetStorage, DesktopApi, Filter, SharedRevision, ViewState } from '../../contracts/desktop-api';
import type { VariableStatistics } from '../../contracts/analysis';
import { usePointerReorder } from './usePointerReorder';
import { queryDistributions } from './distributions';
import { useDistributions } from './useDistributions';
import { SampleControl } from './SampleControl';
import { createQueryQueue, normalizeSampling } from './sampling';
import { DataTable } from './DataTable';
import { categoryColorRanks, isCategoricalKind } from './category-colors';
import { ColumnMenu } from './ColumnMenu';
import { sameTableColumnWindow, tableColumnWindow } from './table-window';
import { nextTablePageFrame, tablePageCovers, type TablePageFrame } from './table-page';
import { VariableDetailsDialog, Variables } from './Variables';
import { useVariableAnalysis } from './AnalysisDialog';
import { PlotsPanel } from '../plots';
import { WorkspaceBar } from '../workspace/WorkspaceBar';
import { isUserLocalSourcePath, lastWorkspaceFilePath, rememberedWorkspaceSource, useDatasetWorkspace } from '../workspace/useDatasetWorkspace';
import { sourceKey, type DatasetTab } from '../workspace/model';
import { defaultConfig, freshWorkspace } from '../plots/model';
import { EMPTY_SELECTION, PAGE_SIZE, moveItem, reconcileView, selectionTSV, type ExplorerSelection } from './model';
import '../../styles/explorer.css';
export interface EnrichmentPanelContext { dataset: Dataset; selection: ExplorerSelection; filters: Filter[]; onDataChanged: () => void }
export interface ExplorerAppProps { api: DesktopApi; renderEnrichmentPanel?: (context: EnrichmentPanelContext) => ReactNode; onOpenSettings?: () => void }
interface ExplorerError { message: string; retry?: () => void }
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const fileSize = (bytes: number, locale: string) => bytes < 1024 ? `${bytes} B` : `${(bytes / 1024 ** (bytes < 1024 ** 2 ? 1 : bytes < 1024 ** 3 ? 2 : 3)).toLocaleString(locale, { maximumFractionDigits: 1 })} ${bytes < 1024 ** 2 ? 'KB' : bytes < 1024 ** 3 ? 'MB' : 'GB'}`;
export function ExplorerApp({ api, renderEnrichmentPanel, onOpenSettings }: ExplorerAppProps) {
  const { t, locale, language, resolvedTheme, colorCategoricalCells, categoryChartMode, showAnalyticalRole, defaultCategoryPalette } = useI18n();
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [view, setView] = useState<ViewState | null>(null);
  const [pageFrame, setPageFrame] = useState<TablePageFrame | null>(null);
  const [pageErrorKey, setPageErrorKey] = useState<string | null>(null);
  const [viewport, setViewport] = useState({ datasetId: '', left: 0, width: 1200 });
  const tableGeometry = useRef<{ columns: Dataset['columns']; widths: ViewState['columns']['widths'] }>({ columns: [], widths: {} });
  const onTableViewport = useCallback((datasetId: string, left: number, width: number) => setViewport(previous => {
    const { columns, widths } = tableGeometry.current;
    if (previous.datasetId === datasetId && previous.width === width && sameTableColumnWindow(tableColumnWindow(columns, widths, previous.left, width), tableColumnWindow(columns, widths, left, width))) return previous;
    return { datasetId, left, width };
  }), []);
  const [visibleVariables, setVisibleVariables] = useState<string[]>([]);
  const onVisibleVariables = useCallback((ids: string[]) => setVisibleVariables(previous => JSON.stringify(previous) === JSON.stringify(ids) ? previous : ids), []);
  const [unfilteredStatistics, setUnfilteredStatistics] = useState<{ key: string; values: Record<string, VariableStatistics> } | null>(null);

  const [selection, setSelection] = useState<ExplorerSelection>(EMPTY_SELECTION);
  const [opening, setOpening] = useState(false);
  const [openProgress, setOpenProgress] = useState<(DatasetOpenProgress & { name: string }) | null>(null);
  const [storageByTab, setStorageByTab] = useState<Record<string, DatasetStorage>>({});
  const [busy, setBusy] = useState(false);
  const pageQueryQueue = useRef(createQueryQueue());
  const [error, setError] = useState<ExplorerError | null>(null);
  const [notice, setNotice] = useState('');
  const [columnSearch, setColumnSearch] = useState('');
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [editingColumn, setEditingColumn] = useState<Dataset['columns'][number] | null>(null);
  const [revealRequest, setRevealRequest] = useState<{ column: string; token: number } | null>(null);
  const [saveState, setSaveState] = useState('Vista guardada');
  const [saveWarning, setSaveWarning] = useState('');
  const [sharedRevisions, setSharedRevisions] = useState<SharedRevision[]>([]);
  const [projectSelectionEpoch, setProjectSelectionEpoch] = useState(0);
  const { tabs, registerWorkbook, registerDataset, remove: removeTab } = useDatasetWorkspace();
  const [revision, setRevision] = useState(0);
  const expanded = view?.workspace?.mode === 'variables';
  const plots = view?.workspace?.mode === 'plots';
  const showVariables = view?.workspace?.variablesVisible ?? true;
  const showEnrichments = view?.workspace?.enrichmentsVisible ?? false;
  const offset = view?.workspace?.pageOffset ?? 0;
  const openSequence = useRef(0);
  const openedFileQueue = useRef<Promise<void>>(Promise.resolve());
  const lastOpenPath = useRef(lastWorkspaceFilePath());
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const savedView = useRef('');
  const pendingViews = useRef(new Map<string, string>());
  const activeDatasetId = useRef<string | null>(null); activeDatasetId.current = dataset?.id ?? null;
  useEffect(() => {
    if (!dataset || !api.listSharedRevisions) {setSharedRevisions([]);return;}
    let cancelled=false;
    const refresh=()=>{void api.listSharedRevisions!(dataset.id).then(items=>{if(!cancelled)setSharedRevisions(items);}).catch(()=>{});};
    refresh();const timer=window.setInterval(refresh,15000);
    return ()=>{cancelled=true;window.clearInterval(timer);};
  },[api,dataset?.id]);
  const chooseSharedRevision=useCallback(async (id:string)=>{
    if (!dataset || !api.selectSharedRevision || !api.listSharedRevisions) return;
    setBusy(true);
    try {
      await saveQueue.current;
      const next=await api.selectSharedRevision(dataset.id,id);
      const restored=await api.loadView(next.id);
      const nextView=reconcileView(next,restored);
      if (nextView.presentation) setUiPreferences(nextView.presentation);
      savedView.current=JSON.stringify(nextView);
      setDataset(next);setView(nextView);setSelection(EMPTY_SELECTION);setPageFrame(null);setProjectSelectionEpoch(value=>value+1);setRevision(value=>value+1);
      setSharedRevisions(await api.listSharedRevisions(next.id));
      setNotice(language==='en'?'Shared project version loaded.':'Versión compartida cargada.');
    } catch (error) {setError({message:message(error)});}
    finally {setBusy(false);}
  },[api,dataset?.id,language]);
  const open = useCallback(async function openSource(path?: string, sheet?: string, defaultPath?: string, preparedDataset?: Dataset): Promise<boolean> {
    const sequence = ++openSequence.current;
    setOpening(true); setOpenProgress(null); setError(null); setNotice('');
    let retryPath = path;
    try {
      const chosen = path ?? (api.selectDatasetPath ? await api.selectDatasetPath(defaultPath ?? lastOpenPath.current) : undefined);
      if (chosen === null || sequence !== openSequence.current) return false;
      retryPath = chosen;
      const name = chosen?.split(/[\\/]/).pop() || chosen || '';
      setOpenProgress({phase:'selected',name});
      if (chosen && /\.xlsx$/i.test(chosen)) {
        setOpenProgress({phase:'inspect',name});
        const names = await api.listSheets(chosen);
        if (sequence !== openSequence.current) return false;
        if (!sheet || preparedDataset) registerWorkbook(chosen, names);
        sheet ??= names[0];
      }
      const next = preparedDataset ?? await api.openDataset(chosen ? { path: chosen, sheet, onProgress: progress => {
        if (sequence === openSequence.current) setOpenProgress(current => ({ ...current, ...progress, name }));
      } } : undefined);
      if (!next || sequence !== openSequence.current) return false;
      if (api.datasetStorage) void api.datasetStorage(next.id).then(storage => {
        setStorageByTab(current => ({...current,[sourceKey(next.sourcePath,next.sheet)]:storage}));
      }).catch(() => {});
      // Wait for pending writes before restoring this same dataset.
      await saveQueue.current.catch(() => {});
      let restored: ViewState | null = null;
      try { restored = await api.loadView(next.id); } catch (e) { setNotice(`No se pudo restaurar la vista: ${message(e)}`); }
      if (sequence !== openSequence.current) return false;
      const nextView = reconcileView(next, restored);
      if (nextView.presentation) setUiPreferences(nextView.presentation);
      // Opening an existing shared project is read-only. A save here would
      // create a new revision on every Mac and manufacture false conflicts.
      savedView.current = restored ? JSON.stringify(nextView) : '';
      registerDataset(next);
      if (isUserLocalSourcePath(next.sourcePath)) lastOpenPath.current = next.sourcePath;
      setDataset(next); setView(nextView); setPageFrame(null); setSelection(EMPTY_SELECTION); setEditingColumn(null); setRevealRequest(null); setSaveState('Vista guardada'); setSaveWarning(''); setRevision(r => r + 1);
      return true;
    } catch (e) { if (sequence === openSequence.current) setError({ message: message(e), retry: () => { void openSource(retryPath, sheet, defaultPath); } }); return false; }
    finally { if (sequence === openSequence.current) {setOpening(false);setOpenProgress(null);} }
  }, [api, registerWorkbook, registerDataset]);
  const closeTab = async (tab: DatasetTab) => {
    if (opening) return;
    if (dataset && tab.key === sourceKey(dataset.sourcePath, dataset.sheet)) {
      const index = tabs.findIndex(item => item.key === tab.key);
      const next = tabs[index + 1] ?? tabs[index - 1];
      if (next) { if (!await open(next.path, next.sheet)) return; }
      else {
        const sequence = ++openSequence.current;
        setOpening(true);
        await saveQueue.current.catch(() => {});
        if (sequence !== openSequence.current) return;
        setDataset(null); setView(null); setPageFrame(null); setSelection(EMPTY_SELECTION); setOpening(false);
      }
    }
    removeTab(tab.key);
  };
  useEffect(() => {
    if (!api.onOpenFiles) return;
    let disposed = false; let unsubscribe: (() => void) | undefined;
    void api.onOpenFiles(batch => {
      openedFileQueue.current = openedFileQueue.current.then(async () => {
        if (disposed) return;
        if (batch.errors.length) setError({ message: batch.errors.join('\n') });
        for (const path of batch.paths) {
          if (disposed) return;
          await open(path);
        }
      });
    }).then(fn => { if (disposed) fn(); else unsubscribe = fn; }).catch(e => { if (!disposed) setError({ message: message(e) }); });
    return () => { disposed = true; unsubscribe?.(); };
  }, [api, open]);
  useEffect(() => {
    if (!api.getLastSource) return;
    let cancelled = false;
    // StrictMode may read twice; only the live effect may open, and a user's
    // explicit open/drop always takes precedence over a late restoration.
    void api.getLastSource().then(source => {
      const remembered = rememberedWorkspaceSource();
      const restore = remembered === undefined ? source : remembered;
      if (!cancelled && restore && openSequence.current === 0) void open(restore.path, restore.sheet);
    }).catch(e => { if (!cancelled && openSequence.current === 0) setNotice(`No se pudo recuperar el último archivo: ${message(e)}`); });
    return () => { cancelled = true; };
  }, [api, open]);
  useEffect(() => {
    if (!api.onFileDrop) return;
    let disposed = false; let unsubscribe: (() => void) | undefined;
    void api.onFileDrop(path => { if (!disposed) void open(path); }).then(fn => { if (disposed) fn(); else unsubscribe = fn; }).catch(e => { if (!disposed) setError({ message: message(e) }); });
    return () => { disposed = true; unsubscribe?.(); };
  }, [api, open]);
  const displayDataset = useMemo(() => !dataset || !view ? null : { ...dataset, columns: dataset.columns.map(column => ({ ...column, originalName: view.variablePanel.metadata?.[column.id]?.originalName ?? column.name, name: view.variablePanel.metadata?.[column.id]?.name || column.name })) }, [dataset, view?.variablePanel.metadata]);
  const originalColumnNames = useMemo(() => Object.fromEntries(dataset?.columns.map(column => [column.id, view?.variablePanel.metadata?.[column.id]?.originalName ?? column.name]) ?? []), [dataset?.columns, view?.variablePanel.metadata]);
  const visibleColumns = useMemo(() => !displayDataset || !view ? [] : view.columns.order.filter(id => !view.columns.hidden.includes(id)).map(id => displayDataset.columns.find(c => c.id === id)!).filter(Boolean), [displayDataset, view?.columns.order, view?.columns.hidden]);
  tableGeometry.current = { columns: visibleColumns, widths: view?.columns.widths ?? {} };
  const tableWindow = useMemo(() => tableColumnWindow(visibleColumns, view?.columns.widths ?? {}, viewport.datasetId === dataset?.id ? viewport.left : 0, viewport.width), [visibleColumns, view?.columns.widths, viewport, dataset?.id]);
  const columnIds = JSON.stringify(visibleColumns.slice(tableWindow.start, tableWindow.end).map(c => c.id));
  const filtersKey = JSON.stringify(view?.filters ?? []);
  const sortingKey = JSON.stringify(view?.sorting ?? []);
  const pageSource = JSON.stringify([dataset?.id, dataset?.revision, revision]);
  const populationKey = JSON.stringify([pageSource, filtersKey, sortingKey, offset]);
  const pageKey = JSON.stringify([populationKey, columnIds]);
  const pageCache = useMemo(() => new Map<string, TablePageFrame>(), [api, pageSource]);
  const latestPageFrame = useRef(pageFrame); latestPageFrame.current = pageFrame;
  const page = pageFrame?.api === api && pageFrame.source === pageSource ? pageFrame.page : null;
  const currentPage = page && tablePageCovers(pageFrame, populationKey, JSON.parse(columnIds)) ? page : null;
  const displayedOffset = page ? pageFrame!.offset : offset;
  const tableStale = !!page && !currentPage;
  const tableBusy = !currentPage && pageErrorKey !== pageKey;
  const datasetColumnIds = useMemo(() => new Set(dataset?.columns.map(column => column.id)), [dataset?.columns]);
  const statisticIds = JSON.stringify((view?.variablePanel.statistics ?? []).filter(id => visibleVariables.includes(id)).sort());
  const samplingKey = JSON.stringify(normalizeSampling(view?.analysisSampling));
  const panelVisible = expanded || showVariables;
  const distributionColumns = useMemo(() => [...new Set([
    ...(panelVisible ? visibleVariables : []),
    ...(!plots && !expanded ? visibleColumns.slice(tableWindow.start, tableWindow.end).filter(column => isCategoricalKind(column.kind)).map(column => column.id) : []),
  ])].filter(id => datasetColumnIds.has(id)), [panelVisible, visibleVariables, plots, expanded, visibleColumns, tableWindow.start, tableWindow.end, datasetColumnIds]);
  const { distributions, distributionsFiltered, chartsBusy, chartsStale } = useDistributions({
    api, datasetId: dataset?.id, revision: `${dataset?.revision}:${revision}`,
    columns: distributionColumns, filters: view?.filters ?? [],
    sampling: JSON.parse(samplingKey), statistics: JSON.parse(statisticIds), enabled: panelVisible || (!plots && !expanded),
    onError: e => setError({ message: `No se pudieron calcular las distribuciones: ${message(e)}`, retry: () => setRevision(r => r + 1) }),
  });
  const categoryRanks = useMemo(() => {
    const columns = new Map(dataset?.columns.map(column => [column.id, column]));
    return new Map((distributions?.variables ?? []).flatMap(distribution => {
      const column = columns.get(distribution.column);
      return column && isCategoricalKind(column.kind)
        ? [[column.id, categoryColorRanks(distribution.bins, column.spss?.missingValues)] as const]
        : [];
    }));
  }, [dataset?.columns, distributions?.variables]);
  const hasFilters = (view?.filters.length ?? 0) > 0;
  const statisticKey = JSON.stringify([dataset?.id, dataset?.revision, revision, statisticIds, samplingKey]);
  useLayoutEffect(() => {
    if (!dataset || !view) return;
    let cancelled = false;
    setPageErrorKey(null); setError(null);
    const columns: string[] = JSON.parse(columnIds);
    const cached = pageCache.get(populationKey);
    if (tablePageCovers(cached, populationKey, columns)) { setPageFrame(cached!); setBusy(false); return; }
    setBusy(true);
    // Coalesce quick horizontal movement. Existing cells keep their DOM throughout.
    const timer = window.setTimeout(() => {
      void pageQueryQueue.current(async () => {
        // An overlapping projection may have completed while this request was queued.
        const cached = pageCache.get(populationKey);
        if (tablePageCovers(cached, populationKey, columns)) return cached!;
        const missing = columns.filter(id => !cached?.columns.includes(id));
        const request = { datasetId: dataset.id, columns: missing, filters: JSON.parse(filtersKey), sorting: JSON.parse(sortingKey), offset, limit: PAGE_SIZE };
        let result = await api.queryPage(request);
        let fetched = missing;
        if (cached && cached.page.datasetRevision !== result.datasetRevision && missing.length < columns.length) {
          // Never combine projections from different native revisions.
          result = await api.queryPage({ ...request, columns }); fetched = columns;
        }
        const frame = nextTablePageFrame(cached ?? latestPageFrame.current, { api, source: pageSource, key: populationKey, offset, columns: fetched }, result, columns);
        pageCache.delete(populationKey); pageCache.set(populationKey, frame);
        while (pageCache.size > 3) pageCache.delete(pageCache.keys().next().value!);
        return frame;
      }, () => cancelled).then(frame => {
        if (!frame || cancelled) return;
        const result = frame.page;
        if (result.filteredCount !== null && offset >= result.filteredCount && offset > 0) { setView(v => v ? { ...v, workspace: { ...v.workspace!, pageOffset: Math.max(0, Math.ceil(result.filteredCount! / PAGE_SIZE) - 1) * PAGE_SIZE } } : v); return; }
        setPageFrame(frame);
      }).catch(e => { if (!cancelled) { setPageErrorKey(pageKey); setError({ message: `No se pudieron consultar las filas: ${message(e)}`, retry: () => setRevision(r => r + 1) }); } }).finally(() => { if (!cancelled) setBusy(false); });
    }, 50);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [api, pageKey]);
  useEffect(() => {
    if (!dataset || !panelVisible || !hasFilters) return;
    const ids: string[] = JSON.parse(statisticIds);
    if (!ids.length) return;
    let cancelled = false;
    void queryDistributions(api, dataset.id, ids, [], () => cancelled, { sampling: JSON.parse(samplingKey), statistics: ids, revision: `${dataset.revision}:${revision}` }).then(result => {
      if (!cancelled && result) setUnfilteredStatistics({ key: statisticKey, values: Object.fromEntries(result.variables.filter(variable => variable.statistics).map(variable => [variable.column, variable.statistics!])) });
    }).catch(e => { if (!cancelled) setError({ message: `No se pudieron calcular las estadísticas generales: ${message(e)}`, retry: () => setRevision(r => r + 1) }); });
    return () => { cancelled = true; };
  }, [api, dataset?.id, statisticIds, statisticKey, samplingKey, panelVisible, hasFilters]);
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
      const saved = await api.saveView(id, view);
      if (activeDatasetId.current === id && pendingViews.current.get(id) === serialized) {
        setSaveState(saved ? (saved.besideSource ? 'Guardado junto al archivo' : 'Guardado en este Mac') : 'Vista guardada');
        setSaveWarning(saved?.warning ?? '');
      }
    }).catch(e => { if (activeDatasetId.current === id && pendingViews.current.get(id) === serialized) { setSaveState('Vista sin guardar'); setSaveWarning(''); setError({ message: `No se pudo guardar la vista: ${message(e)}`, retry: () => { savedView.current = ''; setView(v => v ? { ...v } : null); } }); } });
  }, [api, dataset?.id, view]);
  const onView = useCallback((update: (view: ViewState) => ViewState) => setView(current => current ? update(current) : null), []);
  const presentation=projectPresentation({colorCategoricalCells,categoryChartMode,showAnalyticalRole,defaultCategoryPalette});
  const presentationKey=JSON.stringify(presentation);
  const priorPresentation=useRef(presentationKey);
  useEffect(()=>{
    if (priorPresentation.current===presentationKey)return;
    priorPresentation.current=presentationKey;
    onView(current=>({...current,presentation}));
  },[presentationKey,onView]);
  const openInPlot = useCallback((column: Dataset['columns'][number]) => {
    if (!dataset) return;
    const kind = column.kind === 'date' ? 'line' : 'bar';
    onView(current => {
      const workspace = current.plots ?? freshWorkspace();
      const draft = defaultConfig(kind, dataset.columns, [column.id]);
      draft.theme = resolvedTheme;
      draft.background = resolvedTheme === 'dark' ? '#202223' : '#ffffff';
      return { ...current, workspace: { ...current.workspace!, mode: 'plots', variablesVisible: false }, plots: { ...workspace, staged: [column.id], draft, activeId: undefined } };
    });
  }, [dataset, onView, resolvedTheme]);
  const locateVariable = useCallback((column: string) => {
    onView(current => ({ ...current, workspace: { ...current.workspace!, mode: 'table', variablesVisible: true } }));
    setRevealRequest(current => ({ column, token: (current?.token ?? 0) + 1 }));
  }, [onView]);
  const analysis = useVariableAnalysis({
    api, dataset, view, opening, onView,
    beforeCast: () => saveQueue.current,
    onCast: (result, column) => {
      if (activeDatasetId.current !== result.dataset.id) return;
      setDataset(result.dataset);
      setView(current => current ? { ...reconcileView(result.dataset, current), filters: current.filters.filter(filter => filter.column !== column), workspace: { ...current.workspace!, pageOffset: 0 } } : current);
      setPageFrame(null); setSelection(EMPTY_SELECTION); setRevision(r => r + 1);
      setSaveWarning(result.save.warning ?? '');
      setSaveState(result.save.besideSource ? 'Guardado junto al archivo' : 'Guardado en este Mac');
    },
  });
  const setOffset = (update: (offset: number) => number) => onView(v => ({ ...v, workspace: { ...v.workspace!, pageOffset: update(v.workspace?.pageOffset ?? 0) } }));
  const sortReorder = usePointerReorder(view?.sorting.map(r => r.id) ?? [], (source, target) => onView(v => ({ ...v, sorting: moveItem(v.sorting, v.sorting.findIndex(r => r.id === source), v.sorting.findIndex(r => r.id === target)) })));
  useEffect(() => {
    if (!expanded && !plots) return;
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && !(e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]')) && !document.querySelector('dialog[open]')) onView(v => ({ ...v, workspace: { ...v.workspace!, mode: 'table' } }));
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [expanded, plots, onView]);
  const onFilter = useCallback((id: string, filter?: Filter) => {
    onView(current => ({ ...current, workspace: { ...current.workspace!, pageOffset: 0 }, filters: [...current.filters.filter(f => f.column !== id), ...(filter ? [filter] : [])], variablePanel: filter ? { ...current.variablePanel, relative: true } : current.variablePanel }));
  }, [onView]);
  const onDataChanged = useCallback((): void => {
    setRevision(r => r + 1);
    const refresh = (api as DesktopApi & { getDataset?: (id: string) => Promise<Dataset> }).getDataset;
    if (dataset && refresh) void refresh(dataset.id).then(next => { if (activeDatasetId.current !== next.id) return; setDataset(next); setView(current => current ? reconcileView(next, current) : current); }).catch(e => { if (activeDatasetId.current === dataset.id) setError({ message: message(e), retry: onDataChanged }); });
  }, [api, dataset]);
  const copy = useCallback(async function copy(): Promise<void> {
    if (!currentPage || busy || !dataset || !view) return;
    try {
      // Row/range selection can include offscreen columns. Fetch those explicitly
      // in bounded projections rather than silently copying missing cells as null.
      const needed = selection.rowIds.length ? visibleColumns : visibleColumns.filter(column => selection.cells.some(cell => cell.columnId === column.id));
      const rows = currentPage.rows.map(row => ({ ...row, values: { ...row.values } }));
      const missing = needed.filter(column => rows.some(row => !(column.id in row.values)));
      for (let index = 0; index < missing.length; index += 16) {
        const result = await pageQueryQueue.current(() => api.queryPage({ datasetId: dataset.id, columns: missing.slice(index, index + 16).map(column => column.id), filters: view.filters, sorting: view.sorting, offset, limit: PAGE_SIZE }), () => false);
        if (!result || result.datasetRevision !== currentPage.datasetRevision) throw new Error('Dataset changed while copying');
        const byId = new Map(result.rows.map(row => [row.id, row.values]));
        for (const row of rows) { const values = byId.get(row.id); if (!values) throw new Error('Dataset changed while copying'); Object.assign(row.values, values); }
      }
      await navigator.clipboard.writeText(selectionTSV(rows, visibleColumns, selection)); setNotice('Valores de la selección visible copiados.'); } catch (e) { setError({ message: `No se pudo copiar: ${message(e)}`, retry: () => { void copy(); } }); }
  }, [api, currentPage, busy, dataset, view, selection, visibleColumns, offset]);
  const editTableColumn = useCallback((column: Dataset['columns'][number]) => setEditingColumn(dataset?.columns.find(item => item.id === column.id) ?? column), [dataset?.columns]);
  const exportFile = async (format: 'csv' | 'parquet'): Promise<void> => {
    if (!dataset || !view) return;
    try { setNotice('Exportando…'); const path = await api.exportDataset({ datasetId: dataset.id, format, filters: view.filters, sorting: view.sorting, columns: visibleColumns.map(c => c.id) }); setNotice(path ? `Exportado: ${path}` : 'Exportación cancelada.'); } catch (e) { setError({ message: message(e), retry: () => { void exportFile(format); } }); setNotice(''); }
  };
  const count = page?.filteredCount;
  const activeStorage = dataset ? storageByTab[sourceKey(dataset.sourcePath,dataset.sheet)] : undefined;
  const openingLabel = openProgress ? ({selected:['Archivo seleccionado','File selected'],inspect:['Inspeccionando archivo','Inspecting file'],download:['Descargando archivo','Downloading file'],import:['Importando datos a la caché local','Importing data into local cache'],prepare:['Preparando columnas y filas','Preparing columns and rows'],restore:['Restaurando resultados guardados','Restoring saved results'],ready:['Finalizando apertura','Finishing opening']} as const)[openProgress.phase][language === 'en' ? 1 : 0] : '';
  const analysisDeferred = distributions?.deferredReason === 'remote_source';
  const variablesPanel = dataset && view ? <Variables api={api} dataset={dataset} key={`variables-${dataset.id}`} onVisibleColumns={onVisibleVariables} analysisDeferred={analysisDeferred} samplingControl={<SampleControl value={JSON.parse(samplingKey)} result={distributions} busy={chartsBusy} totalRows={dataset.rowCount ?? 0} onChange={analysisSampling => onView(v => ({ ...v, analysisSampling }))} />} typeOverrides={dataset.typeOverrides} onCast={analysis.openCast} onClassify={analysis.openClassify} onOpenPlot={openInPlot} revealRequest={revealRequest} expanded={expanded} columns={dataset.columns} view={view} distributions={distributions?.variables ?? []} backgroundStatistics={unfilteredStatistics?.key === statisticKey ? unfilteredStatistics.values : {}} analyzedRows={distributions?.analyzedRows ?? 0} selectedRows={distributions?.selectedCount ?? 0} totalRows={distributions?.analyzedRows ?? 0} busy={chartsBusy} stale={chartsStale} distributionsFiltered={distributionsFiltered} onView={onView} onFilter={onFilter} /> : null;
  return <main className="dl-explorer" onDragOver={e => { e.preventDefault(); }} onClick={event => {
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!(link instanceof HTMLAnchorElement) || !api.openExternalUrl || !['https:', 'http:'].includes(link.protocol)) return;
    event.preventDefault();
    void api.openExternalUrl(link.href).catch(e => setError({ message: message(e) }));
  }}>
    <WorkspaceBar api={api} tabs={tabs} dataset={dataset} opening={opening} storageByTab={storageByTab} onOpenSettings={onOpenSettings} onOpen={(path, sheet) => { void open(path, sheet); }} onAdd={() => { void open(); }} onClose={tab => { void closeTab(tab); }} onResult={async result => { if (!await open(result.sourcePath, result.sheet, undefined, result)) throw new Error(language === 'en' ? 'Could not activate the imported dataset.' : 'No se pudo activar el dataset importado.'); }} />
    {opening && openProgress && <div className="dl-open-progress" role="status" aria-live="polite"><div className="dl-open-progress-head"><strong>{openingLabel}</strong><span title={openProgress.name}>{openProgress.name}</span></div><progress aria-label={openingLabel} value={openProgress.totalBytes && openProgress.receivedBytes !== undefined ? openProgress.receivedBytes : undefined} max={openProgress.totalBytes || undefined}/><small>{openProgress.totalBytes && openProgress.receivedBytes !== undefined ? `${fileSize(openProgress.receivedBytes,locale)} / ${fileSize(openProgress.totalBytes,locale)} · ` : ''}{openProgress.sourceBytes != null ? `${language === 'en' ? 'Source file' : 'Archivo original'}: ${fileSize(openProgress.sourceBytes,locale)} · ` : ''}{language === 'en' ? 'The local cache size appears when opening finishes.' : 'El tamaño de la caché local aparecerá al terminar.'}</small></div>}
    {analysis.dialog}{error && <div className="dl-banner dl-error" role="alert"><span>{t(error.message)}</span>{error.retry && <button disabled={opening} onClick={() => { setError(null); error.retry?.(); }}>{t("Reintentar")}</button>}<button aria-label={t("Cerrar error")} onClick={() => setError(null)}>×</button></div>}{notice && <div className="dl-banner" role="status"><span>{t(notice)}</span><button aria-label={t("Cerrar aviso")} onClick={() => setNotice('')}>×</button></div>}
    {saveWarning && <div className="dl-banner" role="status"><span>{t(saveWarning)}</span><button disabled={opening || saveState === 'Guardando vista…'} onClick={() => { savedView.current = ''; setView(v => v ? { ...v } : null); }}>{t("Guardar junto al original")}</button></div>}
    {sharedRevisions.some(item=>item.head&&!item.active) && <div className="dl-banner" role="status"><span>{language==='en'?'Another shared project version is available. Choose which one to continue.':'Hay otra versión del proyecto compartido. Elige con cuál continuar.'}</span>{sharedRevisions.filter(item=>item.head).map(item=><button key={item.id} disabled={busy || opening || item.active} onClick={()=>void chooseSharedRevision(item.id)}>{item.active?(language==='en'?'Current version':'Versión actual'):`${new Date(item.savedAtMs).toLocaleString(locale)} · ${item.id.slice(4,12)}`}</button>)}</div>}
    {!dataset || !view ? <section className="dl-empty"><div className="dl-empty-glyph">▦</div><h1>{t("Explora tus datos.")}<br /><span>{t("Desde tu Mac.")}</span></h1><p>{t("Abre un archivo para filtrar, comparar variables")}<br />{t("y enriquecer las filas que elijas.")}</p><button className="dl-primary" onClick={() => void open()} disabled={opening}>{opening ? t('Preparando tabla…') : t('Abrir archivo')}</button><small>CSV · XLSX · Parquet · SAV</small>{api.onFileDrop && <p className="dl-drop-hint">{t("También puedes arrastrar aquí un archivo")}</p>}</section> : <>
      <div className="dl-workspace-toolbar"><div className="dl-view-tabs"><button aria-pressed={!expanded && !plots} onClick={() => onView(v => ({ ...v, workspace: { ...v.workspace!, mode: 'table' } }))}>{t("▤ Tabla")}</button><button aria-pressed={expanded} title={t("Explorar variables a pantalla completa")} onClick={() => onView(v => ({ ...v, workspace: { ...v.workspace!, mode: 'variables' } }))}>{t("▦ Explorar")}</button><button aria-pressed={plots} onClick={() => onView(v => ({ ...v, workspace: { ...v.workspace!, mode: 'plots' } }))}>{t("▥ Gráficos")}</button>{!expanded && <button aria-pressed={showVariables} title={t("Mostrar u ocultar el panel de variables")} onClick={() => onView(v => ({ ...v, workspace: { ...v.workspace!, variablesVisible: !showVariables } }))}>{t("☷ Variables")}</button>}<span className="dl-toolbar-divider" /><span className="dl-count">{count === null || count === undefined ? '…' : count.toLocaleString(locale)} <span>{t("de ")}{dataset.rowCount?.toLocaleString(locale) ?? '…'}{t(" filas")}</span></span></div><div className="dl-table-actions"><button disabled={opening} onClick={analysis.openFilter}>{t("✧ Filtrar con IA")}</button><details className="dl-popover" onToggle={event => setColumnsOpen(event.currentTarget.open)}><summary>{t("Columnas ")}<span>{visibleColumns.length}</span></summary>{columnsOpen && <ColumnMenu columns={displayDataset?.columns ?? []} view={view} search={columnSearch} onSearch={setColumnSearch} onView={onView} />}</details><details className="dl-popover"><summary>{t("Exportar ↗")}</summary><div className="dl-export-menu"><button onClick={() => void exportFile('csv')}>{t("CSV · vista filtrada")}</button><button onClick={() => void exportFile('parquet')}>{t("Parquet · vista filtrada")}</button></div></details>{renderEnrichmentPanel && <button className={showEnrichments ? 'dl-primary' : ''} aria-pressed={showEnrichments} onClick={() => onView(v => ({ ...v, workspace: { ...v.workspace!, enrichmentsVisible: !showEnrichments, mode: 'table' } }))}>{t("✧ Enriquecer")}</button>}</div></div>
      {(view.filters.length > 0 || view.sorting.length > 0) && <div className="dl-filter-bar">{view.filters.map(filter => { const column = displayDataset?.columns.find(c => c.id === filter.column); return <button className="dl-filter-chip" key={filter.column} title={`${JSON.stringify(filter)}${column?.originalName && column.originalName !== column.name ? `\n${t('Columna original: {value0}', { value0: column.originalName })}` : ''}`} onClick={() => onFilter(filter.column)}>{column?.name} · {'selected' in filter ? filter.selected.join(', ') : filter.kind === 'numeric' ? `${filter.min?.toLocaleString(locale, { maximumSignificantDigits: 6 }) ?? '−∞'} – ${filter.max?.toLocaleString(locale, { maximumSignificantDigits: 6 }) ?? '∞'}` : filter.kind === 'date' ? `${filter.start?.slice(0, 10) ?? '…'} – ${filter.end?.slice(0, 10) ?? '…'}` : filter.terms.join(', ')} <span>×</span></button>; })}{view.filters.length > 0 && <button className="dl-link" onClick={() => { onView(v => ({ ...v, workspace: { ...v.workspace!, pageOffset: 0 }, filters: [] })); }}>{t("Limpiar filtros")}</button>}{view.sorting.length > 0 && <div className="dl-sort-rules" ref={sortReorder.root}><span>{t("Orden")}</span>{view.sorting.map((rule, index) => { const column = displayDataset?.columns.find(c => c.id === rule.id); return <div className={`dl-sort-rule ${sortReorder.className(rule.id)}`} key={rule.id} data-reorder-id={rule.id}><button className="dl-grip" aria-label={t("Reordenar prioridad {value0}", { value0: index + 1 })} title={t("Arrastra o usa las flechas para cambiar la prioridad")} {...sortReorder.handle(rule.id)}>⠿ {index + 1}</button><button title={column?.originalName && column.originalName !== column.name ? t('Columna original: {value0}', { value0: column.originalName }) : column?.name} onClick={() => onView(v => ({ ...v, sorting: v.sorting.map(r => r.id === rule.id ? { ...r, desc: !r.desc } : r) }))}>{column?.name} {rule.desc ? '↓' : '↑'}</button><button aria-label={t("Quitar orden {value0}", { value0: rule.id })} onClick={() => onView(v => ({ ...v, sorting: v.sorting.filter(r => r.id !== rule.id) }))}>×</button></div>; })}</div>}</div>}
      {plots ? <div key={dataset.id} className="dl-workspace">{showVariables && variablesPanel}<PlotsPanel key={`plots-${dataset.id}`} api={api} dataset={displayDataset ?? dataset} filters={view.filters} value={view.plots} onChange={plots => onView(v => ({ ...v, plots }))} onFilter={onFilter} revision={revision} /></div> : <div key={dataset.id} className={`dl-workspace${expanded ? " dl-workspace-expanded" : ""}`}>{(expanded || showVariables) && variablesPanel}{!expanded && <section className="dl-table-region"><DataTable key={dataset.id} categoryPalettes={view.categoryPalettes} categoryColors={view.categoryColors} categoryRanks={categoryRanks} datasetId={dataset.id} window={tableWindow} onViewport={onTableViewport} columns={visibleColumns} originalNames={originalColumnNames} page={page} widths={view.columns.widths} sorting={view.sorting} busy={tableBusy} stale={tableStale} selection={selection} onSelection={setSelection} onView={onView} onLocateVariable={locateVariable} onOpenPlot={openInPlot} onEditVariable={editTableColumn} offset={displayedOffset} onCopy={copy} /><footer className="dl-table-footer"><div>{selection.cells.length || selection.rowIds.length ? <><strong>{selection.cells.length ? t("{value0} celdas", { value0: selection.cells.length.toLocaleString(locale) }) : t("{value0} filas", { value0: selection.rowIds.length.toLocaleString(locale) })}</strong><button disabled={tableBusy || tableStale} onClick={() => void copy()}>{t("Copiar visibles ⌘C")}</button><button onClick={() => setSelection(EMPTY_SELECTION)}>{t("Limpiar selección")}</button></> : <span>{t("Clic selecciona · ⇧ rango · ⌘ selección múltiple")}</span>}</div><div className="dl-pagination"><span>{page?.rows.length ? displayedOffset + 1 : 0}–{displayedOffset + (page?.rows.length ?? 0)}</span><button disabled={tableBusy || tableStale || offset === 0} onClick={() => setOffset(n => Math.max(0, n - PAGE_SIZE))} aria-label={t("Página anterior")}>←</button><button disabled={tableBusy || tableStale || (count !== null && count !== undefined ? offset + PAGE_SIZE >= count : (page?.rows.length ?? 0) < PAGE_SIZE)} onClick={() => setOffset(n => n + PAGE_SIZE)} aria-label={t("Página siguiente")}>→</button></div></footer>{distributions?.sampled && !analysisDeferred && <div className="dl-sample-note">{t("Distribuciones calculadas sobre una muestra de ")}{distributions.analyzedRows.toLocaleString(locale)}{t(" filas. La tabla consulta todo el archivo.")}</div>}</section>}{renderEnrichmentPanel && <aside className="dl-enrichment-slot" hidden={expanded || !showEnrichments}><Fragment key={projectSelectionEpoch}>{renderEnrichmentPanel({ dataset, selection, filters: view.filters, onDataChanged })}</Fragment></aside>}</div>}
      {editingColumn && <VariableDetailsDialog key={editingColumn.id} column={editingColumn} view={view} onView={onView} onClose={() => setEditingColumn(null)} />}
    </>}
  </main>;
}
