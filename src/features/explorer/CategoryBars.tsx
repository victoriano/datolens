import { memo, useMemo, useState, type CSSProperties } from 'react';
import type { Bin, Filter } from '../../contracts/desktop-api';
import { useI18n } from '../../ui';
import { sortCategoryBins, type CategorySortMode } from './category-sort';
import { categoryColorRanks, getCategoryColor, type CategoryColorOverrides } from './category-colors';

const FIRST_PAGE = 8;

function axisMaximum(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find(candidate => candidate * magnitude >= value / 4) ?? 10;
  return Math.ceil(value / (step * magnitude)) * step * magnitude;
}

function barInk(color: string | null): string {
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) return '#fff';
  const channels = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16) / 255).map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722 > .179 ? '#171717' : '#fff';
}

const CategoryBar = memo(function CategoryBar({ bin, relative, max, hasSelection, selected, labelValue, missing, color, compact, onToggle }: {
  bin: Bin; relative: boolean; max: number; hasSelection: boolean; selected: boolean;
  labelValue?: string; missing: boolean; color: string | null; compact: boolean; onToggle: (value: string) => void;
}) {
  const { t, locale } = useI18n();
  const value = bin.value ?? null;
  const label = value === null ? t('(vacío)') : labelValue ? `${value} · ${labelValue}` : value;
  const foregroundWidth = `${Math.min(100, Math.max(0, (relative ? bin.rForeground : bin.foreground) / max * 100))}%`;
  const backgroundWidth = `${Math.min(100, Math.max(0, (relative ? bin.rBackground : bin.background) / max * 100))}%`;
  return <button className={compact ? 'dl-category-row-compact' : undefined} disabled={value === null} aria-pressed={selected} onClick={() => value !== null && onToggle(value)} title={`${t('{value0} · Selección: {value1} ({value2}%) · Total: {value3}', { value0: label, value1: bin.foreground, value2: (bin.rForeground * 100).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }), value3: bin.background })}${missing ? ` · ${t('Valor perdido según SPSS')}` : ''}`}>
    {compact ? <span className="dl-compact-bar" style={{ '--bar-width': foregroundWidth, '--bar-ink': barInk(color) } as CSSProperties}>
      {hasSelection && <span className="dl-bar-background" style={{ width: backgroundWidth }} />}
      <span className="dl-bar-foreground" style={{ width: foregroundWidth, backgroundColor: color ?? 'var(--dl-subtle)' }} />
      <span className="dl-compact-label" aria-hidden="true">{label}</span><span className="dl-compact-label dl-compact-label-on-bar" aria-hidden="true">{label}</span>
    </span> : <><span className="dl-category-label">{label}</span><span className="dl-bar-track">{hasSelection && <span className="dl-bar-background" style={{ width: backgroundWidth }} />}<span className="dl-bar-foreground" style={{ width: foregroundWidth, backgroundColor: color ?? 'var(--dl-subtle)' }} /></span><span className="dl-bar-value">{relative ? `${(bin.rForeground * 100).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : bin.foreground.toLocaleString(locale)}</span></>}
  </button>;
});

export const CategoryBars = memo(function CategoryBars({ bins, filter, relative, sortMode, analyzedRows, hasSelection, expanded, search, onExpand, onToggle, valueLabels, missingValues, categoryColors, categoryPalette, categoryOrder, colorize = false }: {
  expanded: boolean; search: string; onExpand: () => void; bins: Bin[]; filter?: Filter;
  relative: boolean; sortMode: CategorySortMode; analyzedRows: number; hasSelection: boolean;
  onToggle: (value: string) => void; valueLabels?: Record<string, string>; missingValues?: string[]; categoryColors?: CategoryColorOverrides; categoryPalette?: string; categoryOrder?: string[]; colorize?: boolean;
}) {
  const { t, locale, categoryChartMode } = useI18n();
  const [pageSize, setPageSize] = useState(expanded ? FIRST_PAGE * 2 : FIRST_PAGE);
  const ranks = useMemo(() => categoryColorRanks(bins, missingValues), [bins, missingValues]);
  const sorted = useMemo(() => sortCategoryBins(bins.map(bin => bin.value === undefined ? { ...bin, value: null } : bin as Bin & { value: string | null }), sortMode, { analyzedRows, order: categoryOrder }), [bins, sortMode, analyzedRows, categoryOrder]);
  const query = search.trim().toLocaleLowerCase();
  const matching = useMemo(() => query ? sorted.filter(bin => (bin.value ?? '').toLocaleLowerCase().includes(query) || (bin.value !== null && valueLabels && Object.hasOwn(valueLabels, bin.value) && valueLabels[bin.value].toLocaleLowerCase().includes(query))) : sorted, [sorted, query, valueLabels]);
  const compact = categoryChartMode === 'compact';
  const rawMax = useMemo(() => Math.max(1e-10, ...bins.flatMap(bin => relative ? [bin.rForeground, bin.rBackground] : [bin.foreground, bin.background])), [bins, relative]);
  const max = compact ? axisMaximum(rawMax) : rawMax;
  const visibleCount = expanded ? Math.max(FIRST_PAGE * 2, pageSize) : FIRST_PAGE;
  const visible = query ? matching : matching.slice(0, visibleCount);
  const selected = filter && 'selected' in filter ? filter.selected : [];
  const ticks = !relative && max <= 4 ? Array.from({ length: max + 1 }, (_, index) => index / max) : [0, .25, .5, .75, 1];
  const axisValue = (fraction: number) => relative ? `${Math.round(max * fraction * 100).toLocaleString(locale)}%` : Math.round(max * fraction).toLocaleString(locale);
  return <div className={`dl-category-bars${compact ? ' dl-category-bars-compact' : ''}`}>
    {visible.map(bin => <CategoryBar key={JSON.stringify(bin.value)} bin={bin} relative={relative} max={max} hasSelection={hasSelection} selected={bin.value !== null && selected.includes(bin.value)} labelValue={bin.value !== null && valueLabels && Object.hasOwn(valueLabels, bin.value) ? valueLabels[bin.value] : undefined} missing={bin.value !== null && !!missingValues?.includes(bin.value)} color={bin.value === null || missingValues?.includes(bin.value) ? null : colorize ? getCategoryColor(bin.value, categoryColors, categoryPalette, ranks) : 'var(--dl-accent)'} compact={compact} onToggle={onToggle} />)}
    {query && matching.length === 0 && <small>{t('Sin valores que coincidan')}</small>}
    {!query && matching.length > FIRST_PAGE && <div className="dl-category-paging">
      {visibleCount < matching.length && <button type="button" className="dl-link" onClick={() => { if (!expanded) onExpand(); setPageSize(visibleCount * 2); }}>{t('+ {value0} más', { value0: Math.min(visibleCount, matching.length - visibleCount) })}</button>}
      {visibleCount > FIRST_PAGE && <button type="button" className="dl-link" onClick={() => { const next = Math.max(FIRST_PAGE, visibleCount / 2); setPageSize(next); if (next === FIRST_PAGE) onExpand(); }}>{t('− {value0} menos', { value0: Math.min(visibleCount, matching.length) - Math.min(Math.max(FIRST_PAGE, visibleCount / 2), matching.length) })}</button>}
    </div>}
    {compact && visible.length > 0 && <div className="dl-category-axis" aria-label={t('Escala de frecuencia')}><div className="dl-category-axis-ticks">{ticks.map(fraction => <span key={fraction} className="dl-category-axis-tick" style={{ left: `${fraction * 100}%` }}><i />{axisValue(fraction)}</span>)}</div></div>}
  </div>;
});
