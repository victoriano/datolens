import type { Dataset } from '../../contracts/desktop-api';
export interface DatasetTab { key: string; path: string; sheet?: string; name: string; dataset?: Dataset }
export const sourceKey = (path: string, sheet?: string) => JSON.stringify([path, sheet ?? null]);
export function registerTabs(tabs: DatasetTab[], additions: DatasetTab[]): DatasetTab[] {
  const next = [...tabs];
  for (const tab of additions) {
    const index = next.findIndex(existing => existing.key === tab.key);
    if (index < 0) next.push(tab); else next[index] = { ...next[index], ...tab, dataset: tab.dataset ?? next[index].dataset };
  }
  return next;
}
export function workbookTabs(path: string, sheets: string[]): DatasetTab[] {
  return sheets.map(sheet => ({ key: sourceKey(path, sheet), path, sheet, name: path.split(/[\\/]/).pop() || path }));
}
export const quoteColumn = (column: string) => `"${column.replaceAll('"', '""')}"`;
export function joinExample(tables: Array<{ alias: string; dataset?: Dataset }>): string {
  const [left, right] = tables;
  if (!left) return '';
  if (!right) return `SELECT * FROM ${left.alias}\nLIMIT 1000`;
  const common = left.dataset?.columns.find(c => right.dataset?.columns.some(r => r.id === c.id));
  const l = quoteColumn(common?.id ?? left.dataset?.columns[0]?.id ?? 'id');
  const r = quoteColumn(common?.id ?? right.dataset?.columns[0]?.id ?? 'id');
  return `SELECT a.*, b.*\nFROM ${left.alias} AS a\nLEFT JOIN ${right.alias} AS b ON a.${l} = b.${r}`;
}
