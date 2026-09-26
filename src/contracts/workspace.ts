import type { Dataset } from './desktop-api';
export interface WorkspaceSource { datasetId: string; alias: string }
export interface WorkspaceQueryRequest { name: string; sql: string; sources: WorkspaceSource[] }
export interface WorkspaceApi { suggestWorkspaceQuery?(request: WorkspaceQuerySuggestionRequest): Promise<WorkspaceQuerySuggestion>; createQueryDataset(request: WorkspaceQueryRequest): Promise<Dataset> }
export interface WorkspaceQuerySuggestionRequest { message: string; model: string; sources: WorkspaceSource[]; previousSql?: string; language: 'es' | 'en' }
export interface WorkspaceQuerySuggestion { name: string; sql: string; explanation: string }
