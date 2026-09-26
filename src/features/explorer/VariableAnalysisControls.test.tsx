import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { VariableStatisticsView } from './VariableAnalysisControls';

test('statistics remain mounted while refreshing and quantile actions wait for fresh results', () => {
  const statistics = { count: 5000, missing: 0, distinct: 99, min: '0', p25: '25', median: '50', mean: '49', p75: '75', max: '100' };
  const render = (busy: boolean) => renderToStaticMarkup(<VariableStatisticsView column={{ id: 'score', name: 'Score', kind: 'numeric', dataType: 'DOUBLE' }} statistics={statistics} backgroundStatistics={statistics} busy={busy} filtered onFilter={() => {}} />);
  const pending = render(true);
  expect(pending).not.toContain('dl-statistics-loading');
  expect(pending.match(/disabled=""/g)).toHaveLength(3);
  expect(pending.replace('aria-busy="true"', 'aria-busy="false"').replaceAll(' disabled=""', '')).toBe(render(false));
});
