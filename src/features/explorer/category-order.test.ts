import { describe, expect, test } from 'bun:test';
import type { Bin, Column, Dataset } from '../../contracts/desktop-api';
import { applySemanticEdits, categoryValues, reconcileCategoryOrders, semanticScope, setCategoryOrder, validateColorProposal, validateOrderProposal } from './category-semantics';
import { sortCategoryBins } from './category-sort';
import { initialView, reconcileView } from './model';

const column: Column = { id: 'agreement', name: 'Agreement', kind: 'categorical', dataType: 'VARCHAR', spss: { valueLabels: { '01': 'Strongly disagree', '02': 'Disagree', '03': 'Agree', '99': 'Missing' }, missingValues: ['99'], categorical: true } };
const dataset: Dataset = { id: 'test', revision: '1', sourcePath: '/fixture.csv', name: 'Fixture', rowCount: 10, columns: [column] };
const bin = (value: string | null, background: number): Bin & { value: string | null } => ({ value, background, foreground: background, rBackground: background / 100, rForeground: background / 100 });

describe('manual category order', () => {
  test('persists by raw ID, retains new categories, and keeps null last across selections', () => {
    const view = setCategoryOrder(initialView(dataset), column.id, ['01', '02', '03']);
    const restored = reconcileView(dataset, JSON.parse(JSON.stringify(view)));
    expect(restored.categoryOrders?.agreement).toEqual(['01', '02', '03']);
    expect(restored.variablePanel.sortModeByColumn.agreement).toBe('manual');
    const bins = [bin('03', 30), bin('new', 80), bin(null, 99), bin('01', 1), bin('02', 9)];
    for (const input of [bins, bins.map(item => ({ ...item, foreground: 0 }))]) {
      expect(sortCategoryBins(input, 'manual', { analyzedRows: 100, order: restored.categoryOrders!.agreement }).map(item => item.value)).toEqual(['01', '02', '03', 'new', null]);
    }
    expect(sortCategoryBins(bins, 'everything', { analyzedRows: 100, order: restored.categoryOrders!.agreement }).map(item => item.value)).toEqual(['new', '03', '02', '01', null]);
    expect(bins[0].value).toBe('03');
    expect(setCategoryOrder(view, 'agreement').categoryOrders).toBeUndefined();
    expect(setCategoryOrder(view, 'agreement').variablePanel.sortModeByColumn.agreement).toBe('everything');
  });
  test('keeps unseen saved categories without duplicating values or conflating null with strings', () => {
    expect(categoryValues([bin('01', 3), bin(null, 2), bin('', 2), bin('null', 1)], ['02', '01'])).toEqual(['02', '01', '', 'null']);
    expect(reconcileCategoryOrders(JSON.parse('{"agreement":["01",null,1,"01","__proto__",""],"deleted":["a"]}'), new Set(['agreement']))).toEqual({ agreement: ['01', '__proto__', ''] });
    const malformed = initialView(dataset);
    malformed.variablePanel.sortModeByColumn.agreement = 'manual';
    expect(reconcileView(dataset, malformed).variablePanel.sortModeByColumn.agreement).toBe('everything');
  });
});

describe('semantic scopes and review', () => {
  test('excludes SPSS missing, empty and protected colors; never silently treats a subset as a full ordinal scale', () => {
    expect(semanticScope(column, ['01', '02', '03', '99', ''], '').values).toEqual(['01', '02', '03']);
    expect(semanticScope(column, ['01', '02', '03'], '', { '01': '#000000' }).values).toEqual(['02', '03']);
    const over = semanticScope(column, Array.from({ length: 101 }, (_, i) => `v${i}`), '');
    expect(over.values.length).toBe(100); expect(over.complete).toBe(false);
    expect(semanticScope(column, ['a', 'é'.repeat(251)], '').complete).toBe(false);
    const longLabel = { ...column, spss: { ...column.spss!, valueLabels: { '01': 'x'.repeat(19_000) } } };
    expect(semanticScope(longLabel, ['01', '02'], '').complete).toBe(false);
  });
  test('rejects late revisions, partial scales, invented values and duplicate assignments', () => {
    const result = { column: 'agreement', datasetRevision: '1', ordinal: true, order: ['01', '02', '03'], explanation: 'Increasing agreement' };
    expect(validateOrderProposal(result, ['03', '02', '01'], 'agreement', '1')).toBe(result);
    for (const order of [['01', '02'], ['01', '02', '04'], ['01', '01', '03']]) expect(() => validateOrderProposal({ ...result, order }, ['01', '02', '03'], 'agreement', '1')).toThrow();
    expect(() => validateOrderProposal(result, ['01', '02', '03'], 'agreement', '2')).toThrow();
    expect(validateOrderProposal({ ...result, ordinal: false, order: [] }, ['01', '02', '03'], 'agreement', '1').ordinal).toBe(false);
    const colors = { column: 'agreement', datasetRevision: '1', assignments: [{ value: '01', color: '#AABBCC', reason: 'Recognized' }], explanation: '' };
    expect(validateColorProposal(colors, ['01', '02'], 'agreement', '1')[0].color).toBe('#aabbcc');
    expect(() => validateColorProposal({ ...colors, assignments: [...colors.assignments, ...colors.assignments] }, ['01', '02'], 'agreement', '1')).toThrow();
    expect(() => validateColorProposal(colors, ['02'], 'agreement', '1')).toThrow();
  });
  test('applies only reviewed changes to the latest view without overwriting protected edits', () => {
    const original = setCategoryOrder(initialView(dataset), 'agreement', ['03', '02', '01']);
    original.categoryColors = { agreement: { '01': '#123456' }, other: { x: '#654321' } };
    original.filters = [{ kind: 'categorical', column: 'agreement', selected: ['01'] }];
    const edits = [{ column: 'agreement', order: ['01', '02', '03'], colors: { '01': '#ffffff', '03': '#009e73' } }];
    const protectedView = applySemanticEdits(original, edits, false, false);
    expect(protectedView.categoryOrders).toEqual(original.categoryOrders);
    expect(protectedView.categoryColors?.agreement).toEqual({ '01': '#123456', '03': '#009e73' });
    expect(protectedView.categoryColors?.other).toEqual({ x: '#654321' });
    expect(protectedView.filters).toBe(original.filters);
    const replaced = applySemanticEdits(original, edits, true, true);
    expect(replaced.categoryOrders?.agreement).toEqual(['01', '02', '03']);
    expect(replaced.categoryColors?.agreement['01']).toBe('#ffffff');
    expect(original.categoryColors.agreement['01']).toBe('#123456');
  });
});
