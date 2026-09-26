import type { CellValue, DesktopApi, Page } from '../../contracts/desktop-api';

export const MAX_TABLE_COLUMNS = 64;
export interface TablePageFrame { api: DesktopApi; source: string; key: string; offset: number; columns: string[]; page: Page }

export function tablePageCovers(frame: TablePageFrame | null | undefined, key: string, columns: string[]) {
  return !!frame && frame.key === key && (!frame.page.rows.length || columns.every(id => frame.columns.includes(id)));
}

function sameValue(a: CellValue | undefined, b: CellValue | undefined): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, index) => sameValue(value, b[index]));
  const left = a as Record<string, CellValue>, right = b as Record<string, CellValue>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && sameValue(left[key], right[key]));
}

/** IPC creates fresh objects. Share unchanged rows/cells by stable row ID, never by position. */
export function reconcileTablePage(previous: Page | null, incoming: Page): Page {
  if (!previous || previous.datasetRevision !== incoming.datasetRevision) return incoming;
  const byId = new Map(previous.rows.map(row => [row.id, row]));
  const rows = incoming.rows.map(row => {
    const old = byId.get(row.id);
    if (!old) return row;
    const values = Object.fromEntries(Object.entries(row.values).map(([id, value]) => [id, sameValue(old.values[id], value) ? old.values[id] : value]));
    return Object.keys(values).length === Object.keys(old.values).length && Object.keys(values).every(id => Object.hasOwn(old.values, id) && values[id] === old.values[id]) ? old : { ...row, values };
  });
  const sameRows = rows.length === previous.rows.length && rows.every((row, index) => row === previous.rows[index]);
  if (sameRows && incoming.filteredCount === previous.filteredCount) return previous;
  return { ...incoming, rows: sameRows ? previous.rows : rows };
}

export function nextTablePageFrame(previous: TablePageFrame | null, request: Omit<TablePageFrame, 'page'>, incoming: Page, visibleColumns = request.columns): TablePageFrame {
  const compatible = previous?.api === request.api && previous.source === request.source && previous.page.datasetRevision === incoming.datasetRevision;
  if (!compatible) return { ...request, page: incoming };
  const byId = new Map(previous.page.rows.map(row => [row.id, row]));
  // Reuse projections only if every returned row has that column. Filters may introduce new rows.
  const reusable = previous.columns.filter(id => incoming.rows.every(row => Object.hasOwn(row.values, id) || Object.hasOwn(byId.get(row.id)?.values ?? {}, id)));
  const available = [...reusable.filter(id => !request.columns.includes(id)), ...request.columns];
  // Evict offscreen columns first, including when scrolling back into the oldest cached range.
  const visible = new Set(visibleColumns);
  const columns = [...available.filter(id => !visible.has(id)), ...available.filter(id => visible.has(id))].slice(-Math.max(MAX_TABLE_COLUMNS, visibleColumns.length));
  const page = { ...incoming, rows: incoming.rows.map(row => ({ ...row, values: Object.fromEntries(columns.map(id => [id, Object.hasOwn(row.values, id) ? row.values[id] : byId.get(row.id)!.values[id]])) })) };
  return { ...request, columns, page: reconcileTablePage(previous.page, page) };
}
