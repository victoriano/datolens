import { expect, test } from 'bun:test';
import type { Column } from '../../contracts/desktop-api';
import type { VariableStatistics } from '../../contracts/analysis';
import { isSameRange, quantileFilter } from './statistic-filters';

const numeric: Column = { id: 'revenue', name: 'Facturación', kind: 'numeric', dataType: 'DOUBLE' };
const statistics: VariableStatistics = { count: 5, missing: 0, distinct: 5, min: '0', p25: '25', median: '50', mean: '50', p75: '75', max: '100' };

test('quantile controls use fixed unfiltered quarters and replace the range for this column', () => {
  expect(quantileFilter(numeric, statistics, 'p25')).toEqual({ column: 'revenue', kind: 'numeric', min: 0, max: 25 });
  expect(quantileFilter(numeric, statistics, 'median')).toEqual({ column: 'revenue', kind: 'numeric', min: 25, max: 75 });
  const upper = quantileFilter(numeric, statistics, 'p75');
  expect(upper).toEqual({ column: 'revenue', kind: 'numeric', min: 75, max: 100 });
  expect(isSameRange(upper ?? undefined, upper)).toBe(true);
  expect(isSameRange({ column: 'revenue', kind: 'numeric', min: 25, max: 75 }, upper)).toBe(false);
});

test('date statistics from DuckDB become UTC inclusive filter endpoints', () => {
  const date: Column = { id: 'created', name: 'Fecha', kind: 'date', dataType: 'DATE' };
  const dated = { ...statistics, min: '2024-01-01 00:00:00', p25: '2024-02-01 00:00:00', p75: '2024-04-01 00:00:00', max: '2024-05-01 00:00:00' };
  expect(quantileFilter(date, dated, 'median')).toEqual({ column: 'created', kind: 'date', start: '2024-02-01T00:00:00.000Z', end: '2024-04-01T00:00:00.000Z' });
});

test('missing or unsafe statistics cannot create a rounded filter', () => {
  expect(quantileFilter(numeric, { ...statistics, p25: null }, 'p25')).toBeNull();
  expect(quantileFilter(numeric, { ...statistics, p25: '9007199254740993' }, 'p25')).toBeNull();
  expect(quantileFilter(numeric, { ...statistics, p25: '9.007199254740993e15' }, 'p25')).toBeNull();
  expect(quantileFilter(numeric, { ...statistics, min: '40', p25: '25' }, 'p25')).toBeNull();
});
