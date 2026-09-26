import type { CellValue, Column, Dataset, Row, ViewState } from '../../contracts/desktop-api';
import { normalizeSampling } from './sampling';
import { reconcileCategoryOrders } from './category-semantics';
import { reconcileCategoryColors, reconcileCategoryPalettes } from './category-colors';
import { getUiSnapshot, projectPresentation, readProjectPresentation } from '../../ui/preferences';
export interface CellId { rowId: string; columnId: string }
export interface ExplorerSelection { cells: CellId[]; rowIds: string[] }
export const EMPTY_SELECTION: ExplorerSelection = { cells: [], rowIds: [] };
export const PAGE_SIZE = 100;
export function initialView(dataset: Dataset): ViewState {
  const order = dataset.columns.map(c => c.id);
  return { formatVersion: 1, presentation: projectPresentation(getUiSnapshot()), workspace: { mode: 'table', variablesVisible: true, enrichmentsVisible: false, pageOffset: 0 }, columns: { order, hidden: [], widths: {} }, sorting: [], filters: [], variablePanel: { search: '', expanded: [], order, pinned: [], hidden: [], relative: false, sortModeByColumn: {} } };
}
export function setVariableText(view: ViewState, column: Column, name: string, description: string): ViewState {
  const previous = view.variablePanel.metadata?.[column.id];
  const originalName = previous?.originalName ?? column.name;
  const nextName = name.trim();
  const hasBeenRenamed = previous?.originalName !== undefined || nextName !== originalName;
  return { ...view, variablePanel: { ...view.variablePanel, metadata: {
    ...view.variablePanel.metadata,
    [column.id]: { ...previous, name: nextName === originalName ? undefined : nextName, originalName: hasBeenRenamed ? originalName : undefined, description: description.trim() || undefined },
  } } };
}
/** Reconcile a saved view with the current schema; never trust stale column IDs. */
export function reconcileView(dataset: Dataset, saved: ViewState | null): ViewState {
  const defaults = initialView(dataset);
  if (!saved || saved.formatVersion !== 1) return defaults;
  defaults.presentation = readProjectPresentation(saved.presentation, defaults.presentation!);
  const valid = new Set(defaults.columns.order);
  const categoryOrders = reconcileCategoryOrders(saved.categoryOrders, valid);
  const sortModeByColumn = Object.fromEntries(Object.entries(saved.variablePanel.sortModeByColumn ?? {}).filter(([id, mode]) => valid.has(id) && ['everything', 'selection', 'uplift', 'tfidf', 'manual'].includes(mode)).map(([id, mode]) => [id, mode === 'manual' && !categoryOrders[id]?.length ? 'everything' : mode]));
  const categoryColors = reconcileCategoryColors(saved.categoryColors, valid);
  const categoryPalettes = reconcileCategoryPalettes(saved.categoryPalettes, valid);
  const ids = (items: string[] = []) => [...new Set(items)].filter(id => valid.has(id));
  const order = (items: string[]) => [...ids(items), ...defaults.columns.order.filter(id => !items.includes(id))];
  return { ...defaults, ...(Object.keys(categoryOrders).length ? { categoryOrders } : {}), ...(Object.keys(categoryColors).length ? { categoryColors } : {}), ...(Object.keys(categoryPalettes).length ? { categoryPalettes } : {}), analysisSampling: normalizeSampling(saved.analysisSampling), plots: saved.plots, workspace: { ...defaults.workspace!, ...saved.workspace, mode: saved.workspace?.mode === 'variables' || saved.workspace?.mode === 'plots' ? saved.workspace.mode : 'table', pageOffset: Math.max(0, Math.floor((saved.workspace?.pageOffset || 0) / PAGE_SIZE) * PAGE_SIZE) }, columns: { order: order(saved.columns.order), hidden: ids(saved.columns.hidden), widths: Object.fromEntries(Object.entries(saved.columns.widths).filter(([id, width]) => valid.has(id) && Number.isFinite(width)).map(([id, width]) => [id, Math.min(800, Math.max(90, width))])) }, sorting: saved.sorting.filter(rule => valid.has(rule.id)), filters: saved.filters.filter(filter => valid.has(filter.column)), variablePanel: { ...defaults.variablePanel, ...saved.variablePanel, sortModeByColumn, expanded: ids(saved.variablePanel.expanded), order: order(saved.variablePanel.order), pinned: ids(saved.variablePanel.pinned), hidden: ids(saved.variablePanel.hidden), statistics: ids(saved.variablePanel.statistics), metadata: Object.fromEntries(Object.entries(saved.variablePanel.metadata ?? {}).filter(([id, value]) => valid.has(id) && value && typeof value === 'object' && !Array.isArray(value) && (value.role === undefined || ['target', 'actionable', 'feature', 'identifier'].includes(value.role)) && (value.group === undefined || typeof value.group === 'string')).map(([id, value]) => {
    const name = typeof value.name === 'string' ? value.name.trim().slice(0, 120) || undefined : undefined;
    const savedOriginal = typeof value.originalName === 'string' ? value.originalName.trim().slice(0, 120) || undefined : undefined;
    const sourceName = dataset.columns.find(column => column.id === id)?.name;
    return [id, { ...value, group: value.group?.slice(0, 80), name, originalName: savedOriginal ?? (name && name !== sourceName ? sourceName : undefined), description: typeof value.description === 'string' ? value.description.trim().slice(0, 1000) || undefined : undefined }];
  })) } };
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
export const kindSymbol: Record<Column['kind'], string> = { numeric: '#', date: '◷', boolean: '◐', categorical: 'ABC', multivalued: '[ ]', text: 'TXT' };

/** Moving across the pinned boundary adopts the destination group, so every drop is visible. */
export function reorderVariables(panel: ViewState['variablePanel'], source: string, target: string, visibleIds?: string[]): ViewState['variablePanel'] {
  if (source === target || !panel.order.includes(source) || !panel.order.includes(target)) return panel;
  const pinned = panel.pinned.filter(id => id !== source);
  if (panel.pinned.includes(target)) pinned.push(source);
  if (visibleIds && Object.values(panel.metadata ?? {}).some(value => !!value.group)) {
    const moved = moveItem(visibleIds, visibleIds.indexOf(source), visibleIds.indexOf(target));
    const visible = new Set(visibleIds); let index = 0;
    const order = panel.order.map(id => visible.has(id) ? moved[index++] : id);
    const metadata = { ...panel.metadata };
    if (!panel.pinned.includes(target)) metadata[source] = { ...metadata[source], role: metadata[source]?.role ?? 'feature', group: metadata[target]?.group ?? '' };
    return { ...panel, order, pinned, metadata };
  }
  // The preview follows the displayed pinned-first order, which can differ
  // from the stored order after pinning a card near the end of the list.
  const displayed = [...panel.order.filter(id => panel.pinned.includes(id)), ...panel.order.filter(id => !panel.pinned.includes(id))];
  return { ...panel, order: moveItem(displayed, displayed.indexOf(source), displayed.indexOf(target)), pinned };
}
