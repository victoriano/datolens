/** Full ExplorerApp with delayed native API, DOM identity assertions and cell-format instrumentation. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ExplorerApp } from '../../src/features/explorer/ExplorerApp';
import { createFixtureApi } from '../../src/features/explorer/fixture-api';
import { initialView } from '../../src/features/explorer/model';
import type { Dataset, DesktopApi, PageRequest } from '../../src/contracts/desktop-api';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const check = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };
async function until(predicate: () => boolean) { const start = performance.now(); while (!predicate()) { if (performance.now() - start > 20000) throw new Error('Timed out waiting for UI'); await wait(25); } }
const formats = new Map<string, number>();
const dataset: Dataset = { id: 'table-render-fixture', revision: 'r1', sourcePath: '/fixtures/wide.parquet', name: 'Table render regression', rowCount: 400,
  columns: Array.from({ length: 246 }, (_, i) => ({ id: `c${i}`, name: i === 1 ? 'Group' : `Column ${i}`, kind: i === 1 ? 'categorical' : 'numeric', dataType: i === 1 ? 'VARCHAR' : 'DOUBLE',
    ...(i === 1 ? {} : { spss: { label: null, categorical: false, missingValues: [], valueLabels: new Proxy({}, { get: (_target, key) => { const cell = `c${i}:${String(key)}`; formats.set(cell, (formats.get(cell) ?? 0) + 1); return undefined; } }) } }) })) };
const calls: PageRequest[] = [], copies: string[] = [], errors: string[] = [];
let active = 0, maxActive = 0;
const fixture = createFixtureApi();
const api: DesktopApi = { ...fixture,
  getLastSource: async () => ({ path: dataset.sourcePath }), openDataset: async () => dataset,
  loadView: async () => initialView(dataset), saveView: async () => {},
  queryPage: async request => {
    calls.push(request); active++; maxActive = Math.max(maxActive, active);
    const filter = request.filters[0], selected = filter && 'selected' in filter ? filter.selected : [];
    await wait(selected.includes('Slow') ? 600 : 190); active--;
    if (selected.includes('Error')) throw new Error('Expected table query failure');
    let ids = Array.from({ length: 400 }, (_, i) => i).filter(i => selected.includes('None') ? false : selected.includes('A') ? i % 2 === 0 : true);
    if (request.sorting[0]?.desc) ids.reverse();
    return { datasetRevision: 'r1', filteredCount: ids.length, rows: ids.slice(request.offset, request.offset + request.limit).map(i => ({ id: `r${i}`, values: Object.fromEntries(request.columns.map(id => [id, id === 'c1' ? i % 2 ? 'B' : 'A' : i * 1000 + Number(id.slice(1))])) })) };
  },
  getDistributions: async request => ({ selectedCount: 400, totalRows: 400, analyzedRows: 400, sampled: false,
    variables: request.columns.map(id => ({ column: id, kind: dataset.columns.find(column => column.id === id)!.kind, bins: id === 'c1' ? ['All', 'A', 'None', 'Slow', 'Error'].map(value => ({ value, background: 100, foreground: 100, rBackground: .25, rForeground: .25 })) : [0, 1, 2].map(i => ({ left: i * 10, right: (i + 1) * 10, background: 100, foreground: 100, rBackground: .25, rForeground: .25 })) })) }),
};
Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { copies.push(text); } } });
localStorage.removeItem('datolens.active-dataset.v1'); localStorage.removeItem('datolens.open-datasets.v1');
addEventListener('error', event => errors.push(event.message)); addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
createRoot(document.getElementById('root')!).render(<ExplorerApp api={api} />);

const formatCount = () => [...formats.values()].reduce((sum, n) => sum + n, 0);
const table = () => document.querySelector<HTMLElement>('.dl-table-scroll')!;
const rows = () => [...document.querySelectorAll<HTMLTableRowElement>('.dl-table tbody tr[data-row-id]')];
const cell = (row: string, column: string) => document.querySelector<HTMLTableCellElement>(`td[data-row-id="${row}"][data-column-id="${column}"]`)!;
const settled = () => !!table() && table().getAttribute('aria-busy') === 'false' && !table().hasAttribute('data-stale') && active === 0;
function filterButton(value: string) { return [...document.querySelectorAll<HTMLButtonElement>('[data-reorder-id="c1"] .dl-category-bars button')].find(button => button.querySelector('.dl-category-label')?.textContent === value)!; }
function select(target: HTMLElement, options: { shiftKey?: boolean; metaKey?: boolean } = {}) {
  target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, buttons: 1, ...options }));
  target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, buttons: 0, ...options }));
}
function key(target: HTMLElement, key: string, metaKey = false) { target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key, metaKey })); }

async function run() {
  await until(() => settled() && rows().length === 100 && !!filterButton('All'));
  let checkedPendingFrames = 0, lostRowsWhilePending = 0, heightCollapses = 0;
  const change = async (value: string, expectFailure = false) => {
    const originalRows = rows(), height = table().scrollHeight, pressed = filterButton(value).getAttribute('aria-pressed');
    filterButton(value).click();
    await until(() => filterButton(value).getAttribute('aria-pressed') !== pressed);
    while (table().getAttribute('aria-busy') === 'true') {
      checkedPendingFrames++;
      lostRowsWhilePending += originalRows.filter(row => !row.isConnected).length;
      if (table().scrollHeight < height - 1) heightCollapses++;
      check(table().querySelector('tbody')!.inert, 'Old rows remain interactive during a query');
      await frame();
    }
    await until(() => active === 0 && (expectFailure ? !!document.querySelector('.dl-error') : settled()));
  };
  const originalCell = cell('r2', 'c0'), originalRow = originalCell.closest('tr');
  const beforeSame = formatCount(); await change('All');
  check(cell('r2', 'c0') === originalCell && originalCell.closest('tr') === originalRow, 'Unchanged filter replaced row/cell nodes');
  const unchangedFilterFormats = formatCount() - beforeSame;
  check(unchangedFilterFormats === 0, `Unchanged filter reformatted ${unchangedFilterFormats} cells`);
  await change('All');
  const beforeSurvivor = formats.get('c0:2000'); await change('A');
  check(rows().length === 100 && rows()[1].dataset.rowId === 'r2', 'Filtered row order is wrong');
  check(cell('r2', 'c0') === originalCell && originalCell.closest('tr') === originalRow, 'Surviving rows/cells were recreated');
  check(formats.get('c0:2000') === beforeSurvivor, 'Unchanged surviving cell was rendered again');
  await change('A');

  select(cell('r0', 'c0')); await frame(); select(cell('r1', 'c2'), { shiftKey: true }); await frame();
  check(document.querySelectorAll('td[aria-selected="true"]').length === 6, 'Shift range selection broke');
  select(cell('r0', 'c0'), { metaKey: true }); await frame();
  check(document.querySelectorAll('td[aria-selected="true"]').length === 5, 'Command-toggle selection broke');
  key(table(), 'Escape'); await frame();
  const rowCheckbox = rows()[0].querySelector<HTMLInputElement>('input')!; rowCheckbox.click(); await frame();
  check(rows()[0].classList.contains('is-row-selected'), 'Row checkbox broke'); key(table(), 'Escape'); await frame();
  select(cell('r0', 'c0')); await frame(); key(table(), 'c', true); await until(() => copies.length === 1);
  check(copies[0] === '0', 'Copy returned wrong selected cell');
  filterButton('Slow').click(); await until(() => table().getAttribute('aria-busy') === 'true');
  const selected = document.querySelectorAll('td[aria-selected="true"]').length;
  select(cell('r4', 'c0')); key(table(), 'c', true); await frame();
  check(document.querySelectorAll('td[aria-selected="true"]').length === selected && copies.length === 1, 'Stale selection/copy was allowed');
  filterButton('Slow').click(); await until(settled); check(rows()[0].dataset.rowId === 'r0', 'Cancelled filter replaced current data');
  key(table(), 'Escape'); await frame();

  await change('Error', true);
  check(rows().length === 100 && table().hasAttribute('data-stale'), 'Failed query discarded/validated old rows');
  filterButton('Error').click(); await until(settled);
  await change('None'); check(!rows().length && !!document.querySelector('.dl-table-empty'), 'Empty result was not displayed');
  filterButton('None').click(); await until(() => settled() && rows().length === 100);

  // Warm 25+ columns, then inspect each animation frame during both scroll directions.
  for (let left = 0; left <= 4500; left += 450) { table().scrollLeft = left; await wait(90); await until(settled); }
  table().scrollLeft = 0; await wait(90); await until(settled);
  const warmCalls = calls.length, originalRows = rows();
  let horizontalFrames = 0, blankFrames = 0, cachedPlaceholderFrames = 0, replacedRows = 0;
  let previousCells = new Map([...table().querySelectorAll<HTMLTableCellElement>('td[data-column-id]')].map(cell => [`${cell.dataset.rowId}/${cell.dataset.columnId}`, cell]));
  let replacedOverlappingCells = 0;
  for (const direction of [1, -1]) for (let pixel = 0; pixel <= 4000; pixel += 25) {
    table().scrollLeft = direction === 1 ? pixel : 4000 - pixel; await frame(); horizontalFrames++;
    if (rows().length !== 100) blankFrames++;
    if (document.querySelector('.dl-cell-pending')) cachedPlaceholderFrames++;
    replacedRows += originalRows.filter(row => !row.isConnected).length;
    const cells = new Map([...table().querySelectorAll<HTMLTableCellElement>('td[data-column-id]')].map(cell => [`${cell.dataset.rowId}/${cell.dataset.columnId}`, cell]));
    for (const [id, node] of cells) if (previousCells.has(id) && previousCells.get(id) !== node) replacedOverlappingCells++;
    previousCells = cells;
  }
  await wait(100); await until(settled);
  const warmHorizontalQueries = calls.length - warmCalls;
  check(calls.length === warmCalls, `Cached horizontal scroll made ${calls.length - warmCalls} queries`);
  check(!blankFrames && !cachedPlaceholderFrames && !replacedRows && !replacedOverlappingCells, 'Horizontal scroll flickered/recreated existing cells');
  table().scrollLeft = table().scrollWidth; await wait(100); await until(settled);
  check(!!document.querySelector('th[data-reorder-id="c245"]') && !!cell('r0', 'c245'), 'Last column is unreachable');
  // Cross the bounded projection cache, then reverse into its oldest retained columns.
  for (const direction of [1, -1]) for (let pixel = 0; pixel <= 18000; pixel += 900) {
    table().scrollLeft = direction === 1 ? pixel : 18000 - pixel; await wait(90); await until(settled);
    check(rows().length === 100 && !document.querySelector('.dl-cell-pending'), 'Cache eviction lost a visible column');
    for (const row of rows()) for (const node of row.querySelectorAll<HTMLTableCellElement>('td[data-column-id]')) {
      const id = Number(row.dataset.rowId!.slice(1)), column = node.dataset.columnId!;
      const value = column === 'c1' ? id % 2 ? 'B' : 'A' : String(id * 1000 + Number(column.slice(1)));
      check(node.textContent === value, `Wrong projected value for ${row.dataset.rowId}/${column}`);
    }
  }
  document.querySelector<HTMLButtonElement>('.dl-pagination button:last-child')!.click();
  await until(() => settled() && rows()[0]?.dataset.rowId === 'r100');
  document.querySelector<HTMLButtonElement>('.dl-pagination button:first-of-type')!.click();
  await until(() => settled() && rows()[0]?.dataset.rowId === 'r0');
  const sort = () => document.querySelector<HTMLButtonElement>('th[data-reorder-id="c0"] .dl-header-cell > button')!;
  sort().click(); await until(() => !!document.querySelector('.dl-sort-indicator')); await until(settled);
  sort().click(); await until(() => settled() && rows()[0]?.dataset.rowId === 'r399');
  sort().click(); await until(() => settled() && rows()[0]?.dataset.rowId === 'r0');
  check(!lostRowsWhilePending && !heightCollapses, 'Pending filters collapsed the table'); check(!errors.length, errors.join('\n'));
  return { status: 'PASS', columns: 246, pageRows: 100, checkedPendingFrames, lostRowsWhilePending, heightCollapses, unchangedFilterFormats, survivingRowsAndCells: 'PASS', rangeSelection: 'PASS', rowSelection: 'PASS', copy: 'PASS', staleInteractionGuard: 'PASS', cancelledFilter: 'PASS', queryError: 'PASS', emptyResult: 'PASS', horizontalFrames, blankFrames, cachedPlaceholderFrames, replacedRows, replacedOverlappingCells, warmHorizontalQueries, lastColumnReached: true, cacheEviction: 'PASS', projectedValues: 'PASS', pagination: 'PASS', sorting: 'PASS', nativeMaxConcurrency: maxActive, errors };
}
void run().then(result => { document.getElementById('report')!.textContent = JSON.stringify(result, null, 2); }).catch(error => { document.getElementById('report')!.textContent = `FAIL: ${error.stack ?? error}`; });
