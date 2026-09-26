/** Real hook, virtualized variable cards and Vega, with delayed deterministic native responses. */
import React, { useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Variables } from '../../src/features/explorer/Variables';
import { SampleControl } from '../../src/features/explorer/SampleControl';
import { useDistributions } from '../../src/features/explorer/useDistributions';
import { initialView } from '../../src/features/explorer/model';
import type { Dataset, DesktopApi, Filter, ViewState } from '../../src/contracts/desktop-api';
import '../../src/styles/explorer.css';
import '../../src/styles/theme.css';
import '../../src/styles/native.css';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const check = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };
async function until(predicate: () => boolean) { const start = performance.now(); while (!predicate()) { if (performance.now() - start > 15000) throw new Error('Timed out waiting for UI'); await wait(25); } }
const dataset: Dataset = { id: 'filter-fixture', revision: 'r1', sourcePath: '/fixtures/pisa.parquet', name: 'Filter transitions', rowCount: 191254,
  columns: Array.from({ length: 246 }, (_, i) => ({ id: `c${i}`, name: `Variable ${i}`, kind: (i % 4 === 0 ? 'numeric' : i % 4 === 1 ? 'date' : i % 4 === 2 ? 'categorical' : 'text') as Dataset['columns'][number]['kind'], dataType: 'DOUBLE' })) };
const stats = { count: 5000, missing: 0, distinct: 12, min: '0', p25: '25', median: '50', mean: '49', p75: '75', max: '100' };
const background = Object.fromEntries(dataset.columns.map(column => [column.id, stats]));
const errors: string[] = [], expectedErrors: string[] = [];
const calls: Array<{ filters: Filter[]; ids: string[] }> = [];
let active = 0, maxActive = 0, failNext = false;
const population = (filters: Filter[]) => filters.length ? filters[0].kind === 'categorical' ? 2100 : filters[0].kind === 'numeric' ? 1250 : filters[0].kind === 'date' ? 900 : 0 : 5000;
const api = { getDistributions: async (request: Parameters<DesktopApi['getDistributions']>[0]) => {
  calls.push({ filters: request.filters, ids: request.columns }); active++; maxActive = Math.max(maxActive, active);
  await wait(220); active--;
  if (failNext) { failNext = false; throw new Error('Expected fixture failure'); }
  const selectedCount = population(request.filters);
  return { selectedCount, totalRows: 191254, analyzedRows: 5000, sampled: true, variables: request.columns.map(id => {
    const column = dataset.columns.find(column => column.id === id)!;
    return { column: id, kind: column.kind, bins: Array.from({ length: 6 }, (_, i) => ({ value: `Category ${i}`, left: i * (column.kind === 'date' ? 86400000 : 10), right: (i + 1) * (column.kind === 'date' ? 86400000 : 10), background: 100 + i, foreground: selectedCount ? Math.round((100 + i) * selectedCount / 5000) : 0, rBackground: .2, rForeground: selectedCount ? .1 : 0 })), statistics: request.statistics?.includes(id) ? { ...stats, count: selectedCount } : undefined };
  }) };
} } as DesktopApi;
let setFilters: (filters: Filter[]) => void, setSource: (source: string) => void, state: ReturnType<typeof useDistributions>;
function Harness() {
  const [view, setView] = useState(() => { const view = initialView(dataset); view.variablePanel.statistics = ['c0']; return view; });
  const [columns, setColumns] = useState<string[]>([]), [source, changeSource] = useState('r1');
  const visible = useCallback((ids: string[]) => setColumns(previous => JSON.stringify(previous) === JSON.stringify(ids) ? previous : ids), []);
  setFilters = filters => setView(previous => ({ ...previous, filters })); setSource = changeSource;
  state = useDistributions({ api, datasetId: dataset.id, revision: source, columns, filters: view.filters, sampling: { mode: 'auto' }, statistics: view.variablePanel.statistics ?? [], enabled: true, onError: error => expectedErrors.push(String(error)) });
  const { distributions: result } = state;
  return <main className="dl-explorer" data-theme="light"><div className="dl-workspace dl-workspace-expanded"><Variables expanded columns={dataset.columns} view={view} distributions={result?.variables ?? []} distributionsFiltered={state.distributionsFiltered} stale={state.chartsStale} busy={state.chartsBusy} backgroundStatistics={background} analyzedRows={result?.analyzedRows ?? 0} selectedRows={result?.selectedCount ?? 0} totalRows={result?.analyzedRows ?? 0} onVisibleColumns={visible} onView={setView} onFilter={(id, filter) => setView(previous => ({ ...previous, filters: [...previous.filters.filter(f => f.column !== id), ...(filter ? [filter] : [])] }))} samplingControl={<SampleControl value={{ mode: 'auto' }} result={result} busy={state.chartsBusy} totalRows={191254} onChange={() => {}} />} /></div></main>;
}
addEventListener('error', event => errors.push(event.message));
addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
createRoot(document.getElementById('root')!).render(<Harness />);

