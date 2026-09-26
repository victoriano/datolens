import type { Column, Filter } from '../../contracts/desktop-api';
import type { VariableStatistics } from '../../contracts/analysis';

export type QuantileFilterKey = 'p25' | 'median' | 'p75';

const bounds: Record<QuantileFilterKey, readonly [keyof VariableStatistics, keyof VariableStatistics]> = {
  p25: ['min', 'p25'],
  median: ['p25', 'p75'],
  p75: ['p75', 'max'],
};

function statisticValue(value: string | null, kind: Column['kind']): number | null {
  if (value === null) return null;
  if (kind === 'date') {
    // DuckDB returns timestamps without a zone; the date filter uses UTC ISO values.
    const timestamp = value.includes(' ') ? value.replace(' ', 'T') : value;
    const utc = /(?:Z|[+-]\d\d(?::?\d\d)?)$/i.test(timestamp) || /^\d{4}-\d{2}-\d{2}$/.test(timestamp)
      ? timestamp : `${timestamp}Z`;
    const parsed = Date.parse(utc);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const parsed = Number(value);
  // A numeric filter travels through JavaScript Number; do not round large integer IDs.
  if (!Number.isFinite(parsed) || Math.abs(parsed) > Number.MAX_SAFE_INTEGER) return null;
  return parsed;
}

/** Quantile shortcuts use unfiltered values, matching Datoflow's fixed ranges. */
export function quantileFilter(column: Column, statistics: VariableStatistics | undefined, key: QuantileFilterKey): Filter | null {
  if (!statistics || (column.kind !== 'numeric' && column.kind !== 'date')) return null;
  const [startKey, endKey] = bounds[key];
  const start = statisticValue(statistics[startKey] as string | null, column.kind);
  const end = statisticValue(statistics[endKey] as string | null, column.kind);
  if (start === null || end === null || start > end) return null;
  return column.kind === 'date'
    ? { column: column.id, kind: 'date', start: new Date(start).toISOString(), end: new Date(end).toISOString() }
    : { column: column.id, kind: 'numeric', min: start, max: end };
}

export function isSameRange(current: Filter | undefined, candidate: Filter | null): boolean {
  if (!current || !candidate || current.kind !== candidate.kind) return false;
  if (current.kind === 'numeric' && candidate.kind === 'numeric') return current.min === candidate.min && current.max === candidate.max;
  if (current.kind === 'date' && candidate.kind === 'date') return current.start === candidate.start && current.end === candidate.end;
  return false;
}
