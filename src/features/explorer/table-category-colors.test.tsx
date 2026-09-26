import React from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Column, Row } from '../../contracts/desktop-api';
import { TableRows } from './TableRows';
import { categoryColorRanks, getCategoryColor } from './category-colors';
import { selectionTSV } from './model';
import { getUiSnapshot, setUiPreferences } from '../../ui/preferences';

const columns: Column[] = [
  { id: 'group', name: 'Group', kind: 'categorical', dataType: 'VARCHAR', spss: { valueLabels: { '1': 'High' }, missingValues: [], categorical: true } },
  { id: 'number', name: 'Number', kind: 'numeric', dataType: 'DOUBLE' },
  { id: 'active', name: 'Active', kind: 'boolean', dataType: 'BOOLEAN' },
  { id: 'tags', name: 'Tags', kind: 'multivalued', dataType: 'VARCHAR[]' },
  { id: 'empty', name: 'Missing', kind: 'categorical', dataType: 'VARCHAR' },
];
const rows: Row[] = [{ id: 'r1', values: { group: '1', number: 42, active: true, tags: ['High', 'Low'], empty: null } }];
const colors = { group: { '1': '#ff0000', High: '#00ff00' }, active: { true: '#123456' }, tags: { High: '#654321' } };
function markup(enabled?: boolean, categoryPalettes?: Record<string, string>, categoryRanks?: ReadonlyMap<string, ReadonlyMap<string, number>>) {
  return renderToStaticMarkup(<table><tbody><TableRows rows={rows} columns={columns} offset={0} before={false} after={false} selectedRows={new Set()} selectedCells={new Map([['r1', new Set(['group'])]])} nullLabel="Missing" rowLabel={String} onRowSelection={() => {}} colorCategoricalCells={enabled} categoryColors={colors} categoryPalettes={categoryPalettes} categoryRanks={categoryRanks} /></tbody></table>);
}

describe('categorical table colors', () => {
  test('follows global changes for inheriting columns and preserves variable and category overrides', () => {
    const previous = getUiSnapshot();
    try {
      setUiPreferences({ defaultCategoryPalette: 'pastel' });
      expect(markup(true)).toContain(`--dl-category-color:${getCategoryColor('Low', undefined, 'pastel')}`);
      expect(markup(true)).toContain('--dl-category-color:#654321');
      expect(markup(true, { tags: 'classic' })).toContain(`--dl-category-color:${getCategoryColor('Low', undefined, 'classic')}`);
      setUiPreferences({ defaultCategoryPalette: 'earth' });
      expect(markup(true)).toContain(`--dl-category-color:${getCategoryColor('Low', undefined, 'earth')}`);
      expect(markup(true, { tags: 'classic' })).toContain(`--dl-category-color:${getCategoryColor('Low', undefined, 'classic')}`);
    } finally { setUiPreferences(previous); }
  });
  test('keeps the default table plain even when saved overrides exist', () => {
    const html = markup();
    expect(html).not.toContain('dl-category-cell');
    expect(html).toContain('1 · High');
    expect(html).toContain('dl-boolean');
  });
  test('colors raw values consistently, including booleans and individual list entries', () => {
    const html = markup(true);
    expect(html).toContain('--dl-category-color:#ff0000');
    expect(html).not.toContain('--dl-category-color:#00ff00');
    expect(html).toContain('--dl-category-color:#123456');
    expect(html).toContain('--dl-category-color:#654321');
    expect(html).toContain(`--dl-category-color:${getCategoryColor('Low')}`);
    expect(html.match(/class="dl-category-cell"/g)).toHaveLength(4);
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('is-cell-selected');
    expect(html).toContain('<span class="dl-null">null</span>');
  });
  test('display colors do not alter clipboard data or SPSS codes', () => {
    expect(selectionTSV(rows, columns, { rowIds: ['r1'], cells: [] })).toBe('1\t42\ttrue\t"[""High"",""Low""]"\t');
  });
  test('uses the chosen palette for unassigned values while explicit colors win', () => {
    const html = markup(true, { tags: 'earth', group: 'pastel' });
    expect(html).toContain(`--dl-category-color:${getCategoryColor('Low', undefined, 'earth')}`);
    expect(html).toContain('--dl-category-color:#654321');
    expect(html).toContain('--dl-category-color:#ff0000');
    expect(html).not.toContain(`--dl-category-color:${getCategoryColor('Low', undefined, 'classic')}`);
    expect(markup(false, { tags: 'earth' })).not.toContain('dl-category-cell');
  });
  test('uses the same frequency rank as the chart for uncustomized table values', () => {
    const ranks = categoryColorRanks([
      { value: 'Low', background: 20, foreground: 20, rBackground: 0.8, rForeground: 0.8 },
      { value: 'High', background: 5, foreground: 5, rBackground: 0.2, rForeground: 0.2 },
    ]);
    const html = markup(true, { tags: 'tableau' }, new Map([['tags', ranks]]));
    expect(html).toContain(`--dl-category-color:${getCategoryColor('Low', undefined, 'tableau', ranks)}`);
    expect(html).toContain('--dl-category-color:#654321');
  });
});
