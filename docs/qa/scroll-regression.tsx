/** Automated DOM/React regression fixture. Serve with bun run dev; never bundled in the app. */
import React, { Profiler } from 'react';
import { createRoot } from 'react-dom/client';
import { ExplorerApp } from '../../src/features/explorer/ExplorerApp';
import { createFixtureApi } from '../../src/features/explorer/fixture-api';
import { initialView } from '../../src/features/explorer/model';
import type { Dataset, DesktopApi, Distributions } from '../../src/contracts/desktop-api';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const frame = () => new Promise<number>(resolve => requestAnimationFrame(resolve));
const params = new URLSearchParams(location.search), expanded = params.get('mode') === 'explore';
const columnCount = params.get('columns') === '4911' ? 4911 : 246;
const dataset: Dataset = { id: 'scroll-regression', revision: 'r1', sourcePath: '/fixtures/wide.parquet', name: 'Scroll regression · 246 variables', rowCount: 191254,
  columns: Array.from({ length: columnCount }, (_, i) => ({ id: `c${i}`, name: `Variable ${i} ${i % 4 === 0 ? 'with a longer wrapped title' : ''}`, kind: i % 3 === 0 ? 'numeric' : 'categorical', dataType: i % 3 === 0 ? 'DOUBLE' : 'VARCHAR' })) };
const requests: string[][] = [], errors: string[] = [], durations: number[] = [];
let active = 0, maxActive = 0, commits = 0;
const fixture = createFixtureApi();
const api: DesktopApi = { ...fixture,
  getLastSource: async () => ({ path: dataset.sourcePath }), openDataset: async () => dataset,
  loadView: async () => { const view = initialView(dataset); if (expanded) view.workspace!.mode = 'variables'; return view; }, saveView: async () => {},
  queryPage: async request => ({ datasetRevision: 'r1', filteredCount: dataset.rowCount!, rows: Array.from({ length: 100 }, (_, i) => ({ id: `r${i}`, values: Object.fromEntries(request.columns.map(id => [id, i])) })) }),
  getDistributions: async request => {
    requests.push(request.columns); active++; maxActive = Math.max(maxActive, active);
    await wait(160); active--;
    const result: Distributions = { selectedCount: 5000, totalRows: 191254, analyzedRows: 5000, sampled: true,
      variables: request.columns.map(id => { const index = Number(id.slice(1)), column = dataset.columns[index];
        return { column: id, kind: column.kind, bins: Array.from({ length: column.kind === 'numeric' ? 12 : [3, 5, 8, 2, 10][index % 5] }, (_, i) => ({ value: `Category ${i}`, left: i * 10, right: (i + 1) * 10, foreground: 100 + i, background: 100 + i, rForeground: (100 + i) / 5000, rBackground: (100 + i) / 5000 })) };
      }) };
    return result;
  },
};
// The isolated preview uses only generated rows and in-memory view writes.
localStorage.removeItem('datolens.active-dataset.v1');
localStorage.removeItem('datolens.open-datasets.v1');
addEventListener('error', event => errors.push(event.message));
addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
createRoot(document.getElementById('root')!).render(<Profiler id="explorer" onRender={(_id, _phase, actualDuration) => { commits++; durations.push(actualDuration); }}><ExplorerApp api={api} /></Profiler>);

async function until(predicate: () => boolean) {
  const start = performance.now();
  while (!predicate()) { if (performance.now() - start > 15000) throw new Error('UI failed to settle in 15 seconds'); await wait(40); }
}
const check = (ok: boolean, message: string) => { if (!ok) throw new Error(message); };
async function run() {
  await until(() => !!document.querySelector('.dl-variable-list'));
  const list = document.querySelector<HTMLElement>('.dl-variable-list')!;
  const settled = () => !document.querySelector('.dl-variable-pending') && list.getAttribute('aria-busy') === 'false' && active === 0;
  await until(settled);
  const lanes = expanded ? Math.max(1, Math.floor(list.clientWidth / 390)) : 1;
  check(list.scrollHeight > dataset.columns.length * 150 / lanes, 'Virtual spacers collapsed; the scroll cannot reach distant variables');
  const sampleHeight = document.querySelector('.dl-sampling')!.getBoundingClientRect().height;
  let maxCards = 0, placeholderFrames = 0, changedSampleHeight = 0;
  const inspect = () => {
    maxCards = Math.max(maxCards, document.querySelectorAll('.dl-variable').length);
    if (document.querySelector('.dl-variable-pending')) placeholderFrames++;
    if (document.querySelector('.dl-sampling')!.getBoundingClientRect().height !== sampleHeight) changedSampleHeight++;
  };
  for (let top = 0; top <= 3500; top += 350) { list.scrollTop = top; await wait(250); await until(settled); }
  list.scrollTop = 0; await wait(250); await until(settled);
  const callsBeforeWarmScroll = requests.length;
  const frames: number[] = [];
  let last = await frame();
  for (const direction of [1, -1]) for (let pixel = 0; pixel <= 3300; pixel += 22) {
    list.scrollTop = direction === 1 ? pixel : 3300 - pixel;
    const time = await frame(); frames.push(time - last); last = time; inspect();
  }
  await wait(250); await until(settled);
  const warmRequests = requests.length - callsBeforeWarmScroll;
  const stationaryCommits = commits, stationaryCalls = requests.length;
  await wait(1200);
  check(commits === stationaryCommits, 'Stationary UI keeps rendering');
  check(requests.length === stationaryCalls, 'Stationary UI keeps querying');
  check(warmRequests === 0, `Warm scroll issued ${warmRequests} native requests`);
  check(placeholderFrames === 0, `Cached charts flickered to placeholders on ${placeholderFrames} frames`);
  check(changedSampleHeight === 0, 'Sample controls changed height while scrolling');
  check(maxCards < 12 * lanes, `Too many mounted cards: ${maxCards}`);
  // Overshoot in-flight work to exercise cancellation and queue-time cache checks.
  for (let top = 5000; top <= 17000; top += 750) { list.scrollTop = top; await wait(110); }
  await wait(250); await until(settled);
  list.scrollTop = list.scrollHeight;
  await wait(250); await until(settled);
  check(!!document.querySelector(`[data-reorder-id="c${columnCount - 1}"]`), 'The last variable is unreachable');
  const counts = new Map<string, number>();
  for (const ids of requests) for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  check([...counts.values()].every(count => count === 1), 'A column was fetched more than once');
  check(counts.size > 30, 'The scroll did not reach enough distinct variables');
  check([...counts.keys()].some(id => Number(id.slice(1)) > 50), 'Distant variables were never reached');
  check(maxActive === 1, 'Native calls ran concurrently');
  check(!errors.length, errors.join('\n'));
  frames.sort((a, b) => a - b); durations.sort((a, b) => a - b);
  return { status: 'PASS', fixtureColumns: columnCount, mode: expanded ? 'explore' : 'table', warmRequests, placeholderFrames, changedSampleHeight, maxMountedCards: maxCards,
    idleRenders: 0, idleRequests: 0, nativeMaxConcurrency: maxActive, queriedColumns: counts.size, duplicateColumnQueries: 0, lastVariableReached: true,
    warmFrames: frames.length, frameP95Ms: frames[Math.floor(frames.length * .95)], reactCommitP95Ms: durations[Math.floor(durations.length * .95)], errors };
}
void run().then(result => { document.getElementById('report')!.textContent = JSON.stringify(result, null, 2); })
  .catch(error => { document.getElementById('report')!.textContent = `FAIL: ${error.stack ?? error}`; });
