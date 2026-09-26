/** Real React/Vega components. Synthetic IPC returns fresh but selectively changed distributions. */
import React, { useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as vega from 'vega';
import { Variables } from '../../src/features/explorer/Variables';
import { useDistributions } from '../../src/features/explorer/useDistributions';
import { initialView } from '../../src/features/explorer/model';
import { PlotsPanel } from '../../src/features/plots/PlotsPanel';
import { defaultConfig, freshWorkspace } from '../../src/features/plots/model';
import type { Dataset, DesktopApi, Filter, ViewState } from '../../src/contracts/desktop-api';
import '../../src/styles/explorer.css';
import '../../src/styles/theme.css';
import '../../src/styles/native.css';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const check = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };
async function until(predicate: () => boolean) { const start = performance.now(); while (!predicate()) { if (performance.now() - start > 20000) throw new Error('Timed out waiting for UI'); await wait(20); } }
const renders = () => ({ ...(window as any).__renderMetrics }) as Record<string, number>;
const delta = (before: Record<string, number>) => Object.fromEntries(Object.entries(renders()).map(([key, n]) => [key, n - (before[key] ?? 0)]).filter(([, n]) => n));
const paints: Record<string, number> = {}, plotViews = new Map<string, vega.View>();
const clear = CanvasRenderingContext2D.prototype.clearRect;
CanvasRenderingContext2D.prototype.clearRect = function(...args) {
  const column = this.canvas.closest('[data-reorder-id]')?.getAttribute('data-reorder-id') ?? this.canvas.closest('section')?.querySelector('h3')?.textContent ?? 'chart';
  paints[column] = (paints[column] ?? 0) + 1; return clear.apply(this, args);
};
const runAsync = vega.View.prototype.runAsync;
vega.View.prototype.runAsync = function() {
  const container = this.container();
  if (container?.classList.contains('dl-plot-vega')) plotViews.set(container.closest('section')!.querySelector('h3')?.textContent ?? 'chart', this);
  return runAsync.call(this);
};
const errors: string[] = [], expectedErrors: string[] = [];
addEventListener('error', event => errors.push(event.message)); addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
const dataset: Dataset = { id: 'selective-chart-fixture', revision: 'r1', sourcePath: '/fixtures/wide.parquet', name: 'Selective rendering', rowCount: 5000, columns: Array.from({ length: 246 }, (_, i) => ({ id: `c${i}`, name: `Variable ${i}`, kind: i % 4 === 0 ? 'numeric' : i % 4 === 1 ? 'date' : 'categorical', dataType: 'DOUBLE' })) };
const stats = { count: 5000, missing: 0, distinct: 10, min: '0', p25: '25', median: '50', mean: '49', p75: '75', max: '100' };
const background = Object.fromEntries(dataset.columns.map(column => [column.id, stats]));
let active = 0, callbackVersion = 0;
const callbackCalls: number[] = [];
const api = { getDistributions: async (request: Parameters<DesktopApi['getDistributions']>[0]) => {
  active++; await wait(110); active--;
  const phaseFilter = request.filters.find(filter => filter.column === 'c245'), phase = phaseFilter && 'selected' in phaseFilter ? phaseFilter.selected[0] : 'A';
  return { selectedCount: 1000, totalRows: 5000, analyzedRows: 5000, sampled: false, variables: request.columns.map(id => {
    const column = dataset.columns.find(column => column.id === id)!;
    return { column: id, kind: column.kind, bins: Array.from({ length: 10 }, (_, i) => {
      const changed = i === 1 && (id === 'c0' && phase !== 'A' || id === 'c2' && ['C', 'D', 'E'].includes(phase));
      return { value: `Category ${i}`, left: i * (column.kind === 'date' ? 86400000 : 10), right: (i + 1) * (column.kind === 'date' ? 86400000 : 10), background: 20, foreground: changed ? 4 : 10, rBackground: .2, rForeground: changed ? .04 : .1 };
    }), statistics: request.statistics?.includes(id) ? { ...stats, missing: ['D', 'E'].includes(phase) ? 4 : 0 } : undefined };
  }) };
} } as DesktopApi;
let setFilters: (filters: Filter[]) => void, currentView: ViewState, state: ReturnType<typeof useDistributions>;
const phaseFilter = (phase: string): Filter => ({ column: 'c245', kind: 'categorical', selected: [phase] });
function Harness() {
  const [view, setView] = useState(() => { const view = initialView(dataset); view.filters = [phaseFilter('A')]; view.variablePanel.statistics = ['c0']; return view; });
  const [columns, setColumns] = useState<string[]>([]);
  const visible = useCallback((ids: string[]) => setColumns(previous => JSON.stringify(previous) === JSON.stringify(ids) ? previous : ids), []);
  setFilters = filters => setView(previous => ({ ...previous, filters })); currentView = view;
  const version = callbackVersion;
  state = useDistributions({ api, datasetId: dataset.id, revision: 'r1', columns, filters: view.filters, sampling: { mode: 'auto' }, statistics: view.variablePanel.statistics ?? [], enabled: true, onError: error => expectedErrors.push(String(error)) });
  const result = state.distributions;
  return <main className="dl-explorer" data-theme="light"><div className="dl-workspace dl-workspace-expanded"><Variables expanded columns={dataset.columns} view={view} distributions={result?.variables ?? []} distributionsFiltered={state.distributionsFiltered} stale={state.chartsStale} busy={state.chartsBusy} backgroundStatistics={background} analyzedRows={result?.analyzedRows ?? 0} selectedRows={result?.selectedCount ?? 0} totalRows={result?.analyzedRows ?? 0} onVisibleColumns={visible} onView={setView} onFilter={(id, filter) => { callbackCalls.push(version); setView(previous => ({ ...previous, filters: [...previous.filters.filter(filter => filter.column !== id), ...(filter ? [filter] : [])] })); }} /></div></main>;
}
const root = createRoot(document.getElementById('root')!); root.render(<Harness />);
const inputValue = (input: HTMLInputElement, value: string) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); };

