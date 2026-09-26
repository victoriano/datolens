import { t, useI18n, getUiSnapshot } from '../../ui';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { Column, PlotConfig, PlotDatum, PlotResult } from './types';
import { display, number } from './series';
export interface PivotTotals { rows?:PlotResult; columns?:PlotResult; grand?:PlotResult }
export function formatValue(value:unknown,format:string){
  const n=number(value);if(n===null)return '—';
  if(Math.abs(n)>Number.MAX_SAFE_INTEGER&&Number.isInteger(n))return String(value);
  return new Intl.NumberFormat(getUiSnapshot().locale,{...(format.includes('%')?{style:'percent' as const,maximumFractionDigits:1}:format==='~s'?{notation:'compact' as const,maximumFractionDigits:1}:format.includes('e')?{notation:'scientific' as const,maximumFractionDigits:3}:{minimumFractionDigits:format.includes('.0')?0:2,maximumFractionDigits:format.includes('.0')?0:2})}).format(n);
}
export function PivotTable({config:c,result,columns,totals,onPick}:{config:PlotConfig;result:PlotResult;columns:Column[];totals:PivotTotals;onPick(row:PlotDatum):void}){
  const [page,setPage]=useState(0),[sort,setSort]=useState<{column:string;desc:boolean}|null>(null);
  useEffect(()=>setPage(0),[result,c.pageSize]);
  const rowCount=c.tableRows.length,colCount=c.tableColumns.length,measureCount=Math.max(1,c.tableValues.length);
  const key=(row:PlotDatum,start:number,count:number)=>JSON.stringify(Array.from({length:count},(_,i)=>row[`d${start+i}`]));
  const prepared=useMemo(()=>{
    const rows=new Map<string,PlotDatum>(),cols=new Map<string,PlotDatum>(),values=new Map<string,PlotDatum>();
    result.rows.forEach(row=>{const r=key(row,0,rowCount),col=key(row,rowCount,colCount);rows.set(r,row);cols.set(col,row);values.set(r+'|'+col,row);});
    if(!colCount)cols.set('[]',{});
    let rowKeys=[...rows.keys()];const colKeys=[...cols.keys()];
    if(sort){const [col,index]=JSON.parse(sort.column) as [string,number];rowKeys.sort((a,b)=>((number(values.get(a+'|'+col)?.[`m${index}`])??-Infinity)-(number(values.get(b+'|'+col)?.[`m${index}`])??-Infinity))*(sort.desc?-1:1));}
    const max=Math.max(0,...result.rows.flatMap(row=>Array.from({length:measureCount},(_,i)=>Math.abs(number(row[`m${i}`])??0))));
    const rowTotals=new Map(totals.rows?.rows.map(row=>[key(row,0,rowCount),row])??[]),columnTotals=new Map(totals.columns?.rows.map(row=>[key(row,rowCount,colCount),row])??[]);
    return{rows,cols,values,rowKeys,colKeys,max,rowTotals,columnTotals};
  },[result,totals,sort,rowCount,colCount,measureCount]);
  const name=(id:string)=>columns.find(col=>col.id===id)?.name??id;
  const label=(row:PlotDatum,start:number,count:number)=>Array.from({length:count},(_,i)=>display(row[`d${start+i}`])).join(' · ');
  const cell=(row:PlotDatum|undefined,m:number,key:string)=>{
    const value=row?.[`m${m}`],fraction=prepared.max?Math.abs(number(value)??0)/prepared.max:0;
    return <td key={key} style={c.cellStyle==='heat'?{background:`color-mix(in srgb, var(--dl-accent) ${Math.round(fraction*36)}%, transparent)`}:undefined}><button disabled={!row||!c.linkFilters} onClick={()=>row&&onPick(row)} title={value===null||value===undefined?t("Sin valor"):String(value)}>{c.cellStyle==='bars'&&<span className="dl-pivot-bar" style={{width:`${fraction*100}%`}}/>}<span>{formatValue(value,c.numberFormat)}</span></button></td>;
  };
  const colPageSize=30,[colPage,setColPage]=useState(0);
  useEffect(()=>setColPage(0),[result]);
  const colKeys=prepared.colKeys.slice(colPage*colPageSize,(colPage+1)*colPageSize);
  return <div className="dl-pivot" style={{background:c.background,color:c.theme==='dark'?'#eeeeee':'#292827','--dl-surface':c.background,'--dl-text':c.theme==='dark'?'#eeeeee':'#292827','--dl-muted':c.theme==='dark'?'#292c30':'#f0efee','--dl-line':c.theme==='dark'?'#43464b':'#dcdad8','--dl-subtle':c.theme==='dark'?'#a5a4a1':'#777572','--dl-selected':c.theme==='dark'?'#27466f':'#dceaff'} as CSSProperties}><div className="dl-pivot-scroll"><table><thead><tr>{!c.hideIndex&&<th>#</th>}{c.tableRows.map(id=><th key={id}>{name(id)}</th>)}{colKeys.flatMap(col=>Array.from({length:measureCount},(_,m)=><th key={`${col}:${m}`}><button onClick={()=>setSort(old=>({column:JSON.stringify([col,m]),desc:old?.column===JSON.stringify([col,m])?!old.desc:true}))}>{label(prepared.cols.get(col)!,rowCount,colCount)}{colCount>0&&<br/>}{c.tableValues[m]?name(c.tableValues[m]):t("Filas")} {sort?.column===JSON.stringify([col,m])?(sort.desc?'↓':'↑'):''}</button></th>))}{c.showTotals&&Array.from({length:measureCount},(_,m)=><th key={'total'+m}>{t("Total ")}{c.tableValues[m]?name(c.tableValues[m]):''}</th>)}</tr></thead><tbody>{prepared.rowKeys.slice(page*c.pageSize,(page+1)*c.pageSize).map((r,index)=><tr key={r}>{!c.hideIndex&&<td className="dl-pivot-index">{page*c.pageSize+index+1}</td>}{Array.from({length:rowCount},(_,i)=><th key={i}>{display(prepared.rows.get(r)?.[`d${i}`])}</th>)}{colKeys.flatMap(col=>Array.from({length:measureCount},(_,m)=>cell(prepared.values.get(r+'|'+col),m,col+':'+m)))}{c.showTotals&&Array.from({length:measureCount},(_,m)=>cell(prepared.rowTotals.get(r),m,'total:'+m))}</tr>)}</tbody>{c.showTotals&&<tfoot><tr>{!c.hideIndex&&<th/>}{rowCount>0&&<th colSpan={rowCount}>{t("Total")}</th>}{colKeys.flatMap(col=>Array.from({length:measureCount},(_,m)=>cell(prepared.columnTotals.get(col),m,'total:'+col+':'+m)))}{Array.from({length:measureCount},(_,m)=>cell(totals.grand?.rows[0],m,'grand:'+m))}</tr></tfoot>}</table></div><footer><span>{prepared.rowKeys.length.toLocaleString(getUiSnapshot().locale)}{t(" grupos de filas · ")}{prepared.colKeys.length.toLocaleString(getUiSnapshot().locale)}{t(" grupos de columnas")}</span><div><button disabled={page===0} onClick={()=>setPage(p=>p-1)}>{t("← Filas")}</button><span>{page+1} / {Math.max(1,Math.ceil(prepared.rowKeys.length/c.pageSize))}</span><button disabled={(page+1)*c.pageSize>=prepared.rowKeys.length} onClick={()=>setPage(p=>p+1)}>{t("Filas →")}</button></div>{prepared.colKeys.length>colPageSize&&<div><button disabled={colPage===0} onClick={()=>setColPage(p=>p-1)}>{t("← Columnas")}</button><span>{colPage+1} / {Math.ceil(prepared.colKeys.length/colPageSize)}</span><button disabled={(colPage+1)*colPageSize>=prepared.colKeys.length} onClick={()=>setColPage(p=>p+1)}>{t("Columnas →")}</button></div>}</footer>{c.showTotals&&<small>{t("Totales recalculados sobre las mismas filas elegibles; las medias y medianas no se suman.")}</small>}</div>;
}
