import { useI18n } from '../../ui';
import type { Column, ViewState } from '../../contracts/desktop-api';
import { kindSymbol, moveItem } from './model';
import { usePointerReorder } from './usePointerReorder';

interface Props {
  columns: Column[];
  view: ViewState;
  search: string;
  onSearch: (value: string) => void;
  onView: (update: (view: ViewState) => ViewState) => void;
}

export function ColumnMenu({ columns, view, search, onSearch, onView }: Props) {
  const { t } = useI18n();
  const byId = new Map(columns.map(column => [column.id, column]));
  const visibleIds = view.columns.order.filter(id => {
    const column = byId.get(id);
    const original = view.variablePanel.metadata?.[id]?.originalName;
    return !!column && `${column.name}\n${original ?? ''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase());
  });
  const move = (source: string, target: string) => onView(current => {
    const order = current.columns.order;
    if (!order.includes(source) || !order.includes(target) || source === target) return current;
    // Search limits the movable slots; variables outside the search keep their positions.
    const shown = order.filter(id => visibleIds.includes(id));
    const moved = moveItem(shown, shown.indexOf(source), shown.indexOf(target));
    let index = 0;
    return { ...current, columns: { ...current.columns, order: order.map(id => shown.includes(id) ? moved[index++] : id) } };
  });
  const reorder = usePointerReorder(visibleIds, move, { preview: true });

  return <div className="dl-column-menu">
    <input className="dl-column-menu-search" type="search" aria-label={t('Buscar variable')} placeholder={t('Buscar variable…')} value={search} onChange={event => onSearch(event.target.value)} />
    <div className="dl-column-menu-list" ref={reorder.root}>
      {visibleIds.map((id, index) => {
        const column = byId.get(id)!;
        const originalName = view.variablePanel.metadata?.[id]?.originalName;
        const originalTitle = originalName && originalName !== column.name ? t('Columna original: {value0}', { value0: originalName }) : column.name;
        return <div className="dl-column-menu-row" data-reorder-id={id} key={id} onPointerDown={event => {
          const target = event.target as Element;
          if (target.closest('input,label') || (target.closest('button') && !target.closest('.dl-column-menu-grip'))) return;
          reorder.handle(id).onPointerDown(event);
        }}>
          <button className="dl-grip dl-column-menu-grip" aria-label={t('Reordenar columna {value0}', { value0: column.name })} title={t('Arrastra o usa las flechas para reordenar')} onKeyDown={reorder.handle(id).onKeyDown}>⠿</button>
          <label><input type="checkbox" checked={!view.columns.hidden.includes(id)} onChange={event => onView(current => ({ ...current, columns: { ...current.columns, hidden: event.target.checked ? current.columns.hidden.filter(hidden => hidden !== id) : [...current.columns.hidden, id] } }))} /><span title={originalTitle}>{kindSymbol[column.kind]} {column.name}</span></label>
          <button aria-label={t('Subir {value0}', { value0: column.name })} disabled={index === 0} onClick={() => move(id, visibleIds[index - 1])}>↑</button>
          <button aria-label={t('Bajar {value0}', { value0: column.name })} disabled={index === visibleIds.length - 1} onClick={() => move(id, visibleIds[index + 1])}>↓</button>
        </div>;
      })}
    </div>
    <span className="dl-reorder-status" role="status" aria-live="polite">{reorder.drag && t('Moviendo {value0}. Escape para cancelar.', { value0: byId.get(reorder.drag.source)?.name ?? '' })}</span>
  </div>;
}
