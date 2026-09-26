import type { AxisOptions, Column, Dataset, Dimension, Filter, PlotConfig, PlotDatum, PlotKind, PlotQuery, PlotWorkspace, Statistic } from './types';

export const CHARTS = [
  ['bar', 'Barras', 'bar', 'Compara categorías o distribuciones'], ['stackedBar', 'Barras apiladas', 'bar', 'Composición de cada grupo'], ['groupedBar', 'Barras agrupadas', 'bar', 'Series una junto a otra'], ['segmentedBar', 'Barras segmentadas', 'bar', 'Una vista para cada segmento'], ['percentBar', 'Barras al 100 %', 'bar', 'Proporción dentro de cada grupo'],
  ['line', 'Líneas', 'line', 'Evolución de una medida'], ['segmentedLine', 'Líneas segmentadas', 'line', 'Evolución por segmento'], ['multipleLine', 'Líneas múltiples', 'line', 'Compara varias medidas'], ['seasonal', 'Descomposición temporal', 'line', 'Tendencia, estacionalidad y residuo'],
  ['area', 'Área', 'area', 'Magnitud a lo largo de un eje'], ['stackedArea', 'Áreas apiladas', 'area', 'Contribución de cada serie'], ['segmentedArea', 'Áreas segmentadas', 'area', 'Un área para cada segmento'], ['percentArea', 'Áreas al 100 %', 'area', 'Evolución de las proporciones'],
  ['heatmap', 'Mapa de calor', 'heatmap', 'Cruza dos variables'], ['box', 'Diagrama de caja', 'box', 'Mediana, dispersión y extremos'], ['scatter', 'Dispersión', 'scatter', 'Relación entre dos medidas'], ['coloredScatter', 'Dispersión con color', 'scatter', 'Relaciona medidas por grupo'], ['bubble', 'Burbujas', 'scatter', 'Añade una medida al tamaño'], ['coloredBubble', 'Burbujas con color', 'scatter', 'Posición, tamaño y segmento'], ['table', 'Tabla dinámica', 'table', 'Agrega filas, columnas y medidas'],
].map(([kind, label, family, description]) => ({ kind: kind as PlotKind, label, family, description }));
export const STATISTICS: [Statistic, string][] = [['count', 'Número de filas'], ['valid', 'Valores no vacíos'], ['distinct', 'Valores únicos'], ['sum', 'Suma'], ['mean', 'Media'], ['median', 'Mediana'], ['min', 'Mínimo'], ['max', 'Máximo'], ['stddev', 'Desviación estándar'], ['q1', 'Percentil 25'], ['q3', 'Percentil 75'], ['percentile', 'Percentil…'], ['countWhere', 'Recuento de un valor'], ['percentWhere', 'Porcentaje de un valor']];
export const COUNT_STATISTICS: [Statistic, string][] = [['count','Recuento'],['relativeCount','Recuento relativo (total)'],['cumulativeCount','Suma acumulada']];
export const isCountMode = (stat: Statistic): stat is 'count' | 'relativeCount' | 'cumulativeCount' => stat === 'count' || stat === 'relativeCount' || stat === 'cumulativeCount';
export const countModeAvailable = (c: PlotConfig) => !c.y && !['table','heatmap','box','multipleLine','seasonal'].includes(c.kind) && !isPoints(c.kind);
export const statisticOptions = (c: PlotConfig) => countModeAvailable(c) ? COUNT_STATISTICS : STATISTICS;
export const isPoints = (k: PlotKind) => ['scatter', 'coloredScatter', 'bubble', 'coloredBubble'].includes(k);
export const hasColor = (k: PlotKind) => /stacked|grouped|segmented|percent|colored/i.test(k);
export const isLine = (k: PlotKind) => ['line','segmentedLine','multipleLine','seasonal'].includes(k);
export const isArea = (k: PlotKind) => ['area','stackedArea','segmentedArea','percentArea'].includes(k);
export function changeAxisVariable(c: PlotConfig, columns: Column[], key: 'x' | 'y', id: string): PlotConfig {
  const col = columns.find(item => item.id === id);
  return {...c, [key]: id,
    ...(key === 'x' ? {xBinning: col?.kind === 'numeric' ? 'width' as const : col?.kind === 'date' ? 'date' as const : 'exact' as const, xAxis: {...c.xAxis, format: 'auto'}} : {}),
    ...(key === 'y' && c.kind === 'heatmap' ? {yBinning: col?.kind === 'numeric' ? 'width' as const : col?.kind === 'date' ? 'date' as const : 'exact' as const, yAxis: {...c.yAxis, format: col?.kind === 'date' ? '%b %Y' : '~s'}} : key === 'y' && !isPoints(c.kind) ? {stat: id && isCountMode(c.stat) ? col?.kind === 'numeric' ? 'mean' as const : 'valid' as const : id ? c.stat : 'count' as const} : {})};
}
export function swappedAxes(c: PlotConfig, columns: Column[]): PlotConfig | null {
  if (!c.y || ['table', 'multipleLine', 'seasonal'].includes(c.kind)) return null;
  const next: PlotConfig = {...c, x: c.y, y: c.x, xBinning: c.yBinning, yBinning: c.xBinning,
    bins: c.binsY, binsY: c.bins, interval: c.intervalY, intervalY: c.interval,
    xAxis: c.yAxis, yAxis: c.xAxis, dateComponent: ''};
  return configError(next, columns) ? null : next;
}
export const freshWorkspace = (): PlotWorkspace => ({ version: 1, staged: [], draft: null, saved: [] });
const axis = (): AxisOptions => ({ title: '', showTitle: true, format: '~s', log: false, zero: true, grid: true, ticks: 6, customTicks: '', rotation: 0, labelWidth: 110, labelSeparation: 6, binLabel: 'end' });
export function defaultConfig(kind: PlotKind, columns: Column[], staged: string[] = []): PlotConfig {
  const chosen = staged.map(id => columns.find(c => c.id === id)).filter((c): c is Column => !!c);
  const numeric = columns.filter(c => c.kind === 'numeric');
  const x = (chosen[0] ?? (isPoints(kind) ? numeric[0] : columns.find(c => c.kind === 'date') ?? columns.find(c => c.kind === 'categorical') ?? columns[0]));
  const y = chosen.find(c => c.kind === 'numeric' && c.id !== x?.id) ?? numeric.find(c => c.id !== x?.id) ?? numeric[0];
  const color = chosen.find(c => c.id !== x?.id && c.id !== y?.id) ?? columns.find(c => ['categorical','boolean','text'].includes(c.kind) && c.id !== x?.id);
  return {
    kind, x: x?.id ?? '', y: (isPoints(kind) || kind === 'box' || kind === 'seasonal') ? y?.id ?? '' : '', color: hasColor(kind) ? color?.id ?? '' : '', size: numeric.find(c => c.id !== x?.id && c.id !== y?.id)?.id ?? y?.id ?? '', cell: '',
    tableRows: x ? [x.id] : [], tableColumns: color ? [color.id] : [], tableValues: [], multipleY: numeric.filter(c => c.id !== x?.id).slice(0,3).map(c => c.id),
    stat: (kind === 'box' || kind === 'seasonal' || kind === 'multipleLine') ? 'mean' : 'count', percentile: 90, statisticValue: '',
    xBinning: x?.kind === 'numeric' ? 'width' : x?.kind === 'date' ? 'date' : 'exact', yBinning: 'width', colorBinning: 'exact', bins: 24, binsY: 16, binsColor: 8,
    interval: 'month', intervalY: 'month', intervalColor: 'month', dateComponent: '', includeMissing: false,
    sort: 'natural', descending: false, sortY: 'natural', descendingY: false, horizontal: false,
    palette: 'tableau10', reversePalette: false, singleColor: '#3478f6', categoryColors: {}, opacity: CHARTS.find(chart => chart.kind === kind)?.family === 'bar' ? 1 : .85, background: '#ffffff', theme: 'light',
    title: '', subtitle: '', description: '', footer: '', showTitle: true, showSubtitle: true, showDescription: false, showFooter: false,
    labels: false, showCount: false, showChange: false, showTotals: false, labelPosition: 'outside', labelAlign: 'center', numberFormat: ',.2f', tooltip: true, tooltipColumns: [], legend: true,
    xAxis: {...axis(), zero: false, format:'auto'}, yAxis: axis(), interpolation: 'linear', lineWidth: 2, dashed: false, markers: true, missing: 'gap', zerosMissing: false,
    innerPadding: .18, outerPadding: .1, pointMin: 5, pointMax: 24, boxStyle: 'iqr', regression: false, correlation: true,
    period: 12, sharedSeasonalScale: false, pageSize: 25, hideIndex: false, cellStyle: 'plain', height: 430, annotations: [], linkFilters: true,
  };
}
export function dimension(column: string, config: PlotConfig, columns: Column[], slot: 'x' | 'y' | 'color' = 'x'): Dimension {
  const col = columns.find(c => c.id === column);
  const binning = slot === 'x' ? config.xBinning : slot === 'y' ? config.yBinning : config.colorBinning;
  return { column, binning: col?.kind === 'date' ? 'date' : col?.kind === 'numeric' ? binning === 'date' ? 'width' : binning : 'exact', bins: slot === 'x' ? config.bins : slot === 'y' ? config.binsY : config.binsColor, interval: slot === 'x' ? config.interval : slot === 'y' ? config.intervalY : config.intervalColor, ...(slot === 'x' && config.dateComponent ? {component: config.dateComponent} : {}) };
}
export function buildQuery(config: PlotConfig, dataset: Dataset, filters: Filter[]): PlotQuery {
  const q: PlotQuery = { datasetId: dataset.id, filters, mode: isPoints(config.kind) ? 'points' : 'aggregate', dimensions: [], measures: [], limit: isPoints(config.kind) ? 10000 : 5000, includeMissing: config.includeMissing, sort:config.sort, descending:config.descending };
  const measure = (column?: string) => ({column: column || undefined, stat: column && !isCountMode(config.stat) ? config.stat : 'count' as const, percentile: config.percentile / 100, value: config.statisticValue});
  if (isPoints(config.kind)) { q.pointColumns = [config.x,config.y,config.color || '',config.kind.toLowerCase().includes('bubble') ? config.size : '',...config.tooltipColumns]; return q; }
  if (config.kind === 'table') {
    q.dimensions = [...config.tableRows,...config.tableColumns].map(column => dimension(column,config,dataset.columns));
    q.measures = config.tableValues.length ? config.tableValues.map(measure) : [measure()];
  } else {
    if(config.x) q.dimensions.push(dimension(config.x,config,dataset.columns));
    if(config.kind === 'heatmap' && config.y) q.dimensions.push(dimension(config.y,config,dataset.columns,'y'));
    else if(hasColor(config.kind) && config.color) q.dimensions.push(dimension(config.color,config,dataset.columns,'color'));
    if(config.kind === 'box') q.measures = (['q1','median','q3','min','max','mean','stddev'] as const).map(stat => ({ column: config.y, stat }));
    else if(config.kind === 'multipleLine') q.measures = config.multipleY.map(measure);
    else q.measures = [measure(config.kind === 'heatmap' ? config.cell : config.y)];
  }
  q.measures.push({stat:'count'});
  return q;
}
export function configError(c: PlotConfig, columns: Column[]): string | null {
  const valid = (id: string) => columns.some(col => col.id === id);
  const numeric = (id: string) => columns.some(col => col.id === id && col.kind === 'numeric');
  if (c.kind === 'table') { if (!c.tableRows.length && !c.tableColumns.length) return 'Selecciona al menos una variable de filas o columnas.'; }
  else if (!valid(c.x)) return 'Selecciona la variable del eje X.';
  if ((isPoints(c.kind) || c.kind === 'box') && !numeric(c.y)) return 'Selecciona una variable numérica para el eje Y.';
  if (isPoints(c.kind) && !numeric(c.x)) return 'El eje X de dispersión necesita una variable numérica.';
  if (c.kind === 'heatmap' && !valid(c.y)) return 'Selecciona la segunda variable del mapa de calor.';
  if (c.kind.toLowerCase().includes('bubble') && !numeric(c.size)) return 'Selecciona una variable numérica para el tamaño.';
  if (hasColor(c.kind) && !valid(c.color)) return 'Selecciona una variable para los segmentos de color.';
  if (c.kind === 'multipleLine' && !c.multipleY.length) return 'Selecciona las medidas que quieres comparar.';
  if(c.kind === 'seasonal' && !columns.some(col => col.id === c.x && col.kind === 'date')) return 'La descomposición necesita una fecha en el eje X.';
  if(c.kind === 'seasonal' && (c.xBinning === 'exact' || c.dateComponent)) return 'Usa intervalos de tiempo consecutivos, sin componentes de fecha.';
  if(c.kind !== 'table' && c.y && !['count','relativeCount','cumulativeCount','valid','distinct','countWhere','percentWhere'].includes(c.stat) && !numeric(c.kind === 'heatmap' ? c.cell : c.y)) return 'Esta operación necesita una medida numérica.';
  const ids = [c.x,c.y,c.color,...c.tableRows,...c.tableColumns,...c.tableValues,...c.multipleY].filter(Boolean);
  if(ids.some(id => !valid(id))) return 'Una variable guardada ya no está disponible. Revisa la configuración.';
  if (new Set([...c.tableRows,...c.tableColumns]).size !== c.tableRows.length + c.tableColumns.length && c.kind === 'table') return 'Usa cada variable una sola vez en filas y columnas.';
  if(!isPoints(c.kind)&&c.kind!=='box'&&!isCountMode(c.stat)&&(c.kind==='table'?!c.tableValues.length:c.kind==='multipleLine'?!c.multipleY.length:!(c.kind==='heatmap'?c.cell:c.y))) return 'Selecciona la medida que quieres agregar o usa Número de filas.';
  for(const a of [c.xAxis,c.yAxis]) if(a.min !== undefined && a.max !== undefined && a.min >= a.max) return 'El mínimo del eje debe ser menor que el máximo.';
  return null;
}
export function filterFromDatum(col: Column, value: unknown, end?: unknown, endInclusive=false, startExclusive=false): Filter | undefined {
  if(value === null || value === undefined) return;
  if(col.kind === 'numeric' && Number.isFinite(Number(value))) { const start=Number(value),stop=end===null||end===undefined?start:Number(end); return {column:col.id,kind:'numeric',min:startExclusive?nextNumber(start,1):start,max:end!==null&&end!==undefined&&!endInclusive?nextNumber(stop,-1):stop}; }
  if(col.kind === 'date') {
    const boundary=String(end).replace(' ','T');
    const utc=/^\d{4}-\d{2}-\d{2}$/.test(boundary)?boundary+'T00:00:00Z':/[zZ]$|[+-]\d\d:?\d\d$/.test(boundary)?boundary:boundary+'Z';
    return {column:col.id,kind:'date',start:String(value),end:end ? new Date(Date.parse(utc)-1).toISOString() : String(value)};
  }
  return {column:col.id,kind:col.kind === 'multivalued' ? 'multivalued' : 'categorical',selected:[String(value)]};
}
function nextNumber(n:number,direction:1|-1):number {
  if(n===0)return direction*Number.MIN_VALUE;
  const buffer=new ArrayBuffer(8),view=new DataView(buffer);view.setFloat64(0,n);let bits=view.getBigUint64(0);bits+=((n>0)===(direction>0))?1n:-1n;view.setBigUint64(0,bits);return view.getFloat64(0);
}
export function csv(rows: PlotDatum[], headers?: string[]): string {
  const keys = headers ?? [...new Set(rows.flatMap(row => Object.keys(row)))];
  const quote = (v: unknown) => '"'+String(v ?? '').replaceAll('"','""')+'"';
  return '\ufeff'+[keys.map(quote).join(','),...rows.map(row => keys.map(key => quote(row[key])).join(','))].join('\r\n');
}
