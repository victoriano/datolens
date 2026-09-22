/** Brushing bar chart. The Vega signal graph is kept self-contained. */
import { useEffect, useRef, useState } from 'react';
import type { View } from 'vega';
import type { Bin } from '../../contracts/desktop-api';
import { buildBrushingSpec } from './brushing-spec';
interface Props { bins: Bin[]; range: [number, number] | null; isDate: boolean; relative: boolean; hasSelection: boolean; onChange: (range: [number, number] | null) => void }
export function Histogram(props: Props) {
  const container = useRef<HTMLDivElement>(null);
  const view = useRef<View | null>(null);
  const latest = useRef(props); latest.current = props;
  const apply = useRef<(() => void) | null>(null);
  const syncing = useRef(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    void import('vega').then(vega => {
      if (disposed || !container.current) return;
      const chart = new vega.View(vega.parse(buildBrushingSpec({ isDate: props.isDate, width: 272, height: 72, foregroundColor: '#3b82f6', backgroundColor: '#d4d4d8', brushColor: '#3b82f6', axisLabelColor: '#71717a', axisLineColor: '#d4d4d8', rangeLabelColor: '#52525b' })), { renderer: 'canvas', container: container.current, hover: false });
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
      apply.current = () => {
        syncing.current = true;
        const { bins, range, isDate, relative, hasSelection } = latest.current;
        const edge = (n: number) => isDate ? new Date(n).toISOString() : n;
        const data = bins.filter(bin => Number.isFinite(bin.left) && Number.isFinite(bin.right)).map(bin => ({ ...bin, left: edge(bin.left!), right: edge(bin.right!) }));
        chart.signal('showBarBackground', hasSelection)
          .change('data', vega.changeset().remove(() => true).insert(data))
          .change('selected', vega.changeset().remove(() => true).insert(range ? [{ filterRange: range.map(edge) }] : []))
          .change('propsAsData', vega.changeset().remove(() => true).insert([{ relative, bgField: relative ? 'rBackground' : 'background', fgField: relative ? 'rForeground' : 'foreground' }]));
        void chart.runAsync().catch(e => { if (!disposed) setError(String(e)); }).finally(() => { syncing.current = false; });
      };
      apply.current();
    }).catch(e => { if (!disposed) setError(String(e)); });
    return () => { disposed = true; apply.current = null; view.current?.finalize(); view.current = null; };
  }, [props.isDate]);
  useEffect(() => { apply.current?.(); }, [props.bins, props.range, props.relative, props.hasSelection]);
  return <div className="dl-histogram" role="img" aria-label="Distribución: arrastra para seleccionar un intervalo"><div ref={container} />{error && <small role="alert">No se pudo dibujar: {error}</small>}</div>;
}
