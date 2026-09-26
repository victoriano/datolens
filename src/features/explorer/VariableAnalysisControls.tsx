import { useI18n, getUiSnapshot } from '../../ui';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Column, Filter, VariableKind, ViewState } from '../../contracts/desktop-api';
import type { VariableRole, VariableStatistics } from '../../contracts/analysis';
import { kindLabel, kindSymbol } from './model';
import { ROLE_OPTIONS } from './analysis-model';
import { isSameRange, quantileFilter, type QuantileFilterKey } from './statistic-filters';
import './analysis.css';

export function RoleIcon({ role }: { role?: VariableRole }) {
  const path = role === 'target' ? <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></> : role === 'actionable' ? <><path d="m8 8 11 4-5 2-2 5-4-11Z M5 3v3 M3 5h3 M14 3l-2 3 M3 14l3-2" /></> : role === 'identifier' ? <><path d="M5 12c0-10 14-10 14 0 M8 12c0-6 8-6 8 0v3 M11 12v7 M5 15c0 3-1 4-2 5 M8 15c0 3-1 5-2 6 M14 12v5l-1 4 M17 18l1 3" /></> : <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 4 16 4 16 0V5 M4 12c0 4 16 4 16 0" /></>;
  return <svg className="dl-role-icon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{path}</svg>;
}
function TypeIcon({ kind }: { kind: VariableKind | null }) {
  const symbol = kind === 'numeric' ? <text x="12" y="16" textAnchor="middle" stroke="none" fill="currentColor" fontSize="12" fontWeight="600">#</text>
    : kind === 'text' ? <text x="12" y="17" textAnchor="middle" stroke="none" fill="currentColor" fontSize="16" fontWeight="500">T</text>
    : kind === 'date' ? <><rect x="4" y="6" width="16" height="15" rx="2" /><path d="M4 10h16M8 3v5M16 3v5" /></>
    : kind === 'boolean' ? <><rect x="3" y="7" width="18" height="10" rx="5" /><circle cx="8" cy="12" r="2.5" /></>
    : kind === 'categorical' ? <path d="M4 5h9l7 7-8 8-8-8V5Z" />
    : kind === 'multivalued' ? <><path d="M8 4H5v16h3M16 4h3v16h-3" /><circle cx="10" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="14" cy="12" r="1" fill="currentColor" stroke="none" /></>
    : <><circle cx="12" cy="12" r="8" /><path d="m9 12 2 2 4-4" /></>;
  return <svg className="dl-type-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{symbol}</svg>;
}
/** Portals keep menus outside the scrolling rail; the menu still inherits app tokens. */
export function VariableMenu({ label, title, children, menuClassName = '', menuWidth = 298, menuHeight = 365, align = 'start' }: { label: ReactNode; title: string; children: (close: () => void) => ReactNode; menuClassName?: string; menuWidth?: number; menuHeight?: number; align?: 'start' | 'end' }) {
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const close = () => { setPosition(null); button.current?.focus(); };
  useEffect(() => {
    if (!position) return;
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node) && !button.current?.contains(event.target as Node)) setPosition(null); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } };
    const scroll = (event: Event) => { if (!menu.current?.contains(event.target as Node)) setPosition(null); };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape, true); document.addEventListener('wheel', scroll, true);
    menu.current?.querySelector<HTMLElement>('button, input')?.focus();
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape, true); document.removeEventListener('wheel', scroll, true); };
  }, [position]);
  const shell = button.current?.closest('.dl-explorer');
  return <><button ref={button} aria-label={title} title={title} aria-haspopup="dialog" aria-expanded={!!position} onClick={() => { if (position) return close(); const rect = button.current!.getBoundingClientRect(); const below = rect.bottom + 5; setPosition({ top: below + menuHeight <= window.innerHeight - 8 ? below : Math.max(8, rect.top - menuHeight - 5), left: Math.max(8, Math.min(align === 'end' ? rect.right - menuWidth : rect.left, window.innerWidth - menuWidth - 8)) }); }}>{label}</button>{position && shell && createPortal(<div ref={menu} className={`dl-variable-menu ${menuClassName}`.trim()} role="dialog" aria-label={title} style={position}>{children(close)}</div>, shell)}</>;
}
export function VariableTypeControl({ column, override, onCast }: { column: Column; override?: VariableKind; onCast: (column: Column, kind: VariableKind | null) => void }) {
  const { t } = useI18n();
  const types: Array<VariableKind | null> = ['boolean', 'categorical', 'date', 'multivalued', 'numeric', 'text'];
  if (override !== undefined) types.push(null);
  return <VariableMenu title={t("Tipo de {value0}: {value1}", { value0: column.name, value1: t(kindLabel[column.kind]) })} label={<TypeIcon kind={column.kind} />} menuClassName="dl-type-menu" menuWidth={232} menuHeight={override === undefined ? 270 : 318}>{close => types.map(kind => <button key={kind ?? 'auto'} type="button" className={kind === null ? 'dl-type-auto' : undefined} aria-pressed={kind === column.kind} onClick={() => { close(); if (kind !== column.kind || kind === null) onCast(column, kind); }}><TypeIcon kind={kind} /><span>{kind === null ? t('Auto (detectado)') : t(kindLabel[kind])}</span><span className="dl-type-selection" aria-hidden="true">{kind === column.kind ? '✓' : ''}</span></button>)}</VariableMenu>;
}
export function VariableRoleControl({ column, view, onView }: { column: Column; view: ViewState; onView: (update: (v: ViewState) => ViewState) => void }) {
  const { t, locale } = useI18n();
  const current = view.variablePanel.metadata?.[column.id];
  return <VariableMenu title={t("Función de {value0}: {value1}", { value0: column.name, value1: t(ROLE_OPTIONS.find(r => r.value === current?.role)?.label ?? 'Sin clasificar') })} label={<RoleIcon role={current?.role} />}>{close => <><div className="dl-menu-caption">{t("Función analítica")}</div>{ROLE_OPTIONS.map(role => <button key={role.value} aria-pressed={current?.role === role.value} onClick={() => { onView(v => ({ ...v, variablePanel: { ...v.variablePanel, metadata: { ...v.variablePanel.metadata, [column.id]: { ...v.variablePanel.metadata?.[column.id], group: current?.group ?? '', role: role.value } } } })); close(); }}><span className="dl-menu-check">{current?.role === role.value ? '✓' : ''}</span><RoleIcon role={role.value} /><span>{t(role.label)}<small>{t(role.description)}</small></span></button>)}<form onSubmit={e => { e.preventDefault(); const group = String(new FormData(e.currentTarget).get('group') ?? '').trim(); onView(v => ({ ...v, variablePanel: { ...v.variablePanel, metadata: { ...v.variablePanel.metadata, [column.id]: { ...v.variablePanel.metadata?.[column.id], role: current?.role ?? 'feature', group } } } })); close(); }}><label>{t("Grupo temático")}<input name="group" aria-label={t("Grupo de {value0}", { value0: column.name })} defaultValue={current?.group ?? ''} maxLength={80} placeholder={t("Ej. Precio y valoración")} /></label><button type="submit">{t("Guardar grupo")}</button></form></>}</VariableMenu>;
}
export function formatStatistic(value: string | null, kind: Column['kind']): string {
  const {locale} = getUiSnapshot();
  if (value === null) return '—';
  if (kind === 'date') {
    const timestamp = value.replace(' ', 'T').replace(/(T.*[+-]\d{2})$/, '$1:00');
    // DuckDB timestamps without a zone use the same UTC convention as date filters.
    const utc = /(?:Z|[+-]\d\d(?::?\d\d)?)$/i.test(timestamp) || /^\d{4}-\d{2}-\d{2}$/.test(timestamp)
      ? timestamp : `${timestamp}Z`;
    const date = new Date(utc);
    return Number.isNaN(date.getTime()) ? value.slice(0, 10) : date.toLocaleDateString(locale, { timeZone: 'UTC', day: '2-digit', month: 'short', year: '2-digit' });
  }
  if (/^[+-]?\d+$/.test(value)) { try { return BigInt(value).toLocaleString(locale); } catch { return value; } }
  const number = Number(value);
  if (Number.isFinite(number) && Math.abs(number) > Number.MAX_SAFE_INTEGER) return value;
  return Number.isFinite(number) ? number.toLocaleString(locale, { maximumFractionDigits: 2, maximumSignificantDigits: 7 }) : value;
}
export function VariableStatisticsView({ statistics, backgroundStatistics, column, busy, filtered, filter, onFilter }: { statistics?: VariableStatistics; backgroundStatistics?: VariableStatistics; column: Column; busy: boolean; filtered: boolean; filter?: Filter; onFilter: (filter: Filter) => void }) {
  const { t, locale, language } = useI18n();
  if (!statistics) return <div className="dl-statistics-loading" role="status">{t("Calculando estadísticas…")}</div>;
  const numeric = column.kind === 'numeric' || column.kind === 'date';
  const reference = filtered ? backgroundStatistics : statistics;
  const columns = [[t('Mín'), 'min'], ['P25', 'p25'], [t('Mediana'), 'median'], [t('Media'), 'mean'], ['P75', 'p75'], [t('Máx'), 'max']] as const;
  const rangeNames: Record<QuantileFilterKey, string> = {
    p25: language === 'en' ? 'Min – P25' : 'Mín – P25', median: 'P25 – P75', p75: language === 'en' ? 'P75 – Max' : 'P75 – Máx',
  };
  return <div className="dl-variable-statistics" aria-busy={busy}><span className="dl-statistics-scope">{filtered ? language === 'en' ? 'Filtered rows · gray: all rows' : 'Filas filtradas · gris: todas las filas' : t('Todas las filas')}</span>{numeric && <dl>{columns.map(([label, key]) => {
    const shortcut = key === 'p25' || key === 'median' || key === 'p75' ? key : null;
    const candidate = shortcut ? quantileFilter(column, reference, shortcut) : null;
    return <div key={key} className={shortcut ? 'dl-quantile' : ''}><dt>{shortcut ? <button type="button" disabled={busy || !candidate} aria-label={language === 'en' ? `Filter ${column.name} to ${rangeNames[shortcut]}` : `Filtrar ${column.name} por ${rangeNames[shortcut]}`} aria-pressed={isSameRange(filter, candidate)} title={language === 'en' ? `Filter to ${rangeNames[shortcut]}` : `Filtrar por ${rangeNames[shortcut]}`} onClick={() => { if (candidate) onFilter(candidate); }}>{label}</button> : label}</dt>{filtered && reference && <dd className="dl-statistic-background" title={reference[key] ?? t('Sin valores')}>{formatStatistic(reference[key], column.kind)}</dd>}<dd title={statistics[key] ?? t('Sin valores')}>{formatStatistic(statistics[key], column.kind)}</dd></div>;
  })}</dl>}<div className="dl-statistics-counts"><span>{statistics.count.toLocaleString(locale)}{t(" válidos")}</span><span>{statistics.missing.toLocaleString(locale)}{t(" vacíos")}</span><span>{statistics.distinct.toLocaleString(locale)}{t(" distintos")}</span></div></div>;
}
