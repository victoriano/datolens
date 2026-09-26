/**
 * Sort modes for categorical / multivalued / text-keyword bars, mirroring
 * Graphext's per-variable sort menu:
 *
 * - everything: frequency in the whole dataset (background), the default.
 * - selection:  frequency within the current selection (foreground).
 * - uplift:     difference in relative frequency (selection − background).
 * - tfidf:      term frequency (in selection) × inverse document frequency
 *               across the dataset, surfacing distinctive terms.
 *
 * These reorder the already-fetched top-N bins client-side; the candidate pool
 * is still the top values by background count, so a term that is rare overall
 * but common in the selection can fall outside the fetched set.
 */
import type { Bin } from '../../contracts/desktop-api';
type CategoryBin = Bin & { value: string | null };

export type CategorySortMode = 'everything' | 'selection' | 'uplift' | 'tfidf' | 'manual';

export const CATEGORY_SORT_MODES: {
  value: CategorySortMode;
  label: string;
  description: string;
}[] = [
  { value: 'everything', label: 'By everything', description: 'Frequency in the whole dataset' },
  { value: 'selection', label: 'By selection', description: 'Frequency just in the selection' },
  {
    value: 'uplift',
    label: 'By uplift',
    description: 'Difference in frequency between the selection and the whole dataset',
  },
  { value: 'tfidf', label: 'By tf-idf', description: 'Term frequency times inverse document frequency' },
];

interface SortOptions {
  /** Analyzed row count, used as the document total for idf. */
  analyzedRows: number;
  order?: string[];
}

function score(bin: CategoryBin, mode: CategorySortMode, analyzedRows: number): number {
  switch (mode) {
    case 'selection':
      return bin.foreground;
    case 'uplift':
      return bin.rForeground - bin.rBackground;
    case 'tfidf': {
      // idf = ln(N / df); df is the background document count for the term.
      // +1 smoothing keeps common terms from collapsing to zero / undefined.
      const idf = Math.log((analyzedRows + 1) / (bin.background + 1)) + 1;
      return bin.rForeground * idf;
    }
    case 'everything':
    default:
      return bin.background;
  }
}

/**
 * Return a new array of bins ordered by the chosen mode. The null bucket is
 * always pinned to the end regardless of mode.
 */
export function sortCategoryBins(
  bins: CategoryBin[],
  mode: CategorySortMode,
  { analyzedRows, order }: SortOptions,
): CategoryBin[] {
  const nulls = bins.filter((bin) => bin.value === null);
  const values = bins.filter((bin) => bin.value !== null);
  const ranks = new Map(order?.map((value, index) => [value, index]));
  values.sort((a, b) => {
    if (mode === 'manual') {
      const rankA = ranks.get(a.value!) ?? Number.MAX_SAFE_INTEGER;
      const rankB = ranks.get(b.value!) ?? Number.MAX_SAFE_INTEGER;
      if (rankA !== rankB) return rankA - rankB;
    }
    const diff = score(b, mode, analyzedRows) - score(a, mode, analyzedRows);
    // Stable tie-break on background so equal scores keep a deterministic order.
    return diff !== 0 ? diff : b.background - a.background;
  });
  return [...values, ...nulls];
}
