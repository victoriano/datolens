import { describe, expect, test } from 'bun:test';
import type { Column, Distribution } from '../../contracts/desktop-api';
import { significanceScore, significantVariables } from './significant-variables';

const columns: Column[] = [
  { id: 'price', name: 'Precio', kind: 'numeric', dataType: 'DOUBLE' },
  { id: 'city', name: 'Ciudad', kind: 'categorical', dataType: 'VARCHAR' },
];
const price: Distribution = { column: 'price', kind: 'numeric', bins: [
  { background: 50, foreground: 0, rBackground: .5, rForeground: 0 },
  { background: 50, foreground: 20, rBackground: .5, rForeground: 1 },
] };
const city: Distribution = { column: 'city', kind: 'categorical', bins: [
  { value: 'A', background: 20, foreground: 8, rBackground: .2, rForeground: .4 },
  { value: 'B', background: 80, foreground: 12, rBackground: .8, rForeground: .6 },
] };

describe('significant variables', () => {
  test('ranks the largest selection versus whole-dataset difference first', () => {
    const ranked = significantVariables(columns, [city, price], 20, 100);
    expect(ranked.map(item => item.column)).toEqual(['price', 'city']);
    expect(ranked[0].score).toBeCloseTo(.5);
    expect(ranked[1].score).toBeCloseTo(.2);
    expect(significantVariables(columns, [price], 100, 100)).toEqual([]);
    expect(significantVariables(columns, [price], 0, 100)).toEqual([]);
  });
  test('includes omitted categorical values as one residual bucket', () => {
    const truncated: Distribution = { column: 'city', kind: 'categorical', truncated: true, bins: [
      { value: 'A', background: 20, foreground: 8, rBackground: .2, rForeground: .4 },
    ] };
    expect(significanceScore(truncated, 20, 100)).toBeCloseTo(.2);
  });
  test('normalizes multi-valued incidences and avoids incomplete rankings', () => {
    const list: Distribution = { column: 'tags', kind: 'multivalued', bins: [
      { value: 'A', background: 80, foreground: 8, rBackground: .8, rForeground: .4 },
      { value: 'B', background: 20, foreground: 12, rBackground: .2, rForeground: .6 },
      { value: 'C', background: 100, foreground: 20, rBackground: 1, rForeground: 1 },
    ] };
    expect(significanceScore(list, 20, 100)).toBeCloseTo(.2);
    expect(significanceScore({ ...list, truncated: true }, 20, 100)).toBe(0);
  });
});
