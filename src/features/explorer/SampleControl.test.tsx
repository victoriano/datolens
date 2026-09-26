import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { SampleControl } from './SampleControl';
import type { Distributions } from '../../contracts/desktop-api';

test('loading more cards does not remove sample text or change the sampling controls layout', () => {
  const result: Distributions = { variables: [], selectedCount: 5000, totalRows: 191254, analyzedRows: 5000, sampled: true };
  const render = (busy: boolean) => renderToStaticMarkup(<SampleControl value={{ mode: 'auto' }} result={result} busy={busy} totalRows={191254} onChange={() => {}} />);
  expect(render(true).replace('aria-busy="true"', 'aria-busy="false"')).toBe(render(false));
});