async function run() {
  const settled = () => !!state?.distributions && !state.chartsBusy && !state.chartsStale && active === 0 && !document.querySelector('.dl-variable-pending');
  await until(settled); await until(() => !!document.querySelector('[data-reorder-id="c0"] canvas')); await wait(150);
  check(renders()['Histogram:c0'] > 0 && renders()['CategoryBar:c2:Category 1'] > 0, `React commit instrumentation is inactive: ${JSON.stringify(renders())}`);
  const canvas = document.querySelector('[data-reorder-id="c0"] canvas'), bars = [...document.querySelectorAll('[data-reorder-id="c2"] .dl-category-bars button')];
  const stages: Record<string, Record<string, number>> = {};
  for (const phase of ['B', 'C', 'D', 'E']) {
    const before = renders(), beforePaints = { ...paints };
    callbackVersion++; setFilters([phaseFilter(phase)]); await until(() => state.chartsBusy); await until(settled); await wait(80);
    stages[phase] = delta(before);
    const changed = Object.keys(stages[phase]);
    if (phase === 'B') {
      check(stages[phase]['Histogram:c0'] === 1, `Changed histogram renders: ${JSON.stringify(stages[phase])}`);
      check(changed.every(key => key.endsWith(':c0')), `Unchanged charts rendered: ${JSON.stringify(stages[phase])}`);
      check(Object.keys(paints).every(id => id === 'c0' || paints[id] === beforePaints[id]), 'Unchanged numeric canvases repainted');
    } else if (phase === 'C') {
      check(changed.every(key => key === 'VariableChart:c2' || key === 'CategoryBars:c2' || key === 'CategoryBar:c2:Category 1'), `Unchanged category bars rendered: ${JSON.stringify(stages[phase])}`);
      check(stages[phase]['CategoryBar:c2:Category 1'] === 1, 'Changed category bar was not rendered');
    } else check(!changed.length, `Statistics-only/equal result rendered charts: ${JSON.stringify(stages[phase])}`);
    check(document.querySelector('[data-reorder-id="c0"] canvas') === canvas, 'Histogram canvas replaced');
    check(bars.every(node => node.isConnected), 'Category bar nodes replaced');
  }
  // Stable callbacks must still read the latest filter and parent handler.
  const category = (value: string) => [...document.querySelectorAll<HTMLButtonElement>('[data-reorder-id="c2"] .dl-category-bars button')].find(button => button.querySelector('.dl-category-label')?.textContent === value)!;
  category('Category 0').click(); await until(() => currentView.filters.some(filter => filter.column === 'c2')); await until(settled);
  category('Category 1').click(); await until(() => { const filter = currentView.filters.find(filter => filter.column === 'c2'); return !!filter && 'selected' in filter && filter.selected.length === 2; }); await until(settled);
  check(callbackCalls.every(version => version === callbackVersion), 'Memoization retained an obsolete handler');
  const sort = document.querySelector<HTMLSelectElement>('[data-reorder-id="c2"] .dl-variable-sort select')!;
  sort.value = 'selection'; sort.dispatchEvent(new Event('change', { bubbles: true })); await frame();
  document.querySelector<HTMLButtonElement>('[data-reorder-id="c2"] .dl-category-bars > .dl-link')!.click(); await frame();
  await until(() => !!category('Category 9'));
  check(category('Category 1').getAttribute('aria-pressed') === 'true', 'Sorting lost category selection');
  setFilters([phaseFilter('E'), { column: 'c0', kind: 'numeric', min: 5, max: 15 }]); await until(settled); await wait(100);
  await until(() => !!document.querySelector('[data-reorder-id="c0"] .dl-range-label-0 button'));
  document.querySelector<HTMLButtonElement>('[data-reorder-id="c0"] .dl-range-label-0 button')!.click(); await frame();
  const numberInput = document.querySelector<HTMLInputElement>('[data-reorder-id="c0"] .dl-range-label input')!; inputValue(numberInput, '4'); await frame(); numberInput.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await until(() => currentView.filters.some(filter => filter.kind === 'numeric' && filter.min === 4 && filter.max === 15)); await until(settled);
  check(!errors.length && !expectedErrors.length, [...errors, ...expectedErrors].join('\n'));
  root.unmount();

  const plotResult = await runPlots();
  return { status: 'PASS', variables: 246, stages, histogramCanvasReplacements: 0, categoryNodeReplacements: 0, latestCallbacks: 'PASS', multiSelection: 'PASS', categorySortAndExpand: 'PASS', numericBoundEditing: 'PASS', plots: plotResult, errors };
}

