/** Initial integration contract. Coordinator owns changes to this file. */
export type Scalar = string | number | boolean | null;
export type CellValue = Scalar | CellValue[] | { [key: string]: CellValue };
export type RowId = string;
export type ColumnId = string;
export type VariableKind = 'numeric' | 'date' | 'boolean' | 'categorical' | 'multivalued' | 'text';
export interface Column { id: ColumnId; name: string; dataType: string; kind: VariableKind }
export interface Dataset { id: string; name: string; sourcePath: string; sheet?: string; columns: Column[]; rowCount: number | null; revision: string }
export interface Row { id: RowId; values: Record<ColumnId, CellValue> }
export type Filter =
  | { column: ColumnId; kind: 'numeric'; min?: number; max?: number }
  | { column: ColumnId; kind: 'date'; start?: string; end?: string }
  | { column: ColumnId; kind: 'categorical' | 'multivalued'; selected: string[]; listEncoded?: boolean }
  | { column: ColumnId; kind: 'text'; terms: string[]; mode: 'any' | 'all'; caseSensitive: boolean };
export interface SortRule { id: ColumnId; desc: boolean }
export interface ViewState {
  formatVersion: 1;
  columns: { order: ColumnId[]; hidden: ColumnId[]; widths: Record<ColumnId, number> };
  sorting: SortRule[];
  filters: Filter[];
  variablePanel: { order: ColumnId[]; pinned: ColumnId[]; hidden: ColumnId[]; relative: boolean; sortModeByColumn: Record<ColumnId, 'everything' | 'selection' | 'uplift' | 'tfidf'> };
}
export interface PageRequest { datasetId: string; columns: ColumnId[]; filters: Filter[]; sorting: SortRule[]; offset: number; limit: number }
export interface Page { rows: Row[]; filteredCount: number | null; datasetRevision: string }
export interface Bin { value?: string | null; left?: number; right?: number; background: number; foreground: number; rBackground: number; rForeground: number }
export interface Distribution { column: ColumnId; kind: VariableKind; bins: Bin[]; truncated?: boolean }
export interface Distributions { variables: Distribution[]; selectedCount: number; totalRows: number; analyzedRows: number; sampled: boolean }
export interface EnrichmentDefinition {
  id: string; name: string; provider: string; model: string; prompt: string;
  inputColumns: ColumnId[]; outputColumn: ColumnId; outputKind: VariableKind;
  dependsOn: string[]; revision: number;
}
export type SelectionScope =
  | { kind: 'cells'; cells: Array<{ rowId: RowId; columnId: ColumnId }> }
  | { kind: 'rows'; rowIds: RowId[]; enrichmentIds: string[] }
  | { kind: 'filtered'; filters: Filter[]; enrichmentIds: string[] }
  | { kind: 'all'; enrichmentIds: string[] };
export interface RunRequest { datasetId: string; scope: SelectionScope; mode: 'pending' | 'regenerate'; includePrerequisites: boolean; includeDependents: boolean; concurrency?: number; maxCalls?: number }
export interface RunPlan { id: string; datasetRevision: string; cellCount: number; estimatedCalls: number; missingInputs: string[] }
export interface RunStatus { id: string; state: 'queued' | 'running' | 'paused' | 'completed' | 'cancelled' | 'failed'; succeeded: number; failed: number; pending: number; error?: string }
export interface CellKey { rowId: string; enrichmentId: string }
export interface EnrichmentCell { key: CellKey; state: 'pending' | 'running' | 'succeeded' | 'failed' | 'stale' | 'blocked' | 'cancelled'; generation: number; definitionRevision: number; fingerprint: string; value: CellValue | null; error: string | null; attempts: number; applied: boolean }
export interface DesktopApi {
  getLastSource?(): Promise<{ path: string; sheet?: string } | null>;
  getDataset?(datasetId: string): Promise<Dataset>;
  listRuns(datasetId: string): Promise<RunStatus[]>;
  getCells(datasetId: string, cells: CellKey[]): Promise<EnrichmentCell[]>;
  getCellHistory(datasetId: string, cell: CellKey): Promise<EnrichmentCell[]>;
  selectDatasetPath?(): Promise<string | null>;
  onFileDrop?(handler: (path: string) => void): Promise<() => void>;
  openDataset(request?: { path?: string; sheet?: string }): Promise<Dataset | null>;
  listSheets(path: string): Promise<string[]>;
  queryPage(request: PageRequest): Promise<Page>;
  getDistributions(request: { datasetId: string; columns: ColumnId[]; filters: Filter[] }): Promise<Distributions>;
  loadView(datasetId: string): Promise<ViewState | null>;
  saveView(datasetId: string, view: ViewState): Promise<void>;
  exportDataset(request: { datasetId: string; format: 'csv' | 'parquet'; path?: string; filters: Filter[]; sorting: SortRule[]; columns: ColumnId[] }): Promise<string | null>;
  listEnrichments(datasetId: string): Promise<EnrichmentDefinition[]>;
  saveEnrichment(datasetId: string, definition: EnrichmentDefinition): Promise<void>;
  deleteEnrichment(datasetId: string, enrichmentId: string): Promise<void>;
  saveProviderKey(provider: string, key: string): Promise<void>;
  hasProviderKey(provider: string): Promise<boolean>;
  removeProviderKey(provider: string): Promise<void>;
  planRun(request: RunRequest): Promise<RunPlan>;
  startRun(planId: string): Promise<RunStatus>;
  getRunStatus(runId: string): Promise<RunStatus>;
  pauseRun(runId: string): Promise<void>;
  resumeRun(runId: string): Promise<void>;
  cancelRun(runId: string): Promise<void>;
}
