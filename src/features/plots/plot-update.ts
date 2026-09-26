import type { Spec, changeset } from 'vega';
import type { PlotResult } from './types';

export function sharePlotRows<T extends object>(previous: T[], incoming: T[]): T[] {
  const equal = (a: T, b: T) => {
    const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && Object.is(left[key], right[key]));
  };
  return previous.length === incoming.length && incoming.every((row, i) => equal(previous[i], row)) ? previous : incoming;
}
export function sharePlotResult(previous: PlotResult | null, incoming: PlotResult): PlotResult {
  if (!previous || previous.datasetRevision !== incoming.datasetRevision) return incoming;
  const rows = sharePlotRows(previous.rows, incoming.rows);
  return rows === previous.rows && JSON.stringify({ ...previous, rows: null }) === JSON.stringify({ ...incoming, rows: null }) ? previous : { ...incoming, rows };
}

type Values = Record<string, unknown>[];
export function plotSpecParts(spec: Spec) {
  const data = spec.data as Array<{ name: string; values?: Values }> | undefined;
  return { values: data?.find(data => data.name === 'values')?.values ?? [], structure: JSON.stringify({ ...spec, data: data?.map(data => data.name === 'values' ? { ...data, values: [] } : data) }) };
}
const rowKey = (row: Record<string, unknown>) => JSON.stringify([row.id, row.d0, row.d0End, row.d1, row.d1End, row.d2, row.d3, row.series]);

/** Preserve the Vega view, scales, handlers and tuples when only measures change. */
export function createPlotUpdater(vega: { changeset: typeof changeset }, initial: Values) {
  let tuples = initial, keys = initial.map(rowKey), previous = initial.map(row => ({ ...row }));
  return (values: Values) => {
    const nextKeys = values.map(rowKey), changes = vega.changeset();
    if (keys.length !== nextKeys.length || keys.some((key, i) => key !== nextKeys[i])) {
      changes.remove(() => true).insert(values); tuples = values; keys = nextKeys; previous = values.map(row => ({ ...row }));
      return changes;
    }
    let changed = false;
    values.forEach((row, i) => {
      for (const field of new Set([...Object.keys(previous[i]), ...Object.keys(row)])) {
        const before = previous[i][field], after = row[field];
        if (Object.is(before, after) || (before && after && typeof before === 'object' && typeof after === 'object' && JSON.stringify(before) === JSON.stringify(after))) continue;
        changes.modify(tuples[i], field, after); changed = true;
      }
    });
    previous = values.map(row => ({ ...row }));
    return changed ? changes : null;
  };
}