async function runPlots() {
  let filter: (value: string) => void, plotting = 0;
  const exports: Array<{ format: string; content: string }> = [];
  const plotApi = { queryPlot: async (request: any) => {
    plotting++; await wait(190); plotting--;
    const phase = request.filters[0]?.selected[0] ?? 'A';
    if (phase === 'Error') throw new Error('Expected plot error');
    return { rows: ['First', 'Second'].flatMap((series, s) => ['A', 'B', 'C'].map((category, i) => ({ d0: category, d1: series, m0: series === 'First' && i === 1 && phase !== 'A' ? 7 : 3 + i, m1: 3 + i }))), matchedRows: 42, totalRows: 5000, plottedRows: 42, truncated: false, datasetRevision: 'r1', selectionMethod: 'allGroups' };
  }, exportPlot: async (request: any) => { exports.push(request); return '/fixtures/export.svg'; } } as DesktopApi;
  function PlotHarness() {
    const [filters, setFilters] = useState<Filter[]>([]), [workspace, setWorkspace] = useState(() => ({ ...freshWorkspace(), draft: { ...defaultConfig('segmentedBar', dataset.columns, ['c2', 'c3']), x: 'c2', color: 'c3' } }));
    filter = value => setFilters([{ column: 'c245', kind: 'categorical', selected: [value] }]);
    return <main className="dl-explorer" data-theme="light"><PlotsPanel api={plotApi} dataset={dataset} value={workspace} filters={filters} onChange={setWorkspace} onFilter={() => {}} /></main>;
  }
  const plotRoot = createRoot(document.getElementById('root')!); plotRoot.render(<PlotHarness />);
  const settled = () => !plotting && document.querySelector('.dl-plot-canvas-region')?.getAttribute('aria-busy') === 'false';
  await until(() => settled() && document.querySelectorAll('.dl-plot-vega canvas').length === 2); await wait(100);
  const nodes = [...document.querySelectorAll('.dl-plot-vega canvas')], views = new Map(plotViews), before = renders(), beforePaints = { ...paints };
  filter!('B'); await until(() => !settled());
  let pendingFrames = 0;
  while (!settled()) { check(nodes.every(node => node.isConnected), 'Charts unmounted while filtering'); pendingFrames++; await frame(); }
  await wait(100);
  const changed = delta(before);
  check(!changed['Canvas:Second'], `Unchanged facet rendered: ${JSON.stringify(changed)}`);
  check(paints.Second === beforePaints.Second, 'Unchanged facet canvas repainted');
  check(nodes.every(node => node.isConnected), 'A plot canvas was replaced');
  check(plotViews.get('First') === views.get('First') && plotViews.get('Second') === views.get('Second'), 'Vega views were recreated');
  check(plotViews.get('First')!.data('values').find(row => row.d0 === 'B').m0 === 7, 'Updated plot values are stale');
  const noOp = renders(); filter!('Same'); await until(() => !settled()); await until(settled); await wait(80);
  check(!Object.keys(delta(noOp)).some(key => key.startsWith('Canvas:')), 'Equal plot result rerendered facets');
  document.querySelector<HTMLDetailsElement>('.dl-plot-export')!.open = true;
  document.querySelectorAll<HTMLButtonElement>('.dl-plot-export button')[1].click(); await until(() => exports.length === 1);
  check(exports[0].format === 'svg' && exports[0].content.includes('<svg'), 'Retained views failed SVG export');
  filter!('Error'); await until(() => !settled()); await until(settled);
  check(nodes.every(node => node.isConnected) && document.querySelector('.dl-plot-canvas-region')?.hasAttribute('data-stale'), 'Failed plot query discarded or validated old data');
  check(document.querySelectorAll<HTMLButtonElement>('.dl-plot-export button')[1].disabled, 'Stale plot export is enabled');
  filter!('B'); await until(() => !settled()); await until(settled);
  const host = document.querySelector<HTMLElement>('main')!, resizable = document.querySelector<HTMLElement>('.dl-plot-resizable')!;
  const widthBefore = resizable.clientWidth;
  host.style.width = '1100px';
  await until(() => resizable.clientWidth < widthBefore);
  await wait(100);
  const region = document.querySelector<HTMLElement>('.dl-plot-canvas-region')!;
  check(region.scrollWidth === region.clientWidth, 'Auto-sized plot overflows after narrowing its container');
  check([...document.querySelectorAll<HTMLCanvasElement>('.dl-plot-vega canvas')].every(canvas => canvas.getBoundingClientRect().width <= canvas.parentElement!.clientWidth + 1), 'Canvas did not follow available width');
  check(!errors.length, errors.join('\n'));
  return { status: 'PASS', pendingFrames, changedFacetRenders: changed, unchangedFacetPaints: 0, canvasReplacements: 0, vegaViewReplacements: 0, valuesUpdated: true, equalResults: 'PASS', svgExport: 'PASS', retainedErrorAndRecovery: 'PASS', autoSize: 'PASS' };
}
void run().then(result => { document.getElementById('report')!.textContent = JSON.stringify(result, null, 2); }).catch(error => { document.getElementById('report')!.textContent = `FAIL: ${error.stack ?? error}`; });
