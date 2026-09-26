import { afterAll, beforeAll, expect, test } from 'bun:test';
import { formatStatistic } from './VariableAnalysisControls';
import { getUiSnapshot } from '../../ui';

const previousTimezone = process.env.TZ;
beforeAll(() => { process.env.TZ = 'Europe/Madrid'; });
afterAll(() => { if (previousTimezone === undefined) delete process.env.TZ; else process.env.TZ = previousTimezone; });
const label = (iso: string) => new Date(iso).toLocaleDateString(getUiSnapshot().locale, {
  timeZone: 'UTC', day: '2-digit', month: 'short', year: '2-digit',
});

test('DuckDB date statistics keep their UTC day in Madrid winter and summer', () => {
  expect(formatStatistic('2024-01-01 00:00:00', 'date')).toBe(label('2024-01-01T00:00:00Z'));
  expect(formatStatistic('2024-07-01 00:00:00', 'date')).toBe(label('2024-07-01T00:00:00Z'));
  expect(formatStatistic('2024-01-01', 'date')).toBe(label('2024-01-01T00:00:00Z'));
});

test('explicit timestamp offsets are preserved when displaying statistics in UTC', () => {
  expect(formatStatistic('2024-01-01T00:30:00+02:00', 'date')).toBe(label('2023-12-31T22:30:00Z'));
  expect(formatStatistic('2024-01-01T23:30:00-02:00', 'date')).toBe(label('2024-01-02T01:30:00Z'));
});

test('missing and invalid date statistics retain their fallback display', () => {
  expect(formatStatistic(null, 'date')).toBe('—');
  expect(formatStatistic('not-a-date', 'date')).toBe('not-a-date');
});

test('DuckDB mean timestamps with hour-only offsets use localized UTC dates', () => {
  expect(formatStatistic('2024-01-02 13:00:00+01', 'date')).toBe(label('2024-01-02T12:00:00Z'));
  expect(formatStatistic('2024-01-01 00:30:00+01', 'date')).toBe(label('2023-12-31T23:30:00Z'));
  expect(formatStatistic('2024-01-01 23:30:00-02', 'date')).toBe(label('2024-01-02T01:30:00Z'));
});
