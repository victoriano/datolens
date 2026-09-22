import { invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { open, save } from '@tauri-apps/plugin-dialog';
import type { DesktopApi } from '../contracts/desktop-api';
const call = <T,>(command: string, args?: Record<string, unknown>) => {
  if (!isTauri()) return Promise.reject(new Error('Abre Datolens.app para trabajar con archivos locales.'));
  return invoke<T>(command, args);
};
const selectDatasetPath = async () => {
  const result = await open({multiple:false, directory:false, filters:[{name:'Tablas de datos',extensions:['csv','xlsx','parquet']}]});
  return typeof result === 'string' ? result : null;
};
export const desktopApi: DesktopApi = {
  selectDatasetPath,
  getLastSource: () => call('get_last_source'),
  getDataset: datasetId => call('get_dataset',{datasetId}),
  listRuns: datasetId => call('list_runs',{datasetId}),
  getCells: (datasetId,cells) => call('get_cells',{datasetId,cells}),
  getCellHistory: (datasetId,cell) => call('get_cell_history',{datasetId,cell}),
  onFileDrop: async handler => getCurrentWebviewWindow().onDragDropEvent(event => {
    if(event.payload.type === 'drop' && event.payload.paths[0]) handler(event.payload.paths[0]);
  }),
  openDataset: async request => {
    const path = request?.path ?? await selectDatasetPath();
    return path ? call('open_dataset', {path, sheet: request?.sheet ?? null}) : null;
  },
  listSheets: path => call('list_sheets',{path}),
  queryPage: request => call('query_page',{request}),
  getDistributions: request => call('get_distributions',{request}),
  loadView: datasetId => call('load_view',{datasetId}),
  saveView: (datasetId,view) => call('save_view',{datasetId,view}),
  exportDataset: async request => {
    const path = request.path ?? await save({defaultPath:`export.${request.format}`,filters:[{name:request.format.toUpperCase(),extensions:[request.format]}]});
    return path ? call('export_dataset',{request:{...request,path}}) : null;
  },
  listEnrichments: datasetId => call('list_enrichments',{datasetId}),
  saveEnrichment: (datasetId,definition) => call('save_enrichment',{datasetId,definition}),
  deleteEnrichment: (datasetId,enrichmentId) => call('delete_enrichment',{datasetId,enrichmentId}),
  saveProviderKey: (provider,key) => call('save_provider_key',{provider,key}),
  hasProviderKey: provider => call('has_provider_key',{provider}),
  removeProviderKey: provider => call('remove_provider_key',{provider}),
  planRun: request => call('plan_run',{request}),
  startRun: planId => call('start_run',{planId}),
  getRunStatus: runId => call('get_run_status',{runId}),
  pauseRun: runId => call('pause_run',{runId}),
  resumeRun: runId => call('resume_run',{runId}),
  cancelRun: runId => call('cancel_run',{runId}),
};
