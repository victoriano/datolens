import { useEffect, useId, type ReactNode } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useI18n } from './i18n';
import { setUiPreferences, type Language, type Theme } from './preferences';
import { setNativeMenuLanguage } from './native-menu';
import '../styles/theme.css';

let nativeThemeQueue = Promise.resolve();
export function UiPreferencesProvider({ children }: { children: ReactNode }) {
  const { theme, language } = useI18n();
  useEffect(() => {
    if (isTauri()) void setNativeMenuLanguage(language).catch(error => console.error('Menu language:', error));
  }, [language]);
  useEffect(() => {
    if (!isTauri()) return;
    // Serial writes keep a quick sequence of switches in the same order as the UI.
    // Let macOS own the native appearance in System mode so its changes reach
    // the WebView's prefers-color-scheme listener instead of pinning it here.
    nativeThemeQueue = nativeThemeQueue.catch(() => {}).then(() => getCurrentWindow().setTheme(theme === 'system' ? null : theme)).catch(error => console.error('Window appearance:', error));
  }, [theme]);
  return children;
}

export function AppearanceControls() {
  const uid = useId();
  const { t, language, theme } = useI18n();
  return <div className="dl-appearance-controls" role="group" aria-label={t('Preferencias de interfaz')}>
    <label className="dl-preference-label" title={t('Idioma de la interfaz')}>
      <span className="dl-sr-only">{t('Idioma')}</span>
      <svg aria-hidden="true" width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.25"><circle cx="10" cy="10" r="7.25"/><ellipse cx="10" cy="10" rx="3" ry="7.25"/><path d="M3 10h14"/></svg>
      <select id={`${uid}-language`} aria-label={t('Idioma')} value={language} onChange={event => setUiPreferences({ language: event.target.value as Language })}>
        <option value="es" lang="es">Español</option><option value="en" lang="en">English</option>
      </select>
    </label>
    <label className="dl-preference-label" title={t('Apariencia de la interfaz')}>
      <span className="dl-sr-only">{t('Apariencia')}</span>
      <svg aria-hidden="true" width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.25"><circle cx="10" cy="10" r="7.25"/><path d="M10 2.75a7.25 7.25 0 0 1 0 14.5z" fill="currentColor" stroke="none"/></svg>
      <select id={`${uid}-theme`} aria-label={t('Apariencia')} value={theme} onChange={event => setUiPreferences({ theme: event.target.value as Theme })}>
        <option value="light">{t('Claro')}</option><option value="dark">{t('Oscuro')}</option><option value="system">{t('Sistema')}</option>
      </select>
    </label>
  </div>;
}
