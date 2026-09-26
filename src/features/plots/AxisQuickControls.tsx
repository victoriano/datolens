import { VariablePicker } from '../../ui/VariablePicker';
import { t } from '../../ui';
import { changeAxisVariable, CHARTS, isPoints, statisticOptions, swappedAxes } from './model';
import type { Column, DateInterval, PlotConfig, Statistic } from './types';

interface Props { config: PlotConfig; columns: Column[]; onChange(config: PlotConfig): void }
const periods: [DateInterval, string][] = [['hour','Hora'],['day','Día'],['week','Semana'],['month','Mes'],['quarter','Trimestre'],['year','Año']];

export function AxisQuickControls({config:c,columns,onChange}:Props) {
  if (c.kind === 'table') return null;
  const xColumn = columns.find(col => col.id === c.x);
  const yColumn = columns.find(col => col.id === c.y);
  const points = isPoints(c.kind);
  const heatmap = c.kind === 'heatmap';
  const multiple = c.kind === 'multipleLine';
  const canRotate = CHARTS.find(chart => chart.kind === c.kind)?.family === 'bar' || c.kind === 'box';
  const swapped = swappedAxes(c, columns);
  const xNumeric = xColumn?.kind === 'numeric';
  const xDate = xColumn?.kind === 'date';
  const xSummary = xNumeric ? c.xBinning === 'exact' ? t('Valores exactos') : `${c.bins} ${t(c.xBinning === 'quantile' ? 'cuantiles' : 'intervalos')}` : xDate ? t(periods.find(([value]) => value === c.interval)?.[1] ?? 'Mes') : t('Valores exactos');
  const ySummary = heatmap ? yColumn?.kind === 'numeric' ? `${c.binsY} ${t(c.yBinning === 'quantile' ? 'cuantiles' : 'intervalos')}` : yColumn?.kind === 'date' ? t(periods.find(([value]) => value === c.intervalY)?.[1] ?? 'Mes') : t('Valores exactos') : t(statisticOptions(c).find(([value]) => value === c.stat)?.[1] ?? 'Recuento');
  const yNumeric = points || c.kind === 'box';
  return <div className="dl-plot-axis-bar" aria-label={t('Variables y cálculos del gráfico')}>
    <div className="dl-plot-axis-pill">
      <span className="dl-plot-axis-letter">X</span>
      <VariablePicker label={t('Variable del eje X')} columns={columns.filter(col => !points || col.kind === 'numeric')} value={c.x} placeholder={t('Selecciona una variable…')} onChange={id => onChange(changeAxisVariable(c, columns, 'x', id))}/>
      {!points && <details className="dl-plot-axis-detail"><summary aria-label={t('Agrupación del eje X')}>{xSummary}</summary><div className="dl-plot-axis-menu">
        {xNumeric && <><label>{t('Agrupación')}<select value={c.xBinning} onChange={e => onChange({...c,xBinning:e.target.value as PlotConfig['xBinning']})}><option value="width">{t('Intervalos iguales')}</option><option value="quantile">{t('Cuantiles')}</option><option value="exact">{t('Valores exactos')}</option></select></label>{c.xBinning !== 'exact' && <label>{t('Número de intervalos')}<input type="number" min="1" max="100" value={c.bins} onChange={e => { const n=Number(e.target.value);if(Number.isInteger(n)&&n>=1&&n<=100)onChange({...c,bins:n}); }}/></label>}</>}
        {xDate && <label>{t('Periodo')}<select value={c.interval} onChange={e => onChange({...c,interval:e.target.value as DateInterval})}>{periods.map(([value,label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label>}
        {!xNumeric && !xDate && <span>{t('Valores exactos')}</span>}
      </div></details>}
    </div>
    <div className="dl-plot-axis-actions"><button className="dl-plot-axis-swap" disabled={!swapped} title={swapped ? t('Intercambiar variables X e Y') : t('Selecciona dos variables compatibles para intercambiarlas')} aria-label={t('Intercambiar variables X e Y')} onClick={() => swapped && onChange(swapped)}>⇄</button>{canRotate && <button className="dl-plot-axis-swap" aria-pressed={c.horizontal} title={t('Cambiar orientación de los ejes')} aria-label={t('Cambiar orientación de los ejes')} onClick={() => onChange({...c,horizontal:!c.horizontal})}>↷</button>}</div>
    <div className="dl-plot-axis-pill">
      <span className="dl-plot-axis-letter">Y</span>
      {multiple ? <span className="dl-plot-axis-static">{t('Medidas múltiples')}</span> : <VariablePicker label={t('Variable del eje Y')} columns={columns.filter(col => !yNumeric || col.kind === 'numeric')} value={c.y} placeholder={t('Selecciona una variable…')} emptyLabel={yNumeric || heatmap ? undefined : t('Número de filas')} onChange={id => onChange(changeAxisVariable(c, columns, 'y', id))}/>}
      {!points && c.kind !== 'box' && !multiple && <details className="dl-plot-axis-detail"><summary aria-label={heatmap ? t('Agrupación del eje Y') : t('Cálculo del eje Y')}>{ySummary}</summary><div className="dl-plot-axis-menu">
        {heatmap ? yColumn?.kind === 'numeric' ? <><label>{t('Agrupación')}<select value={c.yBinning} onChange={e => onChange({...c,yBinning:e.target.value as PlotConfig['yBinning']})}><option value="width">{t('Intervalos iguales')}</option><option value="quantile">{t('Cuantiles')}</option><option value="exact">{t('Valores exactos')}</option></select></label>{c.yBinning !== 'exact' && <label>{t('Número de intervalos')}<input type="number" min="1" max="100" value={c.binsY} onChange={e => { const n=Number(e.target.value);if(Number.isInteger(n)&&n>=1&&n<=100)onChange({...c,binsY:n}); }}/></label>}</> : yColumn?.kind === 'date' ? <label>{t('Periodo')}<select value={c.intervalY} onChange={e => onChange({...c,intervalY:e.target.value as DateInterval})}>{periods.map(([value,label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label> : <span>{t('Valores exactos')}</span> : <><div className="dl-plot-axis-options" role="group" aria-label={t('Estadístico')}>{statisticOptions(c).map(([value,label]) => <button type="button" key={value} aria-pressed={c.stat===value} onClick={e => {onChange({...c,stat:value as Statistic});e.currentTarget.closest('details')?.removeAttribute('open');}}><span>{t(label)}</span>{c.stat===value&&<span aria-hidden="true">✓</span>}</button>)}</div>{c.stat === 'percentile' && <label>{t('Percentil (0–100)')}<input type="number" min="0" max="100" value={c.percentile} onChange={e => {const n=Number(e.target.value);if(n>=0&&n<=100)onChange({...c,percentile:n});}}/></label>}{['countWhere','percentWhere'].includes(c.stat) && <label>{t('Valor que contar')}<input value={c.statisticValue} onChange={e => onChange({...c,statisticValue:e.target.value})}/></label>}</>}
      </div></details>}
    </div>
  </div>;
}
