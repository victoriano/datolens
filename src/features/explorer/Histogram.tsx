import { useI18n } from '../../ui';
import { localizeChart } from '../../ui/chart';
/** Brushing bar chart. The Vega signal graph is kept self-contained. */
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { View } from 'vega';
import type { Bin } from '../../contracts/desktop-api';
import { buildBrushingSpec } from './brushing-spec';
import { createHistogramUpdater } from './histogram-data';
interface Props { bins: Bin[]; range: [number, number] | null; bounds: [number | undefined, number | undefined]; label: string; isDate: boolean; relative: boolean; hasSelection: boolean; onChange: (range: [number, number] | null) => void; onChangeBound: (edge: 0 | 1, value: number) => void }
export const Histogram = memo(function Histogram(props: Props) {
  const { t, locale, language, resolvedTheme } = useI18n();
  const container = useRef<HTMLDivElement>(null);
  const view = useRef<View | null>(null);
  const latest = useRef(props); latest.current = props;
  const apply = useRef<(() => void) | null>(null);
  const syncing = useRef(false);
  const [error, setError] = useState('');
  const [plotWidth, setPlotWidth] = useState(272);
  const [editing, setEditing] = useState<0 | 1 | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editError, setEditError] = useState('');
  const editInput = useRef<HTMLInputElement>(null);
  const domain = useMemo(() => props.bins.reduce<[number, number]>((bounds, bin) => [Math.min(bounds[0], bin.left ?? Infinity), Math.max(bounds[1], bin.right ?? -Infinity)], [Infinity, -Infinity]), [props.bins]);
  const position = (value: number) => {
    if (!Number.isFinite(domain[0]) || !Number.isFinite(domain[1]) || domain[0] === domain[1]) return 4;
    return 4 + Math.max(0, Math.min(1, (value - domain[0]) / (domain[1] - domain[0]))) * (plotWidth - 30);
  };
  const labelTransform = (value: number, edge: number) => {
    const margin = editing === edge ? 75 : props.isDate ? 55 : 42;
    const x = position(value);
    return x < margin ? 'translateX(0)' : x > plotWidth - margin ? 'translateX(-100%)' : 'translateX(-50%)';
  };
  const formatLabel = (value: number) => props.isDate ? new Date(value).toLocaleDateString(locale, { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' }) : value.toLocaleString(locale, { maximumFractionDigits: 2 });
  const startEdit = (edge: 0 | 1) => {
    const value = props.bounds[edge];
    if (value === undefined) return;
    setEditing(edge);
    setEditValue(props.isDate ? new Date(value).toISOString().slice(0, 10) : String(value));
    setEditError('');
    requestAnimationFrame(() => editInput.current?.select());
  };
  const commitEdit = () => {
    if (editing === null) return;
    const trimmed = editValue.trim();
    const parsed = props.isDate ? Date.parse(`${trimmed}T${editing === 0 ? '00:00:00.000' : '23:59:59.999'}Z`) : Number(trimmed.replace(',', '.'));
    const opposite = props.bounds[1 - editing];
    if (!trimmed || !Number.isFinite(parsed) || (props.isDate && (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed) || new Date(parsed).toISOString().slice(0, 10) !== trimmed)) || (opposite !== undefined && (editing === 0 ? parsed > opposite : parsed < opposite))) {
      setEditError(t('Introduce un límite válido dentro del intervalo.'));
      editInput.current?.focus();
      return;
    }
    setEditing(null);
    if (parsed !== props.bounds[editing]) props.onChangeBound(editing, parsed);
  };
  useEffect(() => {
    let disposed = false;
    let resize: ResizeObserver | undefined;
    let resizeFrame = 0;
    void import('vega').then(vega => {
      if (disposed || !container.current) return;
      const colors = getComputedStyle(container.current);
      const color = (name: string) => colors.getPropertyValue(name).trim();
      const spec = buildBrushingSpec({ isDate: props.isDate, width: 272, height: 72, foregroundColor: color('--dl-accent'), backgroundColor: color('--dl-chart-background'), brushColor: color('--dl-accent'), axisLabelColor: color('--dl-subtle'), axisLineColor: color('--dl-line') });
      const chart = new vega.View(vega.parse(localizeChart(spec, language)), { renderer: 'canvas', container: container.current, hover: false });
      view.current = chart;
      const emit = (value: unknown) => {
        if (disposed || syncing.current) return;
        if (value === null) { if (latest.current.range) queueMicrotask(() => latest.current.onChange(null)); return; }
        if (!Array.isArray(value) || value.length !== 2) return;
        const values = value.map(v => typeof v === 'number' ? v : new Date(v).getTime()).sort((a, b) => a - b);
        if (!values.every(Number.isFinite)) return;
        const range: [number, number] = [values[0], values[1]];
        if (JSON.stringify(range) === JSON.stringify(latest.current.range)) return;
        chart.runAfter(() => { if (!disposed) latest.current.onChange(range); });
      };
      chart.addSignalListener('filterStop', (_name, value) => emit(value));
      chart.addSignalListener('barClick', (_name, value) => { if (value) emit([value.left, value.right]); });
      const updateData = createHistogramUpdater(vega, props.isDate);
      let appliedBins: Bin[] | undefined, appliedRange: string | undefined;
      let appliedRelative: boolean | undefined, appliedSelection: boolean | undefined, pendingRuns = 0;
      apply.current = () => {
        const { bins, range, isDate, relative, hasSelection } = latest.current;
        const edge = (n: number) => isDate ? new Date(n).toISOString() : n;
        let changed = false;
        if (bins !== appliedBins) {
          const changes = updateData(bins);
          if (changes) { chart.change('data', changes); changed = true; }
          appliedBins = bins;
        }
        const rangeKey = JSON.stringify(range);
        if (rangeKey !== appliedRange) {
          chart.change('selected', vega.changeset().remove(() => true).insert(range ? [{ filterRange: range.map(edge) }] : []));
          appliedRange = rangeKey; changed = true;
        }
        if (relative !== appliedRelative) {
          chart.change('propsAsData', vega.changeset().remove(() => true).insert([{ relative, bgField: relative ? 'rBackground' : 'background', fgField: relative ? 'rForeground' : 'foreground' }]));
          appliedRelative = relative; changed = true;
        }
        if (hasSelection !== appliedSelection) { chart.signal('showBarBackground', hasSelection); appliedSelection = hasSelection; changed = true; }
        if (!changed) return;
        syncing.current = true; pendingRuns++;
        void chart.runAsync().catch(e => { if (!disposed) setError(String(e)); }).finally(() => { if (--pendingRuns === 0 && !disposed) syncing.current = false; });
      };
      apply.current();
      resize = new ResizeObserver(() => {
        cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(() => {
          if (disposed || !container.current) return;
          const width = Math.max(180, Math.floor(container.current.clientWidth) - 8);
          setPlotWidth(width);
          if (chart.width() !== width) void chart.width(width).runAsync().catch(e => { if (!disposed) setError(String(e)); });
        });
      });
      resize.observe(container.current);
    }).catch(e => { if (!disposed) setError(String(e)); });
    return () => { disposed = true; resize?.disconnect(); cancelAnimationFrame(resizeFrame); apply.current = null; view.current?.finalize(); view.current = null; };
  }, [props.isDate, resolvedTheme, language]);
  useEffect(() => { apply.current?.(); }, [props.bins, props.range?.[0], props.range?.[1], props.relative, props.hasSelection]);
  const crowded = props.bounds[0] !== undefined && props.bounds[1] !== undefined && position(props.bounds[1]) - position(props.bounds[0]) < (props.isDate ? 112 : 76);
  return <div className={`dl-histogram${crowded ? ' has-crowded-range' : ''}`} aria-label={t("Distribución: arrastra para seleccionar un intervalo")}>
    <div ref={container} role="img" aria-label={t("Distribución: arrastra para seleccionar un intervalo")} />
    {props.bounds.map((value, edge) => value === undefined ? null : <div key={edge} className={`dl-range-label dl-range-label-${edge}${crowded && edge === 1 ? ' is-crowded' : ''}`} style={{ left: position(value), transform: labelTransform(value, edge) }}>
      {editing === edge ? <form onSubmit={event => { event.preventDefault(); commitEdit(); }}><input ref={editInput} type={props.isDate ? 'date' : 'text'} inputMode={props.isDate ? undefined : 'decimal'} aria-label={t(edge === 0 ? 'Mínimo {value0}' : 'Máximo {value0}', { value0: props.label })} aria-invalid={!!editError} value={editValue} onChange={event => { setEditValue(event.target.value); setEditError(''); }} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setEditing(null); } }} onBlur={() => { if (!editError) setEditing(null); }} />{editError && <small role="alert">{editError}</small>}</form> : <button type="button" title={t("Editar valor exacto: {value0}", { value0: String(value) })} aria-label={t(edge === 0 ? 'Editar mínimo de {value0}: {value1}' : 'Editar máximo de {value0}: {value1}', { value0: props.label, value1: String(value) })} onClick={() => startEdit(edge as 0 | 1)}>{formatLabel(value)}</button>}
    </div>)}
    {error && <small role="alert">{t("No se pudo dibujar: ")}{error}</small>}
  </div>;
});
