import { expect, test } from 'bun:test';
import type { DesktopApi, Page } from '../../contracts/desktop-api';
import { MAX_TABLE_COLUMNS, nextTablePageFrame, reconcileTablePage, tablePageCovers } from './table-page';

const api = {} as DesktopApi;
const page = (ids: string[], columns = ['a'], count = 100): Page => ({ datasetRevision: 'r1', filteredCount: count, rows: ids.map(id => ({ id, values: Object.fromEntries(columns.map(column => [column, `${id}:${column}`])) })) });
const request = { api, source: 'pisa:r1', key: 'all:0', offset: 0, columns: ['a'] };

test('unchanged filter results preserve both the page and rows; surviving rows are matched by ID', () => {
  const previous = page(['r0', 'r1', 'r2']);
  expect(reconcileTablePage(previous, structuredClone(previous))).toBe(previous);
  const filtered = reconcileTablePage(previous, page(['r2', 'r0', 'r3'], ['a'], 3));
  expect(filtered.rows[0]).toBe(previous.rows[2]); expect(filtered.rows[1]).toBe(previous.rows[0]);
  expect(filtered.rows[2].id).toBe('r3'); expect(filtered.filteredCount).toBe(3);
});
test('changing one value keeps other cells, including nested values and exact integers, shared', () => {
  const previous: Page = { datasetRevision: 'r1', filteredCount: 1, rows: [{ id: 'r0', values: { exact: '9223372036854775808', nested: { a: [1, null, true] }, edited: 10 } }] };
  const incoming = structuredClone(previous); incoming.rows[0].values.edited = 11;
  const next = reconcileTablePage(previous, incoming);
  expect(next.rows[0]).not.toBe(previous.rows[0]);
  expect(next.rows[0].values.nested).toBe(previous.rows[0].values.nested);
  expect(next.rows[0].values.exact).toBe('9223372036854775808'); expect(next.rows[0].values.edited).toBe(11);
  expect(reconcileTablePage(previous, { ...incoming, datasetRevision: 'r2' }).rows).toBe(incoming.rows);
});
test('horizontal projections retain earlier columns and accurately track complete coverage', () => {
  const first = nextTablePageFrame(null, request, page(['r0', 'r1']));
  const second = nextTablePageFrame(first, { ...request, columns: ['b'] }, page(['r0', 'r1'], ['b']));
  expect(second.columns).toEqual(['a', 'b']); expect(second.page.rows[0].values).toEqual({ a: 'r0:a', b: 'r0:b' });
  expect(tablePageCovers(second, 'all:0', ['a', 'b'])).toBe(true);
  expect(tablePageCovers(second, 'all:0', ['c'])).toBe(false);
  expect(tablePageCovers(second, 'filtered:0', ['a'])).toBe(false);
  const changed = nextTablePageFrame(second, { ...request, key: 'filtered:0', columns: ['b'] }, page(['r1', 'r2'], ['b']));
  expect(changed.columns).toEqual(['b']); // New rows do not inherit another row's unqueried values.
  expect(changed.page.rows[1].values).toEqual({ b: 'r2:b' });
});
test('projections never cross a dataset, API or revision boundary', () => {
  const previous = nextTablePageFrame(null, request, page(['r0']));
  for (const next of [{ ...request, source: 'other:r1', columns: ['b'] }, { ...request, api: {} as DesktopApi, columns: ['b'] }]) {
    expect(nextTablePageFrame(previous, next, page(['r0'], ['b'])).page.rows[0].values).toEqual({ b: 'r0:b' });
  }
  expect(nextTablePageFrame(previous, { ...request, columns: ['b'] }, { ...page(['r0'], ['b']), datasetRevision: 'r2' }).page.rows[0].values).toEqual({ b: 'r0:b' });
});
test('wide horizontal scrolling keeps at most 64 projected columns per page', () => {
  let frame = nextTablePageFrame(null, request, page(['r0', 'r1']));
  for (let i = 0; i < 246; i++) frame = nextTablePageFrame(frame, { ...request, columns: [`c${i}`] }, page(['r0', 'r1'], [`c${i}`]));
  expect(frame.columns).toHaveLength(MAX_TABLE_COLUMNS);
  expect(Object.keys(frame.page.rows[0].values)).toHaveLength(MAX_TABLE_COLUMNS);
  expect(tablePageCovers(frame, 'all:0', ['c245'])).toBe(true);
  expect(tablePageCovers(frame, 'all:0', ['c0'])).toBe(false);
});
test('an empty filtered page is final and does not require more horizontal queries', () => {
  const previous = nextTablePageFrame(null, request, page(['r0']));
  const empty = nextTablePageFrame(previous, { ...request, key: 'empty:0' }, page([], ['a'], 0));
  expect(empty.page.rows).toHaveLength(0); expect(empty.page.filteredCount).toBe(0);
  expect(tablePageCovers(empty, 'empty:0', ['unseen'])).toBe(true);
});
test('cache eviction preserves the whole viewport when scrolling into older cached columns', () => {
  const columns = Array.from({ length: MAX_TABLE_COLUMNS }, (_, i) => `c${i + 1}`);
  const previous = nextTablePageFrame(null, { ...request, columns }, page(['r0'], columns));
  const visible = ['c0', 'c1', 'c2', 'c3'];
  const next = nextTablePageFrame(previous, { ...request, columns: ['c0'] }, page(['r0'], ['c0']), visible);
  expect(next.columns).toHaveLength(MAX_TABLE_COLUMNS);
  expect(tablePageCovers(next, request.key, visible)).toBe(true);
  for (const id of visible) expect(next.page.rows[0].values[id]).toBe(`r0:${id}`);
});
