import { expect, test } from 'bun:test';
import * as vega from 'vega';
import { buildBrushingSpec } from './brushing-spec';
import { createHistogramUpdater } from './histogram-data';

for (const isDate of [false, true]) test(`${isDate ? 'date' : 'numeric'} crossfilters update Vega tuples without replacing bars`, async () => {
  const chart = new vega.View(vega.parse(buildBrushingSpec({ isDate, width: 272, height: 72, foregroundColor: '#00f', backgroundColor: '#999', brushColor: '#00f', axisLabelColor: '#777', axisLineColor: '#777' })), { renderer: 'none' });
  const update = createHistogramUpdater(vega, isDate);
  const bins = [0, 1].map(index => ({ left: index * 86400000, right: (index + 1) * 86400000, background: 20, foreground: 20, rBackground: .5, rForeground: .5 }));
  await chart.change('data', update(bins)!).runAsync();
  const original = [...chart.data('data')];
  const filtered = bins.map(bin => ({ ...bin, foreground: 3, rForeground: .2 }));
  await chart.change('data', update(filtered)!).runAsync();
  const after = chart.data('data');
  expect(after[0]).toBe(original[0]); expect(after[1]).toBe(original[1]);
  expect(after[0].foreground).toBe(3); expect(after[0].rForeground).toBe(.2);
  expect(after[0].left).toBe(isDate ? '1970-01-01T00:00:00.000Z' : 0);
  expect(update(filtered.map(bin => ({ ...bin })))).toBeNull();
  // Two cached filter changes can reach Vega before its previous run completes.
  const firstRun = chart.change('data', update(bins)!).runAsync();
  const latestChanges = update(filtered);
  expect(latestChanges).not.toBeNull();
  const latestRun = chart.change('data', latestChanges!).runAsync();
  await Promise.all([firstRun, latestRun]);
  expect(chart.data('data')[0].foreground).toBe(3);
  await chart.change('data', update([filtered[1]])!).runAsync();
  expect(chart.data('data')).toHaveLength(1);
  expect(chart.data('data')[0]).toBe(original[1]);
  await chart.change('data', update([])!).runAsync();
  expect(chart.data('data')).toHaveLength(0);
  chart.finalize();
});
