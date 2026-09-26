import type { Dataset, Filter, VariableKind, ViewSaveResult } from './desktop-api';
export type VariableRole = 'target' | 'actionable' | 'feature' | 'identifier';
export interface VariableMetadata { role?: VariableRole; group?: string; name?: string; originalName?: string; description?: string }
export interface VariableStatistics { count: number; missing: number; distinct: number; min: string | null; p25: string | null; median: string | null; mean: string | null; p75: string | null; max: string | null }
export interface CastRequest { datasetId: string; column: string; kind: VariableKind | null; expectedRevision?: string }
export interface CastPreview { datasetRevision: string; invalidCount: number; nonNullCount: number; physicalType: string }
export interface CastResult { dataset: Dataset; save: ViewSaveResult }
export interface AnalysisRequest { datasetId: string; columns: string[]; model: string; language: 'es' | 'en'; prompt?: string }
export interface AnalysisModel { id: string; provider: 'jev' | 'gemini' }
export interface Classification { datasetRevision: string; assignments: Array<{ column: string; role: VariableRole; group: string }>; explanation: string }
export interface FilterProposal { datasetRevision: string; filters: Filter[]; explanation: string }
export interface AnalysisApi {
  analysisModels?(provider: 'jev' | 'gemini'): Promise<AnalysisModel[]>;
  analysisPreviewCast?(request: CastRequest): Promise<CastPreview>;
  analysisCast?(request: CastRequest): Promise<CastResult>;
  analysisClassify?(request: AnalysisRequest): Promise<Classification>;
  analysisFilter?(request: AnalysisRequest): Promise<FilterProposal>;
}
