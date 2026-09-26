import { useI18n } from '../../ui';
import { useMemo, useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import { useVariableWindow } from './useVariableWindow';
import { usePointerReorder } from './usePointerReorder';
import type { Column, Dataset, DesktopApi, Distribution, Filter, VariableKind, ViewState } from '../../contracts/desktop-api';
import type { VariableStatistics } from '../../contracts/analysis';
import { VariableChart } from './VariableChart';
import { kindLabel, kindSymbol, reorderVariables, setVariableText } from './model';
import { ROLE_OPTIONS, variableGroups } from './analysis-model';
import { VariableMenu, VariableRoleControl, VariableStatisticsView, VariableTypeControl } from './VariableAnalysisControls';
import { SignificantVariables } from './SignificantVariables';
import { Caret } from './Caret';
import { CategoryColorDialog } from './CategoryColorDialog';
import { CategoryOrderDialog } from './CategoryOrderDialog';
import { CategorySemanticsDialog } from './CategorySemanticsDialog';
import { CategorySortMenu } from './CategorySortMenu';
import { isCategoricalKind } from './category-colors';
interface Props { api?: DesktopApi; dataset?: Dataset; onVisibleColumns: (ids: string[]) => void; analysisDeferred?: boolean; samplingControl?: ReactNode; expanded?: boolean; columns: Column[]; view: ViewState; distributions: Distribution[]; backgroundStatistics: Record<string, VariableStatistics>; analyzedRows: number; selectedRows: number; totalRows: number; busy: boolean; stale?: boolean; distributionsFiltered?: boolean; typeOverrides?: Record<string, VariableKind>; onCast?: (column: Column, kind: VariableKind | null) => void; onClassify?: () => void; onOpenPlot?: (column: Column) => void; revealRequest?: { column: string; token: number } | null; onView: (update: (view: ViewState) => ViewState) => void; onFilter: (id: string, filter?: Filter) => void }
export function VariableDetailsDialog({ column, view, onView, onClose }: { column: Column; view: ViewState; onView: Props['onView']; onClose: () => void }) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const metadata = view.variablePanel.metadata?.[column.id];
  const originalName = metadata?.originalName ?? column.name;
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="dl-variable-details-dialog" aria-label={t('Editar nombre y descripción')} onClose={onClose}><form onSubmit={event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get('name') ?? '').trim();
    const description = String(data.get('description') ?? '').trim();
    if (!name) return;
    onView(current => setVariableText(current, column, name, description));
    dialog.current?.close();
  }}><h2>{t('Editar nombre y descripción')}</h2><p>{t('Columna original: {value0}', { value0: originalName })}</p><label>{t('Nombre de la variable')}<input name="name" autoFocus required maxLength={120} defaultValue={metadata?.name || originalName} /></label><label>{t('Descripción de la variable')}<textarea name="description" maxLength={1000} rows={4} defaultValue={metadata?.description ?? ''} /></label><div><button type="button" onClick={() => dialog.current?.close()}>{t('Cancelar')}</button><button type="submit" className="dl-primary">{t('Guardar')}</button></div></form></dialog>;
}
function HiddenVariablesDialog({ columns, hidden, onView, onClose }: { columns: Array<Column & { originalName?: string }>; hidden: string[]; onView: Props['onView']; onClose: () => void }) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const hiddenColumns = columns.filter(column => hidden.includes(column.id));
  useEffect(() => { dialog.current?.showModal(); }, []);
  const restore = (id: string) => {
    onView(current => ({ ...current, variablePanel: { ...current.variablePanel, hidden: current.variablePanel.hidden.filter(column => column !== id) } }));
    if (hiddenColumns.length === 1) dialog.current?.close();
  };
  return <dialog ref={dialog} className="dl-hidden-variables-dialog" aria-labelledby="dl-hidden-variables-title" onClose={onClose} onClick={event => { if (event.target === dialog.current) dialog.current?.close(); }}>
    <header><div><h2 id="dl-hidden-variables-title">{t('Variables ocultas')}</h2><p>{hiddenColumns.length} {hiddenColumns.length === 1 ? t('variable oculta') : t('variables ocultas')}</p></div><button type="button" aria-label={t('Cerrar')} onClick={() => dialog.current?.close()}>×</button></header>
    <div className="dl-hidden-variables-list">{hiddenColumns.map(column => <div key={column.id}><span title={column.originalName && column.originalName !== column.name ? t('Columna original: {value0}', { value0: column.originalName }) : column.name}>{column.name}</span><button type="button" onClick={() => restore(column.id)} aria-label={t('Mostrar {value0}', { value0: column.name })}>{t('Mostrar')}</button></div>)}</div>
    <footer><button type="button" className="dl-primary" onClick={() => { onView(current => ({ ...current, variablePanel: { ...current.variablePanel, hidden: [] } })); dialog.current?.close(); }}>{t('Mostrar todas')}</button></footer>
  </dialog>;
}
function HiddenEyeIcon() {
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
    <path d="M3 3l18 18" />
    <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
    <path d="M9.9 5.1A10.7 10.7 0 0 1 12 4.9c4.5 0 8.3 2.8 10 7.1a11.8 11.8 0 0 1-3.1 4.5" />
    <path d="M6.6 6.6A11.8 11.8 0 0 0 2 12c1.7 4.3 5.5 7.1 10 7.1 1.3 0 2.6-.2 3.7-.7" />
  </svg>;
}
function SearchIcon() {
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 5 5" />
  </svg>;
}
function StatisticsIcon() {
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 4H6l6 8-6 8h12" />
  </svg>;
}
function PinIcon() {
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="7" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3" />
  </svg>;
}
function OrderCategoriesIcon() {
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 20V4m0 0L4.5 7.5M8 4l3.5 3.5M16 4v16m0 0-3.5-3.5M16 20l3.5-3.5" />
  </svg>;
}
function PlotIcon() {
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3v18h18M7 16v-5m5 5V7m5 9V4" />
  </svg>;
}
function EditIcon() {
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15zM12 20h8" />
  </svg>;
}
function PaletteIcon() {
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3a9 9 0 1 0 0 18h1.2a2.2 2.2 0 0 0 1.7-3.6 1.8 1.8 0 0 1 1.4-3h1.5A4.2 4.2 0 0 0 22 10.2 9.5 9.5 0 0 0 12 3Z" /><circle cx="7.4" cy="11.5" r=".8" fill="currentColor" stroke="none" /><circle cx="10" cy="7.5" r=".8" fill="currentColor" stroke="none" /><circle cx="15" cy="7.7" r=".8" fill="currentColor" stroke="none" /><circle cx="17.7" cy="11" r=".8" fill="currentColor" stroke="none" />
  </svg>;
}
function MoreVerticalIcon() {
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <circle cx="12" cy="5" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="12" cy="19" r="1.7" />
  </svg>;
}
export function Variables({ api, dataset, onVisibleColumns, analysisDeferred = false, samplingControl, expanded = false, columns, view, distributions, backgroundStatistics, analyzedRows, selectedRows, totalRows, busy, stale = false, distributionsFiltered = view.filters.length > 0, typeOverrides, onCast, onClassify, onOpenPlot, revealRequest, onView, onFilter }: Props) {
  const { t, locale, language, showAnalyticalRole, defaultCategoryPalette } = useI18n();
  const panelRef = useRef<HTMLElement>(null);
  const chartActions = useRef({ onView, onFilter }); chartActions.current = { onView, onFilter };
  const chartOnView = useCallback<Props['onView']>(update => chartActions.current.onView(update), []);
  const chartOnFilter = useCallback<Props['onFilter']>((id, filter) => chartActions.current.onFilter(id, filter), []);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [editing, setEditing] = useState<Column | null>(null);
  const [colorEditing, setColorEditing] = useState<Column | null>(null);
  const [orderEditing, setOrderEditing] = useState<Column | null>(null);
  const [semanticEditing, setSemanticEditing] = useState(false);
  const [showHiddenDialog, setShowHiddenDialog] = useState(false);
  const [searchingColumn, setSearchingColumn] = useState<string | null>(null);
  const [categorySearch, setCategorySearch] = useState<Record<string, string>>({});
  const displayColumns = useMemo(() => columns.map(column => ({ ...column, originalName: view.variablePanel.metadata?.[column.id]?.originalName ?? column.name, name: view.variablePanel.metadata?.[column.id]?.name || column.name })), [columns, view.variablePanel.metadata]);
  const originalNames = useMemo(() => new Map(columns.map(column => [column.id, view.variablePanel.metadata?.[column.id]?.originalName ?? column.name])), [columns, view.variablePanel.metadata]);
  useEffect(() => {
    if (!highlighted) return;
    const frame = requestAnimationFrame(() => panelRef.current?.querySelector<HTMLElement>(`[data-significant-column="${CSS.escape(highlighted)}"]`)?.scrollIntoView({ block: 'center' }));
    const timeout = window.setTimeout(() => setHighlighted(null), 1600);
    return () => { cancelAnimationFrame(frame); window.clearTimeout(timeout); };
  }, [highlighted, view]);
  const reveal = (column: string) => {
    const group = view.variablePanel.metadata?.[column]?.group;
    onView(current => ({ ...current, variablePanel: { ...current.variablePanel, hidden: current.variablePanel.hidden.filter(id => id !== column), search: '', roleFilter: 'all', groupFilter: '', collapsedGroups: current.variablePanel.collapsedGroups?.filter(name => name !== group && name !== 'Fijadas') } }));
    setHighlighted(column);
  };
  useEffect(() => { if (revealRequest) reveal(revealRequest.column); }, [revealRequest?.token]);
  const search = view.variablePanel.search ?? '';
  const groupLabel = (name: string) => (name === 'Fijadas' || name === 'Sin grupo') && !Object.values(view.variablePanel.metadata ?? {}).some(m => m.group === name) ? t(name) : name;
  const grouped = Object.values(view.variablePanel.metadata ?? {}).some(m => !!m.group);
  const groups = useMemo(() => variableGroups(displayColumns, view), [displayColumns, view.variablePanel]);
  const variableCount = groups.reduce((count, group) => count + group.columns.length, 0);
  const visible = groups.flatMap(group => grouped && view.variablePanel.collapsedGroups?.includes(group.name) ? [] : group.columns);
  const groupNames = [...new Set(columns.map(c => view.variablePanel.metadata?.[c.id]?.group || 'Sin grupo'))];
  const reorder = usePointerReorder(visible.map(c => c.id), (source, target) => onView(v => ({ ...v, variablePanel: reorderVariables(v.variablePanel, source, target, visible.map(c => c.id)) })), { preview: true });
  const virtualCards = useVariableWindow(reorder.root, groups, grouped, view.variablePanel.collapsedGroups ?? [], expanded, highlighted, onVisibleColumns);
  const byColumn = useMemo(() => new Map(distributions.map(distribution => [distribution.column, distribution])), [distributions]);
  return <aside ref={panelRef} className={`dl-variables${expanded ? ' dl-variables-expanded' : ''}`} aria-label={t("Panel de variables")}><div className="dl-panel-heading"><strong>{t("Variables ")}<span>{columns.length}</span></strong><label><input type="checkbox" checked={view.variablePanel.relative} onChange={e => onView(v => ({ ...v, variablePanel: { ...v.variablePanel, relative: e.target.checked } }))} /> %</label></div>{samplingControl}{!analysisDeferred && <SignificantVariables columns={displayColumns} distributions={distributions} selectedRows={selectedRows} totalRows={totalRows} view={view} busy={busy} onReveal={reveal} />}<input className="dl-variable-search" placeholder={t("Buscar variable…")} aria-label={t("Buscar variable")} value={search} onChange={e => { const search = e.target.value; onView(v => ({ ...v, variablePanel: { ...v.variablePanel, search } })); }} />
    <div className="dl-variable-filters"><select aria-label={t("Mostrar variables por función")} value={view.variablePanel.roleFilter ?? 'all'} onChange={e => onView(v => ({ ...v, variablePanel: { ...v.variablePanel, roleFilter: e.target.value as typeof v.variablePanel.roleFilter } }))}><option value="all">{t("Todas las funciones")}</option>{ROLE_OPTIONS.map(role => <option key={role.value} value={role.value}>{t(role.label)}</option>)}</select>{(grouped || view.variablePanel.groupFilter) && <select aria-label={t("Mostrar variables por grupo")} value={view.variablePanel.groupFilter ?? ''} onChange={e => onView(v => ({ ...v, variablePanel: { ...v.variablePanel, groupFilter: e.target.value } }))}><option value="">{t("Todos los grupos")}</option>{view.variablePanel.groupFilter && !groupNames.includes(view.variablePanel.groupFilter) && <option value={view.variablePanel.groupFilter}>{view.variablePanel.groupFilter} ({t("sin variables")})</option>}{groupNames.map(name => <option key={name} value={name}>{groupLabel(name)}</option>)}</select>}{onClassify && <button onClick={onClassify} title={t("Clasificar nombres y tipos con IA")}>{t("✧ Clasificar")}</button>}{api && dataset && <button onClick={() => setSemanticEditing(true)} title={language === 'en' ? 'Order and color categories with AI across variables' : 'Ordenar y colorear categorías con IA en lote'}>{language === 'en' ? '✧ Categories' : '✧ Categorías'}</button>}<span className="dl-variable-result-count">{variableCount}{variableCount === 1 ? " variable" : t(" variables")}</span></div>
    {!analysisDeferred && <div className="dl-chart-legend"><span><i />{t("Selección")}</span><span><i />{t("Todo")}</span>{busy ? <span role="status" title={stale ? (language === 'en' ? 'Previous results remain visible while updating.' : 'Los resultados anteriores se conservan mientras se actualizan.') : undefined}>{t("Actualizando…")}</span> : stale && <span role="status">{language === 'en' ? 'Previous results' : 'Resultados anteriores'}</span>}</div>}
    <span className="dl-reorder-status" role="status" aria-live="polite">{reorder.drag && t("Moviendo {value0}. {value1} Escape para cancelar.", { value0: columns.find(c => c.id === reorder.drag!.source)?.name ?? '', value1: reorder.drag.target ? t("Posición {value0} de {value1}. Suelta para colocar.", {value0: visible.findIndex(c => c.id === reorder.drag!.target) + 1, value1: visible.length}) : t("Fuera del panel.") })}</span>
    <div className="dl-variable-list dl-virtual-variables" ref={reorder.root} onScroll={virtualCards.measure} aria-busy={busy} data-stale={stale || undefined}>
      <div aria-hidden="true" style={{ height: virtualCards.before }} />
      {virtualCards.rendered.map(row => <div key={row.key} data-virtual-row={row.key} className="dl-variable-virtual-row" style={{ display: 'grid', minHeight: !row.header && row.columns.some(column => !byColumn.has(column.id)) ? row.height : undefined, gridTemplateColumns: row.header ? '1fr' : `repeat(${virtualCards.lanes}, minmax(0, 1fr))` }}>
        {row.header ? <button className="dl-variable-group" data-reorder-group-header={row.group.name} onClick={() => onView(v => ({ ...v, variablePanel: { ...v.variablePanel, collapsedGroups: v.variablePanel.collapsedGroups?.includes(row.group.name) ? v.variablePanel.collapsedGroups.filter(g => g !== row.group.name) : [...(v.variablePanel.collapsedGroups ?? []), row.group.name] } }))} aria-expanded={!view.variablePanel.collapsedGroups?.includes(row.group.name)}><Caret direction={view.variablePanel.collapsedGroups?.includes(row.group.name) ? 'right' : 'down'} /><span>{groupLabel(row.group.name)}</span><span>{row.group.columns.length}</span></button> : row.columns.map(column => {
      const filter = view.filters.find(f => f.column === column.id);
      const distribution = byColumn.get(column.id);
      const bins = distribution?.bins ?? [];
      const pinned = view.variablePanel.pinned.includes(column.id);
      const searchable = column.kind === 'categorical' || column.kind === 'multivalued' || column.kind === 'text';
      return <section className={`dl-variable ${filter ? 'has-filter' : ''} ${highlighted === column.id ? 'dl-significant-highlight' : ''} ${reorder.className(column.id)}`} key={column.id} data-reorder-id={column.id} data-significant-column={column.id} data-variable-group={grouped ? row.group.name : undefined}>
        <header className={showAnalyticalRole ? undefined : 'dl-variable-role-hidden'}><button className="dl-grip" {...reorder.handle(column.id)} aria-label={t("Reordenar variable {value0}", { value0: column.name })} title={t("Arrastra para reordenar; también puedes usar las flechas del teclado")}>⠿</button>{onCast ? <VariableTypeControl column={column} override={typeOverrides?.[column.id]} onCast={onCast} /> : <span className="dl-type" title={t(kindLabel[column.kind])}>{kindSymbol[column.kind]}</span>}{showAnalyticalRole && <VariableRoleControl column={column} view={view} onView={onView} />}<strong title={originalNames.get(column.id) !== column.name ? t('Columna original: {value0}', { value0: originalNames.get(column.id) ?? column.name }) : column.name}>{column.name}</strong><div className="dl-variable-actions">{searchable && !analysisDeferred && <button className="dl-variable-search-toggle" title={t("Buscar en {value0}", { value0: column.name })} aria-label={t("Buscar en {value0}", { value0: column.name })} aria-expanded={searchingColumn === column.id} aria-controls={`dl-variable-search-${column.id}`} aria-pressed={searchingColumn === column.id || (column.kind === 'text' && filter?.kind === 'text')} onClick={() => { setSearchingColumn(current => current === column.id ? null : column.id); if (column.kind !== 'text') setCategorySearch(current => ({ ...current, [column.id]: '' })); }}><SearchIcon /></button>}{(isCategoricalKind(column.kind) || column.kind === 'text') && !analysisDeferred && <CategorySortMenu column={column} mode={view.variablePanel.sortModeByColumn[column.id] ?? 'everything'} hasManualOrder={!!view.categoryOrders?.[column.id]?.length} onView={onView} />}{isCategoricalKind(column.kind) && !analysisDeferred && <button className="dl-category-color-toggle" title={language === 'en' ? `Edit category colors for ${column.name}` : `Editar colores de categorías de ${column.name}`} aria-label={language === 'en' ? `Edit category colors for ${column.name}` : `Editar colores de categorías de ${column.name}`} aria-pressed={!!Object.keys(view.categoryColors?.[column.id] ?? {}).length || view.categoryPalettes?.[column.id] != null} onClick={() => setColorEditing(columns.find(item => item.id === column.id) ?? column)}><PaletteIcon /></button>}<button className="dl-statistics-toggle" title={t("Estadísticas de {value0}", { value0: column.name })} aria-label={t("Estadísticas de {value0}", { value0: column.name })} aria-pressed={view.variablePanel.statistics?.includes(column.id) ?? false} onClick={() => onView(v => ({ ...v, variablePanel: { ...v.variablePanel, statistics: v.variablePanel.statistics?.includes(column.id) ? v.variablePanel.statistics.filter(id => id !== column.id) : [...(v.variablePanel.statistics ?? []), column.id] } }))}><StatisticsIcon /></button><VariableMenu label={<MoreVerticalIcon />} title={t('Opciones de {value0}', { value0: column.name })} menuClassName={isCategoricalKind(column.kind) ? 'dl-categorical-options-menu' : ''} menuWidth={isCategoricalKind(column.kind) ? 272 : undefined} menuHeight={isCategoricalKind(column.kind) ? 244 : undefined} align="end">{close => <>
          {isCategoricalKind(column.kind) && <button onClick={() => { close(); setOrderEditing(columns.find(item => item.id === column.id) ?? column); }}><OrderCategoriesIcon /><span>{language === 'en' ? 'Order categories…' : 'Ordenar categorías…'}</span></button>}
          <button aria-pressed={pinned} onClick={() => { close(); onView(v => ({ ...v, variablePanel: { ...v.variablePanel, pinned: v.variablePanel.pinned.includes(column.id) ? v.variablePanel.pinned.filter(id => id !== column.id) : [...v.variablePanel.pinned, column.id] } })); }}><PinIcon /><span>{pinned ? t('Desfijar variable') : t('Fijar variable')}</span></button>
          <button onClick={() => { close(); onView(v => ({ ...v, variablePanel: { ...v.variablePanel, hidden: [...v.variablePanel.hidden, column.id] } })); }}><HiddenEyeIcon /><span>{t('Ocultar variable del panel')}</span></button>
          <button onClick={() => { close(); onOpenPlot?.(column); }} disabled={!onOpenPlot}><PlotIcon /><span>{t('Abrir en Gráficos')}</span></button>
          <button onClick={() => { close(); setEditing(columns.find(item => item.id === column.id) ?? null); }}><EditIcon /><span>{t('Editar nombre y descripción')}</span></button>
        </>}</VariableMenu></div></header>
        {searchingColumn === column.id && !analysisDeferred && column.kind !== 'text' && <div className="dl-card-search" id={`dl-variable-search-${column.id}`}><SearchIcon /><input autoFocus type="search" aria-label={t("Buscar en {value0}", { value0: column.name })} placeholder={t("Buscar categoría…")} value={categorySearch[column.id] ?? ''} onChange={event => setCategorySearch(current => ({ ...current, [column.id]: event.target.value }))} onKeyDown={event => { if (event.key === 'Escape') setSearchingColumn(null); }} /></div>}
        {searchingColumn === column.id && !analysisDeferred && column.kind === 'text' && <form className="dl-text-filter dl-card-search" id={`dl-variable-search-${column.id}`} onSubmit={e => { e.preventDefault(); const term = String(new FormData(e.currentTarget).get('term') ?? '').trim(); onFilter(column.id, term ? { column: column.id, kind: 'text', terms: [term], mode: 'any', caseSensitive: false } : undefined); }}><input autoFocus key={filter?.kind === 'text' ? filter.terms.join(' ') : ''} name="term" aria-label={t("Buscar en {value0}", { value0: column.name })} placeholder={t("Contiene texto…")} defaultValue={filter?.kind === 'text' ? filter.terms.join(' ') : ''} onKeyDown={event => { if (event.key === 'Escape') setSearchingColumn(null); }} /><button type="submit" aria-label={t("Aplicar filtro")}>↵</button></form>}
        {view.variablePanel.metadata?.[column.id]?.description && <p className="dl-variable-description">{view.variablePanel.metadata[column.id].description}</p>}
        {!analysisDeferred && view.variablePanel.statistics?.includes(column.id) && <VariableStatisticsView statistics={distribution?.statistics} backgroundStatistics={backgroundStatistics[column.id]} column={column} busy={busy} filtered={distributionsFiltered} filter={filter} onFilter={next => onFilter(column.id, next)} />}
        {!distribution ? <div className="dl-variable-pending" role="status">{language === 'en' ? 'Loading chart…' : 'Cargando gráfico…'}</div> : analysisDeferred ? <small>{language === 'en' ? 'Analysis paused for this remote source.' : 'Análisis en pausa para esta fuente remota.'}</small> : <VariableChart column={column} bins={bins} filter={filter} relative={view.variablePanel.relative} hasSelection={distributionsFiltered} sortMode={view.variablePanel.sortModeByColumn[column.id] ?? 'everything'} analyzedRows={analyzedRows} expanded={view.variablePanel.expanded?.includes(column.id) ?? false} search={searchingColumn === column.id ? categorySearch[column.id] ?? '' : ''} categoryColors={view.categoryColors?.[column.id]} categoryPalette={view.categoryPalettes?.[column.id] ?? defaultCategoryPalette} categoryOrder={view.categoryOrders?.[column.id]} onView={chartOnView} onFilter={chartOnFilter} />}{distribution?.truncated && <small className="dl-category-limit">{t("Primeras ")}{bins.filter(bin => bin.value !== null).length}{t(" categorías por frecuencia")}</small>}{!analysisDeferred && distribution && !busy && bins.length === 0 && <small>{t("Sin valores disponibles")}</small>}{filter && <button className="dl-link" onClick={() => onFilter(column.id)}>{t("Limpiar filtro")}</button>}
      </section>;
    })}</div>)}<div aria-hidden="true" style={{ height: virtualCards.after }} />{groups.length === 0 && <p className="dl-variable-empty">{t("No hay variables que coincidan con la búsqueda y los filtros.")}</p>}</div>{view.variablePanel.hidden.length > 0 && <button className="dl-show-hidden" onClick={() => setShowHiddenDialog(true)}>{t("Mostrar ")}{view.variablePanel.hidden.length} {view.variablePanel.hidden.length === 1 ? t('variable oculta') : t('variables ocultas')}</button>}{showHiddenDialog && <HiddenVariablesDialog columns={displayColumns} hidden={view.variablePanel.hidden} onView={onView} onClose={() => setShowHiddenDialog(false)} />}{editing && <VariableDetailsDialog key={editing.id} column={editing} view={view} onView={onView} onClose={() => setEditing(null)} />}{colorEditing && <CategoryColorDialog key={colorEditing.id} column={colorEditing} bins={byColumn.get(colorEditing.id)?.bins ?? []} truncated={byColumn.get(colorEditing.id)?.truncated} api={api} dataset={dataset} paletteId={view.categoryPalettes?.[colorEditing.id]} overrides={view.categoryColors?.[colorEditing.id]} onView={onView} onClose={() => setColorEditing(null)} />}
    {orderEditing && <CategoryOrderDialog key={orderEditing.id} column={orderEditing} bins={byColumn.get(orderEditing.id)?.bins ?? []} truncated={byColumn.get(orderEditing.id)?.truncated} view={view} api={api} dataset={dataset} onView={onView} onClose={() => setOrderEditing(null)} />}
    {semanticEditing && api && dataset && <CategorySemanticsDialog api={api} dataset={dataset} columns={columns} view={view} onView={onView} onClose={() => setSemanticEditing(false)} />}
  </aside>;
}
