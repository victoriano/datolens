/** Only the explicitly requested category names are sent to Gemini. */
export interface CategoryColorSuggestionRequest {
  datasetId: string;
  column: string;
  values: string[];
  model: string;
  language: 'es' | 'en';
  context?: string;
}
export interface CategoryColorProposal {
  datasetRevision: string;
  column: string;
  assignments: Array<{ value: string; color: string | null; reason: string }>;
  explanation: string;
}
export interface CategoryColorApi {
  suggestCategoryColors?(request: CategoryColorSuggestionRequest): Promise<CategoryColorProposal>;
}
