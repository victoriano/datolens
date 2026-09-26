export type Language = 'es' | 'en';
export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = Exclude<Theme, 'system'>;
export type CategoryChartMode = 'compact' | 'detailed';
export type CategoryPaletteId = 'classic' | 'tableau' | 'pastel' | 'vivid' | 'earth';
export interface UiPreferences { language: Language; theme: Theme; colorCategoricalCells: boolean; categoryChartMode: CategoryChartMode; showAnalyticalRole: boolean; defaultCategoryPalette: CategoryPaletteId }
export type ProjectPresentation = Pick<UiPreferences, 'colorCategoricalCells' | 'categoryChartMode' | 'showAnalyticalRole' | 'defaultCategoryPalette'>;
export interface UiSnapshot extends UiPreferences { locale: string; resolvedTheme: ResolvedTheme }
export const PREFERENCES_KEY = 'datolens.ui.v1';

export function readPreferences(raw: string | null, languages: readonly string[] = ['es']): UiPreferences {
  let value: Partial<UiPreferences> = {};
  try { const parsed: unknown = JSON.parse(raw ?? 'null'); if (parsed && typeof parsed === 'object') value = parsed; } catch { /* Older or unavailable storage uses defaults. */ }
  const preferred = languages.map(language => language.split('-')[0].toLowerCase()).find(language => language === 'es' || language === 'en');
  return {
    language: value.language === 'es' || value.language === 'en' ? value.language : preferred === 'en' ? 'en' : 'es',
    theme: value.theme === 'light' || value.theme === 'dark' || value.theme === 'system' ? value.theme : 'system',
    colorCategoricalCells: value.colorCategoricalCells === true,
    categoryChartMode: value.categoryChartMode === 'detailed' ? 'detailed' : 'compact',
    showAnalyticalRole: value.showAnalyticalRole === true,
    defaultCategoryPalette: value.defaultCategoryPalette === 'tableau' || value.defaultCategoryPalette === 'pastel' || value.defaultCategoryPalette === 'vivid' || value.defaultCategoryPalette === 'earth' ? value.defaultCategoryPalette : 'classic',
  };
}

export function resolvePreferences(preferences: UiPreferences, systemDark: boolean): UiSnapshot {
  return { ...preferences, locale: preferences.language === 'es' ? 'es-ES' : 'en-US', resolvedTheme: preferences.theme === 'system' ? systemDark ? 'dark' : 'light' : preferences.theme };
}

function storedPreferences(): UiPreferences {
  let raw: string | null = null;
  try { raw = globalThis.localStorage?.getItem(PREFERENCES_KEY) ?? null; } catch { /* Preferences remain usable in memory. */ }
  return readPreferences(raw, typeof navigator === 'undefined' ? ['es'] : navigator.languages);
}
const media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
let snapshot = resolvePreferences(storedPreferences(), media?.matches ?? false);
const listeners = new Set<() => void>();
export const getUiSnapshot = () => snapshot;
export function projectPresentation(preferences: ProjectPresentation): ProjectPresentation {
  return { colorCategoricalCells: preferences.colorCategoricalCells, categoryChartMode: preferences.categoryChartMode, showAnalyticalRole: preferences.showAnalyticalRole, defaultCategoryPalette: preferences.defaultCategoryPalette };
}
export function readProjectPresentation(raw: unknown, fallback: ProjectPresentation): ProjectPresentation {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return projectPresentation(fallback);
  const value = raw as Partial<ProjectPresentation>;
  return {
    colorCategoricalCells: typeof value.colorCategoricalCells === 'boolean' ? value.colorCategoricalCells : fallback.colorCategoricalCells,
    categoryChartMode: value.categoryChartMode === 'compact' || value.categoryChartMode === 'detailed' ? value.categoryChartMode : fallback.categoryChartMode,
    showAnalyticalRole: typeof value.showAnalyticalRole === 'boolean' ? value.showAnalyticalRole : fallback.showAnalyticalRole,
    defaultCategoryPalette: value.defaultCategoryPalette === 'classic' || value.defaultCategoryPalette === 'tableau' || value.defaultCategoryPalette === 'pastel' || value.defaultCategoryPalette === 'vivid' || value.defaultCategoryPalette === 'earth' ? value.defaultCategoryPalette : fallback.defaultCategoryPalette,
  };
}

function publish(preferences: UiPreferences) {
  const next = resolvePreferences(preferences, media?.matches ?? false);
  if (next.language === snapshot.language && next.theme === snapshot.theme && next.colorCategoricalCells === snapshot.colorCategoricalCells && next.categoryChartMode === snapshot.categoryChartMode && next.showAnalyticalRole === snapshot.showAnalyticalRole && next.defaultCategoryPalette === snapshot.defaultCategoryPalette && next.resolvedTheme === snapshot.resolvedTheme) return;
  snapshot = next;
  applyDocumentPreferences();
  listeners.forEach(listener => listener());
}
export function setUiPreferences(update: Partial<UiPreferences>) {
  const next = readPreferences(JSON.stringify({ ...snapshot, ...update }));
  try { globalThis.localStorage?.setItem(PREFERENCES_KEY, JSON.stringify(next)); } catch { /* No storage permission is required to switch the UI. */ }
  publish(next);
}
function systemChanged() { publish(snapshot); }
function storageChanged(event: StorageEvent) {
  if (event.key === PREFERENCES_KEY || event.key === null) publish(storedPreferences());
}
export function subscribeUi(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    media?.addEventListener('change', systemChanged);
    if (typeof window !== 'undefined') window.addEventListener('storage', storageChanged);
    systemChanged();
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      media?.removeEventListener('change', systemChanged);
      if (typeof window !== 'undefined') window.removeEventListener('storage', storageChanged);
    }
  };
}
export function applyDocumentPreferences() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = snapshot.language;
  document.documentElement.dataset.theme = snapshot.resolvedTheme;
  document.documentElement.style.colorScheme = snapshot.resolvedTheme;
}
// Runs before React's first paint, including standalone feature previews.
applyDocumentPreferences();
