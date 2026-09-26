import { t } from '../../ui/i18n';
import { getUiSnapshot } from '../../ui/preferences';
import type { Column, Filter, ViewState } from '../../contracts/desktop-api';
import type { Classification, VariableRole } from '../../contracts/analysis';

export const ROLE_OPTIONS: Array<{ value: VariableRole; label: string; description: string }> = [
  { value: 'target', label: 'Objetivo', description: 'Resultado o variable que quieres entender' },
  { value: 'actionable', label: 'Accionable', description: 'Palanca, ajuste o acción sobre la que intervenir' },
  { value: 'feature', label: 'Explicativa', description: 'Atributo, medida o contexto' },
  { value: 'identifier', label: 'Identificador', description: 'ID, clave de fila, procedencia o campo técnico' },
];
export function variableGroups(columns: Column[], view: ViewState) {
  const panel = view.variablePanel;
  const groups = new Map<string, Column[]>();
  const byId = new Map(columns.map(column => [column.id, column]));
  const hidden = new Set(panel.hidden), pinned = new Set(panel.pinned);
  const query = (panel.search ?? '').toLocaleLowerCase();
  const filtered = panel.order.map(id => byId.get(id)).filter((c): c is Column => {
    if (!c || hidden.has(c.id) || !c.name.toLocaleLowerCase().includes(query)) return false;
    const metadata = panel.metadata?.[c.id];
    return (!panel.roleFilter || panel.roleFilter === 'all' || metadata?.role === panel.roleFilter) && (!panel.groupFilter || (metadata?.group || 'Sin grupo') === panel.groupFilter);
  });
  for (const column of [...filtered.filter(c => pinned.has(c.id)), ...filtered.filter(c => !pinned.has(c.id))]) {
    const group = pinned.has(column.id) ? 'Fijadas' : panel.metadata?.[column.id]?.group || 'Sin grupo';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(column);
  }
  return [...groups].map(([name, columns]) => ({ name, columns }));
}
export function applyClassification(view: ViewState, classification: Classification): ViewState {
  return { ...view, variablePanel: { ...view.variablePanel, metadata: { ...view.variablePanel.metadata, ...Object.fromEntries(classification.assignments.map(({ column, role, group }) => [column, { ...view.variablePanel.metadata?.[column], role, group }])) } } };
}
export function mergeAnalysisFilters(current: Filter[], proposed: Filter[]): Filter[] {
  const replaced = new Set(proposed.map(f => f.column));
  return [...current.filter(f => !replaced.has(f.column)), ...proposed];
}
export function filterDescription(filter: Filter): string {
  if (filter.kind === 'numeric') return [filter.min === undefined ? '' : `≥ ${filter.min.toLocaleString(getUiSnapshot().locale, { maximumSignificantDigits: 15 })}`, filter.max === undefined ? '' : `≤ ${filter.max.toLocaleString(getUiSnapshot().locale, { maximumSignificantDigits: 15 })}`].filter(Boolean).join(t(' y '));
  if (filter.kind === 'date') return `${filter.start ?? '…'} — ${filter.end ?? '…'}`;
  if ('selected' in filter) return `${filter.kind === 'multivalued' ? t('Contiene alguno de: ') : t('Es: ')}${filter.selected.join(', ')}`;
  return t(filter.mode === 'all' ? 'Contiene todos: {terms}{suffix}' : 'Contiene alguno: {terms}{suffix}', {terms: filter.terms.join(', '), suffix: filter.caseSensitive ? t(' (distingue mayúsculas)') : ''});
}
