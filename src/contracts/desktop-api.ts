import type { CategoryColorApi } from './category-colors';
import type { CategoryOrderApi } from './category-order';
import type { WorkspaceApi } from './workspace';
/** Initial integration contract. Coordinator owns changes to this file. */
import type { AnalysisApi, VariableMetadata, VariableRole, VariableStatistics } from './analysis';
import type { DerivedColumnsApi } from './derived-columns';
import type { PlotApi, PlotWorkspace } from '../features/plots/types';
export type Scalar = string | number | boolean | null;
export type CellValue = Scalar | CellValue[] | { [key: string]: CellValue };
export type RowId = string;
export type ColumnId = string;
export type VariableKind = 'numeric' | 'date' | 'boolean' | 'categorical' | 'multivalued' | 'text';
export interface Column { id: ColumnId; name: string; dataType: string; kind: VariableKind; spss?: { label?: string | null; valueLabels: Record<string,string>; missingValues: string[]; categorical: boolean } }
export interface Dataset { id: string; name: string; sourcePath: string; sheet?: string; columns: Column[]; rowCount: number | null; revision: string; typeOverrides?: Record<ColumnId, VariableKind> }
export interface DatasetOpenProgress { phase: 'selected' | 'inspect' | 'download' | 'import' | 'prepare' | 'restore' | 'ready'; sourceBytes?: number | null; receivedBytes?: number; totalBytes?: number | null }
export interface DatasetStorage { sourceBytes: number; cacheBytes: number }
export interface OpenFileBatch { id: number; paths: string[]; errors: string[] }
export interface CliSetup { available: boolean; bundledPath: string; installCommand: string; targetPath: string; pathConfigured: boolean; installed: boolean }
export interface Row { id: RowId; values: Record<ColumnId, CellValue> }
export type Filter =
  | { column: ColumnId; kind: 'numeric'; min?: number; max?: number }
  | { column: ColumnId; kind: 'date'; start?: string; end?: string }
  | { column: ColumnId; kind: 'categorical' | 'multivalued'; selected: string[]; listEncoded?: boolean }
  | { column: ColumnId; kind: 'text'; terms: string[]; mode: 'any' | 'all'; caseSensitive: boolean };
export interface SortRule { id: ColumnId; desc: boolean }
export type AnalysisSampling = { mode: 'auto' } | { mode: 'full' } | { mode: 'rows'; rows: number };
export interface ViewState {
  formatVersion: 1;
  presentation?: import('../ui/preferences').ProjectPresentation;
  /** Explicit colors keyed by stable column ID and raw category value. */
  categoryColors?: Record<ColumnId, Record<string, string>>;
  categoryPalettes?: Record<ColumnId, string>;
  categoryOrders?: Record<ColumnId, string[]>;
  analysisSampling?: AnalysisSampling;
  columns: { order: ColumnId[]; hidden: ColumnId[]; widths: Record<ColumnId, number> };
  sorting: SortRule[];
  filters: Filter[];
  workspace?: { mode: 'table' | 'variables' | 'plots'; variablesVisible: boolean; enrichmentsVisible: boolean; pageOffset: number };
  plots?: PlotWorkspace;
  variablePanel: { search?: string; expanded?: ColumnId[]; order: ColumnId[]; pinned: ColumnId[]; hidden: ColumnId[]; relative: boolean; sortModeByColumn: Record<ColumnId, 'everything' | 'selection' | 'uplift' | 'tfidf' | 'manual'>; statistics?: ColumnId[]; metadata?: Record<ColumnId, VariableMetadata>; roleFilter?: 'all' | VariableRole; groupFilter?: string; collapsedGroups?: string[] };
}
export interface ViewSaveResult { path: string; besideSource: boolean; warning?: string }
export interface SharedRevision { id:string; savedAtMs:number; active:boolean; head:boolean }
export interface PageRequest { datasetId: string; columns: ColumnId[]; filters: Filter[]; sorting: SortRule[]; offset: number; limit: number }
export interface Page { rows: Row[]; filteredCount: number | null; datasetRevision: string }
export interface Bin { value?: string | null; left?: number; right?: number; background: number; foreground: number; rBackground: number; rForeground: number }
export interface Distribution { column: ColumnId; kind: VariableKind; bins: Bin[]; truncated?: boolean; statistics?: VariableStatistics }
/** Bin counts and selectedCount refer to analyzedRows; totalRows is the full dataset. */
export interface Distributions { variables: Distribution[]; selectedCount: number; totalRows: number; analyzedRows: number; sampled: boolean; automaticRows?: number; deferredReason?: 'remote_source' }
export interface EnrichmentDefinition {
  id: string; name: string; provider: string; model: string; prompt: string;
  inputColumns: ColumnId[]; outputColumn: ColumnId; outputKind: VariableKind;
  dependsOn: string[]; revision: number; options?: EnrichmentOptions;
}
export interface EnrichmentOptions { webSearch?: boolean; questionType?: 'choice' | 'score' | 'noul' | null; choices?: Record<string,string>; levels?: string[]; threshold?: number | null }
export interface ProviderEvidence { value:CellValue; provider:string; model:string; confidence?:number|null; probability?:number|null; sources:Array<{title:string;url:string}>; searchSuggestions?:string|null }
export interface EnrichmentPreview { definitionFingerprint:string; datasetRevision:string; calls:number; rows:Array<{rowId:string;inputs:Record<string,CellValue>;value:CellValue|null;error:string|null;evidence:ProviderEvidence|null}> }
export type SelectionScope =
  | { kind: 'cells'; cells: Array<{ rowId: RowId; columnId: ColumnId }> }
  | { kind: 'rows'; rowIds: RowId[]; enrichmentIds: string[] }
  | { kind: 'filtered'; filters: Filter[]; enrichmentIds: string[] }
  | { kind: 'all'; enrichmentIds: string[] };
