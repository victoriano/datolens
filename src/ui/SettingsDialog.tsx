import { useEffect, useRef, useState } from 'react';
import type { CliSetup, DesktopApi } from '../contracts/desktop-api';
import { useI18n } from './i18n';
import { CATEGORY_PALETTES } from '../features/explorer/category-colors';
import { setUiPreferences, type CategoryChartMode, type CategoryPaletteId, type Language, type Theme } from './preferences';
import './settings.css';

type Provider = 'gemini' | 'jev';
const providers: Provider[] = ['gemini', 'jev'];

export function SettingsDialog({ api, onClose }: { api: DesktopApi; onClose(): void }) {
  const { t, language, theme, colorCategoricalCells, categoryChartMode, showAnalyticalRole, defaultCategoryPalette } = useI18n();
  const tr = (es: string, en: string) => language === 'en' ? en : es;
  const dialog = useRef<HTMLDialogElement>(null);
  const [keys, setKeys] = useState<Record<Provider, boolean | null | 'unavailable'>>({ gemini: null, jev: null });
  const [drafts, setDrafts] = useState<Record<Provider, string>>({ gemini: '', jev: '' });
  const [busy, setBusy] = useState<Provider | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [cli, setCli] = useState<CliSetup | null>(null);
  const command = useRef<HTMLInputElement>(null);

  useEffect(() => {
    dialog.current?.showModal();
    let active = true;
    void Promise.all(providers.map(async provider => {
      try { const saved = await api.hasProviderKey(provider); if (active) setKeys(current => ({ ...current, [provider]: saved })); }
      catch (cause) { if (active) { setKeys(current => ({ ...current, [provider]: 'unavailable' })); setError(String(cause)); } }
    }));
    if (api.cliSetup) void api.cliSetup().then(setup => { if (active) setCli(setup); }).catch(cause => { if (active) setError(String(cause)); });
    return () => { active = false; };
  }, [api]);

  async function save(provider: Provider) {
    const key = drafts[provider].trim();
    if (!key) return;
    setBusy(provider); setError(''); setMessage('');
    try {
      await api.saveProviderKey(provider, key);
      setDrafts(current => ({ ...current, [provider]: '' }));
      setKeys(current => ({ ...current, [provider]: true }));
      setMessage(tr('Clave guardada en el Llavero de macOS.', 'Key saved in macOS Keychain.'));
      window.dispatchEvent(new Event('datolens:provider-keys-changed'));
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(null); }
  }

  async function remove(provider: Provider) {
    setBusy(provider); setError(''); setMessage('');
    try {
      await api.removeProviderKey(provider);
      setKeys(current => ({ ...current, [provider]: false }));
      setDrafts(current => ({ ...current, [provider]: '' }));
      setMessage(tr('Clave eliminada del Llavero.', 'Key removed from Keychain.'));
      window.dispatchEvent(new Event('datolens:provider-keys-changed'));
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(null); }
  }

  async function checkAccess(provider: Provider) {
    setBusy(provider); setError(''); setMessage('');
    try {
      await api.checkProviderKeyAccess(provider);
      setMessage(tr('Acceso preparado. Las llamadas y futuras aperturas reutilizarán la autorización.', 'Access ready. Model requests and future launches will reuse this authorization.'));
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(null); }
  }

  async function copyCliCommand() {
    if (!cli) return;
    setError(''); setMessage('');
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(cli.installCommand);
      else {
        command.current?.select();
        if (!document.execCommand('copy')) throw new Error(tr('No se pudo copiar el comando.', 'Could not copy the command.'));
      }
      setMessage(tr('Comando copiado. Pégalo una vez en Terminal.', 'Command copied. Paste it once in Terminal.'));
    } catch (cause) { setError(String(cause)); }
  }

  return <dialog ref={dialog} className="dl-settings-dialog" aria-labelledby="dl-settings-title" onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}>
    <header><h2 id="dl-settings-title">{tr('Ajustes', 'Settings')}</h2><button type="button" disabled={busy !== null} aria-label={tr('Cerrar ajustes', 'Close settings')} onClick={onClose}>×</button></header>
    <section><h3>{tr('General', 'General')}</h3>
      <label>{tr('Idioma', 'Language')}<select value={language} onChange={event => setUiPreferences({ language: event.target.value as Language })}><option value="es">Español</option><option value="en">English</option></select></label>
      <label>{tr('Apariencia', 'Appearance')}<select value={theme} onChange={event => setUiPreferences({ theme: event.target.value as Theme })}><option value="system">{tr('Sistema', 'System')}</option><option value="light">{tr('Claro', 'Light')}</option><option value="dark">{tr('Oscuro', 'Dark')}</option></select></label>
      <label>{tr('Gráficos de categorías', 'Category charts')}<select value={categoryChartMode} onChange={event => setUiPreferences({ categoryChartMode: event.target.value as CategoryChartMode })}><option value="compact">{tr('Pulso · compacto', 'Pulse · compact')}</option><option value="detailed">{tr('Detalle', 'Detail')}</option></select></label>
      <div className="dl-settings-palette"><span>{tr('Paleta categórica', 'Categorical palette')}<small>{tr('Se usa como paleta general; puedes cambiarla en cada variable.', 'Used by default; you can override it for each variable.')}</small></span><div role="group" aria-label={tr('Paleta categórica', 'Categorical palette')}>{CATEGORY_PALETTES.map(palette => <button key={palette.id} type="button" aria-pressed={defaultCategoryPalette === palette.id} onClick={() => setUiPreferences({ defaultCategoryPalette: palette.id as CategoryPaletteId })}><span className="dl-settings-palette-swatches" aria-hidden="true">{palette.colors.slice(0, 8).map(color => <i key={color} style={{ backgroundColor: color }} />)}</span><span>{palette.name[language]}</span></button>)}</div></div>
      <label className="dl-settings-checkbox"><span><span>{tr('Colorear categorías en la tabla', 'Color categorical cells')}</span><small>{tr('Usa los colores de las gráficas categóricas.', 'Uses the colors from categorical charts.')}</small></span><input type="checkbox" checked={colorCategoricalCells} onChange={event => setUiPreferences({ colorCategoricalCells: event.target.checked })}/></label>
      <label className="dl-settings-checkbox"><span><span>{tr('Mostrar función analítica', 'Show analytical role')}</span><small>{tr('Muestra el icono de función en la barra de cada variable.', 'Shows the role icon in each variable toolbar.')}</small></span><input type="checkbox" checked={showAnalyticalRole} onChange={event => setUiPreferences({ showAnalyticalRole: event.target.checked })}/></label>
    </section>
    <section><h3>{tr('Terminal', 'Terminal')}</h3><p>{tr('Abre cualquiera de los formatos compatibles con «datolens archivo.csv». La activación crea un enlace en ~/.local/bin; la app y los datos siguen dentro de su sandbox.', 'Open any supported format with “datolens file.csv”. Activation creates a link in ~/.local/bin; the app and data remain inside their sandbox.')}</p>
      {!cli ? <p>{tr('Comprobando herramienta…', 'Checking tool…')}</p> : !cli.available ? <p className="dl-settings-error">{tr('Esta instalación no incluye la herramienta de Terminal.', 'This installation does not include the Terminal tool.')}</p> : <div className="dl-settings-cli"><div><strong>{cli.installed ? tr('Comando activado', 'Command activated') : tr('Activar comando', 'Activate command')}</strong><span>{cli.targetPath}</span></div><div><input ref={command} readOnly value={cli.installCommand} aria-label={tr('Comando de instalación de Datolens', 'Datolens installation command')}/><button type="button" onClick={() => void copyCliCommand()}>{tr('Copiar comando', 'Copy command')}</button></div>{!cli.pathConfigured && <small>{tr('Si tu Terminal no encuentra el comando, añade ~/.local/bin al PATH de tu shell.', 'If Terminal cannot find the command, add ~/.local/bin to your shell PATH.')}</small>}</div>}
    </section>
    <section><h3>{tr('Proveedores de IA', 'AI providers')}</h3><p>{tr('Las claves siguen cifradas en el Llavero. Las claves antiguas necesitan autorizar el acceso una vez; después se reutiliza al cambiar de modelo, reiniciar o actualizar Datolens.', 'Keys remain encrypted in Keychain. Existing keys need access authorized once; it is then reused when switching models, restarting or updating Datolens.')}</p>
      {providers.map(provider => <form key={provider} onSubmit={event => { event.preventDefault(); void save(provider); }}><div className="dl-settings-provider"><strong>{provider === 'jev' ? 'Jev · TypeSafe' : 'Gemini'}</strong><span>{keys[provider] === null ? tr('Comprobando…', 'Checking…') : keys[provider] === 'unavailable' ? tr('No disponible', 'Unavailable') : keys[provider] ? tr('Configurado', 'Configured') : tr('Sin clave', 'No key')}</span></div><div className="dl-settings-key"><input type="password" autoComplete="off" aria-label={`${provider === 'jev' ? 'Jev' : 'Gemini'} API key`} placeholder={keys[provider] === true ? '************' : tr('Nueva API key', 'New API key')} value={drafts[provider]} disabled={busy !== null || keys[provider] === 'unavailable'} onChange={event => setDrafts(current => ({ ...current, [provider]: event.target.value }))}/><button type="submit" disabled={busy !== null || keys[provider] === 'unavailable' || !drafts[provider].trim()}>{tr('Guardar', 'Save')}</button>{keys[provider] === true && <button type="button" disabled={busy !== null} onClick={() => void remove(provider)}>{tr('Eliminar', 'Remove')}</button>}</div>{keys[provider] === true && <button className="dl-settings-check" type="button" disabled={busy !== null} onClick={() => void checkAccess(provider)}>{tr('Autorizar acceso', 'Authorize access')}</button>}</form>)}
      {message && <p className="dl-settings-success" role="status">{message}</p>}{error && <p className="dl-settings-error" role="alert">{t(error)}</p>}
    </section>
    <footer><button type="button" disabled={busy !== null} onClick={onClose}>{tr('Cerrar', 'Close')}</button></footer>
  </dialog>;
}
