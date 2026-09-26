import type { Datum } from './series';

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/** Labels are presentation only: the full category and native boundaries remain on each datum. */
export function numericBinLabels(rows: Datum[], format: string, locale: string, placement: 'range' | 'start' | 'end' = 'range'): Map<string, string> {
  const bins = [...new Map(rows.filter(row => row.d0End !== null && row.d0End !== undefined)
    .map(row => [row.category, [Number(row.d0), Number(row.d0End)] as const] as const)).entries()]
    .filter(([, [start, end]]) => Number.isFinite(start) && Number.isFinite(end));
  if (!bins.length) return new Map();
  const boundaries = bins.flatMap(([, pair]) => pair);
  const widths = bins.map(([, [start, end]]) => Math.abs(end-start)).filter(value => value > 0);
  const smallest = Math.min(...widths);
  const magnitude = Math.max(...boundaries.map(Math.abs));
  const unit = magnitude >= 1e12 ? [1e12, 'T'] as const : magnitude >= 1e9 ? [1e9, 'G'] as const
    : magnitude >= 1e6 ? [1e6, 'M'] as const : magnitude >= 1e3 ? [1e3, 'k'] as const : [1, ''] as const;
  const autoDigits = Number.isFinite(smallest) ? clamp(Math.ceil(-Math.log10(smallest/unit[0])), 0, 8) : 0;
  const fixed = format.match(/^,?\.(\d)f$/);
  const percent = format.match(/^\.(\d)%$/);
  const scientific = format.match(/^\.(\d)e$/);
  const numberFormat = (digits: number) => new Intl.NumberFormat(locale, {maximumFractionDigits:digits,minimumFractionDigits:digits,useGrouping:format.startsWith(',')});
  const boundary = (value: number): string => {
    if (format === 'auto' || format === '~s') {
      const digits = format === 'auto' ? autoDigits : clamp(3 - Math.ceil(Math.log10(Math.max(Math.abs(value/unit[0]), 1))), 0, 6);
      return new Intl.NumberFormat(locale, {maximumFractionDigits:digits}).format(value/unit[0]) + unit[1];
    }
    if (fixed) return numberFormat(Number(fixed[1])).format(value);
    if (format === ',') return new Intl.NumberFormat(locale).format(value);
    if (percent) return new Intl.NumberFormat(locale, {style:'percent',minimumFractionDigits:Number(percent[1]),maximumFractionDigits:Number(percent[1])}).format(value);
    if (scientific) return value.toExponential(Number(scientific[1]));
    return String(value);
  };
  return new Map(bins.map(([key, [start, end]]) => [key, placement === 'start' ? boundary(start) : placement === 'end' ? boundary(end) : `${boundary(start)}–${boundary(end)}`]));
}

export function categoryLabelSignal(labels: Map<string, string>): string {
  return [...labels].reduceRight((fallback, [category, text]) => `datum.value === ${JSON.stringify(category)} ? ${JSON.stringify(text)} : (${fallback})`, 'datum.value');
}

/** Vega evaluates custom D3 formats using the chart locale. */
export function customBinLabelSignal(rows: Datum[], format: string, placement: 'range' | 'start' | 'end' = 'range'): string {
  const labels = new Map(rows.filter(row => row.d0End !== null && row.d0End !== undefined)
    .map(row => [row.category, [Number(row.d0), Number(row.d0End)] as const] as const));
  return [...labels].filter(([, [start, end]]) => Number.isFinite(start) && Number.isFinite(end))
    .reduceRight((fallback, [category, [start, end]]) =>
      `datum.value === ${JSON.stringify(category)} ? ${placement === 'start' ? `format(${start}, ${JSON.stringify(format)})` : placement === 'end' ? `format(${end}, ${JSON.stringify(format)})` : `format(${start}, ${JSON.stringify(format)}) + '–' + format(${end}, ${JSON.stringify(format)})`} : (${fallback})`, 'datum.value');
}

export const isPresetNumberFormat = (format: string): boolean =>
  ['auto','~s',',.0f',',.1f',',.2f',',','.0%','.1%','.2%','.2e'].includes(format);
