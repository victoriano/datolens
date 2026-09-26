import { countModeAvailable, hasColor, isPoints } from './model';
import type { Column, PlotConfig, PlotDatum, PlotResult } from './types';
import { t, getUiSnapshot } from '../../ui';

export const number = (value: unknown): number | null => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
export const display = (value: unknown): string => value === null || value === undefined ? t('(Vacío)') : String(value);
export function label(value: unknown, end?: unknown): string {
  if (end === null || end === undefined || end === value) return display(value);
  const format = (v: unknown) => typeof v === 'number' ? v.toLocaleString(getUiSnapshot().locale, {maximumSignificantDigits:5}) : String(v).replace('T',' ').replace(/ 00:00:00$/, '');
  return `${format(value)} – ${format(end)}`;
}
export interface Datum extends PlotDatum { x: number | string; category: string; y: number | null; series: string; size: number; count: number; low: number | null; high: number | null; median: number | null; q1: number | null; q3: number | null; y0: number; y1: number; change: number | null }
export function chartRows(c: PlotConfig, result: PlotResult, columns: Column[]): Datum[] {
  const points = isPoints(c.kind), date = columns.find(col => col.id === c.x)?.kind === 'date' && !c.dateComponent;
  const numeric = columns.find(col => col.id === c.x)?.kind === 'numeric';
  let rows: Datum[] = [];
  result.rows.forEach(raw => {
    const measures = c.kind === 'multipleLine' ? c.multipleY : [''];
    measures.forEach((measure, i) => {
      const value = points ? raw.d1 : raw[`m${i}`];
      let y = number(value);
      if(c.zerosMissing && y === 0) y = null;
      if(c.missing === 'zero' && y === null) y = 0;
      const mean = number(raw.m5), std = number(raw.m6), q1 = number(raw.m0), q3 = number(raw.m2), minimum = number(raw.m3), maximum = number(raw.m4);
      const spread = q1 !== null && q3 !== null ? (q3-q1)*1.5 : 0;
      const series = c.kind === 'multipleLine' ? columns.find(col => col.id === measure)?.name ?? measure : points ? display(raw.d2) : hasColor(c.kind) ? display(raw.d1) : '';
      const rawDate=String(raw.d0).replace(' ','T');
      const x = date ? Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(rawDate)?rawDate:rawDate+'Z') : numeric && number(raw.d0) !== null ? Number(raw.d0) : display(raw.d0);
      const mKeys = Object.keys(raw).filter(key => /^m\d+$/.test(key));
      rows.push({...raw,x,category:label(raw.d0,raw.d0End),y,series,size:Math.abs(number(raw.d3) ?? 1),count:number(raw[mKeys.at(-1) ?? '']) ?? 0,
        low:c.boxStyle === 'deviation' ? mean === null ? null : mean-(std??0) : c.boxStyle === 'extent' ? minimum : Math.max(minimum ?? -Infinity,(q1??0)-spread),
        high:c.boxStyle === 'deviation' ? mean === null ? null : mean+(std??0) : c.boxStyle === 'extent' ? maximum : Math.min(maximum??Infinity,(q3??0)+spread),
        median:c.boxStyle === 'deviation' ? mean : number(raw.m1),q1:c.boxStyle === 'deviation' ? mean === null ? null : mean-(std??0) : q1,q3:c.boxStyle === 'deviation' ? mean === null ? null : mean+(std??0) : q3,
        y0:0,y1:y??0,change:null,
      });
    });
  });
  const totals = new Map<string, number>();
  rows.forEach(d => totals.set(d.category,(totals.get(d.category)??0)+(d.y??0)));
  const natural = (a: Datum,b: Datum) => typeof a.x === 'number' && typeof b.x === 'number' ? a.x-b.x : String(a.x).localeCompare(String(b.x),'es',{numeric:true});
  rows.sort((a,b) => (c.sort === 'value' ? (totals.get(a.category)??0)-(totals.get(b.category)??0) : c.sort === 'count' ? a.count-b.count : natural(a,b))*(c.descending?-1:1));
  if(countModeAvailable(c) && c.stat === 'relativeCount') {
    rows = rows.map(d => ({...d,y:result.plottedRows ? (d.y??0)/result.plottedRows : 0,y1:result.plottedRows ? (d.y??0)/result.plottedRows : 0}));
  } else if(countModeAvailable(c) && c.stat === 'cumulativeCount') {
    const cumulative = new Map<string,number>();
    rows = rows.map(d => {const value=(cumulative.get(d.series)??0)+(d.y??0);cumulative.set(d.series,value);return {...d,y:value,y1:value};});
  }
  const running = new Map<string,number>();
  if(/stacked|percent/.test(c.kind)) {
    rows = rows.map(d => {
      const withinGroupPercent=c.kind.startsWith('percent') && !(countModeAvailable(c) && c.stat!=='count');
      const value = withinGroupPercent ? (totals.get(d.category) ? (d.y??0)/totals.get(d.category)! : 0) : d.y??0;
      const key = `${d.category}:${value<0?'negative':'positive'}`;
      const start = running.get(key) ?? 0;
      running.set(key,start+value);
      return {...d,y:value,y0:start,y1:start+value};
    });
  }
  const previous = new Map<string,number>();
  rows.forEach(d => { const p = previous.get(d.series); if(p !== undefined && p !== 0 && d.y !== null)d.change=(d.y-p)/Math.abs(p); if(d.y !== null) previous.set(d.series,d.y); });
  return rows;
}
/** Classical additive decomposition over equally spaced calendar buckets. */
export function decompose(rows: Datum[], period: number): Datum[] {
  const sorted=[...rows].sort((a,b)=>Number(a.x)-Number(b.x));
  const p=Math.max(2,Math.floor(period));
  if(sorted.length<p*2) throw new Error(`La descomposición necesita al menos ${p*2} intervalos (${p} por ciclo).`);
  if(sorted.some(d=>d.y===null)) throw new Error('Hay intervalos sin medida. Elige cómo tratar los valores vacíos antes de descomponer.');
  const trend=sorted.map((_,i)=>{
    const half=Math.floor(p/2), lo=i-half, hi=lo+p-1;
    if(lo<0 || hi>=sorted.length || (p%2===0 && hi+1>=sorted.length))return null;
    let sum=0;for(let j=lo;j<=hi;j++)sum+=sorted[j].y!;
    return p%2===0 ? (sum-.5*sorted[lo].y!+.5*sorted[hi+1].y!)/p : sum/p;
  });
  const season=Array.from({length:p},()=>({sum:0,n:0}));
  sorted.forEach((d,i)=>{if(trend[i]!==null){season[i%p].sum+=d.y!-trend[i]!;season[i%p].n++;}});
  const values=season.map(v=>v.n?v.sum/v.n:0), center=values.reduce((a,b)=>a+b,0)/p;
  return sorted.flatMap((d,i)=>[
    {...d,series:'Observada'}, {...d,series:'Tendencia',m0:trend[i],y:trend[i],y1:trend[i]??0},
    {...d,series:'Estacionalidad',m0:values[i%p]-center,y:values[i%p]-center,y1:values[i%p]-center},
    {...d,series:'Residuo',m0:trend[i]===null?null:d.y!-trend[i]!-(values[i%p]-center),y:trend[i]===null?null:d.y!-trend[i]!-(values[i%p]-center),y1:trend[i]===null?0:d.y!-trend[i]!-(values[i%p]-center)},
  ]);
}
export function regularize(rows: Datum[], c: PlotConfig): Datum[] {
  if(!rows.length)return rows;
  const sorted=[...rows].sort((a,b)=>Number(a.x)-Number(b.x));
  const existing=new Map(sorted.map(d=>[Number(d.x),d]));
  const result:Datum[]=[];let timestamp=Number(sorted[0].x), last=Number(sorted.at(-1)!.x);
  while(timestamp<=last && result.length<10000){
    const d=existing.get(timestamp);
    const date=new Date(timestamp);
    if(c.interval==='hour')date.setUTCHours(date.getUTCHours()+1);
    else if(c.interval==='day'||c.interval==='week')date.setUTCDate(date.getUTCDate()+(c.interval==='week'?7:1));
    else date.setUTCMonth(date.getUTCMonth()+({month:1,quarter:3,year:12}[c.interval]));
    const next=date.getTime();if(next<=timestamp||!Number.isFinite(next))break;
    result.push(d??{...sorted[0],x:timestamp,d0:new Date(timestamp).toISOString(),d0End:new Date(next).toISOString(),m0:null,category:new Date(timestamp).toISOString().slice(0,10),y:c.missing==='zero'?0:null,y1:0,count:0});
    timestamp=next;
  }
  if(timestamp<=last) throw new Error('La serie excede 10.000 intervalos; agrupa por un periodo mayor.');
  return result;
}
