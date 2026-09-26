import { describe, expect, test } from 'bun:test';
import { cellKey, cellText, initialView, moveItem, reconcileView, rectangularCells, selectionTSV, setVariableText } from './model';
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
  test('restores shared visual settings while rejecting invalid values', () => {
    const view=initialView(dataset);
    view.presentation={colorCategoricalCells:true,categoryChartMode:'detailed',showAnalyticalRole:true,defaultCategoryPalette:'earth'};
    expect(reconcileView(dataset,view).presentation).toEqual(view.presentation);
    view.presentation={colorCategoricalCells:'yes',categoryChartMode:'wide',showAnalyticalRole:false,defaultCategoryPalette:'unknown'};
    const sanitized=reconcileView(dataset,view).presentation;
    expect(sanitized.showAnalyticalRole).toBe(false);
    expect(typeof sanitized.colorCategoricalCells).toBe('boolean');
    expect(['compact','detailed']).toContain(sanitized.categoryChartMode);
    expect(['classic','tableau','pastel','vivid','earth']).toContain(sanitized.defaultCategoryPalette);
  });
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
  test('variable display name and description survive a saved view without changing column IDs', () => {
    const view = initialView(dataset);
    view.variablePanel.metadata = { revenue: { name: 'Facturación neta', description: 'Ingresos después de descuentos.' } };
    const restored = reconcileView(dataset, JSON.parse(JSON.stringify(view)));
    expect(restored.variablePanel.metadata.revenue).toEqual({ ...view.variablePanel.metadata.revenue, originalName: 'Ingresos' });
    expect(dataset.columns.find(column => column.id === 'revenue').name).toBe('Ingresos');
    expect(restored.variablePanel.order).toContain('revenue');
  });
  test('editing variable text leaves an unclassified analytical role untouched', () => {
    const view = initialView(dataset);
    const edited = setVariableText(view, columns[2], 'Facturación neta', 'Importe en euros');
    expect(edited.variablePanel.metadata.revenue).toEqual({ name: 'Facturación neta', originalName: 'Ingresos', description: 'Importe en euros' });
    expect(edited.variablePanel.metadata.revenue.role).toBeUndefined();
    expect(view.variablePanel.metadata).toBeUndefined();
  });
  test('the first original name survives later renames and restoring the visible name', () => {
    const first = setVariableText(initialView(dataset), columns[2], 'Facturación', '');
    const second = setVariableText(first, { ...columns[2], name: 'Facturación' }, 'Ingresos netos', '');
    const restored = setVariableText(second, { ...columns[2], name: 'Ingresos netos' }, 'Ingresos', '');
    expect(second.variablePanel.metadata.revenue).toEqual({ name: 'Ingresos netos', originalName: 'Ingresos', description: undefined });
    expect(restored.variablePanel.metadata.revenue).toEqual({ name: undefined, originalName: 'Ingresos', description: undefined });
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

describe('full workspace and variable reordering', () => {
  test('old views receive presentation defaults; saved presentation survives schema reconciliation', () => {
    const old = initialView(dataset); delete old.workspace; delete old.variablePanel.search; delete old.variablePanel.expanded;
    expect(reconcileView(dataset, old).workspace).toEqual({ mode: 'table', variablesVisible: true, enrichmentsVisible: false, pageOffset: 0 });
    const saved = initialView(dataset);
    saved.workspace = { mode: 'variables', variablesVisible: false, enrichmentsVisible: true, pageOffset: 200 };
    saved.variablePanel.search = 'Ciudad'; saved.variablePanel.expanded = ['city', 'removed'];
    const restored = reconcileView(dataset, JSON.parse(JSON.stringify(saved)));
    expect(restored.workspace).toEqual(saved.workspace);expect(restored.variablePanel.search).toBe('Ciudad');
    expect(restored.variablePanel.expanded).toEqual(['city']);
  });
  test('drops across pinned boundary move visibly and preserve hidden variables', async () => {
    const { reorderVariables } = await import('./model');
    const panel = { ...initialView(dataset).variablePanel, pinned: ['city'], hidden: ['revenue'] };
    const changed = reorderVariables(panel, 'long-id', 'city');
    expect(changed.pinned).toContain('long-id');expect(changed.hidden).toEqual(['revenue']);
    const unpinned = reorderVariables(changed, 'city', 'revenue');
    expect(unpinned.pinned).not.toContain('city');expect(unpinned.order).toEqual(['long-id', 'revenue', 'city']);
    expect(panel.order).toEqual(['long-id', 'city', 'revenue']);
    expect(reorderVariables(panel, 'missing', 'city')).toBe(panel);
  });
  test('wide files request every distribution without exceeding native limits, and abandon superseded work', async () => {
    const { queryDistributions } = await import('./distributions');
    const requested = [];
    let cancelled = false;
    const api = { getDistributions: async ({ columns, filters }) => {
      expect(columns.length).toBeLessThanOrEqual(64);expect(filters).toEqual([{ column: 'city', kind: 'categorical', selected: ['Madrid'] }]);
      requested.push(columns);
      return { variables: columns.map(column => ({ column, bins: [] })), selectedCount: 2, totalRows: 3, analyzedRows: 3, sampled: false };
    } };
    const ids = Array.from({ length: 130 }, (_, i) => String(i));
    const filters = [{ column: 'city', kind: 'categorical', selected: ['Madrid'] }];
    const result = await queryDistributions(api, 'fixture', ids, filters, () => cancelled);
    expect(requested.every(batch => batch.length <= 8)).toBe(true);expect(requested.flat()).toEqual(ids);expect(result.variables.map(v => v.column)).toEqual(ids);
    requested.length = 0;
    const interruptedApi = { getDistributions: async request => { const result = await api.getDistributions(request);cancelled = true;return result; } };
    expect(await queryDistributions(interruptedApi, 'fixture', ids, filters, () => cancelled)).toBeNull();
    expect(requested).toHaveLength(1);
  });
  test('dropping a formerly last pinned card lands in the visible preview position', async () => {
    const { reorderVariables } = await import('./model');
    const panel = { ...initialView(dataset).variablePanel, order: ['a', 'hidden', 'b', 'c', 'd'], pinned: ['d'], hidden: ['hidden'] };
    // Visible before dragging: d, a, b, c. Dropping on b must result in a, b, d, c.
    const changed = reorderVariables(panel, 'd', 'b');
    expect(changed.order.filter(id => !changed.hidden.includes(id))).toEqual(['a', 'b', 'd', 'c']);
    expect(changed.pinned).toEqual([]);
    expect(changed.order).toContain('hidden');
    expect(panel.pinned).toEqual(['d']);
  });
});
