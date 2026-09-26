import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Dataset, DatasetOpenProgress, DesktopApi } from '../../contracts/desktop-api';
import { useI18n } from '../../ui';

interface Props {
  api: DesktopApi;
  onClose(): void;
  onResult(dataset: Dataset): void | Promise<void>;
}

export function RemoteDatasetDialog({ api, onClose, onResult }: Props) {
  const { language, locale } = useI18n();
  const tr = (es: string, en: string) => language === 'en' ? en : es;
  const dialog = useRef<HTMLDialogElement>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<DatasetOpenProgress | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !api.importDatasetUrl) return;
    let normalized: string;
    try {
      const parsed = new URL(url.trim());
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
      normalized = parsed.href;
    } catch {
      setError(tr('Introduce una URL HTTP o HTTPS válida.', 'Enter a valid HTTP or HTTPS URL.'));
      return;
    }
    setBusy(true); setError(''); setProgress(null);
    try {
      const dataset = await api.importDatasetUrl(normalized, setProgress);
      if (!dataset) throw new Error(tr('No se pudo abrir el dataset remoto.', 'Could not open the remote dataset.'));
      await onResult(dataset);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  }

  const received = progress?.receivedBytes;
  const total = progress?.totalBytes;
  const phase = progress?.phase === 'download'
    ? tr('Descargando archivo…', 'Downloading file…')
    : progress?.phase === 'inspect' ? tr('Comprobando origen…', 'Checking source…')
    : progress?.phase === 'import' ? tr('Importando datos…', 'Importing data…')
    : progress?.phase === 'prepare' ? tr('Preparando dataset…', 'Preparing dataset…')
    : progress?.phase === 'restore' ? tr('Restaurando vista…', 'Restoring view…')
    : progress?.phase === 'ready' ? tr('Abriendo pestaña…', 'Opening tab…')
    : tr('Conectando…', 'Connecting…');
  return <dialog ref={dialog} className="dl-remote-dialog" onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}>
    <form onSubmit={event => void submit(event)}>
      <header><div><h2>{tr('Cargar dataset desde URL', 'Load dataset from URL')}</h2><p>{tr('Pega un enlace directo a un archivo CSV, XLSX, Parquet o SAV.', 'Paste a direct link to a CSV, XLSX, Parquet or SAV file.')}</p></div><button type="button" disabled={busy} aria-label={tr('Cerrar', 'Close')} onClick={onClose}>×</button></header>
      <div className="dl-remote-body">
        <label>{tr('URL del archivo', 'File URL')}<input type="url" autoFocus required value={url} disabled={busy} placeholder="https://example.org/data.parquet" onChange={event => setUrl(event.target.value)} /></label>
        <p>{tr('El archivo se abrirá automáticamente como una nueva pestaña. Parquet usa lectura por rangos cuando el servidor lo permite; si no, se descarga el archivo completo (máximo 8 GiB).', 'The file opens automatically as a new tab. Parquet uses range reads when the server allows them; otherwise the full file is downloaded (8 GiB maximum).')}</p>
        {busy && <div className="dl-remote-progress" role="status" aria-live="polite"><strong>{phase}</strong><progress value={total && received !== undefined ? received : undefined} max={total || undefined}/>{total && received !== undefined && <small>{(received / 1024 ** 2).toLocaleString(locale, { maximumFractionDigits: 1 })} / {(total / 1024 ** 2).toLocaleString(locale, { maximumFractionDigits: 1 })} MB</small>}</div>}
        {error && <p className="dl-remote-error" role="alert">{error}</p>}
      </div>
      <footer><button type="button" disabled={busy} onClick={onClose}>{tr('Cancelar', 'Cancel')}</button><button type="submit" className="dl-remote-run" disabled={busy || !url.trim() || !api.importDatasetUrl}>{tr('Cargar dataset', 'Load dataset')}</button></footer>
    </form>
  </dialog>;
}
