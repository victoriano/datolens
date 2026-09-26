import { useRef, useState } from 'react';
import type { AnalysisSampling, Distributions } from '../../contracts/desktop-api';
import { useI18n } from '../../ui';
import { MAX_SAMPLE_ROWS } from './sampling';
import { Caret } from './Caret';
import './sampling.css';

export function SampleControl({ value, result, busy, totalRows, onChange }: {
  value: AnalysisSampling; result: Distributions | null; busy: boolean; totalRows: number;
  onChange: (value: AnalysisSampling) => void;
}) {
  const { language, locale } = useI18n();
  const en = language === 'en';
  const popover = useRef<HTMLDetailsElement>(null);
  const [custom, setCustom] = useState('');
  const number = (rows: number) => rows.toLocaleString(locale);
  const apply = (next: AnalysisSampling) => { onChange(next); if (popover.current) popover.current.open = false; };
  const label = value.mode === 'auto' ? (en ? 'Auto' : 'Auto') : value.mode === 'full' ? (en ? 'All rows' : 'Todas las filas') : number(value.rows);
  return <div className="dl-sampling">
    <details ref={popover} className="dl-sampling-popover">
      <summary aria-label={en ? 'Crossfilter sample size' : 'Tamaño de muestra de los filtros'}><span>{en ? 'Analysis' : 'Análisis'}</span><strong>{label}</strong><Caret /></summary>
      <div className="dl-sampling-menu">
        <strong>{en ? 'Rows used in crossfilters' : 'Filas para los crossfilters'}</strong>
        <p>{en ? 'A stable random sample speeds up the variable charts and statistics. Table rows, exports and joins use the full dataset.' : 'Una muestra aleatoria estable acelera los gráficos y estadísticas de variables. La tabla, las exportaciones y los joins usan todo el dataset.'}</p>
        <div className="dl-sampling-options">
          <button type="button" aria-pressed={value.mode === 'auto'} onClick={() => apply({ mode: 'auto' })}>{en ? 'Automatic' : 'Automático'}{result?.automaticRows !== undefined && <small>{number(Math.min(totalRows, result.automaticRows))}</small>}</button>
          {[10_000, 50_000, 100_000, 500_000, 1_000_000].filter(rows => rows < totalRows).map(rows => <button type="button" key={rows} aria-pressed={value.mode === 'rows' && value.rows === rows} onClick={() => apply({ mode: 'rows', rows })}>{number(rows)}</button>)}
          <button type="button" aria-pressed={value.mode === 'full'} onClick={() => apply({ mode: 'full' })}>{en ? 'All rows · exact' : 'Todas · exacto'}<small>{number(totalRows)}</small></button>
        </div>
        <form onSubmit={event => { event.preventDefault(); const rows = Number(custom); if (Number.isSafeInteger(rows) && rows >= 1 && rows <= MAX_SAMPLE_ROWS) apply({ mode: 'rows', rows }); }}>
          <label>{en ? 'Custom number of rows' : 'Número de filas personalizado'}<input type="number" min="1" max={MAX_SAMPLE_ROWS} step="1" value={custom} onChange={event => setCustom(event.target.value)} placeholder="25000" required /></label>
          <button type="submit">{en ? 'Apply' : 'Aplicar'}</button>
        </form>
        <p>{result?.deferredReason === 'remote_source' ? (en ? 'For a remote Parquet file, choosing a size or All rows starts the analysis and may read the entire remote file.' : 'En un Parquet remoto, elegir un tamaño o Todas inicia el análisis y puede leer el archivo remoto completo.') : (en ? 'Larger samples take more time and memory. Rare values may be absent from a sample; use All rows for exact analysis.' : 'Las muestras mayores requieren más tiempo y memoria. Una muestra puede omitir valores poco frecuentes; usa Todas para un análisis exacto.')}</p>
      </div>
    </details>
    <span className="dl-sampling-status" role="status" aria-busy={busy}>{result?.deferredReason === 'remote_source' ? (en ? 'Remote · analysis paused' : 'Remoto · análisis en pausa') : result ? result.sampled ? `${en ? 'Sample' : 'Muestra'} · ${number(result.analyzedRows)} / ${number(totalRows)}` : `${en ? 'Exact' : 'Exacto'} · ${number(result.analyzedRows)}` : busy ? (en ? 'Updating…' : 'Actualizando…') : (en ? 'Preparing…' : 'Preparando…')}</span>
    {result?.deferredReason === 'remote_source' && <small>{en ? 'Choose a sample size or All rows to calculate charts; this may read the full remote file.' : 'Elige un tamaño de muestra o Todas para calcular gráficos; puede leerse el archivo remoto completo.'}</small>}
    {result?.sampled && !result.deferredReason && <small>{en ? 'Chart counts refer to the sample.' : 'Los conteos de los gráficos corresponden a la muestra.'}{result.selectedCount === 0 && ` ${en ? 'No matches in the sample; check the table or increase the size.' : 'Sin coincidencias en la muestra; consulta la tabla o aumenta el tamaño.'}`}</small>}
  </div>;
}
