import { useI18n } from '../../ui';
/** Local paginated data table with no feed or cloud dependencies. */
import { memo, useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import type { TableColumnWindow } from './table-window';
import type { Column, Page, ViewState } from '../../contracts/desktop-api';
import { usePointerReorder } from './usePointerReorder';
import { VariableMenu } from './VariableAnalysisControls';
import { TableRows, type CategoryRanksByColumn } from './TableRows';
import { cellKey, kindLabel, kindSymbol, moveItem, rectangularCells, type CellId, type ExplorerSelection } from './model';

const EMPTY_ROWS: NonNullable<Page>['rows'] = [];
function cellAt(target: EventTarget | null): CellId | null {
  const element = target instanceof Element ? target.closest<HTMLElement>('td[data-row-id][data-column-id]') : null;
  return element ? { rowId: element.dataset.rowId!, columnId: element.dataset.columnId! } : null;
}
interface Props { datasetId: string; window: TableColumnWindow; onViewport: (datasetId: string, left: number, width: number) => void; columns: Column[]; originalNames?: Record<string, string>; page: Page | null; categoryColors?: ViewState['categoryColors']; categoryPalettes?: ViewState['categoryPalettes']; categoryRanks?: CategoryRanksByColumn; widths: ViewState['columns']['widths']; sorting: ViewState['sorting']; busy: boolean; stale: boolean; selection: ExplorerSelection; onSelection: (selection: ExplorerSelection) => void; onView: (update: (view: ViewState) => ViewState) => void; onLocateVariable: (id: string) => void; onOpenPlot: (column: Column) => void; onEditVariable: (column: Column) => void; offset: number; onCopy: () => void }
export const DataTable = memo(function DataTable({ datasetId, window: columnWindow, onViewport, columns, originalNames, page, categoryColors, categoryPalettes, categoryRanks, widths, sorting, busy, stale, selection, onSelection, onView, onLocateVariable, onOpenPlot, onEditVariable, offset, onCopy }: Props) {
  const { t, language, colorCategoricalCells } = useI18n();
  const anchor = useRef<CellId | null>(null);
  const dragging = useRef(false);
  const scrollFrame = useRef(0);
  const reorder = usePointerReorder(columns.map(c => c.id), (source, target) => onView(v => ({ ...v, columns: { ...v.columns, order: moveItem(v.columns.order, v.columns.order.indexOf(source), v.columns.order.indexOf(target)) } })));
  const renderedColumns = useMemo(() => columns.slice(columnWindow.start, columnWindow.end), [columns, columnWindow.start, columnWindow.end]);
  useLayoutEffect(() => {
    const element = reorder.root.current;
    if (!element) return;
    const measure = () => onViewport(datasetId, element.scrollLeft, element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure); observer.observe(element);
    return () => { observer.disconnect(); cancelAnimationFrame(scrollFrame.current); scrollFrame.current = 0; };
  }, [datasetId, onViewport, columns, widths]);
  const onScroll = () => {
    if (scrollFrame.current) return;
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = 0;
      const element = reorder.root.current;
      if (element) onViewport(datasetId, element.scrollLeft, element.clientWidth);
    });
  };
  const rows = page?.rows ?? EMPTY_ROWS;
  const blocked = busy || stale;
  const interaction = useRef({ rows, columns, selection, blocked }); interaction.current = { rows, columns, selection, blocked };
  const selectedCells = useMemo(() => new Set(selection.cells.map(cellKey)), [selection.cells]);
  const selectedRows = useMemo(() => new Set(selection.rowIds), [selection.rowIds]);
  const cellsByRow = useMemo(() => {
    const byRow = new Map<string, Set<string>>();
    for (const cell of selection.cells) { if (!byRow.has(cell.rowId)) byRow.set(cell.rowId, new Set()); byRow.get(cell.rowId)!.add(cell.columnId); }
    return byRow;
  }, [selection.cells]);
  const rowLabel = useCallback((number: number) => t('Seleccionar fila {value0}', { value0: number }), [t]);
  const onRowSelection = useCallback((id: string, checked: boolean) => {
    const { blocked, selection } = interaction.current;
    if (!blocked) onSelection({ cells: [], rowIds: checked ? [...new Set([...selection.rowIds, id])] : selection.rowIds.filter(rowId => rowId !== id) });
  }, [onSelection]);
  useLayoutEffect(() => {
    if (blocked) dragging.current = false;
    if (anchor.current && (!rows.some(row => row.id === anchor.current!.rowId) || !columns.some(column => column.id === anchor.current!.columnId))) anchor.current = null;
  }, [blocked, rows, columns]);
  const select = (cell: CellId, extend: boolean, toggle: boolean) => {
    if (extend && anchor.current) onSelection({ rowIds: [], cells: rectangularCells(rows, columns, anchor.current, cell) });
    else { anchor.current = cell; onSelection({ rowIds: [], cells: toggle ? selectedCells.has(cellKey(cell)) ? selection.cells.filter(c => cellKey(c) !== cellKey(cell)) : [...selection.cells, cell] : [cell] }); }
  };
  const sort = (id: string) => onView(v => { const rule = v.sorting.find(r => r.id === id); return { ...v, sorting: rule ? rule.desc ? v.sorting.filter(r => r.id !== id) : v.sorting.map(r => r.id === id ? { ...r, desc: true } : r) : [...v.sorting, { id, desc: false }] }; });
  return <div className="dl-table-shell"><div className="dl-table-scroll" ref={reorder.root} onScroll={onScroll} tabIndex={0} aria-label={t("Tabla de datos. Mayúsculas selecciona un rango; Comando permite selección múltiple.")} aria-busy={busy} data-stale={stale || undefined} onPointerUp={() => { dragging.current = false; }} onPointerLeave={() => { dragging.current = false; }} onKeyDown={e => {
    if (e.target === e.currentTarget && !e.metaKey && !e.ctrlKey && !e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); e.currentTarget.scrollBy({ left: e.key === 'ArrowRight' ? 180 : -180 }); }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') { e.preventDefault(); if (!busy && !stale) onCopy(); }
    if (e.key === 'Escape') { onSelection({ cells: [], rowIds: [] }); anchor.current = null; }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); if (!busy && !stale) onSelection({ cells: [], rowIds: rows.map(row => row.id) }); }
  }}><table className="dl-table" style={{ width: columnWindow.total }}><colgroup><col style={{ width: 48 }} />{columnWindow.before > 0 && <col style={{ width: columnWindow.before }} />}{renderedColumns.map(col => <col key={col.id} style={{ width: widths[col.id] ?? 180 }} />)}{columnWindow.after > 0 && <col style={{ width: columnWindow.after }} />}</colgroup><thead><tr><th className="dl-row-index"><input type="checkbox" aria-label={t("Seleccionar todas las filas de esta página")} disabled={busy || stale || !rows.length} checked={rows.length > 0 && rows.every(r => selectedRows.has(r.id))} onChange={e => onSelection({ cells: [], rowIds: e.target.checked ? [...new Set([...selection.rowIds, ...rows.map(r => r.id)])] : selection.rowIds.filter(id => !rows.some(r => r.id === id)) })} /></th>{columnWindow.before > 0 && <th aria-hidden="true" className="dl-column-spacer" />}{renderedColumns.map(col => { const priority = sorting.findIndex(r => r.id === col.id); const originalName = originalNames?.[col.id] ?? col.name; const originalTitle = originalName !== col.name ? `\n${t('Columna original: {value0}', { value0: originalName })}` : ''; return <th key={col.id} data-reorder-id={col.id} className={reorder.className(col.id)} onPointerDown={event => { if ((event.target as Element).closest('button,[role="separator"]')) return; reorder.handle(col.id).onPointerDown(event); }}>
      <div className="dl-header-cell"><span className="dl-type dl-grip" tabIndex={0} role="button" aria-label={t("Reordenar columna {value0}", { value0: col.name })} title={t("{value0} · {value1} · Arrastra o usa las flechas para reordenar", { value0: t(kindLabel[col.kind]), value1: col.dataType })} onKeyDown={reorder.handle(col.id).onKeyDown}>{kindSymbol[col.kind]}</span><button onClick={() => sort(col.id)} title={`${t("Ordenar {value0}; clics sucesivos: ascendente, descendente, sin orden", { value0: col.name })}${originalTitle}`}>{col.name}</button>{priority >= 0 && <span className="dl-sort-indicator">{sorting[priority].desc ? '↓' : '↑'}{priority + 1}</span>}<span className="dl-header-menu"><VariableMenu label="••" title={t('Opciones de {value0}', { value0: col.name })}>{close => <><button onClick={() => { close(); onView(v => ({ ...v, columns: { ...v.columns, hidden: [...new Set([...v.columns.hidden, col.id])] } })); }}>{t('Ocultar columna')}</button><button onClick={() => { close(); onLocateVariable(col.id); }}>{t('Localizar en cross filters')}</button><button onClick={() => { close(); onOpenPlot(col); }}>{t('Abrir en Gráficos')}</button><button onClick={() => { close(); onEditVariable(col); }}>{t('Editar nombre y descripción')}</button></>}</VariableMenu></span></div>
      <span className="dl-column-resize" role="separator" aria-label={t("Ancho de {value0}", { value0: col.name })} aria-orientation="vertical" tabIndex={0} onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); onView(v => ({ ...v, columns: { ...v.columns, widths: { ...v.columns.widths, [col.id]: Math.min(800, Math.max(90, (v.columns.widths[col.id] ?? 180) + (e.key === 'ArrowRight' ? 20 : -20))) } } })); } }} onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); const start = e.clientX; const width = widths[col.id] ?? 180; const target = e.currentTarget; const move = (ev: PointerEvent) => onView(v => ({ ...v, columns: { ...v.columns, widths: { ...v.columns.widths, [col.id]: Math.min(800, Math.max(90, width + ev.clientX - start)) } } })); const end = () => { target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', end); target.removeEventListener('pointercancel', end); }; target.addEventListener('pointermove', move); target.addEventListener('pointerup', end); target.addEventListener('pointercancel', end); }} />
    </th>; })}{columnWindow.after > 0 && <th aria-hidden="true" className="dl-column-spacer" />}</tr></thead><tbody inert={blocked} aria-disabled={blocked} onPointerDown={event => {
      const cell = cellAt(event.target);
      if (!cell || blocked || event.button !== 0) return;
      event.preventDefault(); reorder.root.current?.focus(); dragging.current = !event.metaKey && !event.ctrlKey;
      select(cell, event.shiftKey, event.metaKey || event.ctrlKey);
    }} onPointerOver={event => {
      const cell = cellAt(event.target), previous = cellAt(event.relatedTarget);
      if (cell && !blocked && dragging.current && event.buttons === 1 && anchor.current && (!previous || cellKey(previous) !== cellKey(cell))) onSelection({ rowIds: [], cells: rectangularCells(rows, columns, anchor.current, cell) });
    }} onKeyDown={event => {
      const cell = cellAt(event.target);
      if (cell && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); if (!blocked) select(cell, event.shiftKey, event.metaKey || event.ctrlKey); }
    }}>
      {rows.length ? <TableRows colorCategoricalCells={colorCategoricalCells} categoryColors={colorCategoricalCells ? categoryColors : undefined} categoryPalettes={colorCategoricalCells ? categoryPalettes : undefined} categoryRanks={colorCategoricalCells ? categoryRanks : undefined} rows={rows} columns={renderedColumns} offset={offset} before={columnWindow.before > 0} after={columnWindow.after > 0} selectedRows={selectedRows} selectedCells={cellsByRow} nullLabel={t('Valor nulo')} rowLabel={rowLabel} onRowSelection={onRowSelection} /> : !busy && <tr><td colSpan={renderedColumns.length + 1 + Number(columnWindow.before > 0) + Number(columnWindow.after > 0)} className="dl-table-empty">{t("No hay filas para estos filtros.")}</td></tr>}
    </tbody></table></div>{busy ? <div className="dl-table-loading" role="status">{t("Consultando filas…")}</div> : stale && <div className="dl-table-loading" role="status">{language === 'en' ? 'Previous rows' : 'Filas anteriores'}</div>}</div>;
});
