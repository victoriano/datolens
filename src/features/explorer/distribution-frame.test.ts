import { expect, test } from 'bun:test';
import type { DesktopApi, Distributions } from '../../contracts/desktop-api';
import { nextDistributionFrame } from './distribution-frame';

const api = {} as DesktopApi;
const request = { api, source: 'pisa:r1:auto', context: 'all', filtered: false };
const result = (ids: string[], selectedCount = 5000): Distributions => ({ variables: ids.map(column => ({ column, kind: 'numeric', bins: [] })), selectedCount, totalRows: 191254, analyzedRows: 5000, sampled: true });

test('crossfilter batches retain the entire old frame until the requested viewport is ready', () => {
  const previous = nextDistributionFrame(null, request, result(['a', 'b', 'offscreen']), ['a', 'b']);
  const filtered = { ...request, context: 'filtered', filtered: true };
  expect(nextDistributionFrame(previous, filtered, result(['a'], 42), ['a', 'b'])).toBe(previous);
  const next = nextDistributionFrame(previous, filtered, result(['a', 'b'], 42), ['a', 'b']);
  expect(next.result.selectedCount).toBe(42);
  expect(next.result.variables.map(v => v.column)).toEqual(['a', 'b']); // no stale offscreen column
  expect(next.filtered).toBe(true);
});
test('first load remains progressive, while scrolling preserves valid same-filter cards', () => {
  const first = nextDistributionFrame(null, request, result(['a']), ['a', 'b']);
  const next = nextDistributionFrame(first, request, result(['b']), ['b', 'c']);
  expect(next.result.variables[0]).toBe(first.result.variables[0]);
  expect(next.result.variables.map(v => v.column)).toEqual(['a', 'b']);
});
test('old charts never cross an API, dataset, revision, or sample boundary', () => {
  const previous = nextDistributionFrame(null, request, result(['old']), ['old']);
  for (const changed of [{ ...request, source: 'other:r1:auto' }, { ...request, source: 'pisa:r2:auto' }, { ...request, source: 'pisa:r1:full' }, { ...request, api: {} as DesktopApi }]) {
    const next = nextDistributionFrame(previous, changed, result(['new']), ['new', 'later']);
    expect(next.result.variables.map(v => v.column)).toEqual(['new']);
  }
});
test('empty selections and deliberate analysis deferral replace the prior frame', () => {
  const previous = nextDistributionFrame(null, request, result(['a', 'b']), ['a', 'b']);
  const filtered = { ...request, context: 'none', filtered: true };
  expect(nextDistributionFrame(previous, filtered, result(['a', 'b'], 0), ['a', 'b']).result.selectedCount).toBe(0);
  const deferred = { ...result([], 0), deferredReason: 'remote_source' as const };
  expect(nextDistributionFrame(previous, filtered, deferred, ['a', 'b']).result).toBe(deferred);
});
test('equal charts survive a new filter context without retaining old offscreen populations', () => {
  const previous = nextDistributionFrame(null, request, result(['a', 'b', 'offscreen']), ['a', 'b']);
  const next = nextDistributionFrame(previous, { ...request, context: 'filtered', filtered: true }, result(['a', 'b'], 123), ['a', 'b']);
  expect(next.context).toBe('filtered'); expect(next.result.selectedCount).toBe(123);
  expect(next.result.variables).toHaveLength(2);
  expect(next.result.variables[0]).toBe(previous.result.variables[0]);
  expect(next.result.variables[1]).toBe(previous.result.variables[1]);
  const revised = nextDistributionFrame(next, { ...request, source: 'pisa:r2:auto' }, result(['a', 'b']), ['a', 'b']);
  expect(revised.result.variables[0]).not.toBe(next.result.variables[0]);
});
