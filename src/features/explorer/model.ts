import type { CellValue, Column, Dataset, Row, ViewState } from '../../contracts/desktop-api';
export interface CellId { rowId: string; columnId: string }
export interface ExplorerSelection { cells: CellId[]; rowIds: string[] }
export const EMPTY_SELECTION: ExplorerSelection = { cells: [], rowIds: [] };
export const PAGE_SIZE = 100;
export function initialView(dataset: Dataset): ViewState {
  const order = dataset.columns.map(c => c.id);
  return { formatVersion: 1, columns: { order, hidden: [], widths: {} }, sorting: [], filters: [], variablePanel: { order, pinned: [], hidden: [], relative: false, sortModeByColumn: {} } };
}
/** Reconcile a saved view with the current schema; never trust stale column IDs. */
export function reconcileView(dataset: Dataset, saved: ViewState | null): ViewState {
  const defaults = initialView(dataset);
  if (!saved || saved.formatVersion !== 1) return defaults;
  const valid = new Set(defaults.columns.order);
  const ids = (items: string[] = []) => [...new Set(items)].filter(id => valid.has(id));
  const order = (items: string[]) => [...ids(items), ...defaults.columns.order.filter(id => !items.includes(id))];
  return { ...defaults, columns: { order: order(saved.columns.order), hidden: ids(saved.columns.hidden), widths: Object.fromEntries(Object.entries(saved.columns.widths).filter(([id, width]) => valid.has(id) && Number.isFinite(width)).map(([id, width]) => [id, Math.min(800, Math.max(90, width))])) }, sorting: saved.sorting.filter(rule => valid.has(rule.id)), filters: saved.filters.filter(filter => valid.has(filter.column)), variablePanel: { ...saved.variablePanel, order: order(saved.variablePanel.order), pinned: ids(saved.variablePanel.pinned), hidden: ids(saved.variablePanel.hidden) } };
}
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
  const next = [...items]; const [item] = next.splice(from, 1); next.splice(to, 0, item); return next;
}
export const cellKey = (cell: CellId) => JSON.stringify([cell.rowId, cell.columnId]);
export function rectangularCells(rows: Row[], columns: Column[], anchor: CellId, end: CellId): CellId[] {
  const r1 = rows.findIndex(row => row.id === anchor.rowId), r2 = rows.findIndex(row => row.id === end.rowId);
  const c1 = columns.findIndex(col => col.id === anchor.columnId), c2 = columns.findIndex(col => col.id === end.columnId);
  if (Math.min(r1, r2, c1, c2) < 0) return [end];
  return rows.slice(Math.min(r1, r2), Math.max(r1, r2) + 1).flatMap(row => columns.slice(Math.min(c1, c2), Math.max(c1, c2) + 1).map(col => ({ rowId: row.id, columnId: col.id })));
}
export function cellText(value: CellValue | undefined): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}
export function selectionTSV(rows: Row[], columns: Column[], selection: ExplorerSelection): string {
  const selected = new Set(selection.cells.map(cellKey));
  const selectedRows = new Set(selection.rowIds);
  const chosenColumns = columns.filter(col => selectedRows.size > 0 || selection.cells.some(cell => cell.columnId === col.id));
  const escape = (text: string) => /[\t\n\r"]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  return rows.filter(row => selectedRows.has(row.id) || selection.cells.some(cell => cell.rowId === row.id)).map(row => chosenColumns.map(col => selectedRows.has(row.id) || selected.has(cellKey({ rowId: row.id, columnId: col.id })) ? escape(cellText(row.values[col.id])) : '').join('\t')).join('\n');
}
export const kindLabel: Record<Column['kind'], string> = { numeric: 'Número', date: 'Fecha', boolean: 'Booleano', categorical: 'Categoría', multivalued: 'Lista', text: 'Texto' };
export const kindSymbol: Record<Column['kind'], string> = { numeric: '#', date: '◷', boolean: '◐', categorical: '≡', multivalued: '☷', text: 'Aa' };