export interface RunRequest { datasetId: string; scope: SelectionScope; mode: 'pending' | 'regenerate'; includePrerequisites: boolean; includeDependents: boolean; concurrency?: number; maxCalls?: number }
export interface RunPlan { id: string; datasetRevision: string; cellCount: number; estimatedCalls: number; missingInputs: string[] }
export interface RunStatus { id: string; state: 'queued' | 'running' | 'paused' | 'completed' | 'cancelled' | 'failed'; succeeded: number; failed: number; pending: number; error?: string }
export interface CellKey { rowId: string; enrichmentId: string }
export interface EnrichmentCell { key: CellKey; state: 'pending' | 'running' | 'succeeded' | 'failed' | 'stale' | 'blocked' | 'cancelled'; generation: number; definitionRevision: number; fingerprint: string; value: CellValue | null; error: string | null; attempts: number; applied: boolean; evidence?: ProviderEvidence | null }
export interface DesktopApi extends Partial<WorkspaceApi>, AnalysisApi, CategoryColorApi, CategoryOrderApi, Partial<PlotApi>, Partial<DerivedColumnsApi> {
  openExternalUrl?(url:string):Promise<void>;
  suggestEnrichment?(request:{datasetId:string;message:string;language:'es'|'en';previous?:EnrichmentDefinition}):Promise<{definition:EnrichmentDefinition;explanation:string}>;
  previewEnrichment?(request:{datasetId:string;definition:EnrichmentDefinition;rowIds?:string[];filters?:Filter[]}):Promise<EnrichmentPreview>;
  getLastSource?(): Promise<{ path: string; sheet?: string } | null>;
  getDataset?(datasetId: string): Promise<Dataset>;
  listRuns(datasetId: string): Promise<RunStatus[]>;
  getCells(datasetId: string, cells: CellKey[]): Promise<EnrichmentCell[]>;
  getCellHistory(datasetId: string, cell: CellKey): Promise<EnrichmentCell[]>;
  selectDatasetPath?(defaultPath?: string): Promise<string | null>;
  revealDatasetSource?(datasetId: string): Promise<void>;
  onFileDrop?(handler: (path: string) => void): Promise<() => void>;
  onOpenFiles?(handler: (batch: OpenFileBatch) => void): Promise<() => void>;
  cliSetup?(): Promise<CliSetup>;
  openDataset(request?: { path?: string; sheet?: string; onProgress?: (progress: DatasetOpenProgress) => void }): Promise<Dataset | null>;
  importDatasetUrl?(url: string, onProgress?: (progress: DatasetOpenProgress) => void): Promise<Dataset | null>;
  datasetStorage?(datasetId: string): Promise<DatasetStorage>;
  listSheets(path: string): Promise<string[]>;
  queryPage(request: PageRequest): Promise<Page>;
  getDistributions(request: { datasetId: string; columns: ColumnId[]; filters: Filter[]; sampling?: AnalysisSampling; statistics?: ColumnId[] }): Promise<Distributions>;
  loadView(datasetId: string): Promise<ViewState | null>;
  saveView(datasetId: string, view: ViewState): Promise<ViewSaveResult | void>;
  listSharedRevisions?(datasetId: string): Promise<SharedRevision[]>;
  selectSharedRevision?(datasetId: string, revisionId: string): Promise<Dataset>;
  exportDataset(request: { datasetId: string; format: 'csv' | 'parquet'; path?: string; filters: Filter[]; sorting: SortRule[]; columns: ColumnId[] }): Promise<string | null>;
  listEnrichments(datasetId: string): Promise<EnrichmentDefinition[]>;
  saveEnrichment(datasetId: string, definition: EnrichmentDefinition): Promise<void>;
  deleteEnrichment(datasetId: string, enrichmentId: string): Promise<void>;
  saveProviderKey(provider: string, key: string): Promise<void>;
  hasProviderKey(provider: string): Promise<boolean>;
  checkProviderKeyAccess(provider: string): Promise<void>;
  removeProviderKey(provider: string): Promise<void>;
  planRun(request: RunRequest): Promise<RunPlan>;
  startRun(planId: string): Promise<RunStatus>;
  getRunStatus(runId: string): Promise<RunStatus>;
  pauseRun(runId: string): Promise<void>;
  resumeRun(runId: string): Promise<void>;
  cancelRun(runId: string): Promise<void>;
}
