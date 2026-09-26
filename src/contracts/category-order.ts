import type { CategoryColorSuggestionRequest } from './category-colors';

export interface CategoryOrderProposal {
  datasetRevision: string;
  column: string;
  ordinal: boolean;
  /** Exact raw values, each once. Empty when no natural order is recognizable. */
  order: string[];
  explanation: string;
}
export interface CategoryOrderApi {
  suggestCategoryOrder?(request: CategoryColorSuggestionRequest): Promise<CategoryOrderProposal>;
}
