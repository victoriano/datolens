import type { Bin, Column, ViewState } from '../../contracts/desktop-api';
import type { CategoryOrderProposal } from '../../contracts/category-order';
import type { CategoryColorProposal } from '../../contracts/category-colors';
import { normalizeCategoryColor } from './category-colors';

export const categoryLabel = (column: Column, value: string) =>
  column.spss?.valueLabels && Object.hasOwn(column.spss.valueLabels, value) ? column.spss.valueLabels[value] : value;

/** Saved values absent from a sample stay in place; newly seen values follow them. */
export function categoryValues(bins: Bin[], saved: string[] = []): string[] {
  return [...new Set([...saved, ...bins.flatMap(bin => typeof bin.value === 'string' ? [bin.value] : [])])];
}

export function reconcileCategoryOrders(input: unknown, valid: Set<string>): Record<string, string[]> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  return Object.fromEntries(Object.entries(input).flatMap(([id, values]) => {
    if (!valid.has(id) || !Array.isArray(values)) return [];
    const order = [...new Set(values.filter((value): value is string => typeof value === 'string'))].slice(0, 10_000);
    return order.length ? [[id, order]] : [];
  }));
}

export function setCategoryOrder(view: ViewState, id: string, order?: string[]): ViewState {
  const orders = { ...view.categoryOrders };
  const modes = { ...view.variablePanel.sortModeByColumn };
  delete orders[id]; delete modes[id];
  const nextOrders = order?.length ? { ...orders, [id]: [...new Set(order)] } : orders;
  return { ...view, categoryOrders: Object.keys(nextOrders).length ? nextOrders : undefined, variablePanel: { ...view.variablePanel, sortModeByColumn: { ...modes, [id]: order?.length ? 'manual' : 'everything' } } };
}

/** Labels and raw codes only; the budget matches the native provider boundary. */
export function semanticScope(column: Column, values: string[], context: string, protectedValues: Record<string, string> = {}) {
  const encoder = new TextEncoder();
  const eligible = values.filter(value => value.length > 0 && !column.spss?.missingValues.includes(value) && !Object.hasOwn(protectedValues, value));
  const chosen: string[] = [];
  let bytes = encoder.encode(column.name).length + encoder.encode(context).length;
  for (const value of eligible) {
    const size = encoder.encode(value).length;
    const label = encoder.encode(column.spss?.valueLabels && Object.hasOwn(column.spss.valueLabels, value) ? column.spss.valueLabels[value] : '').length;
    if (chosen.length >= 100) break;
    if (size > 500 || bytes + size + label > 19_000) continue;
    chosen.push(value); bytes += size + label;
  }
  return { values: chosen, eligible: eligible.length, complete: chosen.length === eligible.length };
}

export function validateOrderProposal(result: CategoryOrderProposal, requested: string[], column: string, revision: string) {
  if (result.column !== column || result.datasetRevision !== revision) throw new Error('El dataset cambió. Vuelve a preparar las categorías.');
  if (typeof result.ordinal !== 'boolean' || !Array.isArray(result.order) || typeof result.explanation !== 'string') throw new Error('Propuesta de orden no válida.');
  const actual = new Set(result.order);
  if (result.ordinal ? actual.size !== requested.length || result.order.length !== requested.length || requested.some(value => !actual.has(value)) : result.order.length !== 0) throw new Error('La propuesta no incluye todas las categorías exactamente una vez.');
  return result;
}

export function validateColorProposal(result: CategoryColorProposal, requested: string[], column: string, revision: string) {
  if (result.column !== column || result.datasetRevision !== revision) throw new Error('El dataset cambió. Vuelve a preparar las categorías.');
  if (!Array.isArray(result.assignments)) throw new Error('Propuesta de colores no válida.');
  const allowed = new Set(requested), seen = new Set<string>();
  return result.assignments.flatMap(item => {
    if (!item || !allowed.has(item.value) || seen.has(item.value)) throw new Error('La propuesta contiene categorías repetidas o desconocidas.');
    seen.add(item.value);
    if (item.color === null) return [];
    const color = normalizeCategoryColor(item.color);
    if (!color) throw new Error('La propuesta contiene un color no válido.');
    return [{ value: item.value, color, reason: String(item.reason ?? '').slice(0, 500) }];
  });
}

export interface SemanticEdit { column: string; order?: string[]; colors?: Record<string, string> }
/** Apply against the latest view, preserving concurrent changes and protected customizations. */
export function applySemanticEdits(view: ViewState, edits: SemanticEdit[], replaceOrders: boolean, replaceColors: boolean): ViewState {
  let next = view;
  for (const edit of edits) {
    if (edit.order?.length && (replaceOrders || !next.categoryOrders?.[edit.column]?.length)) next = setCategoryOrder(next, edit.column, edit.order);
    if (edit.colors) {
      const old = next.categoryColors?.[edit.column] ?? {};
      const colors = replaceColors ? { ...old, ...edit.colors } : { ...edit.colors, ...old };
      if (Object.keys(colors).length) next = { ...next, categoryColors: { ...next.categoryColors, [edit.column]: colors } };
    }
  }
  return next;
}
