import type { Column, ViewState } from '../../contracts/desktop-api';
import { useI18n } from '../../ui';
import { CATEGORY_SORT_MODES, type CategorySortMode } from './category-sort';
import { VariableMenu } from './VariableAnalysisControls';
import './category-sort.css';

function SortIcon({ mode }: { mode: CategorySortMode }) {
  const lengths = mode === 'uplift' ? [15, 9, 19, 6] : mode === 'tfidf' ? [8, 18, 12, 5] : mode === 'selection' ? [17, 12, 7, 4] : [19, 14, 10, 6];
  return <svg className="dl-category-sort-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none">
    {lengths.map((length, index) => <rect key={index} x="2" y={3 + index * 5} width={length} height="3" rx="1" fill={index > 1 && mode !== 'everything' ? 'var(--dl-subtle)' : 'currentColor'} />)}
  </svg>;
}

const spanish: Record<Exclude<CategorySortMode, 'manual'>, [string, string]> = {
  everything: ['Por todo', 'Frecuencia en todo el conjunto de datos'],
  selection: ['Por selección', 'Frecuencia solo en la selección'],
  uplift: ['Por diferencia', 'Diferencia de frecuencia entre la selección y el conjunto completo'],
  tfidf: ['Por TF-IDF', 'Frecuencia del término × frecuencia inversa en el conjunto'],
};

export function CategorySortMenu({ column, mode, hasManualOrder, onView }: { column: Column; mode: CategorySortMode; hasManualOrder: boolean; onView: (update: (view: ViewState) => ViewState) => void }) {
  const { language } = useI18n();
  const title = language === 'en' ? `Sort categories of ${column.name}` : `Ordenar categorías de ${column.name}`;
  const options = hasManualOrder ? [...CATEGORY_SORT_MODES, { value: 'manual' as const, label: 'Custom order', description: 'The category order you saved' }] : CATEGORY_SORT_MODES;
  return <VariableMenu label={<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M5 3v18m0 0-3-3m3 3 3-3M16 21V3m0 0-3 3m3-3 3 3" /></svg>} title={title} menuClassName="dl-category-sort-menu" menuWidth={340} menuHeight={Math.min(450, options.length * 64 + 12)}>{close => options.map(option => {
    const [label, description] = option.value === 'manual'
      ? language === 'en' ? ['Custom order', 'The category order you saved'] : ['Orden personalizado', 'El orden de categorías que guardaste']
      : language === 'en' ? [option.label, option.description] : spanish[option.value];
    return <button key={option.value} type="button" aria-pressed={mode === option.value} onClick={() => { if (mode !== option.value) onView(view => ({ ...view, variablePanel: { ...view.variablePanel, sortModeByColumn: { ...view.variablePanel.sortModeByColumn, [column.id]: option.value } } })); close(); }}>
      <SortIcon mode={option.value} /><span className="dl-category-sort-copy"><span>{label}</span><small>{description}</small></span><span className="dl-category-sort-check" aria-hidden="true">{mode === option.value ? '✓' : ''}</span>
    </button>;
  })}</VariableMenu>;
}
