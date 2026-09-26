import type { Bin, VariableKind, ViewState } from '../../contracts/desktop-api';

export type CategoryColorOverrides = Record<string, string>;
export type CategoryColorMappings = Record<string, CategoryColorOverrides>;

/** Palette slots are assigned by background frequency when distribution bins are available. */
export const CATEGORICAL_PALETTE = [
  '#4477aa', '#ee6677', '#228833', '#ccbb44', '#66ccee', '#aa3377',
  '#bbbbbb', '#332288', '#ddcc77', '#117733', '#88ccee', '#882255',
  '#44aa99', '#999933', '#aa4499', '#dd8844', '#6699cc', '#bb5566',
  '#55aa66', '#aa7755', '#7766aa', '#cc6699', '#44aa77', '#bb9944',
] as const;

export const CATEGORY_PALETTES = [
  { id: 'classic', name: { es: 'Clásica', en: 'Classic' }, colors: CATEGORICAL_PALETTE },
  { id: 'tableau', name: { es: 'Tableau', en: 'Tableau' }, colors: [
    '#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948',
    '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac',
  ] },
  { id: 'pastel', name: { es: 'Pastel', en: 'Pastel' }, colors: [
    '#8dbbd7', '#edaaa7', '#a9d3a2', '#d4b6dc', '#efd18b', '#92d5cc',
    '#c8c0e8', '#eabfa2', '#b6d4e5', '#d5c5a5', '#a8cbbb', '#e6b6ca',
  ] },
  { id: 'vivid', name: { es: 'Viva', en: 'Vivid' }, colors: [
    '#e63946', '#1570ef', '#16a34a', '#f59e0b', '#9333ea', '#0891b2',
    '#f43f5e', '#65a30d', '#d946ef', '#ea580c', '#0d9488', '#4f46e5',
  ] },
  { id: 'earth', name: { es: 'Tierra', en: 'Earth' }, colors: [
    '#8c5a3c', '#5f7856', '#c18b43', '#597d84', '#a26865', '#86709b',
    '#a2a35e', '#6b6258', '#c17b58', '#799b85', '#8d7697', '#b9a070',
  ] },
] as const satisfies ReadonlyArray<{ id: string; name: { es: string; en: string }; colors: readonly string[] }>;

export type CategoryPaletteId = (typeof CATEGORY_PALETTES)[number]['id'];
export const DEFAULT_CATEGORY_PALETTE: CategoryPaletteId = 'classic';

export function normalizeCategoryPalette(id: unknown): CategoryPaletteId {
  return CATEGORY_PALETTES.find(palette => palette.id === id)?.id ?? DEFAULT_CATEGORY_PALETTE;
}

/** A saved variable palette takes precedence over the current app preference. */
export function effectiveCategoryPalette(variablePalette: string | undefined, defaultPalette: string): CategoryPaletteId {
  return normalizeCategoryPalette(variablePalette ?? defaultPalette);
}

/** Only an explicit choice is stored; undefined continues following Settings. */
export function setCategoryPaletteOverride(view: ViewState, columnId: string, palette: CategoryPaletteId | undefined): ViewState {
  const entries = Object.entries(view.categoryPalettes ?? {}).filter(([id]) => id !== columnId);
  if (palette !== undefined) entries.push([columnId, palette]);
  const categoryPalettes = Object.fromEntries(entries);
  return { ...view, categoryPalettes: entries.length ? categoryPalettes : undefined };
}

export function getCategoryPalette(id?: string): (typeof CATEGORY_PALETTES)[number] {
  return CATEGORY_PALETTES.find(palette => palette.id === id) ?? CATEGORY_PALETTES[0];
}

export function normalizeCategoryColor(input: string): string | null {
  if (typeof input !== 'string') return null;
  if (/^#[0-9a-f]{3}$/i.test(input)) {
    return `#${[...input.slice(1).toLowerCase()].map(digit => digit + digit).join('')}`;
  }
  return /^#[0-9a-f]{6}$/i.test(input) ? input.toLowerCase() : null;
}

/** FNV-1a over UTF-16 code units, then avalanche to distribute palette indices. */
function categoryHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

/** Rank raw category codes by their population count, independently of chart sorting and filters. */
export function categoryColorRanks(bins: readonly Bin[], missingValues: readonly string[] = []): ReadonlyMap<string, number> {
  const missing = new Set(missingValues);
  const counts = new Map<string, number>();
  for (const bin of bins) {
    if (bin.value == null || missing.has(bin.value)) continue;
    counts.set(bin.value, (counts.get(bin.value) ?? 0) + bin.background);
  }
  const ranked = [...counts].sort(([a, countA], [b, countB]) => countB - countA || (a < b ? -1 : a > b ? 1 : 0));
  return new Map(ranked.map(([value], index) => [value, index]));
}

export function getCategoryColor(value: string, overrides?: CategoryColorOverrides, paletteId?: string, ranks?: ReadonlyMap<string, number>): string {
  if (overrides && Object.hasOwn(overrides, value)) {
    const normalized = normalizeCategoryColor(overrides[value]);
    if (normalized) return normalized;
  }
  const palette = getCategoryPalette(paletteId).colors;
  const rank = ranks?.get(value);
  if (rank !== undefined) return palette[rank % palette.length];
  return palette[categoryHash(value) % palette.length];
}

export function isCategoricalKind(kind: VariableKind): boolean {
  return kind === 'categorical' || kind === 'boolean' || kind === 'multivalued';
}

/** Only own, valid entries for existing columns enter the persisted view. */
export function reconcileCategoryColors(input: unknown, validColumnIds: Set<string>): CategoryColorMappings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  return Object.fromEntries(Object.entries(input).flatMap(([columnId, colors]) => {
    if (!validColumnIds.has(columnId) || !colors || typeof colors !== 'object' || Array.isArray(colors)) return [];
    const entries = Object.entries(colors).flatMap(([value, color]) => {
      const normalized = normalizeCategoryColor(color as string);
      return normalized ? [[value, normalized]] : [];
    });
    return entries.length ? [[columnId, Object.fromEntries(entries)]] : [];
  }));
}

export function reconcileCategoryPalettes(input: unknown, validColumnIds: Set<string>): Record<string, CategoryPaletteId> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  return Object.fromEntries(Object.entries(input).filter(([id]) => validColumnIds.has(id)).map(([id, palette]) => [id, normalizeCategoryPalette(palette)]));
}

/** A null color removes the explicit choice and restores the stable palette color. */
export function setCategoryColor(view: ViewState, columnId: string, value: string, color: string | null): ViewState {
  const normalized = color === null ? null : normalizeCategoryColor(color);
  if (color !== null && !normalized) return view;
  const existing = view.categoryColors && Object.hasOwn(view.categoryColors, columnId)
    ? view.categoryColors[columnId] : undefined;
  if (normalized === null && (!existing || !Object.hasOwn(existing, value))) return view;
  const columnEntries = Object.entries(existing ?? {}).filter(([key]) => key !== value);
  if (normalized) columnEntries.push([value, normalized]);
  const columnColors = Object.fromEntries(columnEntries);
  const mappingEntries = Object.entries(view.categoryColors ?? {}).filter(([key]) => key !== columnId);
  if (columnEntries.length) mappingEntries.push([columnId, columnColors]);
  const categoryColors = Object.fromEntries(mappingEntries);
  return { ...view, categoryColors: Object.keys(categoryColors).length ? categoryColors : undefined };
}
