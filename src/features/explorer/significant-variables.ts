import type { Column, Distribution } from '../../contracts/desktop-api';

export interface SignificantVariable { column: string; score: number }

/** Total variation distance between the filtered rows and the whole dataset. */
export function significanceScore(distribution: Distribution, selectedRows: number, totalRows: number): number {
  if (selectedRows <= 0 || totalRows <= 0 || selectedRows >= totalRows || distribution.bins.length === 0) return 0;
  const bins = distribution.bins;
  if (distribution.kind === 'multivalued') {
    // A row can contribute to several list values. Normalize incidences, not rows.
    // A truncated list has no known remainder, so ranking it would mislead.
    if (distribution.truncated) return 0;
    const background = bins.reduce((sum, bin) => sum + bin.background, 0);
    const foreground = bins.reduce((sum, bin) => sum + bin.foreground, 0);
    if (!background || !foreground) return 0;
    return bins.reduce((sum, bin) => sum + Math.abs(bin.foreground / foreground - bin.background / background), 0) / 2;
  }
  const background = bins.reduce((sum, bin) => sum + bin.background, 0);
  const foreground = bins.reduce((sum, bin) => sum + bin.foreground, 0);
  const distance = bins.reduce((sum, bin) => sum + Math.abs(bin.foreground / selectedRows - bin.background / totalRows), 0);
  // Native categorical distributions may contain only the top 256 values.
  // Keep the omitted values as one aggregate bin so the mass sums to one.
  const remainder = Math.abs(Math.max(0, selectedRows - foreground) / selectedRows - Math.max(0, totalRows - background) / totalRows);
  return Math.min(1, (distance + remainder) / 2);
}

export function significantVariables(columns: Column[], distributions: Distribution[], selectedRows: number, totalRows: number): SignificantVariable[] {
  const valid = new Set(columns.map(column => column.id));
  return distributions.filter(distribution => valid.has(distribution.column)).map(distribution => ({
    column: distribution.column,
    score: significanceScore(distribution, selectedRows, totalRows),
  })).filter(item => item.score > 0.005).sort((a, b) => b.score - a.score || a.column.localeCompare(b.column));
}
