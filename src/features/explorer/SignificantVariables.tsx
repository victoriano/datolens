import { useMemo, useState } from 'react';
import { useI18n } from '../../ui';
import type { Column, Distribution, ViewState } from '../../contracts/desktop-api';
import { ROLE_OPTIONS } from './analysis-model';
import { significantVariables } from './significant-variables';
import { Caret } from './Caret';

interface Props {
  columns: Column[];
  distributions: Distribution[];
  selectedRows: number;
  totalRows: number;
  view: ViewState;
  busy: boolean;
  onReveal: (column: string) => void;
}

export function SignificantVariables({ columns, distributions, selectedRows, totalRows, view, busy, onReveal }: Props) {
  const { t, locale, language } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [showGroups, setShowGroups] = useState<string[]>([]);
  const ranking = useMemo(() => significantVariables(columns, distributions, selectedRows, totalRows), [columns, distributions, selectedRows, totalRows]);
  const byId = useMemo(() => new Map(columns.map(column => [column.id, column])), [columns]);
  const groups = [...new Set(ranking.map(item => view.variablePanel.metadata?.[item.column]?.group).filter((group): group is string => !!group))];
  const valid = new Set([...ROLE_OPTIONS.map(role => `role:${role.value}`), ...groups.map(group => `group:${group}`), 'group:other']);
  const activeGroups = showGroups.filter(group => valid.has(group));
  const matches = (column: string) => activeGroups.length === 0 || activeGroups.some(key => key === `role:${view.variablePanel.metadata?.[column]?.role ?? 'feature'}` || key === `group:${view.variablePanel.metadata?.[column]?.group}` || key === 'group:other' && !view.variablePanel.metadata?.[column]?.group);
  const filtered = ranking.filter(item => matches(item.column));
  const items = filtered.slice(0, expanded ? 30 : 10);
  const maxScore = filtered[0]?.score || 1;
  const toggle = (key: string) => setShowGroups(current => current.includes(key) ? current.filter(item => item !== key) : [...current, key]);
  if (selectedRows <= 0 || selectedRows >= totalRows || ranking.length === 0) return null;
  return <section className="dl-significant" aria-busy={busy} aria-label={t('Variables significativas')}>
    <div className="dl-significant-heading"><button className="dl-significant-toggle" type="button" aria-expanded={!collapsed} aria-controls="dl-significant-content" onClick={() => setCollapsed(value => !value)} title={t('Diferencia entre la selección y todas las filas; no es una prueba estadística.')}><Caret direction={collapsed ? 'right' : 'down'} />{t('Variables significativas')}</button>{!collapsed && <details className="dl-significant-show"><summary><span>{t('Mostrar:')} {activeGroups.length === 0 ? t('Todas') : activeGroups.length === 1 ? activeGroups[0].startsWith('role:') ? t(ROLE_OPTIONS.find(role => `role:${role.value}` === activeGroups[0])?.label ?? '') : activeGroups[0] === 'group:other' ? t('Sin grupo') : activeGroups[0].slice(6) : t('{value0} grupos', { value0: activeGroups.length })}</span><Caret /></summary><div className="dl-significant-menu"><button type="button" aria-pressed={activeGroups.length === 0} onClick={() => setShowGroups([])}><span className="dl-significant-menu-name">{t('Todas')}</span><span className="dl-significant-menu-count">{ranking.length}</span></button><small>{t('Funciones')}</small>{ROLE_OPTIONS.map(role => { const key = `role:${role.value}`; return <label key={key} title={t(role.label)}><input type="checkbox" checked={activeGroups.includes(key)} onChange={() => toggle(key)} /><span className="dl-significant-menu-name">{t(role.label)}</span><span className="dl-significant-menu-count">{ranking.filter(item => (view.variablePanel.metadata?.[item.column]?.role ?? 'feature') === role.value).length}</span></label>; })}<small>{t('Grupos')}</small>{groups.map(group => <label key={group} title={group}><input type="checkbox" checked={activeGroups.includes(`group:${group}`)} onChange={() => toggle(`group:${group}`)} /><span className="dl-significant-menu-name">{group}</span><span className="dl-significant-menu-count">{ranking.filter(item => view.variablePanel.metadata?.[item.column]?.group === group).length}</span></label>)}<label title={t('Sin grupo')}><input type="checkbox" checked={activeGroups.includes('group:other')} onChange={() => toggle('group:other')} /><span className="dl-significant-menu-name">{t('Sin grupo')}</span><span className="dl-significant-menu-count">{ranking.filter(item => !view.variablePanel.metadata?.[item.column]?.group).length}</span></label></div></details>}</div>
    <div id="dl-significant-content" hidden={collapsed}>{distributions.length < columns.length && <small>{language === 'en' ? 'Comparison of loaded variables.' : 'Comparación de las variables cargadas.'}</small>}<div className="dl-significant-items">{items.length ? items.map(item => { const original = byId.get(item.column)?.name ?? item.column; const name = view.variablePanel.metadata?.[item.column]?.name || original; return <button key={item.column} type="button" title={`${name}${name !== original ? ` (${original})` : ''} · ${t('Diferencia')}: ${(item.score * 100).toLocaleString(locale, { maximumFractionDigits: 1 })}%`} onClick={() => onReveal(item.column)}><span>{name}</span><i aria-hidden="true"><i style={{ width: `${Math.max(4, item.score / maxScore * 100)}%` }} /></i></button>; }) : <p>{t('No hay variables significativas en estos grupos.')}</p>}</div>
    {filtered.length > 10 && <button className="dl-significant-more" type="button" onClick={() => setExpanded(value => !value)}>{expanded ? t('Mostrar menos') : t('Mostrar más')}</button>}</div>
  </section>;
}