async function run() {
  const settled = () => !!state?.distributions && !state.chartsBusy && !state.chartsStale && active === 0 && !document.querySelector('.dl-variable-pending');
  await until(settled); await until(() => !!document.querySelector('[data-reorder-id="c0"] canvas') && !!document.querySelector('[data-reorder-id="c1"] canvas'));
  let checkedFrames = 0, placeholderFrames = 0, canvasReplacements = 0, chartShrinks = 0, statisticsRemovals = 0;
  const change = async (filters: Filter[], error = false) => {
    const initial = state.distributions!, chartNodes = ['c0', 'c1'].map(id => document.querySelector(`[data-reorder-id="${id}"] canvas`)!);
    const heights = chartNodes.map(node => node.parentElement!.getBoundingClientRect().height);
    const statistics = document.querySelector('[data-reorder-id="c0"] .dl-variable-statistics')!;
    setFilters(filters); await until(() => state.chartsBusy || (!state.chartsStale && state.distributions?.selectedCount === population(filters)));
    const start = performance.now();
    while (state.chartsBusy) {
      checkedFrames++;
      if (document.querySelector('.dl-variable-pending')) placeholderFrames++;
      chartNodes.forEach((node, i) => { if (!node.isConnected) canvasReplacements++; if (node.parentElement && node.parentElement.getBoundingClientRect().height < heights[i] - 1) chartShrinks++; });
      if (!statistics.isConnected) statisticsRemovals++;
      if (state.chartsStale) check(state.distributions === initial, 'Partial filtered results mixed into the previous population');
      check(performance.now() - start < 15000, 'Filter never settled');
      await frame();
    }
    if (error) { check(state.distributions === initial, 'Failed filter discarded charts'); check(state.chartsStale, 'Failed data was labelled current'); }
    else { check(state.distributions?.selectedCount === population(filters), `Incorrect final population: ${JSON.stringify(filters)} gave ${state.distributions?.selectedCount}`); check(!state.chartsStale, 'New results still marked stale'); }
    await wait(50);
  };
  await change([{ column: 'c2', kind: 'categorical', selected: ['Category 1'] }]);
  await change([{ column: 'c0', kind: 'numeric', min: 10, max: 30 }]);
  await change([{ column: 'c1', kind: 'date', start: '1970-01-02', end: '1970-01-04' }]);
  await change([{ column: 'c3', kind: 'text', terms: ['no match'], mode: 'any', caseSensitive: false }]);
  await change([]);
  // Superseded in-flight filters must never flash their results after clearing.
  setFilters([{ column: 'c0', kind: 'numeric', min: 3, max: 17 }]); await until(() => active > 0);
  setFilters([{ column: 'c2', kind: 'categorical', selected: ['Category 4'] }]); await wait(100);
  setFilters([]); await until(settled); check(state.distributions?.selectedCount === 5000, 'Superseded query won');
  failNext = true; await change([{ column: 'c0', kind: 'numeric', min: 7, max: 19 }], true);
  check(expectedErrors.length === 1, 'Expected query failure not surfaced');
  await change([]);
  setSource('r2'); await frame(); check(state.distributions === null, 'Source revision reused stale data'); await until(settled);
  check(!placeholderFrames && !canvasReplacements && !chartShrinks && !statisticsRemovals, 'Mounted chart/layout regression');
  check(!errors.length, errors.join('\n'));
  return { status: 'PASS', variables: 246, checkedFrames, placeholderFrames, canvasReplacements, chartShrinks, statisticsRemovals, filterKinds: ['categorical', 'numeric', 'date', 'text'], emptySelection: 'PASS', rapidChanges: 'PASS', queryFailure: 'PASS', revisionInvalidation: 'PASS', nativeMaxConcurrency: maxActive, requests: calls.length, errors };
}
void run().then(result => { document.getElementById('report')!.textContent = JSON.stringify(result, null, 2); }).catch(error => { document.getElementById('report')!.textContent = `FAIL: ${error.stack ?? error}`; });
