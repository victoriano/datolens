import { VariablePicker } from '../../ui/VariablePicker';
import { t, useI18n, getUiSnapshot } from '../../ui';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CHARTS, STATISTICS, buildQuery, configError, countModeAvailable, csv, defaultConfig, filterFromDatum, freshWorkspace, isCountMode, isPoints } from './model';
import { PlotResize } from './PlotResize';
import { PlotSettings } from './PlotSettings';
import { AxisQuickControls } from './AxisQuickControls';
import { PlotRenderer, type ChartHandle } from './PlotRenderer';
import { sharePlotResult } from './plot-update';
import { PivotTable, type PivotTotals } from './PivotTable';
import { chartRows, display, type Datum } from './series';
import type { PlotConfig, PlotDatum, PlotKind, PlotResult, PlotsPanelProps, SavedPlot } from './types';
import '../../styles/plots.css';

export function ChartIcon({family}:{family:string}){
  return <svg viewBox="0 0 240 90" aria-hidden="true"><path className="dl-plot-icon-grid" d="M20 15H224M20 40H224M20 65H224M40 5V80M90 5V80M140 5V80M190 5V80"/>{family==='bar'?[20,40,65,48,32,40].map((h,i)=><rect key={i} x={36+i*29} y={76-h} width="19" height={h} rx="3"/>):family==='line'?<><path d="M22 66C48 65 55 38 80 44S119 13 145 24S184 58 220 38" fill="none" stroke="currentColor" strokeWidth="4"/>{[[80,44],[145,24],[220,38]].map(([x,y])=><circle key={x} cx={x} cy={y} r="4"/>)}</>:family==='area'?<path d="M22 65Q58 20 102 47T218 14V77H22Z" opacity=".75"/>:family==='heatmap'?Array.from({length:32},(_,i)=><rect key={i} x={24+i%8*24} y={10+Math.floor(i/8)*17} width="21" height="14" rx="2" opacity={.2+((i*7)%10)/13}/>):family==='box'?[25,35,45,30,52].map((h,i)=><g key={i}><path d={`M${44+i*38} ${65-h}V${85-h/2}`} stroke="currentColor" strokeWidth="3"/><rect x={34+i*38} y={70-h} width="21" height="25" rx="2" opacity=".65"/><path d={`M${34+i*38} ${82-h}h21`} stroke="currentColor" strokeWidth="2"/></g>):family==='scatter'?Array.from({length:20},(_,i)=><circle key={i} cx={30+i*9} cy={72-i*2.5+(i%3-1)*12} r={3+(i%3)} opacity={.45+i%4*.13}/>):Array.from({length:16},(_,i)=><rect key={i} x={24+i%4*49} y={14+Math.floor(i/4)*16} width={15+(i*7)%28} height="3" rx="1"/>)}</svg>;
}
export function PlotsPanel({api,dataset,filters,value,onChange,onFilter,revision=0}:PlotsPanelProps){
  const { resolvedTheme, locale } = useI18n();
  const empty=useRef(freshWorkspace()),state=value??empty.current,c=state.draft;
  const chart=useRef<ChartHandle>(null),[frame,setFrame]=useState<{source:string;key:string;result:PlotResult;totals:PivotTotals}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[retry,setRetry]=useState(0),[settings,setSettings]=useState(true),[exporting,setExporting]=useState(false),[name,setName]=useState(''),[saveDialog,setSaveDialog]=useState(false),[deleted,setDeleted]=useState<SavedPlot|null>(null);
  const validation=c?configError(c,dataset.columns):null;
  const request=useMemo(()=>c&&!validation?buildQuery(c,dataset,filters):null,[c,dataset,filters,validation]);
  const key=JSON.stringify(request),wantsTotals=c?.kind==='table'&&c.showTotals;
  const source=JSON.stringify([dataset.id,dataset.revision,revision,request?{...request,filters:[]}:null]);
  const result=frame?.source===source?frame.result:null,totals=frame?.source===source?frame.totals:{};
  const staleResult=!!result&&frame?.key!==key;
  useLayoutEffect(()=>{
    let stale=false;setError('');setBusy(false);
    if(!request)return;
    if(!api.queryPlot){setError(t("El cálculo de gráficos necesita la aplicación de escritorio actualizada."));return;}
    setBusy(true);
    const timer=setTimeout(()=>{void (async()=>{
      const main=await api.queryPlot!(request);
      if(stale)return;
      if(main.datasetRevision!==dataset.revision)throw new Error(t("El archivo cambió durante el cálculo. Vuelve a abrirlo."));
      let totals:PivotTotals={};
      if(wantsTotals&&c){
        const rowDims=Array.from({length:c.tableRows.length},(_,i)=>i),columnDims=Array.from({length:c.tableColumns.length},(_,i)=>c.tableRows.length+i);
        const results=await Promise.all([rowDims,columnDims,[]].map(groupDimensions=>api.queryPlot!({...request,groupDimensions})));
        totals={rows:results[0],columns:results[1],grand:results[2]};
      }
      if(stale)return;setFrame(previous=>({source,key,result:sharePlotResult(previous?.source===source?previous.result:null,main),totals}));
    })().catch(error=>{if(!stale)setError(error instanceof Error?error.message:String(error));}).finally(()=>{if(!stale)setBusy(false);});},120);
    return()=>{stale=true;clearTimeout(timer);};
  },[api,key,dataset.revision,revision,retry,wantsTotals,c?.tableRows.length]);
  const setConfig=useCallback((config:PlotConfig)=>{setError('');onChange({...state,draft:config});},[state,onChange]);
  useEffect(()=>{if(c && ((countModeAvailable(c) && !isCountMode(c.stat)) || (!countModeAvailable(c) && (c.stat==='relativeCount'||c.stat==='cumulativeCount'))))setConfig({...c,stat:'count'});},[c?.kind,c?.y,c?.stat]);
  const renderError=useCallback((error:string)=>setError(error),[]);
  const choose=(kind:PlotKind)=>{setError('');onChange({...state,draft:{...defaultConfig(kind,dataset.columns,state.staged),theme:resolvedTheme,background:resolvedTheme==='dark'?'#202223':'#ffffff'},activeId:undefined});};
  const selectDatum=(row:PlotDatum)=>{
    if(busy||staleResult||!c?.linkFilters)return;
    const dims=c.kind==='table'?[...c.tableRows,...c.tableColumns]:c.kind==='heatmap'||isPoints(c.kind)?[c.x,c.y]:[c.x];
    dims.forEach((id,i)=>{const col=dataset.columns.find(col=>col.id===id);if(!col||row[`d${i}`]===undefined||row[`d${i}`]===null)return;
      if(col.kind==='date'&&c.dateComponent){setNotice(t("Para filtrar fechas desde el gráfico, usa Fecha completa en la agrupación."));return;}
      const filter=filterFromDatum(col,row[`d${i}`],row[`d${i}End`],!!row[`d${i}EndInclusive`],!!row[`d${i}StartExclusive`]);if(filter)onFilter(id,filter);
    });
  };
  const brush=(range:number[])=>{if(busy||staleResult||!c?.linkFilters)return;onFilter(c.x,{column:c.x,kind:'numeric',min:Math.min(range[0],range[2]),max:Math.max(range[0],range[2])});onFilter(c.y,{column:c.y,kind:'numeric',min:Math.min(range[1],range[3]),max:Math.max(range[1],range[3])});};
  const active=state.saved.find(item=>item.id===state.activeId),changed=!!active&&JSON.stringify(active.config)!==JSON.stringify(c);
  const captureThumbnail=async()=>{
    if(!chart.current)return undefined;
    try{const svg=await chart.current.svg(),image=new Image();image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);await image.decode();const scale=Math.min(280/image.width,170/image.height);const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));canvas.getContext('2d')?.drawImage(image,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/png');}catch{return undefined;}
  };
  const save=async(asNew:boolean)=>{
    if(!c)return;
    if(asNew){setName(c.title||t(CHARTS.find(chart=>chart.kind===c.kind)?.label||'Gráfico'));setSaveDialog(true);return;}
    const thumbnail=await captureThumbnail();
    if(active)onChange({...state,saved:state.saved.map(plot=>plot.id===active.id?{...plot,config:structuredClone(c),savedAt:new Date().toISOString(),thumbnail}:plot)});
  };
  const saveNew=async()=>{
    if(!c||!name.trim())return;
    const config=structuredClone(c),thumbnail=await captureThumbnail();
    const plot={id:crypto.randomUUID(),name:name.trim(),config,savedAt:new Date().toISOString(),thumbnail};
    onChange({...state,saved:[...state.saved,plot],activeId:plot.id});setSaveDialog(false);
  };
  const exportChart=async(format:'svg'|'png'|'csv')=>{
    if(!c||!result)return;setExporting(true);setError('');
    try{
      let content:string;
      if(format==='csv'){
        const derivedCount=countModeAvailable(c) && (c.stat==='relativeCount'||c.stat==='cumulativeCount');
        const dimensionKey=(row:PlotDatum)=>JSON.stringify([row.d0,row.d0End,row.d1,row.d1End]);
        const derivedValues=derivedCount?new Map(chartRows(c,result,dataset.columns).map(row=>[dimensionKey(row),row.y])):null;
        const rows=result.rows.map(row=>{const output=Object.fromEntries(Object.entries(row).filter(([key])=>!key.endsWith("Inclusive")&&!key.endsWith("Exclusive")).map(([key,v])=>{
          const dim=/^d(\d+)(End)?$/.exec(key),measure=/^m(\d+)$/.exec(key);
          if(dim){const i=Number(dim[1]),id=isPoints(c.kind)?request?.pointColumns?.[i]:request?.dimensions[i]?.column;return[(dataset.columns.find(col=>col.id===id)?.name??key)+(dim[2]?t(" · Hasta"):''),v];}
          if(measure){const index=Number(measure[1]),m=request?.measures[index];return[`${t(STATISTICS.find(([id])=>id===m?.stat)?.[1]??key)}${m?.column?' · '+m.column:''} [${index+1}]`,v];}
          return[key,v];
        }));
          if(derivedValues){const value=derivedValues.get(dimensionKey(row));output[t(c.stat==='relativeCount'?'Recuento relativo (total)':'Suma acumulada')]=value===null||value===undefined?'':c.stat==='relativeCount'?`${value*100}%`:String(value);}
          return output;
        });
        content=csv(rows);
      }else {if(!chart.current)throw new Error(t("El gráfico todavía no está listo."));content=await chart.current[format]();}
      if(api.exportPlot){const path=await api.exportPlot({name:(c.title||active?.name||t("Gráfico")).slice(0,120),format,content,encoding:format==='png'?'base64':'utf8'});setNotice(path?t("Exportado: {value0}", {value0: path}):t("Exportación cancelada."));}
      else {const bytes=format==='png'?Uint8Array.from(atob(content),c=>c.charCodeAt(0)):content;const url=URL.createObjectURL(new Blob([bytes],{type:format==='svg'?'image/svg+xml':format==='png'?'image/png':'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`grafico.${format}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setNotice(t("Archivo exportado."));}
    }catch(error){setError(error instanceof Error?error.message:String(error));}finally{setExporting(false);}
  };
  const stagedColumns=state.staged.map(id=>dataset.columns.find(col=>col.id===id)).filter(Boolean),hasNumeric=stagedColumns.some(col=>col?.kind==='numeric'),hasDate=stagedColumns.some(col=>col?.kind==='date');
  const families=['bar','line','area','heatmap','box','scatter','table'];
  const categories=useMemo(()=>result&&c?[...new Set(result.rows.map(row=>display(row[isPoints(c.kind)?'d2':'d1'])))].filter(s=>s!==t("(Vacío)")):[],[result,c]);
  return <section className="dl-plots" aria-label={t("Gráficos")}><header className="dl-plots-toolbar"><div><strong>{t("Gráficos")}</strong>{c&&<><span>/</span><select aria-label={t("Tipo de gráfico")} value={c.kind} onChange={e=>setConfig({...c,kind:e.target.value as PlotKind})}>{CHARTS.map(chart=><option value={chart.kind} key={chart.kind}>{t(chart.label)}</option>)}</select></>}</div><div>{c&&<><button onClick={()=>onChange({...state,draft:null,activeId:undefined})}>{t("Galería")}</button><button onClick={()=>save(!active)}>{active?(changed?t("Actualizar guardado"):t("Guardado ✓")):t("Guardar gráfico")}</button>{active&&<button onClick={()=>save(true)}>{t("Guardar copia")}</button>}<details className="dl-plot-export"><summary>{t("Exportar")}</summary><div><button disabled={busy||staleResult||!result||exporting} onClick={()=>void exportChart('csv')}>{t("Datos CSV")}</button>{c.kind!=='table'&&<><button disabled={busy||staleResult||!result||exporting} onClick={()=>void exportChart('svg')}>{t("Imagen SVG")}</button><button disabled={busy||staleResult||!result||exporting} onClick={()=>void exportChart('png')}>{t("Imagen PNG")}</button></>}</div></details><button aria-pressed={settings} onClick={()=>setSettings(v=>!v)}>{t("Ajustes")}</button></>}</div></header>
    {c&&<AxisQuickControls config={c} columns={dataset.columns} onChange={setConfig}/>}
    {notice&&<div className="dl-plot-message" role="status"><span>{notice}</span><button aria-label={t("Cerrar aviso de gráficos")} onClick={()=>setNotice('')}>{t("×")}</button></div>}
    {error&&<div className="dl-plot-message dl-plot-error" role="alert"><span>{t(error)}</span><button onClick={()=>{setError('');setRetry(v=>v+1);}}>{t("Reintentar")}</button></div>}
    {saveDialog&&<form className="dl-plot-save-form" onSubmit={e=>{e.preventDefault();void saveNew();}}><label>{t("Nombre del gráfico")}<input autoFocus value={name} maxLength={120} onChange={e=>setName(e.target.value)}/></label><button type="submit">{t("Guardar")}</button><button type="button" onClick={()=>setSaveDialog(false)}>{t("Cancelar")}</button></form>}
    {!c?<div className="dl-plot-gallery"><div className="dl-plot-staging"><h2>{t("Selecciona variables para analizar")}</h2><div>{[...state.staged,''].map((id,index)=><label key={index}><span className="dl-visually-hidden">{t("Variable ")}{index+1}{t(" del gráfico")}</span><VariablePicker label={t("Variable ")+(index+1)} columns={dataset.columns.filter(col=>!state.staged.includes(col.id)||col.id===id)} value={id} placeholder={index?t("Añadir variable…"):t("Selecciona una variable…")} onChange={value=>onChange({...state,staged:[...state.staged.slice(0,index),value,...state.staged.slice(index+1)].filter(Boolean)})}/>{id&&<button aria-label={t("Quitar {value0}", {value0: id})} onClick={()=>onChange({...state,staged:state.staged.filter(value=>value!==id)})}>{t("×")}</button>}</label>)}</div><p>{state.staged.length?t("Elige un gráfico para estas variables."):t("O elige un tipo de gráfico para empezar.")}</p></div>
      <div className="dl-plot-gallery-grid">{families.map(family=>{const choices=CHARTS.filter(chart=>chart.family===family),first=choices[0],recommended=state.staged.length>0&&(family==='scatter'?stagedColumns.filter(c=>c?.kind==='numeric').length>=2:family==='line'||family==='area'?hasDate:family==='box'?hasNumeric:family==='bar');return <article className="dl-plot-gallery-card" key={family}><button className="dl-plot-gallery-primary" onClick={()=>choose(first.kind)}><ChartIcon family={family}/><strong>{t(first.label)}</strong><span>{t(first.description)}</span>{recommended&&<small>{t("Recomendado")}</small>}</button>{choices.length>1&&<details><summary>{choices.length-1}{t(" variantes")}</summary>{choices.slice(1).map(chart=><button key={chart.kind} onClick={()=>choose(chart.kind)}>{t(chart.label)}</button>)}</details>}</article>;})}</div>
      {state.saved.length>0&&<section className="dl-plot-saved"><h2>{t("Gráficos guardados ")}<small>{state.saved.length}</small></h2><div>{state.saved.map(plot=><article key={plot.id}><button className="dl-plot-saved-open" onClick={()=>onChange({...state,draft:structuredClone(plot.config),activeId:plot.id})}>{plot.thumbnail?.startsWith('data:image/png;base64,')?<img src={plot.thumbnail} alt={plot.name}/>:<ChartIcon family={CHARTS.find(chart=>chart.kind===plot.config.kind)?.family??'bar'}/>}<strong>{plot.name}</strong><small>{t(CHARTS.find(chart=>chart.kind===plot.config.kind)?.label??'')}</small></button><label><span className="dl-visually-hidden">{t("Nombre de ")}{plot.name}</span><input aria-label={t("Renombrar {value0}", {value0: plot.name})} value={plot.name} maxLength={120} onChange={e=>onChange({...state,saved:state.saved.map(item=>item.id===plot.id?{...item,name:e.target.value}:item)})}/></label><button onClick={()=>{const copy={...structuredClone(plot),id:crypto.randomUUID(),name:plot.name+t(" · copia")};onChange({...state,saved:[...state.saved,copy]});}}>{t("Duplicar")}</button><button onClick={()=>{setDeleted(plot);onChange({...state,saved:state.saved.filter(item=>item.id!==plot.id)});}}>{t("Eliminar")}</button></article>)}</div></section>}{deleted&&<div className="dl-plot-message">{t("Gráfico eliminado. ")}<button onClick={()=>{onChange({...state,saved:[...state.saved,deleted]});setDeleted(null);}}>{t("Deshacer")}</button></div>}
    </div>:<div className={`dl-plot-editor${settings?'':" dl-plot-editor-wide"}`}><div className="dl-plot-canvas-region" aria-busy={busy} data-stale={staleResult||undefined}>{result&&(busy||staleResult)&&<div className="dl-plot-update-status" role="status">{busy?t("Actualizando…"):(getUiSnapshot().language==='en'?'Previous results':'Resultados anteriores')}</div>}{validation?<div className="dl-plot-empty"><ChartIcon family={CHARTS.find(chart=>chart.kind===c.kind)?.family??'bar'}/><h2>{t("Configura las variables")}</h2><p>{t(validation)}</p></div>:busy&&!result?<div className="dl-plot-empty" role="status"><span className="dl-plot-spinner"/><p>{t("Calculando el gráfico…")}</p></div>:result?result.rows.length===0?<div className="dl-plot-empty"><h2>{t("No hay datos para estos filtros")}</h2><p>{t("Ajusta los filtros o incluye los grupos vacíos.")}</p></div>:<>{c.kind==='table'?<PivotTable config={c} result={result} columns={dataset.columns} totals={totals} onPick={selectDatum}/>:<PlotResize width={c.width} height={c.height} onResize={size=>setConfig({...c,...size})}><PlotRenderer ref={chart} config={c} result={result} columns={dataset.columns} onPick={selectDatum as (row:Datum)=>void} onBrush={brush} onError={renderError}/></PlotResize>}
      <div className="dl-plot-result-info"><span>{result.plottedRows.toLocaleString(getUiSnapshot().locale)}{t(" de ")}{result.matchedRows.toLocaleString(getUiSnapshot().locale)}{t(" filas filtradas utilizadas")}</span><span>{result.rows.length.toLocaleString(getUiSnapshot().locale)} {isPoints(c.kind)?t('puntos'):t('grupos')}{result.truncated?t(" · límite alcanzado"):''}</span>{isPoints(c.kind)&&c.correlation&&result.statistics&&<span>{t("Pearson r = ")}{result.statistics.correlation?.toFixed(4)??t("no definido")}{t(" · R² = ")}{result.statistics.rSquared?.toFixed(4)??t("no definido")}</span>}</div>
      {result.truncated&&<p className="dl-plot-warning">{result.selectionMethod==='firstRows'?t("Se muestran los primeros 10.000 pares válidos en el orden del archivo. La correlación y la regresión usan todos los pares válidos filtrados."):t("Se muestran los primeros 5.000 grupos según el orden elegido. Reduce los intervalos o aplica filtros para verlos todos.")}</p>}{(c.xAxis.log||c.yAxis.log)&&<p className="dl-plot-warning">{t("La escala logarítmica omite los valores no positivos.")}</p>}{c.showTotals&&c.kind!=='table'&&<p className="dl-plot-result-info">{t("Total de filas representadas: ")}{result.plottedRows.toLocaleString(getUiSnapshot().locale)}</p>}
      {c.linkFilters&&<p className="dl-plot-hint">{t("Pulsa una marca para filtrar")}{isPoints(c.kind)?t(" · Mayúsculas + arrastrar para seleccionar un área"):''}.</p>}</>:null}</div>{settings&&<PlotSettings config={c} columns={dataset.columns} categories={categories} onChange={setConfig}/>}</div>}
  </section>;
}
