import { describe, expect, test } from 'bun:test';
import { cellKey, cellText, initialView, moveItem, reconcileView, rectangularCells, selectionTSV } from './model';
import { sortCategoryBins } from './category-sort';
const columns = [
  { id: 'long-id', name: 'ID', kind: 'text', dataType: 'VARCHAR' },
  { id: 'city', name: 'Ciudad', kind: 'categorical', dataType: 'VARCHAR' },
  { id: 'revenue', name: 'Ingresos', kind: 'numeric', dataType: 'DOUBLE' },
];
const dataset = { id: 'fixture', name: 'Fixture', sourcePath: '/fixture.csv', columns, rowCount: 3, revision: '1' };
const rows = [
  { id: 'r:9007199254740993', values: { 'long-id': '9007199254740993', city: 'Madrid', revenue: 42 } },
  { id: 'r:9007199254740995', values: { 'long-id': '9007199254740995', city: 'Sevilla\tcentro', revenue: null } },
  { id: 'r:9007199254740997', values: { 'long-id': '9007199254740997', city: 'Bilbao\nNorte', revenue: 12 } },
];
describe('stable selection and exact clipboard data', () => {
  test('reverse rectangular drag snapshots row and column IDs', () => {
    const selection = rectangularCells(rows, columns, { rowId: rows[2].id, columnId: 'revenue' }, { rowId: rows[0].id, columnId: 'city' });
    expect(selection).toHaveLength(6);
    expect(selection[0]).toEqual({ rowId: rows[0].id, columnId: 'city' });
    const snapshot = JSON.stringify(selection);
    const reordered = [...rows].reverse();
    selectionTSV(reordered, columns, { cells: selection, rowIds: [] });
    expect(JSON.stringify(selection)).toBe(snapshot);
    expect(new Set(selection.map(cellKey)).size).toBe(6);
  });
  test('anchor on an unloaded page cannot accidentally span a new page', () => {
    expect(rectangularCells(rows.slice(1), columns, { rowId: rows[0].id, columnId: 'city' }, { rowId: rows[2].id, columnId: 'city' })).toEqual([{ rowId: rows[2].id, columnId: 'city' }]);
  });
  test('copy preserves 64-bit identifiers and quotes tabs/newlines/nulls', () => {
    expect(selectionTSV(rows, columns, { rowIds: rows.map(r => r.id), cells: [] })).toBe('9007199254740993\tMadrid\t42\n9007199254740995\t"Sevilla\tcentro"\t\n9007199254740997\t"Bilbao\nNorte"\t12');
    expect(cellText('9007199254740993')).toBe('9007199254740993');
  });
  test('composite IDs do not collide when IDs contain delimiters', () => {
    expect(cellKey({ rowId: 'a:b', columnId: 'c' })).not.toBe(cellKey({ rowId: 'a', columnId: 'b:c' }));
  });
});
describe('persisted views', () => {
  test('reconciles schema changes, order, hidden IDs and invalid widths', () => {
    const view = initialView(dataset);
    view.columns = { order: ['city', 'removed', 'city'], hidden: ['removed', 'city'], widths: { city: 10, revenue: Infinity } };
    view.sorting = [{ id: 'removed', desc: true }, { id: 'city', desc: false }];
    view.filters = [{ column: 'removed', kind: 'numeric', min: 1 }];
    view.variablePanel.pinned = ['city', 'removed'];
    const result = reconcileView(dataset, view);
    expect(result.columns.order).toEqual(['city', 'long-id', 'revenue']);
    expect(result.columns.hidden).toEqual(['city']);
    expect(result.columns.widths).toEqual({ city: 90 });
    expect(result.sorting).toEqual([{ id: 'city', desc: false }]);
    expect(result.filters).toEqual([]);
    expect(result.variablePanel.pinned).toEqual(['city']);
  });
  test('unknown view version restores defaults', () => {
    expect(reconcileView(dataset, { formatVersion: 99 })).toEqual(initialView(dataset));
  });
  test('priority drag reorders without mutating saved view', () => {
    const sorting = [{ id: 'city', desc: false }, { id: 'revenue', desc: true }];
    expect(moveItem(sorting, 1, 0)).toEqual([sorting[1], sorting[0]]);
    expect(sorting[0].id).toBe('city');
    expect(moveItem(sorting, -1, 0)).toEqual(sorting);
  });
});
test('category sorting preserves null bucket and supports uplift', () => {
  const bins = [{ value: 'A', background: 90, foreground: 2, rBackground: .9, rForeground: .2 }, { value: 'B', background: 10, foreground: 8, rBackground: .1, rForeground: .8 }, { value: null, background: 100, foreground: 100, rBackground: 1, rForeground: 1 }];
  expect(sortCategoryBins(bins, 'uplift', { analyzedRows: 100 }).map(b => b.value)).toEqual(['B', 'A', null]);
  expect(bins[0].value).toBe('A');
});
