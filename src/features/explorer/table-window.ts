import type { Column } from '../../contracts/desktop-api';

/** Keep the full horizontal extent while querying only the viewport and two neighbours. */
export function tableColumnWindow(columns: Column[], widths: Record<string, number>, scrollLeft: number, viewportWidth: number) {
  const sizes = columns.map(column => widths[column.id] ?? 180);
  const total = sizes.reduce((sum, width) => sum + width, 0);
  const left = Math.max(0, Math.min(scrollLeft, Math.max(0, total + 48 - viewportWidth)));
  let first = 0, position = 0;
  while (first < sizes.length && position + sizes[first] <= left) position += sizes[first++];
  let last = first, endPosition = position;
  while (last < sizes.length && endPosition < left + Math.max(1, viewportWidth)) endPosition += sizes[last++];
  const start = Math.max(0, first - 2), end = Math.min(columns.length, last + 2);
  const before = sizes.slice(0, start).reduce((sum, width) => sum + width, 0);
  const shown = sizes.slice(start, end).reduce((sum, width) => sum + width, 0);
  return { start, end, before, after: total - before - shown, total: total + 48 };
}
export type TableColumnWindow = ReturnType<typeof tableColumnWindow>;

export function sameTableColumnWindow(a: TableColumnWindow, b: TableColumnWindow) {
  return a.start === b.start && a.end === b.end && a.before === b.before && a.after === b.after && a.total === b.total;
}
