import { ExplorerApp } from './features/explorer';
import { EnrichmentPanel } from './features/enrichment';
import { desktopApi } from './platform/desktop';
export default function App() {
  return <ExplorerApp api={desktopApi} renderEnrichmentPanel={({dataset,selection,filters,onDataChanged}) =>
    <EnrichmentPanel key={dataset.id} api={desktopApi} dataset={dataset} selectedRowIds={selection.rowIds} selectedCells={selection.cells} filters={filters} onDefinitionsChange={onDataChanged} onResultsChange={onDataChanged}/>
  } />;
}
