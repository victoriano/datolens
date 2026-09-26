import { expect, test } from 'bun:test';
import { createQueryQueue, normalizeSampling } from './sampling';
import { initialView, reconcileView } from './model';
import { queryDistributions } from './distributions';
import type { Dataset, DesktopApi } from '../../contracts/desktop-api';

test('sampling preferences survive view reconciliation; malformed values fall back to auto', () => {
  const dataset: Dataset = { id: 'test', name: 'test', sourcePath: '/test.csv', revision: '1', rowCount: 1_000_000, columns: [] };
  for (const value of [{ mode: 'auto' }, { mode: 'full' }, { mode: 'rows', rows: 25_000 }] as const) {
    expect(reconcileView(dataset, { ...initialView(dataset), analysisSampling: value }).analysisSampling).toEqual(value);
  }
  for (const value of [null, { mode: 'rows', rows: 0 }, { mode: 'rows', rows: Infinity }, { mode: 'rows', rows: 5_000_001 }, { mode: 'rows', rows: 1.5 }, { mode: 'rows', rows: '100' }, { mode: 'bad' }]) {
    expect(normalizeSampling(value)).toEqual({ mode: 'auto' });
  }
});

test('queued obsolete calls are skipped and a failure does not poison the next query', async () => {
  const queue = createQueryQueue();
  let release!: () => void;
  const started: string[] = [];
  const first = queue(async () => { started.push('first'); await new Promise<void>(resolve => { release = resolve; }); throw new Error('test failure'); }, () => false).catch(() => null);
  await Promise.resolve();
  let stale = false;
  const second = queue(async () => { started.push('stale'); return 2; }, () => stale);
  const third = queue(async () => { started.push('latest'); return 3; }, () => false);
  stale = true; release();
  expect(await first).toBeNull(); expect(await second).toBeNull(); expect(await third).toBe(3);
  expect(started).toEqual(['first', 'latest']);
});

test('wide panel publishes batches promptly, requests only visible statistics and keeps one sample', async () => {
  const columns = Array.from({ length: 19 }, (_, i) => `col${i}`);
  const calls: Array<{ columns: string[]; statistics?: string[]; sampling?: unknown }> = [];
  const api = { getDistributions: async (request: Parameters<DesktopApi['getDistributions']>[0]) => {
    calls.push(request);
    return { variables: request.columns.map(column => ({ column, kind: 'numeric' as const, bins: [] })), selectedCount: 42, totalRows: 1_000_000, analyzedRows: 10_000, sampled: true };
  } } as DesktopApi;
  const partials: number[] = [];
  const result = await queryDistributions(api, 'test', columns, [], () => false, { sampling: { mode: 'rows', rows: 10_000 }, statistics: ['col2', 'col18'], onPartial: result => partials.push(result.variables.length) });
  expect(partials).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 19]);
  expect(calls.flatMap(call => call.statistics ?? [])).toEqual(['col2', 'col18']);
  expect(calls.every(call => call.columns.length <= 2)).toBe(true);
  expect(calls.every(call => JSON.stringify(call.sampling) === JSON.stringify({ mode: 'rows', rows: 10_000 }))).toBe(true);
  expect(result?.variables.map(variable => variable.column)).toEqual(columns);
});
