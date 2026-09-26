import type { Spec } from 'vega';
import { countModeAvailable, hasColor, isArea, isLine, isPoints } from './model';
import { display, label, number, type Datum } from './series';
import { categoryLabelSignal, customBinLabelSignal, isPresetNumberFormat, numericBinLabels } from './axis-labels';
import type { AxisOptions, Column, PlotConfig, PlotResult } from './types';
import { getUiSnapshot, t } from '../../ui';

type ObjectSpec = Record<string, unknown>;
const value = (v: unknown) => ({value:v});
export function buildSpec(c: PlotConfig, rows: Datum[], columns: Column[], result: Pick<PlotResult, 'statistics'>, width: number, height: number): Spec {
  const points=isPoints(c.kind), heat=c.kind==='heatmap', box=c.kind==='box', area=isArea(c.kind), line=isLine(c.kind);
  const spanish=getUiSnapshot().language==='es';
  const continuous=points || ((line||area) && (typeof rows[0]?.x==='number'));
  const date=columns.find(col=>col.id===c.x)?.kind==='date' && !c.dateComponent;
  const dateY=heat&&columns.find(col=>col.id===c.y)?.kind==='date';
  const numericX=columns.find(col=>col.id===c.x)?.kind==='numeric';
  const binLabelMode=c.xAxis.binLabel??'end';
  const binLabels=numericX&&!continuous?numericBinLabels(rows,c.xAxis.format,getUiSnapshot().locale,binLabelMode):new Map<string,string>();
  const binLabelText=isPresetNumberFormat(c.xAxis.format)?categoryLabelSignal(binLabels):customBinLabelSignal(rows,c.xAxis.format,binLabelMode);
  const dateFormat=(name:'x'|'y',options:AxisOptions)=>options.format.startsWith('%')?options.format:name==='x'&&c.interval==='hour'?'%d/%m %H:%M':name==='x'&&(c.interval==='day'||c.interval==='week')?'%d/%m/%y':name==='x'&&c.interval==='year'?'%Y':'%b %Y';
  const dark=c.theme==='dark', ink=dark?'#e6e5e3':'#494744', grid=dark?'#ffffff16':'#00000010', gridLine=dark?'#ffffff1a':'#00000014';
  const horizontal=c.horizontal && !points && !heat && !line && !area;
  const stacked=/stacked|percent/.test(c.kind), percent=c.kind.startsWith('percent') && !(countModeAvailable(c) && c.stat!=='count');
  const relativeCount=countModeAvailable(c)&&c.stat==='relativeCount';
  const cumulativeCount=countModeAvailable(c)&&c.stat==='cumulativeCount';
  const colorMapping=hasColor(c.kind)||c.kind==='multipleLine'||c.kind==='seasonal';
  const numericColor=points && !!c.color && columns.find(col=>col.id===c.color)?.kind==='numeric';
  const visible=rows.filter(d=>(!points || (number(d.x)!==null && d.y!==null)) && (!c.xAxis.log || Number(d.x)>0) && (!c.yAxis.log || (d.y??0)>0));
  // Exact numeric values can create thousands of subpixel bars. Their per-value grid
  // lines become a solid overlay, so let the bars form a softer density silhouette.
  const denseExactBars=numericX && c.xBinning==='exact' && !points && !heat && !box && !line && !area
    && new Set(visible.map(row=>row.category)).size > (horizontal?height:width)/3;
  if(percent && rows.some(d=>(d.y??0)<0)) throw new Error('Las proporciones apiladas necesitan medidas no negativas.');
  const named=(id:string)=>columns.find(col=>col.id===id)?.name??id;
  const values=visible.map((d,plotOrder)=>({...d,plotOrder,category:date?String(d.x):d.category,colorValue:numericColor?number(d.d2):d.series,customColor:Object.hasOwn(c.categoryColors,d.series)?c.categoryColors[d.series]:null,
    heatY:dateY?String(Date.parse(String(d.d1).replace(' ','T')+'Z')):label(d.d1,d.d1End),tooltip:{[named(c.x)]:display(d.d0), ...(d.d0End!==null&&d.d0End!==undefined?{[t('Hasta')]:display(d.d0End)}:{}),
      ...(points?{[named(c.y)]:display(d.d1),...(c.color?{[named(c.color)]:display(d.d2)}:{}),...(c.kind.toLowerCase().includes('bubble')?{[named(c.size)]:display(d.d3)}:{}),...Object.fromEntries(c.tooltipColumns.map((id,i)=>[named(id),display(d[`d${i+4}`])])), [t('Fila')]:display(d.id)}:
        box?{'P25':display(d.m0),[t('Mediana')]:display(d.m1),'P75':display(d.m2),[t('Mínimo')]:display(d.m3),[t('Máximo')]:display(d.m4),[t('Media')]:display(d.m5),[t('Desviación')]:display(d.m6)}:
        {[relativeCount?t('Recuento relativo (total)'):cumulativeCount?t('Suma acumulada'):t('Valor')]:relativeCount ? (d.y??0).toLocaleString(getUiSnapshot().locale,{style:'percent',maximumFractionDigits:1}) : cumulativeCount ? (d.y??0).toLocaleString(getUiSnapshot().locale) : c.kind==='multipleLine'?String(d.y??''):display(d.m0),...(heat?{[named(c.y)]:display(d.d1)}:{}),...(d.series?{[t('Serie')]:d.series}:{}),[t('Filas')]:String(d.count)})},
    labelValue:d.y===null?'':d.y,
  }));
  const domain=(fields:string[])=>({data:'values',fields});
  const axisScale=(name:string,options:AxisOptions,scaleDomain:unknown,range:unknown):ObjectSpec=>({name,type:options.log?'log':'linear',domain:scaleDomain,range,nice:options.min===undefined&&options.max===undefined,zero:options.log?false:options.zero,...(options.min!==undefined?{domainMin:options.min}:{}),...(options.max!==undefined?{domainMax:options.max}:{})});
  const scales:ObjectSpec[]=[];
  const orderedDomain=(field:string)=>({data:'values',field,sort:{op:'min',field:'plotOrder'}});
  scales.push(continuous?{...axisScale('x',c.xAxis,{data:'values',field:'x'},'width'),...(date&&!c.xAxis.log?{type:'utc'}:{})}:{name:'x',type:'band',domain:orderedDomain('category'),range:horizontal?'height':'width',paddingInner:denseExactBars?0:c.innerPadding,paddingOuter:denseExactBars?0:c.outerPadding});
  const heatTotals=new Map<string,number>();values.forEach(d=>heatTotals.set(d.heatY,(heatTotals.get(d.heatY)??0)+(c.sortY==='count'?d.count:d.y??0)));
  const heatOrder=[...heatTotals.keys()].sort((a,b)=>(c.sortY==='natural'?a.localeCompare(b,'es',{numeric:true}):(heatTotals.get(a)??0)-(heatTotals.get(b)??0))*(c.descendingY?-1:1));
  scales.push(heat?{name:'y',type:'band',domain:heatOrder,range:'height',padding:.025}:axisScale('y',c.yAxis,box?domain(['low','high','q1','q3']):stacked?domain(['y0','y1']):domain(['y']),horizontal?'width':'height'));
  const colorDomain=heat?{data:'values',field:'y'}:numericColor?{data:'values',field:'colorValue'}:orderedDomain('series');
  const scheme=heat&&['tableau10','category10'].includes(c.palette)?'blues':c.palette;
  scales.push({name:'color',type:heat||numericColor?'linear':'ordinal',domain:colorDomain,range:{scheme},reverse:c.reversePalette,zero:false});
  scales.push({name:'size',type:'sqrt',domain:{data:'values',field:'size'},range:[c.pointMin*c.pointMin,c.pointMax*c.pointMax],zero:true});
  if(c.kind==='groupedBar')scales.push({name:'seriesBand',type:'band',domain:orderedDomain('series'),range:[0,{signal:"bandwidth('x')"}],padding:.07});
  const axis=(name:'x'|'y',options:AxisOptions,title:string):ObjectSpec=>({scale:name,orient:horizontal?(name==='x'?'left':'bottom'):(name==='x'?'bottom':'left'),grid:options.grid && !(name==='x'&&denseExactBars),ticks:!(name==='x'&&denseExactBars),gridColor:gridLine,title:options.showTitle?(options.title||title):null,labelColor:ink,titleColor:ink,domainColor:grid,tickColor:grid,labelFont:'-apple-system',titleFont:'-apple-system',titleFontWeight:500,labelLimit:options.labelWidth,labelAngle:options.rotation,tickCount:options.ticks,labelOverlap:'greedy',labelSeparation:options.labelSeparation??6,labelBound:true,
    ...(name==='x'&&binLabels.size&&binLabelMode!=='range'?{bandPosition:binLabelMode==='start'?0:1}:{}),
    ...(name==='x'&&!continuous||name==='y'&&heat?{}:{format:name==='x'&&date?dateFormat(name,options):name==='y'&&(percent||relativeCount)?'.0%':options.format==='auto'?'~s':options.format.startsWith('%')?'~s':options.format}),
    ...((name==='x'&&date&&!continuous)||(name==='y'&&dateY)?{encode:{labels:{update:{text:{signal:`utcFormat(toNumber(datum.value),${JSON.stringify(dateFormat(name,options))})`}}}}}:name==='x'&&binLabels.size?{encode:{labels:{update:{text:{signal:binLabelText},...(binLabelMode!=='range'?{[horizontal?'y':'x']:{scale:'x',field:'value',band:binLabelMode==='start'?0:1}}:{})}}}}:name==='x'&&numericX&&!continuous?{encode:{labels:{update:{text:{signal:`isValid(toNumber(datum.value)) ? format(toNumber(datum.value), ${JSON.stringify(options.format==='auto'?'~s':options.format)}) : datum.value`}}}}}:{}),
    ...(options.customTicks.trim()?{values:options.customTicks.split(',').map(Number).filter(Number.isFinite)}:{}),
  });
  const axes=[axis('x',c.xAxis,named(c.x)),axis('y',c.yAxis,heat?named(c.y):relativeCount?t('Recuento relativo (total)'):cumulativeCount?t('Suma acumulada'):percent?t('Proporción'):c.y?named(c.y):t('Filas'))];
  const fill=colorMapping||heat?{signal:heat?"scale('color',datum.y)":"datum.customColor || scale('color',datum.colorValue)"}:value(c.singleColor);
  const xPosition=continuous?{scale:'x',field:'x'}:{scale:'x',field:'category',band:.5};
  const encodeBase:ObjectSpec={fill,opacity:value(denseExactBars?Math.min(c.opacity,.75):c.opacity),...(c.tooltip?{tooltip:{signal:'datum.tooltip'}}:{})};
  const marks:ObjectSpec[]=[];
  if(points){
    marks.push({name:'plotMarks',type:'symbol',from:{data:'values'},encode:{update:{...encodeBase,x:xPosition,y:{scale:'y',field:'y'},size:c.kind.toLowerCase().includes('bubble')?{scale:'size',field:'size'}:value(c.pointMin*c.pointMin),stroke:value(c.background),strokeWidth:value(.4)}}});
    if(c.regression && result.statistics?.slope!==null && result.statistics?.slope!==undefined && result.statistics.intercept!==null && result.statistics.intercept!==undefined){
      const extent=visible.map(d=>Number(d.x));const min=Math.min(...extent),max=Math.max(...extent),m=result.statistics.slope,b=result.statistics.intercept;
      if(Number.isFinite(min)&&Number.isFinite(max)) marks.push({type:'rule',encode:{update:{x:{scale:'x',value:min},x2:{scale:'x',value:max},y:{scale:'y',value:m*min+b},y2:{scale:'y',value:m*max+b},stroke:value(ink),strokeWidth:value(1.5),strokeDash:value([5,4])}}});
    }
  }else if(heat){
    marks.push({name:'plotMarks',type:'rect',from:{data:'values'},encode:{update:{...encodeBase,x:{scale:'x',field:'category'},width:{scale:'x',band:1},y:{scale:'y',field:'heatY'},height:{scale:'y',band:1},cornerRadius:value(2)}}});
  }else if(box){
    const position=horizontal?'y':'x',measure=horizontal?'x':'y',end=horizontal?'x2':'y2',breadth=horizontal?'height':'width';
    if(c.boxStyle!=='quartiles') marks.push({type:'rule',from:{data:'values'},encode:{update:{[position]:xPosition,[measure]:{scale:'y',field:'low'},[end]:{scale:'y',field:'high'},stroke:fill,strokeWidth:value(1.5)}}});
    marks.push({name:'plotMarks',type:'rect',from:{data:'values'},encode:{update:{...encodeBase,[position]:{scale:'x',field:'category',band:.2},[breadth]:{scale:'x',band:.6},[measure]:{scale:'y',field:'q3'},[end]:{scale:'y',field:'q1'},fillOpacity:value(.45),stroke:fill}}});
    marks.push({type:'rule',from:{data:'values'},encode:{update:{[position]:{scale:'x',field:'category',band:.2},[horizontal?'y2':'x2']:{scale:'x',field:'category',band:.8},[measure]:{scale:'y',field:'median'},stroke:fill,strokeWidth:value(2.5)}}});
  }else if(line||area){
    const seriesMark:ObjectSpec={type:area?'area':'line',from:{data:'series'},sort:{field:'datum.x'},encode:{update:{x:xPosition,y:{scale:'y',field:stacked?'y1':'y'},...(area?{y2:stacked?{scale:'y',field:'y0'}:{scale:'y',value:0},fill,fillOpacity:value(c.opacity*.6)}:{stroke:fill,strokeWidth:value(c.lineWidth),strokeDash:value(c.dashed?[6,4]:[])}),interpolate:value(c.interpolation),defined:{signal:'isValid(datum.y)'},...(c.tooltip?{tooltip:{signal:'datum.tooltip'}}:{})}}};
    marks.push({type:'group',from:{facet:{name:'series',data:'values',groupby:'series'}},marks:[seriesMark]});
    if(c.markers||c.tooltip||c.linkFilters) marks.push({name:'plotMarks',type:'symbol',from:{data:'validPoints'},encode:{update:{...encodeBase,x:xPosition,y:{scale:'y',field:stacked?'y1':'y'},size:value(c.markers?24:50),opacity:value(c.markers?c.opacity:0)}}});
  }else{
    const position=horizontal?'y':'x',measure=horizontal?'x':'y',end=horizontal?'x2':'y2',breadth=horizontal?'height':'width';
    const grouped=c.kind==='groupedBar';
    marks.push({name:'plotMarks',type:'rect',from:{data:'values'},encode:{update:{...encodeBase,[position]:grouped?{signal:"scale('x',datum.category)+scale('seriesBand',datum.series)"}:{scale:'x',field:'category'},[breadth]:grouped?{signal:"bandwidth('seriesBand')"}:{scale:'x',band:1},[measure]:{scale:'y',field:stacked?'y1':'y'},[end]:stacked?{scale:'y',field:'y0'}:{scale:'y',value:c.yAxis.log?Math.max(Number(c.yAxis.min)||.001,Math.min(...visible.map(d=>d.y??Infinity))):0},cornerRadius:value(stacked?0:2)}}});
  }
  if(c.labels){
    const format=percent||relativeCount?'.1%':c.numberFormat;
    const text=`format(datum.${box?'median':'y'},${JSON.stringify(format)})${c.showCount?" + ' (n=' + datum.count + ')'":''}${c.showChange?" + (isValid(datum.change) ? ' / ' + format(datum.change, '+.1%') : '')":''}`;
    marks.push({type:'text',from:{data:'values'},encode:{update:{text:{signal:`isValid(datum.${box?'median':'y'}) ? ${text} : ''`},x:horizontal?{scale:'y',field:box?'median':stacked?'y1':'y'}:xPosition,y:horizontal?xPosition:heat?{scale:'y',field:'heatY',band:.5}:{scale:'y',field:box?'median':stacked?'y1':'y'},dy:value(horizontal||heat?0:c.labelPosition==='inside'?12:-8),dx:value(horizontal?6:0),align:value(horizontal?'left':c.labelAlign),baseline:value(heat?'middle':'bottom'),fill:value(ink),fontSize:value(10)}}});
  }
  for(const annotation of c.annotations){
    if(annotation.kind==='text')marks.push({type:'text',encode:{update:{x:{signal:`width*${annotation.x}`},y:{signal:`height*${annotation.y}`},text:value(annotation.label),fill:value(annotation.color),fontSize:value(12),align:value('left')}}});
    else {
      const a=annotation.kind,other=a==='x'?'y':'x';
      marks.push({type:annotation.end!==undefined?'rect':'rule',encode:{update:{[a]:{scale:a,value:annotation.value},...(annotation.end!==undefined?{[`${a}2`]:{scale:a,value:annotation.end},fill:value(annotation.color),fillOpacity:value(.12)}:{stroke:value(annotation.color),strokeDash:value([4,3])}),[other]:value(0),[`${other}2`]:{signal:other==='x'?'width':'height'}}}});
      if(annotation.label)marks.push({type:'text',encode:{update:{[a]:{scale:a,value:annotation.value},[other]:value(6),text:value(annotation.label),fill:value(annotation.color),fontSize:value(11),align:value('left'),dx:value(4),dy:value(-4)}}});
    }
  }
  const signals:ObjectSpec[]=[];
  if(points&&c.linkFilters){
    signals.push({name:'brush',value:null,on:[{events:'mousedown[event.shiftKey]',update:'[clamp(x(),0,width), clamp(y(),0,height), clamp(x(),0,width), clamp(y(),0,height)]'},{events:'[mousedown[event.shiftKey], window:mouseup] > window:mousemove!',update:'brush ? [brush[0],brush[1],clamp(x(),0,width),clamp(y(),0,height)] : null'}]},
      {name:'brushDone',value:null,on:[{events:'window:mouseup',update:"brush && abs(brush[0]-brush[2])>4 && abs(brush[1]-brush[3])>4 ? [invert('x',brush[0]),invert('y',brush[1]),invert('x',brush[2]),invert('y',brush[3])] : null"}]});
    marks.push({type:'rect',interactive:false,encode:{update:{x:{signal:'brush ? min(brush[0],brush[2]) : 0'},x2:{signal:'brush ? max(brush[0],brush[2]) : 0'},y:{signal:'brush ? min(brush[1],brush[3]) : 0'},y2:{signal:'brush ? max(brush[1],brush[3]) : 0'},fill:value(c.singleColor),fillOpacity:value(.1),stroke:value(c.singleColor)}}});
  }
  return {width,height,padding:10,autosize:{type:'fit',contains:'padding'},background:c.background,signals,
    data:[{name:'values',values:c.missing==='connect'?values.filter(d=>d.y!==null):values},...(line||area?[{name:'validPoints',source:'values',transform:[{type:'filter',expr:'isValid(datum.y)'}]}]:[])],scales,axes,marks,
    ...(c.legend&&(colorMapping||heat)?{legends:[{fill:'color',title:heat?t('Valor'):named(c.color)||t('Serie'),labelColor:ink,titleColor:ink,orient:'bottom',direction:'horizontal',symbolType:'circle'}]}:{}),
    config:{locale:{number:{decimal:spanish?',':'.',thousands:spanish?'.':',',grouping:[3],currency:['',' €']},...(spanish?{time:{dateTime:'%A, %e de %B de %Y, %X',date:'%d/%m/%Y',time:'%H:%M:%S',periods:['AM','PM'],days:['domingo','lunes','martes','miércoles','jueves','viernes','sábado'],shortDays:['dom','lun','mar','mié','jue','vie','sáb'],months:['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'],shortMonths:['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']}}:{})},axis:{labelFontSize:10,titleFontSize:11,titlePadding:14},legend:{labelFontSize:10,titleFontSize:11}},
  } as unknown as Spec;
}
