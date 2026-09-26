import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Bin } from '../../contracts/desktop-api';
import { getUiSnapshot, setUiPreferences } from '../../ui/preferences';
import { CategoryBars } from './CategoryBars';

const bins: Bin[] = [{ value: 'Madrid', foreground: 60, background: 80, rForeground: .6, rBackground: .8 }];
const render = () => renderToStaticMarkup(<CategoryBars bins={bins} relative={false} sortMode="everything" analyzedRows={100} hasSelection={false} expanded={false} search="" onExpand={() => {}} onToggle={() => {}} />);

test('category chart preference switches between the shared compact axis and detailed row values', () => {
  const previous = getUiSnapshot();
  try {
    setUiPreferences({ categoryChartMode: 'compact' });
    const compact = render();
    expect(compact).toContain('dl-category-bars-compact');
    expect(compact).toContain('dl-compact-label-on-bar');
    expect(compact).toContain('dl-category-axis');
    expect(compact).not.toContain('dl-bar-value');

    setUiPreferences({ categoryChartMode: 'detailed' });
    const detailed = render();
    expect(detailed).not.toContain('dl-category-bars-compact');
    expect(detailed).toContain('dl-category-label');
    expect(detailed).toContain('dl-bar-value');
    expect(detailed).not.toContain('dl-category-axis');
  } finally { setUiPreferences(previous); }
});
