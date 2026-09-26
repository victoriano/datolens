import type { Column } from '../../contracts/desktop-api';
export type VariableGroup = { name: string; columns: Column[] };
export type VariableRow = { key: string; group: VariableGroup; header: boolean; columns: Column[]; top: number; height: number };

export function variableRows(groups: VariableGroup[], grouped: boolean, collapsed: string[], lanes: number, heights: Map<string, number>): VariableRow[] {
  let top = 0;
  const rows: VariableRow[] = [];
  const add = (group: VariableGroup, columns: Column[], header: boolean) => {
    const key = header ? `group:${group.name}` : JSON.stringify(columns.map(column => column.id));
    const height = heights.get(key) ?? (header ? 36 : 240);
    rows.push({ key, group, header, columns, top, height }); top += height;
  };
  for (const group of groups) {
    if (grouped) add(group, [], true);
    if (grouped && collapsed.includes(group.name)) continue;
    for (let i = 0; i < group.columns.length; i += lanes) add(group, group.columns.slice(i, i + lanes), false);
  }
  return rows;
}
export function variableWindow(rows: VariableRow[], scrollTop: number, height: number) {
  const total = rows.length ? rows[rows.length - 1].top + rows[rows.length - 1].height : 0;
  const top = Math.min(Math.max(0, scrollTop), Math.max(0, total - height));
  const start = Math.max(0, rowAtOffset(rows, top) - 1);
  let end = start;
  while (end < rows.length && rows[end].top < top + height + 240) end++;
  const rendered = rows.slice(start, end);
  // True viewport before overscan: first paint isn't held up by an offscreen card.
  const visible = rendered.filter(row => row.top < top + height && row.top + row.height > top);
  const nearby = rendered.filter(row => !visible.includes(row));
  return { rendered, ids: [...visible, ...nearby].flatMap(row => row.columns.map(column => column.id)), before: rows[start]?.top ?? 0, after: Math.max(0, total - (rows[end]?.top ?? total)) };
}
function rowAtOffset(rows: VariableRow[], top: number) {
  let low = 0, high = rows.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (rows[middle].top + rows[middle].height <= top) low = middle + 1;
    else high = middle;
  }
  return Math.min(low, Math.max(0, rows.length - 1));
}
export function sameVariableWindow(a: ReturnType<typeof variableWindow>, b: ReturnType<typeof variableWindow>) {
  return a.before === b.before && a.after === b.after && a.ids.length === b.ids.length
    && a.ids.every((id, index) => id === b.ids[index])
    && a.rendered.length === b.rendered.length && a.rendered.every((row, index) => row.key === b.rendered[index].key);
}
export function variableScrollAnchor(rows: VariableRow[], top: number) {
  const row = rows[rowAtOffset(rows, top)];
  return row ? { key: row.key, offset: Math.max(0, top - row.top) } : null;
}
export function anchoredVariableScrollTop(rows: VariableRow[], anchor: ReturnType<typeof variableScrollAnchor>) {
  const row = anchor && rows.find(row => row.key === anchor.key);
  return row && anchor ? row.top + Math.min(anchor.offset, Math.max(0, row.height - 1)) : null;
}
