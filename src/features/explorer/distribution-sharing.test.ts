import { expect, test } from 'bun:test';
import type { Distribution } from '../../contracts/desktop-api';
import { shareDistribution } from './distribution-sharing';

const distribution = (): Distribution => ({ column: 'a', kind: 'categorical', bins: ['A', 'B', null].map(value => ({ value, background: 20, foreground: 10, rBackground: .2, rForeground: .1 })), statistics: { count: 30, missing: 1, distinct: 2, min: null, p25: null, median: null, mean: null, p75: null, max: null } });
test('equal IPC distributions preserve chart, bin array, bars and statistics', () => {
  const before = distribution();
  expect(shareDistribution(before, structuredClone(before))).toBe(before);
});
test('only the changed category gets a new object; equal bars survive sorting', () => {
  const before = distribution(), incoming = structuredClone(before);
  incoming.bins[0].foreground = 9;
  const next = shareDistribution(before, incoming);
  expect(next.bins[0]).not.toBe(before.bins[0]); expect(next.bins[1]).toBe(before.bins[1]);
  expect(next.bins[2]).toBe(before.bins[2]); expect(next.statistics).toBe(before.statistics);
  const reordered = shareDistribution(before, { ...structuredClone(before), bins: [...structuredClone(before.bins)].reverse() });
  expect(reordered.bins[0]).toBe(before.bins[2]); expect(reordered.bins[2]).toBe(before.bins[0]);
});
test('relative counts, bounds, labels, added/removed bins and metadata are not hidden by memoization', () => {
  const before = distribution();
  for (const edit of [(d: Distribution) => { d.bins[0].rForeground = .3; }, (d: Distribution) => { d.bins[0].background = 30; }, (d: Distribution) => { d.bins[0].value = 'new'; }, (d: Distribution) => { d.bins[0].left = 1; }, (d: Distribution) => { d.bins.pop(); }, (d: Distribution) => { d.truncated = true; }]) {
    const incoming = structuredClone(before); edit(incoming);
    const next = shareDistribution(before, incoming);
    expect(next).not.toBe(before); expect(next).toEqual(incoming);
  }
});
test('statistics-only changes preserve bins, and removed statistics stay removed', () => {
  const before = distribution(), incoming = structuredClone(before); incoming.statistics!.missing = 5;
  const next = shareDistribution(before, incoming);
  expect(next.bins).toBe(before.bins); expect(next.statistics).toEqual(incoming.statistics);
  expect(shareDistribution(before, { ...before, statistics: undefined }).statistics).toBeUndefined();
  expect(shareDistribution(before, { ...before, kind: 'text' })).not.toBe(before);
});
