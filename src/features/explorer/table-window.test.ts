import { describe, expect, test } from 'bun:test';
import { sameTableColumnWindow, tableColumnWindow } from './table-window';
import type { Column } from '../../contracts/desktop-api';
const columns: Column[] = Array.from({ length: 4911 }, (_, i) => ({ id: `c${i}`, name: `c${i}`, dataType: 'VARCHAR', kind: 'text' }));
describe('wide table projection', () => {
  test('4911 columns open with a bounded projection and retain full scroll extent', () => {
    const window = tableColumnWindow(columns, {}, 0, 1200);
    expect(window.start).toBe(0);
    expect(window.end).toBeLessThan(12);
    expect(window.total).toBe(4911 * 180 + 48);
    expect(window.before + (window.end - window.start) * 180 + window.after + 48).toBe(window.total);
  });
  test('middle and last columns remain reachable', () => {
    for (const left of [180000, 4911 * 180]) {
      const window = tableColumnWindow(columns, {}, left, 1200);
      expect(window.end - window.start).toBeLessThan(13);
      expect(window.start).toBeGreaterThan(900);
      expect(window.before + (window.end - window.start) * 180 + window.after + 48).toBe(window.total);
    }
    expect(tableColumnWindow(columns, {}, 4911 * 180, 1200).end).toBe(4911);
  });
  test('resizing, hiding and reordering preserve viewport coverage', () => {
    const reordered = [columns[8], columns[0], columns[3], columns[5]];
    const window = tableColumnWindow(reordered, { c8: 800, c0: 90 }, 820, 90);
    expect(reordered.slice(window.start, window.end).map(c => c.id)).toContain('c0');
    expect(window.total).toBe(1298);
    expect(tableColumnWindow([], {}, 1000, 1200)).toEqual({ start: 0, end: 0, before: 0, after: 0, total: 48 });
  });
});

test('horizontal pixels inside the same projected window do not trigger another render', () => {
  expect(sameTableColumnWindow(tableColumnWindow(columns, {}, 1, 1200), tableColumnWindow(columns, {}, 2, 1200))).toBe(true);
  expect(sameTableColumnWindow(tableColumnWindow(columns, {}, 1, 1200), tableColumnWindow(columns, {}, 500, 1200))).toBe(false);
});
