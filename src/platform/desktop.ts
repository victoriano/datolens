import { invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { documentDir } from '@tauri-apps/api/path';
import { listen } from '@tauri-apps/api/event';
import { open, save } from '@tauri-apps/plugin-dialog';
import type { DesktopApi, DatasetOpenProgress, OpenFileBatch } from '../contracts/desktop-api';
import { t } from '../ui/i18n';
const call = <T,>(command: string, args?: Record<string, unknown>) => {
  if (!isTauri()) return Promise.reject(new Error(t('Abre Datolens.app para trabajar con archivos locales.')));
  return invoke<T>(command, args);
};
const selectDatasetPath = async (defaultPath?: string) => {
  const initialPath = defaultPath ?? await documentDir();
  const result = await open({defaultPath:initialPath, multiple:false, directory:false, filters:[{name:t('Tablas de datos'),extensions:['csv','xlsx','parquet','sav']}]});
  if (typeof result !== 'string') return null;
  await call<void>('remember_source_access', { path: result });
  return result;
};
export const desktopApi: DesktopApi = {
  suggestWorkspaceQuery: request => call('suggest_workspace_query', { request }),
  createQueryDataset: request => call('create_query_dataset', { request }),
  suggestColumn: request => call('suggest_column', { request }),
  previewDerivedColumn: request => call('preview_derived_column', { request }),
  createDerivedColumn: request => call('create_derived_column', { request }),
  openExternalUrl: url => call('open_external_url', { url }),
  queryPlot: request => call('query_plot', { request }),
  exportPlot: async request => {
    const name = request.name.replace(/[\\/:]/g, '-').slice(0,150) || 'Gráfico';
    const path = await save({defaultPath:`${name}.${request.format}`,filters:[{name:request.format.toUpperCase(),extensions:[request.format]}]});
    return path ? call('export_plot',{request:{...request,path}}) : null;
  },
  suggestEnrichment: request => call('suggest_enrichment', { request }),
  previewEnrichment: request => call('preview_enrichment', { request }),
  analysisPreviewCast: request => call('analysis_preview_cast', { request }),
  analysisCast: request => call('analysis_cast', { request }),
  analysisClassify: request => call('analysis_classify', { request }),
  analysisModels: provider => call('analysis_models', { provider }),
  analysisFilter: request => call('analysis_filter', { request }),
  suggestCategoryColors: request => call('suggest_category_colors', { request }),
  suggestCategoryOrder: request => call('suggest_category_order', { request }),
  selectDatasetPath,
  revealDatasetSource: datasetId => call('reveal_dataset_source',{datasetId}),
  getLastSource: () => call('get_last_source'),
  getDataset: datasetId => call('get_dataset',{datasetId}),
  datasetStorage: datasetId => call('dataset_storage',{datasetId}),
  listRuns: datasetId => call('list_runs',{datasetId}),
  getCells: (datasetId,cells) => call('get_cells',{datasetId,cells}),
  getCellHistory: (datasetId,cell) => call('get_cell_history',{datasetId,cell}),
  onFileDrop: async handler => getCurrentWebviewWindow().onDragDropEvent(event => {
    if(event.payload.type === 'drop' && event.payload.paths[0]) handler(event.payload.paths[0]);
  }),
  onOpenFiles: async handler => {
    const handled = new Set<number>();
    const deliver = (batch: OpenFileBatch) => {
      if (handled.has(batch.id)) return;
      handled.add(batch.id);
      handler(batch);
      void call<void>('acknowledge_opened_files', {ids:[batch.id]}).catch(() => {});
    };
    const unlisten = await listen<OpenFileBatch>('opened-files', event => deliver(event.payload));
    try {
      for (const batch of await call<OpenFileBatch[]>('take_opened_files')) deliver(batch);
    } catch (error) {
      unlisten();
      throw error;
    }
    return unlisten;
  },
  cliSetup: () => call('cli_setup'),
  importDatasetUrl: async (url, onProgress) => {
    const requestId = crypto.randomUUID();
    const unlisten = onProgress ? await listen<{requestId:string} & DatasetOpenProgress>('dataset-open-progress', event => {
      if (event.payload.requestId === requestId) onProgress(event.payload);
    }) : null;
    try { return await call('import_dataset_url', {url, requestId}); }
    finally { unlisten?.(); }
  },
  openDataset: async request => {
    const path = request?.path ?? await selectDatasetPath();
    if (!path) return null;
    const requestId = crypto.randomUUID();
    const unlisten = request?.onProgress ? await listen<{requestId:string} & DatasetOpenProgress>('dataset-open-progress', event => {
      if (event.payload.requestId === requestId) request.onProgress?.(event.payload);
    }) : null;
    try { return await call('open_dataset', {path, sheet: request?.sheet ?? null, requestId}); }
    finally { unlisten?.(); }
  },
  listSheets: path => call('list_sheets',{path}),
  queryPage: request => call('query_page',{request}),
  getDistributions: request => call('get_distributions',{request}),
  loadView: datasetId => call('load_view',{datasetId}),
  saveView: (datasetId,view) => call('save_view',{datasetId,view}),
  listSharedRevisions: datasetId => call('list_shared_revisions',{datasetId}),
  selectSharedRevision: (datasetId,revisionId) => call('select_shared_revision',{datasetId,revisionId}),
  exportDataset: async request => {
    const path = request.path ?? await save({defaultPath:`export.${request.format}`,filters:[{name:request.format.toUpperCase(),extensions:[request.format]}]});
    return path ? call('export_dataset',{request:{...request,path}}) : null;
  },
  listEnrichments: datasetId => call('list_enrichments',{datasetId}),
  saveEnrichment: (datasetId,definition) => call('save_enrichment',{datasetId,definition}),
  deleteEnrichment: (datasetId,enrichmentId) => call('delete_enrichment',{datasetId,enrichmentId}),
  saveProviderKey: (provider,key) => call('save_provider_key',{provider,key}),
  hasProviderKey: provider => call('has_provider_key',{provider}),
  checkProviderKeyAccess: provider => call('check_provider_key_access',{provider}),
  removeProviderKey: provider => call('remove_provider_key',{provider}),
  planRun: request => call('plan_run',{request}),
  startRun: planId => call('start_run',{planId}),
  getRunStatus: runId => call('get_run_status',{runId}),
  pauseRun: runId => call('pause_run',{runId}),
  resumeRun: runId => call('resume_run',{runId}),
  cancelRun: runId => call('cancel_run',{runId}),
};
