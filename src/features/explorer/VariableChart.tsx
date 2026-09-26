import { memo, useCallback, useMemo, useRef } from 'react';
import type { Bin, Column, Filter, ViewState } from '../../contracts/desktop-api';
import { CategoryBars } from './CategoryBars';
import type { CategorySortMode } from './category-sort';
import { Histogram } from './Histogram';
import { isCategoricalKind, type CategoryColorOverrides } from './category-colors';

/** No global view/busy/statistics props: an unrelated crossfilter cannot invalidate this chart. */
export const VariableChart = memo(function VariableChart({ column, bins, filter, relative, hasSelection, sortMode, analyzedRows, expanded, search, categoryColors, categoryPalette, categoryOrder, onView, onFilter }: {
  column: Column; bins: Bin[]; filter?: Filter; relative: boolean; hasSelection: boolean;
  sortMode: CategorySortMode; analyzedRows: number; expanded: boolean; search: string; categoryColors?: CategoryColorOverrides; categoryPalette?: string; categoryOrder?: string[];
  onView: (update: (view: ViewState) => ViewState) => void; onFilter: (id: string, filter?: Filter) => void;
}) {
  const currentFilter = useRef(filter); currentFilter.current = filter;
  const bounds = useMemo<[number | undefined, number | undefined]>(() => filter?.kind === 'numeric' ? [filter.min, filter.max] : filter?.kind === 'date' ? [filter.start ? new Date(filter.start).getTime() : undefined, filter.end ? new Date(filter.end).getTime() : undefined] : [undefined, undefined], [filter]);
  const range = useMemo<[number, number] | null>(() => bounds[0] !== undefined && bounds[1] !== undefined ? [bounds[0], bounds[1]] : null, [bounds]);
  const onRange = useCallback((range: [number, number] | null) => onFilter(column.id, range ? column.kind === 'date' ? { column: column.id, kind: 'date', start: new Date(range[0]).toISOString(), end: new Date(range[1]).toISOString() } : { column: column.id, kind: 'numeric', min: range[0], max: range[1] } : undefined), [column.id, column.kind, onFilter]);
  const onBound = useCallback((edge: 0 | 1, value: number) => {
    const filter = currentFilter.current;
    onFilter(column.id, column.kind === 'date' ? { column: column.id, kind: 'date', start: edge === 0 ? new Date(value).toISOString() : filter?.kind === 'date' ? filter.start : undefined, end: edge === 1 ? new Date(value).toISOString() : filter?.kind === 'date' ? filter.end : undefined } : { column: column.id, kind: 'numeric', min: edge === 0 ? value : filter?.kind === 'numeric' ? filter.min : undefined, max: edge === 1 ? value : filter?.kind === 'numeric' ? filter.max : undefined });
  }, [column.id, column.kind, onFilter]);
  const onToggle = useCallback((value: string) => {
    const filter = currentFilter.current;
    const selected = filter && 'selected' in filter ? filter.selected : [];
    const next = selected.includes(value) ? selected.filter(item => item !== value) : [...selected, value];
    onFilter(column.id, next.length ? { column: column.id, kind: column.kind === 'multivalued' ? 'multivalued' : 'categorical', selected: next } : undefined);
  }, [column.id, column.kind, onFilter]);
  const onExpand = useCallback(() => onView(view => ({ ...view, variablePanel: { ...view.variablePanel, expanded: view.variablePanel.expanded?.includes(column.id) ? view.variablePanel.expanded.filter(id => id !== column.id) : [...(view.variablePanel.expanded ?? []), column.id] } })), [column.id, onView]);
  if (column.kind === 'numeric' || column.kind === 'date') return <Histogram bins={bins} range={range} bounds={bounds} label={column.name} isDate={column.kind === 'date'} relative={relative} hasSelection={hasSelection} onChange={onRange} onChangeBound={onBound} />;
  return <>
    <CategoryBars bins={bins} filter={filter} relative={relative} sortMode={sortMode} analyzedRows={analyzedRows} hasSelection={hasSelection} expanded={expanded} search={search} onExpand={onExpand} onToggle={onToggle} valueLabels={column.spss?.valueLabels} missingValues={column.spss?.missingValues} categoryColors={categoryColors} categoryPalette={categoryPalette} categoryOrder={categoryOrder} colorize={isCategoricalKind(column.kind)} />
  </>;
});
