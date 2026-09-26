import { expect, test } from 'bun:test';
import * as vega from 'vega';
import { createPlotUpdater, plotSpecParts, sharePlotResult } from './plot-update';
import { buildSpec } from './spec';
import { defaultConfig } from './model';
import { chartRows } from './series';
import type { PlotResult } from './types';

test('unchanged plot results keep identity while metadata and revisions remain accurate', () => {
  const before: PlotResult = { rows: [{ d0: 'A', m0: 3 }], matchedRows: 3, totalRows: 10, plottedRows: 3, truncated: false, datasetRevision: 'r1', selectionMethod: 'allGroups' };
  expect(sharePlotResult(before, structuredClone(before))).toBe(before);
  const next = sharePlotResult(before, { ...structuredClone(before), matchedRows: 5 });
  expect(next.rows).toBe(before.rows); expect(next.matchedRows).toBe(5);
  expect(sharePlotResult(before, { ...structuredClone(before), datasetRevision: 'r2' }).rows).not.toBe(before.rows);
});
test('plot shape excludes only values, retaining axis and regression changes', () => {
  const first: vega.Spec = { data: [{ name: 'values', values: [{ d0: 'A', m0: 3 }] }], width: 300 };
  expect(plotSpecParts(first).structure).toBe(plotSpecParts({ ...first, data: [{ name: 'values', values: [{ d0: 'A', m0: 8 }] }] }).structure);
  expect(plotSpecParts(first).structure).not.toBe(plotSpecParts({ ...first, width: 400 }).structure);
});
test('measure updates preserve Vega tuples, skip equal values and keep the latest queued update', async () => {
  const initial = [{ d0: 'A', m0: 3, tooltip: { count: '3' } }, { d0: 'B', m0: 5, tooltip: { count: '5' } }];
  const chart = new vega.View(vega.parse({ data: [{ name: 'values', values: initial }] }), { renderer: 'none' });
  await chart.runAsync(); const original = [...chart.data('values')], update = createPlotUpdater(vega, initial);
  expect(update(structuredClone(initial))).toBeNull();
  const next = [{ d0: 'A', m0: 4, tooltip: { count: '4' } }, { ...initial[1] }];
  await chart.change('values', update(next)!).runAsync();
  expect(chart.data('values')[0]).toBe(original[0]); expect(chart.data('values')[1]).toBe(original[1]);
  expect(chart.data('values')[0].m0).toBe(4); expect(chart.data('values')[0].tooltip.count).toBe('4');
  const firstRun = chart.change('values', update([{ ...next[0], m0: 8 }, next[1]])!).runAsync();
  const last = chart.change('values', update(next)!).runAsync(); await Promise.all([firstRun, last]);
  expect(chart.data('values')[0].m0).toBe(4);
  await chart.change('values', update([...next].reverse())!).runAsync();
  expect(chart.data('values').map(row => row.d0)).toEqual(['B', 'A']);
  await chart.change('values', update([])!).runAsync(); expect(chart.data('values')).toHaveLength(0);
  chart.finalize();
});

test('retained categorical scales follow the current row order after removing and restoring groups', async () => {
  const columns = [{ id: 'group', name: 'Group', kind: 'categorical' as const, dataType: 'VARCHAR' }];
  const config = { ...defaultConfig('bar', columns, ['group']), x: 'group' };
  const result: PlotResult = { rows: [{ d0: 'A', m0: 3 }, { d0: 'B', m0: 5 }], matchedRows: 8, totalRows: 8, plottedRows: 8, truncated: false, datasetRevision: 'r1', selectionMethod: 'allGroups' };
  const spec = (rows: PlotResult['rows']) => buildSpec(config, chartRows(config, { ...result, rows }, columns), columns, result, 400, 300);
  const initial = spec(result.rows), first = plotSpecParts(initial);
  const chart = new vega.View(vega.parse(initial), { renderer: 'none' });
  await chart.runAsync(); const update = createPlotUpdater(vega, first.values);
  for (const rows of [[result.rows[1]], result.rows]) {
    const next = plotSpecParts(spec(rows));
    expect(next.structure).toBe(first.structure);
    await chart.change('values', update(next.values)!).runAsync();
    expect(chart.scale('x').domain()).toEqual(rows.map(row => row.d0));
  }
  chart.finalize();
});
