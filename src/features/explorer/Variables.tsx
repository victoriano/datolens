import { useState } from 'react';
import type { Bin, Column, Distribution, Filter, ViewState } from '../../contracts/desktop-api';
import { Histogram } from './Histogram';
import { sortCategoryBins, CATEGORY_SORT_MODES, type CategorySortMode } from './category-sort';
import { kindLabel, kindSymbol, moveItem } from './model';
interface Props { columns: Column[]; view: ViewState; distributions: Distribution[]; analyzedRows: number; busy: boolean; onView: (update: (view: ViewState) => ViewState) => void; onFilter: (id: string, filter?: Filter) => void }
function CategoryBars({ bins, filter, relative, sortMode, analyzedRows, hasSelection, onToggle }: { bins: Bin[]; filter?: Filter; relative: boolean; sortMode: CategorySortMode; analyzedRows: number; hasSelection: boolean; onToggle: (value: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const normalized = bins.map(bin => ({ ...bin, value: bin.value ?? null }));
  const sorted = sortCategoryBins(normalized, sortMode, { analyzedRows });
  const max = Math.max(1e-10, ...bins.flatMap(b => relative ? [b.rForeground, b.rBackground] : [b.foreground, b.background]));
  const selected = filter && 'selected' in filter ? filter.selected : [];
  return <div className="dl-category-bars">{(expanded ? sorted : sorted.slice(0, 8)).map(bin => <button key={JSON.stringify(bin.value)} disabled={bin.value === null} aria-pressed={selected.includes(bin.value ?? '')} onClick={() => bin.value !== null && onToggle(bin.value)} title={`${bin.value ?? '(vacío)'} · Selección: ${bin.foreground} (${(bin.rForeground * 100).toFixed(1)}%) · Total: ${bin.background}`}>
    <span className="dl-category-label">{bin.value ?? '(vacío)'}</span><span className="dl-bar-track">{hasSelection && <span className="dl-bar-background" style={{ width: `${(relative ? bin.rBackground : bin.background) / max * 100}%` }} />}<span className="dl-bar-foreground" style={{ width: `${(relative ? bin.rForeground : bin.foreground) / max * 100}%` }} /></span><span className="dl-bar-value">{relative ? `${(bin.rForeground * 100).toFixed(1)}%` : bin.foreground.toLocaleString('es')}</span>
  </button>)}{bins.length > 8 && <button className="dl-link" onClick={() => setExpanded(!expanded)}>{expanded ? 'Mostrar menos' : `Ver ${bins.length} valores`}</button>}</div>;
}
function RangeInputs({ column, filter, onFilter }: { column: Column; filter?: Filter; onFilter: Props['onFilter'] }) {
  const isDate = column.kind === 'date';
  const first = filter?.kind === 'numeric' ? String(filter.min ?? '') : filter?.kind === 'date' ? filter.start?.slice(0, 10) ?? '' : '';
  const last = filter?.kind === 'numeric' ? String(filter.max ?? '') : filter?.kind === 'date' ? filter.end?.slice(0, 10) ?? '' : '';
  return <form key={`${first}:${last}`} className="dl-range-inputs" onSubmit={e => {
    e.preventDefault(); const form = new FormData(e.currentTarget); const start = String(form.get('start') ?? ''), end = String(form.get('end') ?? '');
    if (!start && !end) return onFilter(column.id);
    if (start && end && (isDate ? start > end : Number(start) > Number(end))) return;
    onFilter(column.id, isDate ? { column: column.id, kind: 'date', start: start ? `${start}T00:00:00.000Z` : undefined, end: end ? `${end}T23:59:59.999Z` : undefined } : { column: column.id, kind: 'numeric', min: start ? Number(start) : undefined, max: end ? Number(end) : undefined });
  }}><input name="start" aria-label={`Mínimo ${column.name}`} type={isDate ? 'date' : 'number'} step="any" defaultValue={first} placeholder="Desde" /><span>–</span><input name="end" aria-label={`Máximo ${column.name}`} type={isDate ? 'date' : 'number'} step="any" defaultValue={last} placeholder="Hasta" /><button aria-label={`Aplicar rango de ${column.name}`}>↵</button></form>;
}
export function Variables({ columns, view, distributions, analyzedRows, busy, onView, onFilter }: Props) {
  const [search, setSearch] = useState('');
  const [drag, setDrag] = useState<string | null>(null);
  const ordered = view.variablePanel.order.map(id => columns.find(c => c.id === id)).filter((c): c is Column => !!c && !view.variablePanel.hidden.includes(c.id) && c.name.toLowerCase().includes(search.toLowerCase()));
  const visible = [...ordered.filter(c => view.variablePanel.pinned.includes(c.id)), ...ordered.filter(c => !view.variablePanel.pinned.includes(c.id))];
  return <aside className="dl-variables" aria-label="Panel de variables"><div className="dl-panel-heading"><strong>Variables <span>{columns.length}</span></strong><label><input type="checkbox" checked={view.variablePanel.relative} onChange={e => onView(v => ({ ...v, variablePanel: { ...v.variablePanel, relative: e.target.checked } }))} /> %</label></div><input className="dl-variable-search" placeholder="Buscar variable…" aria-label="Buscar variable" value={search} onChange={e => setSearch(e.target.value)} />
    <div className="dl-chart-legend"><span><i />Selección</span><span><i />Todo</span>{busy && <span role="status">Actualizando…</span>}</div>
    <div className="dl-variable-list" aria-busy={busy}>{visible.map(column => {
      const filter = view.filters.find(f => f.column === column.id);
      const distribution = distributions.find(d => d.column === column.id);
      const bins = distribution?.bins ?? [];
      const pinned = view.variablePanel.pinned.includes(column.id);
      const numeric = column.kind === 'numeric' || column.kind === 'date';
      const range: [number, number] | null = filter?.kind === 'numeric' && filter.min !== undefined && filter.max !== undefined ? [filter.min, filter.max] : filter?.kind === 'date' && filter.start && filter.end ? [new Date(filter.start).getTime(), new Date(filter.end).getTime()] : null;
      return <section className={`dl-variable ${filter ? 'has-filter' : ''}`} key={column.id} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (drag) onView(v => ({ ...v, variablePanel: { ...v.variablePanel, order: moveItem(v.variablePanel.order, v.variablePanel.order.indexOf(drag), v.variablePanel.order.indexOf(column.id)) } })); setDrag(null); }}>
        <header><button className="dl-grip" draggable onDragStart={() => setDrag(column.id)} title="Arrastrar para reordenar variable">⠿</button><span className="dl-type" title={kindLabel[column.kind]}>{kindSymbol[column.kind]}</span><strong title={column.name}>{column.name}</strong><button title={pinned ? 'Desfijar variable' : 'Fijar variable'} aria-pressed={pinned} onClick={() => onView(v => ({ ...v, variablePanel: { ...v.variablePanel, pinned: pinned ? v.variablePanel.pinned.filter(id => id !== column.id) : [...v.variablePanel.pinned, column.id] } }))}>⌖</button><button title="Ocultar variable del panel" onClick={() => onView(v => ({ ...v, variablePanel: { ...v.variablePanel, hidden: [...v.variablePanel.hidden, column.id] } }))}>×</button></header>
        {numeric ? <><Histogram bins={bins} range={range} isDate={column.kind === 'date'} relative={view.variablePanel.relative} hasSelection={view.filters.length > 0} onChange={r => onFilter(column.id, r ? column.kind === 'date' ? { column: column.id, kind: 'date', start: new Date(r[0]).toISOString(), end: new Date(r[1]).toISOString() } : { column: column.id, kind: 'numeric', min: r[0], max: r[1] } : undefined)} /><RangeInputs column={column} filter={filter} onFilter={onFilter} /></> : <>
          <div className="dl-variable-sort"><select aria-label={`Orden de categorías de ${column.name}`} value={view.variablePanel.sortModeByColumn[column.id] ?? 'everything'} onChange={e => onView(v => ({ ...v, variablePanel: { ...v.variablePanel, sortModeByColumn: { ...v.variablePanel.sortModeByColumn, [column.id]: e.target.value as CategorySortMode } } }))}>{CATEGORY_SORT_MODES.map(mode => <option key={mode.value} value={mode.value}>{({ everything: 'Por total', selection: 'Por selección', uplift: 'Por diferencia', tfidf: 'Por TF-IDF' })[mode.value]}</option>)}</select></div>
          {column.kind === 'text' && <form className="dl-text-filter" onSubmit={e => { e.preventDefault(); const term = String(new FormData(e.currentTarget).get('term') ?? '').trim(); onFilter(column.id, term ? { column: column.id, kind: 'text', terms: [term], mode: 'any', caseSensitive: false } : undefined); }}><input key={filter?.kind === 'text' ? filter.terms.join(' ') : ''} name="term" aria-label={`Buscar en ${column.name}`} placeholder="Contiene texto…" defaultValue={filter?.kind === 'text' ? filter.terms.join(' ') : ''} /><button>↵</button></form>}
          <CategoryBars bins={bins} filter={filter} relative={view.variablePanel.relative} sortMode={view.variablePanel.sortModeByColumn[column.id] ?? 'everything'} analyzedRows={analyzedRows} hasSelection={view.filters.length > 0} onToggle={value => { const selected = filter && 'selected' in filter ? filter.selected : []; const next = selected.includes(value) ? selected.filter(v => v !== value) : [...selected, value]; onFilter(column.id, next.length ? { column: column.id, kind: column.kind === 'multivalued' ? 'multivalued' : 'categorical', selected: next } : undefined); }} />
        </>}{distribution?.truncated && <small className="dl-category-limit">Primeras {bins.filter(bin => bin.value !== null).length} categorías por frecuencia</small>}{!busy && bins.length === 0 && <small>Sin valores disponibles</small>}{filter && <button className="dl-link" onClick={() => onFilter(column.id)}>Limpiar filtro</button>}
      </section>;
    })}</div>{view.variablePanel.hidden.length > 0 && <button className="dl-show-hidden" onClick={() => onView(v => ({ ...v, variablePanel: { ...v.variablePanel, hidden: [] } }))}>Mostrar {view.variablePanel.hidden.length} variables ocultas</button>}
  </aside>;
}
