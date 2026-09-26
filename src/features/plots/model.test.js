import {test,expect} from 'bun:test';
import {parse,View} from 'vega';
import {CHARTS,defaultConfig,buildQuery,filterFromDatum,csv,changeAxisVariable,swappedAxes,statisticOptions,configError} from './model';
import {chartRows,decompose,regularize} from './series';
import {buildSpec} from './spec';
import {numericBinLabels,customBinLabelSignal} from './axis-labels';
import {composeSvg} from './svg-export';
import {t,getUiSnapshot} from '../../ui';
const columns=[{id:'city',name:'City',kind:'categorical',dataType:'VARCHAR'},{id:'x',name:'X',kind:'numeric',dataType:'DOUBLE'},{id:'y',name:'Y',kind:'numeric',dataType:'DOUBLE'},{id:'segment',name:'Segment',kind:'categorical',dataType:'VARCHAR'},{id:'date',name:'Date',kind:'date',dataType:'TIMESTAMP'}];
const dataset={id:'test',name:'fixture',sourcePath:'fixture.csv',columns,rowCount:20,revision:'r1'};
const response=(rows)=>({rows,matchedRows:20,totalRows:20,plottedRows:20,truncated:false,datasetRevision:'r1',selectionMethod:'allGroups',statistics:{correlation:1,slope:2,intercept:0,rSquared:1}});
test('row count offers only count, relative count and cumulative sum and computes both views',()=>{
  const base={...defaultConfig('bar',columns),x:'city',y:'',xBinning:'exact'};
  expect(statisticOptions(base).map(([id])=>id)).toEqual(['count','relativeCount','cumulativeCount']);
  expect(statisticOptions(changeAxisVariable(base,columns,'y','x')).some(([id])=>id==='mean')).toBe(true);
  const result={...response([{d0:'B',m0:'1',m1:'1'},{d0:'A',m0:'3',m1:'3'}]),plottedRows:4};
  const relative={...base,stat:'relativeCount'};
  expect(configError(relative,columns)).toBeNull();
  expect(buildQuery(relative,dataset,[]).measures[0].stat).toBe('count');
  expect(chartRows(relative,result,columns).map(row=>row.y)).toEqual([.75,.25]);
  const relativeSpec=buildSpec(relative,chartRows(relative,result,columns),columns,result,600,400);
  expect(relativeSpec.axes[1].format).toBe('.0%');
  expect(Object.values(relativeSpec.data[0].values[0].tooltip).some(value=>String(value).includes('75'))).toBe(true);
  const cumulative={...base,stat:'cumulativeCount'};
  expect(chartRows(cumulative,result,columns).map(row=>row.y)).toEqual([3,4]);
  expect(buildQuery(cumulative,dataset,[]).measures[0].stat).toBe('count');
  expect(changeAxisVariable(relative,columns,'y','x').stat).toBe('mean');
  expect(changeAxisVariable(cumulative,columns,'y','').stat).toBe('count');
  const percentVariant={...relative,kind:'percentBar',color:'segment'};
  expect(statisticOptions(percentVariant).map(([id])=>id)).toEqual(['count','relativeCount','cumulativeCount']);
  expect(chartRows(percentVariant,result,columns).map(row=>row.y)).toEqual([.75,.25]);
});
test('quick axis changes keep query settings valid and swaps preserve dimension options',()=>{
  const bar=defaultConfig('bar',columns);
  const withX=changeAxisVariable(bar,columns,'x','x');
  expect(withX.xBinning).toBe('width');
  const withY=changeAxisVariable(withX,columns,'y','y');
  expect(withY.stat).toBe('mean');
  const configured={...withY,bins:10,binsY:50,xBinning:'quantile',yBinning:'width'};
  const swapped=swappedAxes(configured,columns);
  expect(swapped && [swapped.x,swapped.y,swapped.bins,swapped.binsY,swapped.xBinning,swapped.yBinning]).toEqual(['y','x',50,10,'width','quantile']);
  expect(buildQuery(swapped,dataset,[]).dimensions[0].column).toBe('y');
  expect(buildQuery(swapped,dataset,[]).measures[0].column).toBe('x');
  expect(swappedAxes(changeAxisVariable(withY,columns,'x','city'),columns)).toBeNull();
  expect(swappedAxes(changeAxisVariable(withY,columns,'y',''),columns)).toBeNull();
});
test('all twenty chart definitions compile and run with native-shaped data',async()=>{
  expect(CHARTS).toHaveLength(20);
  for(const {kind} of CHARTS){
    if(kind==='table')continue;
    const c={...defaultConfig(kind,columns),x:'x',y:'y',color:'segment',size:'y',multipleY:['x','y'],stat:'mean',labels:true,regression:true};
    const r=response(Array.from({length:8},(_,i)=>({id:String(i),d0:i+1,d1:kind.includes('scatter')||kind.includes('Scatter')||kind.includes('bubble')||kind.includes('Bubble')?String((i+1)*2):i%2?'A':'B',d2:i%2?'A':'B',d3:String(i+1),m0:String(i+1),m1:String(i+2),m2:String(i+3),m3:'0',m4:'12',m5:'5',m6:'1',m7:'4'})));
    const spec=buildSpec(c,chartRows(c,r,columns),columns,r,700,400);
    const view=new View(parse(spec),{renderer:'none'}),errors=[];
    view.logger({level:()=>3,error:(...error)=>errors.push(error),warn:()=>{},info:()=>{},debug:()=>{}});
    try{await view.runAsync();expect(errors).toEqual([]);expect(view.data('values').length).toBeGreaterThan(0);}finally{view.finalize();}
  }
});
test('date formats render in band and continuous axes without numeric-format errors',async()=>{
  for(const kind of ['bar','line','area','heatmap']){
    const c={...defaultConfig(kind,columns),x:'date',y:kind==='heatmap'?'date':'',xAxis:{...defaultConfig(kind,columns).xAxis,format:'%d/%m/%Y'}};
    const r=response([{d0:'2025-01-01 00:00:00',d0End:'2025-02-01 00:00:00',d1:'2025-01-01 00:00:00',m0:'10',m1:'10'}]);
    const view=new View(parse(buildSpec(c,chartRows(c,r,columns),columns,r,700,430)),{renderer:'none'}),errors=[];
    view.logger({level:()=>3,error:(...error)=>errors.push(error),warn:()=>{},info:()=>{},debug:()=>{}});
    await view.runAsync();expect(errors).toEqual([]);expect(await view.toSVG()).toContain('01/01/2025');view.finalize();
  }
});
test('numeric bin axes abbreviate by default and honor a manual format without changing filter bounds',async()=>{
  const initial=defaultConfig('bar',columns);
  const c={...initial,x:'x',bins:16,xAxis:{...initial.xAxis,binLabel:'range'}};
  const r=response(Array.from({length:16},(_,i)=>({d0:104100+i*14510,d0End:104100+(i+1)*14510,m0:String(i+1),m1:String(i+1)})));
  const rows=chartRows(c,r,columns);
  const labels=numericBinLabels(rows,c.xAxis.format,'en-US');
  expect(labels.get(rows[0].category)).toBe('104k–119k');
  expect(rows[0].d0).toBe(104100);
  expect(rows[0].d0End).toBe(118610);
  const spec=buildSpec(c,rows,columns,r,550,430);
  expect(spec.axes[0].labelOverlap).toBe('greedy');
  expect(spec.axes[0].labelSeparation).toBe(6);
  const view=new View(parse(spec),{renderer:'none'});
  await view.runAsync();
  const svg=await view.toSVG();
  expect(svg).toContain('104k–119k');
  const xLabels=svg.match(/<g class="mark-text role-axis-label"[^>]*>(.*?)<\/g>/s)?.[1]??'';
  const visibleLabels=xLabels.match(/<text[^>]*opacity="1"/g)??[];
  expect(visibleLabels.length).toBeGreaterThan(0);
  expect(visibleLabels.length).toBeLessThan(16);
  view.finalize();
  const manual={...c,xAxis:{...c.xAxis,format:',.0f',rotation:-45,labelSeparation:12}};
  const formatted=numericBinLabels(rows,manual.xAxis.format,'en-US');
  expect(formatted.get(rows[0].category)).toBe('104,100–118,610');
  const manualSpec=buildSpec(manual,rows,columns,r,550,430);
  expect(manualSpec.axes[0].labelSeparation).toBe(12);
  expect(manualSpec.axes[0].labelAngle).toBe(-45);
  expect(manualSpec.axes[0].encode.labels.update.text.signal).toContain('104.100–118.610');
  const manualView=new View(parse(manualSpec),{renderer:'none'});
  await manualView.runAsync();
  expect(await manualView.toSVG()).toContain('role-axis-label');
  manualView.finalize();
  const custom={...c,xAxis:{...c.xAxis,format:',.3f'}};
  const customSpec=buildSpec(custom,rows,columns,r,550,430);
  expect(customSpec.axes[0].encode.labels.update.text.signal).toContain('format(104100, ",.3f")');
  const customView=new View(parse(customSpec),{renderer:'none'});
  await customView.runAsync();
  expect(await customView.toSVG()).toContain('104.100,000–…');
  customView.finalize();
  const missing=response([{d0:null,d0End:null,m0:'1',m1:'1'}]);
  const missingView=new View(parse(buildSpec(c,chartRows(c,missing,columns),columns,missing,550,430)),{renderer:'none'});
  await missingView.runAsync();
  expect(await missingView.toSVG()).toContain(t('(Vacío)'));
  missingView.finalize();
});
test('numeric bin axis can label the start or end at the corresponding bar edge',async()=>{
  const base={...defaultConfig('bar',columns),x:'x',bins:2};
  expect(base.xAxis.binLabel).toBe('end');
  expect(base.opacity).toBe(1);
  const r=response([{d0:0,d0End:800000,m0:'3',m1:'3'},{d0:800000,d0End:1600000,m0:'1',m1:'1'}]);
  const rows=chartRows(base,r,columns);
  for(const [mode,first,last,position] of [['start','0M','0.8M',0],['end','0.8M','1.6M',1]]){
    const c={...base,xAxis:{...base.xAxis,binLabel:mode}};
    const labels=numericBinLabels(rows,'auto','en-US',mode);
    expect(labels.get(rows[0].category)).toBe(first);
    expect(labels.get(rows[1].category)).toBe(last);
    const spec=buildSpec(c,rows,columns,r,600,400);
    const displayed=numericBinLabels(rows,'auto',getUiSnapshot().locale,mode).get(rows[0].category);
    expect(spec.axes[0].bandPosition).toBe(position);
    expect(spec.axes[0].encode.labels.update.x.band).toBe(position);
    expect(spec.axes[0].encode.labels.update.text.signal).toContain(displayed);
    const view=new View(parse(spec),{renderer:'none'});
    await view.runAsync();
    expect(await view.toSVG()).toContain(displayed);
    view.finalize();
    expect(buildQuery(c,dataset,[])).toEqual(buildQuery(base,dataset,[]));
  }
  expect(customBinLabelSignal(rows,',.0f','start')).not.toContain(" + '–' + ");
  expect(customBinLabelSignal(rows,',.0f','end')).toContain('1600000');
  const defaultSpec=buildSpec(base,rows,columns,r,600,400);
  expect(defaultSpec.axes[0].bandPosition).toBe(1);
  expect(defaultSpec.axes[0].gridColor).toBe('#00000014');
  expect(defaultSpec.marks.find(mark=>mark.name==='plotMarks').encode.update.opacity.value).toBe(1);
  expect(buildSpec({...base,theme:'dark'},rows,columns,r,600,400).axes[0].gridColor).toBe('#ffffff1a');
  expect(buildSpec({...base,xAxis:{...base.xAxis,binLabel:'range'}},rows,columns,r,600,400).axes[0].bandPosition).toBeUndefined();
});
test('dense exact numeric bars stay legible without thousands of grid lines',async()=>{
  const base={...defaultConfig('bar',columns),x:'x',xBinning:'exact'};
  const result=response(Array.from({length:300},(_,i)=>({d0:i+1,d0End:null,m0:String(i+1),m1:String(i+1)})));
  const rows=chartRows(base,result,columns);
  const dense=buildSpec({...base,theme:'dark'},rows,columns,result,600,400);
  expect(dense.axes[0].grid).toBe(false);
  expect(dense.axes[0].ticks).toBe(false);
  expect(dense.axes[1].grid).toBe(true);
  expect(dense.scales[0].paddingInner).toBe(0);
  expect(dense.marks.find(mark=>mark.name==='plotMarks').encode.update.opacity.value).toBe(.75);
  const view=new View(parse(dense),{renderer:'none'});
  await view.runAsync();
  const svg=await view.toSVG();
  expect((svg.match(/role-axis-grid/g)??[]).length).toBe(1);
  expect(svg).toContain('opacity="0.75"');
  view.finalize();
  const small=buildSpec(base,rows.slice(0,12),columns,result,600,400);
  expect(small.axes[0].grid).toBe(true);
  expect(small.scales[0].paddingInner).toBe(base.innerPadding);
  expect(small.marks.find(mark=>mark.name==='plotMarks').encode.update.opacity.value).toBe(1);
  const quieter=buildSpec({...base,opacity:.4},rows,columns,result,600,400);
  expect(quieter.marks.find(mark=>mark.name==='plotMarks').encode.update.opacity.value).toBe(.4);
});
test('bin clicks include the last boundary and handle quantile ties',()=>{
  const c=columns[1];
  expect(filterFromDatum(c,0,4,true)).toEqual({column:'x',kind:'numeric',min:0,max:4});
  expect(filterFromDatum(c,0,4,false).max).toBeLessThan(4);
  expect(filterFromDatum(c,0,4,true,true).min).toBeGreaterThan(0);
  expect(filterFromDatum(c,'2')).toEqual({column:'x',kind:'numeric',min:2,max:2});
});
test('date bucket clicks keep UTC boundaries in Europe/Madrid',()=>{
  const original=process.env.TZ;process.env.TZ='Europe/Madrid';
  try{
    const column=columns.find(col=>col.kind==='date');
    for(const end of ['2025-02-01 00:00:00','2025-02-01T00:00:00Z','2025-02-01T01:00:00+01:00','2025-02-01']){
      expect(filterFromDatum(column,'2025-01-01 00:00:00',end).end).toBe('2025-01-31T23:59:59.999Z');
    }
    expect(filterFromDatum(column,'2025-07-01 00:00:00','2025-08-01 00:00:00').end).toBe('2025-07-31T23:59:59.999Z');
  }finally{if(original===undefined)delete process.env.TZ;else process.env.TZ=original;}
});
test('query sends structured aggregates only and keeps filters',()=>{
  const c={...defaultConfig('table',columns),tableRows:['city'],tableColumns:['segment'],tableValues:['x','y'],stat:'median'};
  const filters=[{column:'x',kind:'numeric',min:3}];const q=buildQuery(c,dataset,filters);
  expect(q.filters).toBe(filters);expect(q.dimensions.map(d=>d.column)).toEqual(['city','segment']);expect(q.measures[0]).toMatchObject({column:'x',stat:'median'});
  expect(q.limit).toBeLessThanOrEqual(10000);
});
test('calendar gaps are explicit and decomposition preserves additive identity',()=>{
  const c={...defaultConfig('seasonal',columns),x:'date',y:'y',interval:'month',period:4};
  const r=response(Array.from({length:16},(_,i)=>({d0:`2025-${String(i%12+1).padStart(2,'0')}-01T00:00:00Z`,m0:String(10+i),m1:'1'})));
  const regular=Array.from({length:20},(_,i)=>({...chartRows(c,r,columns)[0],x:Date.UTC(2024, i,1),y:10+i+[0,3,-1,-2][i%4]}));
  const output=decompose(regular,4);
  for(let i=0;i<regular.length;i++){const rows=output.slice(i*4,i*4+4);if(rows[1].y!==null)expect(rows[1].y+rows[2].y+rows[3].y).toBeCloseTo(rows[0].y,8);}
  const gapped=regularize([regular[0],regular[2]],c);expect(gapped).toHaveLength(3);expect(gapped[1].y).toBeNull();
});
test('seasonal gaps have no point marks and tooltips use the component value',async()=>{
  const c={...defaultConfig('line',columns),x:'date',y:'y',markers:true,missing:'gap'};
  const r=response(Array.from({length:40},(_,i)=>({d0:new Date(Date.UTC(2022,i,1)).toISOString(),m0:String(100+i*i),m1:'6'})));
  const components=decompose(chartRows(c,r,columns),12);
  for(const name of ['Tendencia','Residuo']){
    const rows=components.filter(row=>row.series===name);
    const view=new View(parse(buildSpec(c,rows,columns,r,700,300)),{renderer:'none'});
    await view.runAsync();
    const collect=node=>[...(node.name==='plotMarks'?node.items:[]),...(node.items??[]).flatMap(collect)];
    const marks=collect(view.scenegraph().root);
    expect(marks).toHaveLength(28);
    expect(marks.every(mark=>mark.datum.y!==null)).toBe(true);
    expect(view.data('values').filter(row=>row.y===null)).toHaveLength(12);
    expect(marks[0].datum.tooltip[t('Valor')]).toBe(String(marks[0].datum.y));
    view.finalize();
  }
});
test('CSV retains exact integer strings, quotes and multiline values',()=>{
  const result=csv([{id:'9007199254740993',text:'a,"b"\nc'}]);expect(result).toContain('9007199254740993');expect(result).toContain('"a,""b""\nc"');
});
test('image composition keeps the complete axis viewport and escapes titles',async()=>{
  const c={...defaultConfig('bar',columns),x:'city',title:'A < B & C'};
  const r=response([{d0:'Madrid',m0:'10',m1:'10'}]);
  const view=new View(parse(buildSpec(c,chartRows(c,r,columns),columns,r,700,430)),{renderer:'none'});await view.runAsync();
  const svg=composeSvg(c,[{svg:await view.toSVG(),name:''}]);view.finalize();
  expect(svg).toContain('width="732"');expect(svg).toContain('height="498"');expect(svg).toContain('A &lt; B &amp; C');
});
