/** Explicit synthetic provider fixture: never calls a real AI service. */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Dataset, DesktopApi, ViewState } from '../../src/contracts/desktop-api';
import { CategorySemanticsDialog } from '../../src/features/explorer/CategorySemanticsDialog';
import { initialView } from '../../src/features/explorer/model';
import '../../src/styles/explorer.css';
import '../../src/styles/theme.css';
import '../../src/styles/native.css';
const dataset: Dataset = { id: 'synthetic', revision: 'r1', name: 'Synthetic only', sourcePath: '/fixture.csv', rowCount: 50, columns: [
  { id: 'agreement', name: 'Agreement fixture', kind: 'categorical', dataType: 'VARCHAR' },
  { id: 'frequency', name: 'Frequency fixture', kind: 'categorical', dataType: 'VARCHAR' },
] };
const values = { agreement: ['Agree', 'Disagree', 'Neutral'], frequency: ['Always', 'Never', 'Sometimes'] };
const orders = { agreement: ['Disagree', 'Neutral', 'Agree'], frequency: ['Never', 'Sometimes', 'Always'] };
let updateCalls: (calls: string[]) => void = () => {};
const calls: string[] = [];
let firstColor = true;
const api = {
  hasProviderKey: async () => true,
  getDistributions: async ({ columns }) => ({ variables: columns.map(id => ({ column: id, kind: 'categorical', bins: values[id].map(value => ({ value, background: 10, foreground: 10, rBackground: .2, rForeground: .2 })) })), selectedCount: 50, totalRows: 50, analyzedRows: 50, sampled: false }),
  suggestCategoryOrder: async request => {
    calls.push(`order:${request.column}`); updateCalls([...calls]);
    await new Promise(resolve => setTimeout(resolve, 6000));
    return { datasetRevision: 'r1', column: request.column, ordinal: true, order: orders[request.column], explanation: 'Synthetic ordinal proposal.' };
  },
  suggestCategoryColors: async request => {
    calls.push(`colors:${request.column}`); updateCalls([...calls]);
    await new Promise(resolve => setTimeout(resolve, 6000));
    if (firstColor) { firstColor = false; throw new Error('Synthetic provider failure; other proposals must survive.'); }
    return { datasetRevision: 'r1', column: request.column, assignments: request.values.map(value => ({ value, color: '#009e73', reason: 'Synthetic test color' })), explanation: 'Synthetic colors.' };
  },
} as DesktopApi;
function Harness() {
  const [view, setView] = useState<ViewState>(() => initialView(dataset));
  const [open, setOpen] = useState(false);
  const [log, setLog] = useState<string[]>([]); updateCalls = setLog;
  return <main className="dl-explorer" style={{ padding: 24, minHeight: '100vh' }}><h1>Synthetic provider QA</h1><p>No external calls. First color request fails deliberately.</p><button onClick={() => setOpen(true)}>Open batch fixture</button><pre>{JSON.stringify({ calls: log, savedView: view }, null, 2)}</pre>{open && <CategorySemanticsDialog api={api} dataset={dataset} columns={dataset.columns} view={view} onView={setView} onClose={() => setOpen(false)} />}</main>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
