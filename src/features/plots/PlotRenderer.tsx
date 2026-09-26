import { t, useI18n, getUiSnapshot } from '../../ui';
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { View } from 'vega';
import { buildSpec } from './spec';
import { createPlotUpdater, plotSpecParts, sharePlotRows } from './plot-update';
import { composeSvg } from './svg-export';
import { chartRows, decompose, regularize, type Datum } from './series';
import type { Column, PlotConfig, PlotResult } from './types';

export interface ChartHandle { svg():Promise<string>; png():Promise<string> }
interface Props {config:PlotConfig;result:PlotResult;columns:Column[];onPick(row:Datum):void;onBrush(range:number[]):void;onError(error:string):void}
const escape=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const Canvas = memo(function Canvas({config,statistics,columns,rows,onPick,onBrush,onError,views,index}:{config:PlotConfig;statistics:PlotResult['statistics'];columns:Column[];rows:Datum[];onPick(row:Datum):void;onBrush(range:number[]):void;onError(error:string):void;views:Map<number,View>;index:number}){
  const {locale}=useI18n();
  const ref=useRef<HTMLDivElement>(null),latest=useRef({config,statistics,columns,rows,onPick,onBrush,onError,index});latest.current={config,statistics,columns,rows,onPick,onBrush,onError,index};
  const apply=useRef<(()=>void)|null>(null);
  const [tooltip,setTooltip]=useState<{x:number;y:number;values:Record<string,string>}|null>(null);
  useEffect(()=>{
    let disposed=false;
    let current:{view:View;structure:string;update:ReturnType<typeof createPlotUpdater>;index:number}|undefined;
    const release=()=>{if(current){current.view.finalize();if(views.get(current.index)===current.view)views.delete(current.index);current=undefined;}};
    void import('vega').then(vega=>{
      if(disposed)return;
      apply.current=()=>{
        if(disposed||!ref.current)return;
        try{
          const {config,rows,columns,statistics,index}=latest.current;
          const spec=buildSpec(config,rows,columns,{statistics},Math.max(300,ref.current.clientWidth),config.height);
          const {structure,values}=plotSpecParts(spec);
          if(current&&current.structure===structure){
            if(current.index!==index){if(views.get(current.index)===current.view)views.delete(current.index);current.index=index;views.set(index,current.view);}
            const changes=current.update(values);
            if(changes){setTooltip(null);const view=current.view;void view.change('values',changes).runAsync().catch(error=>{if(!disposed&&current?.view===view)latest.current.onError(String(error));});}
            return;
          }
          release();setTooltip(null);
          const view=new vega.View(vega.parse(spec),{renderer:'canvas',container:ref.current,hover:true});
          current={view,structure,update:createPlotUpdater(vega,values),index};views.set(index,view);
          view.addEventListener('click',(event,item)=>{if((event as MouseEvent).shiftKey)return;if(item?.datum?.category!==undefined)latest.current.onPick(item.datum as Datum);});
          view.addEventListener('mousemove',(event,item)=>{
            if(!latest.current.config.tooltip||!item?.datum?.tooltip){setTooltip(null);return;}
            const mouse=event as MouseEvent;
            setTooltip({x:Math.min(mouse.clientX,window.innerWidth-290),y:Math.min(mouse.clientY+16,window.innerHeight-240),values:item.datum.tooltip as Record<string,string>});
          });
          view.addEventListener('mouseout',()=>setTooltip(null));
          if(spec.signals?.some(signal=>signal.name==='brushDone'))view.addSignalListener('brushDone',(_name,value)=>{if(Array.isArray(value)&&value.length===4&&value.every(Number.isFinite))queueMicrotask(()=>{if(!disposed&&current?.view===view)latest.current.onBrush(value);});});
          void view.runAsync().catch(error=>{if(!disposed&&current?.view===view)latest.current.onError(String(error));});
        }catch(error){latest.current.onError(String(error));}
      };
      apply.current();
    }).catch(error=>{if(!disposed)latest.current.onError(String(error));});
    return()=>{disposed=true;apply.current=null;release();};
  },[views]);
  useEffect(()=>{apply.current?.();},[config,rows,columns,statistics,index,locale]);
  useEffect(()=>{
    const element=ref.current;if(!element)return;
    let width=element.clientWidth,frame=0;
    const observer=new ResizeObserver(()=>{if(element.clientWidth===width)return;width=element.clientWidth;cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>apply.current?.());});
    observer.observe(element);return()=>{observer.disconnect();cancelAnimationFrame(frame);};
  },[]);
  return <><div ref={ref} className="dl-plot-vega" role="img" aria-label={config.title||t("Gráfico de los datos filtrados")}/>{tooltip&&<div role="tooltip" className="dl-plot-tooltip" style={{left:tooltip.x,top:tooltip.y}}>{Object.entries(tooltip.values).map(([label,value])=><div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>}</>;
});
export const PlotRenderer=forwardRef<ChartHandle,Props>(function PlotRenderer({config,result,columns,onPick,onBrush,onError},ref){
  const {locale}=useI18n();
  const listeners=useRef({onPick,onBrush,onError});listeners.current={onPick,onBrush,onError};
  const pick=useCallback((row:Datum)=>listeners.current.onPick(row),[]),brush=useCallback((range:number[])=>listeners.current.onBrush(range),[]),error=useCallback((message:string)=>listeners.current.onError(message),[]);
  const panelHistory=useRef(new Map<string,{config:PlotConfig;rows:Datum[]}>());
  const views=useRef(new Map<number,View>()),[facetPage,setFacetPage]=useState(0);
  const prepared=useMemo(()=>{try{
    let rows=chartRows(config,result,columns);
    if(config.kind==='seasonal'){
      if(result.truncated)throw new Error(t("Agrupa la serie en periodos mayores: la descomposición necesita todos los intervalos."));
      rows=decompose(regularize(rows,config),config.period);
    }
    const segmented=config.kind.startsWith('segmented')||config.kind==='seasonal';
    const names=segmented?[...new Set(rows.map(d=>d.series))]:[''];
    return {rows,names,error:''};
  }catch(error){return {rows:[] as Datum[],names:[] as string[],error:String(error instanceof Error?error.message:error)};}},[config,result,columns,locale]);
  useEffect(()=>{setFacetPage(0);},[config.kind]);
  useEffect(()=>{setFacetPage(page=>Math.min(page,Math.max(0,Math.ceil(prepared.names.length/12)-1)));},[prepared.names.length]);
  useEffect(()=>{if(prepared.error)onError(prepared.error);},[prepared.error,onError]);
  const names=prepared.names.slice(facetPage*12,facetPage*12+12);
  const panels=useMemo(()=>{const next=names.map(name=>({name,rows:config.kind==='seasonal'?prepared.rows.filter(row=>row.series===name).map(row=>({...row,series:t(row.series)})):name?prepared.rows.filter(row=>row.series===name):prepared.rows,config:config.kind==='seasonal'?{...config,kind:'line' as const,height:250,yAxis:{...config.yAxis,zero:false,...(config.sharedSeasonalScale&&(name==="Estacionalidad"||name==="Residuo")?{min:Math.min(...prepared.rows.filter(d=>d.series==="Estacionalidad"||d.series==="Residuo").map(d=>d.y??0)),max:Math.max(...prepared.rows.filter(d=>d.series==="Estacionalidad"||d.series==="Residuo").map(d=>d.y??0))}:{})}}:config.kind.startsWith('segmented')?{...config,kind:config.kind==='segmentedBar'?'bar' as const:config.kind==='segmentedArea'?'area' as const:'line' as const,height:300}:config}));
    const shared=next.map(panel=>{const old=panelHistory.current.get(panel.name);return old?{...panel,config:JSON.stringify(old.config)===JSON.stringify(panel.config)?old.config:panel.config,rows:sharePlotRows(old.rows,panel.rows)}:panel;});
    panelHistory.current=new Map(shared.map(panel=>[panel.name,panel]));return shared;
  },[config,prepared,facetPage]);
  const svg=async()=>{
    if(views.current.size!==panels.length||!panels.length)throw new Error(t("Espera a que termine de dibujarse el gráfico."));
    const rendered=await Promise.all([...views.current.entries()].sort(([a],[b])=>a-b).map(async([index,view])=>({svg:await view.toSVG(),name:config.kind==='seasonal'?t(panels[index]?.name??''):panels[index]?.name??''})));
    return composeSvg(config,rendered);
  };
  useImperativeHandle(ref,()=>({svg,png:async()=>{
    const content=await svg(),image=new Image();
    image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(content);await image.decode();
    const canvas=document.createElement('canvas'),scale=Math.min(2,16000/Math.max(image.width,image.height));canvas.width=Math.ceil(image.width*scale);canvas.height=Math.ceil(image.height*scale);
    const context=canvas.getContext('2d');if(!context)throw new Error(t("No se pudo crear la imagen."));context.drawImage(image,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/png').split(',')[1];
  }}));
  if(prepared.error)return <div className="dl-plot-empty"><strong>{t("No se puede dibujar esta configuración")}</strong><p>{prepared.error}</p></div>;
  return <div className="dl-plot-renderer" style={{background:config.background,color:config.theme==='dark'?'#eeeeee':'#292827',width:config.width?`${config.width}px`:undefined}}>
    {(config.showTitle&&config.title||config.showSubtitle&&config.subtitle||config.showDescription&&config.description)&&<header className="dl-plot-chart-heading">{config.showTitle&&config.title&&<h2>{config.title}</h2>}{config.showSubtitle&&config.subtitle&&<p>{config.subtitle}</p>}{config.showDescription&&config.description&&<small>{config.description}</small>}</header>}
    <div className={panels.length>1?'dl-plot-facets':''}>{panels.map((panel,index)=><section key={panel.name||'chart'}>{panel.name&&<h3>{config.kind==='seasonal'?t(panel.name):panel.name}</h3>}<Canvas config={panel.config} rows={panel.rows} statistics={config.regression?result.statistics:undefined} columns={columns} views={views.current} index={index} onPick={pick} onBrush={brush} onError={error}/></section>)}</div>
    {prepared.names.length>12&&<footer><button disabled={facetPage===0} onClick={()=>setFacetPage(p=>p-1)}>←</button><span>{t("Segmentos ")}{facetPage*12+1}–{Math.min((facetPage+1)*12,prepared.names.length)}{t(" de ")}{prepared.names.length}</span><button disabled={(facetPage+1)*12>=prepared.names.length} onClick={()=>setFacetPage(p=>p+1)}>→</button><small>{t("La imagen exporta los segmentos visibles.")}</small></footer>}
    {config.showFooter&&config.footer&&<footer>{config.footer}</footer>}
  </div>;
});
