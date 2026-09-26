import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { t } from '../../ui';
export function PlotResize({width,height,onResize,children}:{width?:number;height:number;onResize(size:{width?:number;height:number}):void;children:ReactNode}){
  const container=useRef<HTMLDivElement>(null),drag=useRef<{x:number;y:number;width:number;height:number;nextWidth:number;nextHeight:number}|null>(null);
  const [initialWidth,setInitialWidth]=useState<number>();
  useLayoutEffect(()=>{
    const region=container.current?.parentElement;
    if(!region)return;
    const measure=()=>{
      const style=getComputedStyle(region);
      const available=region.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight);
      setInitialWidth(Math.max(300,Math.min(2400,Math.floor(available))));
    };
    measure();
    const observer=new ResizeObserver(measure);observer.observe(region);
    return()=>observer.disconnect();
  },[]);
  const renderedWidth=width??initialWidth;
  const zoom=(factor:number)=>{
    if(!renderedWidth)return;
    onResize({width:Math.max(300,Math.min(2400,Math.round(renderedWidth*factor))),height:Math.max(200,Math.min(1600,Math.round(height*factor)))});
  };
  return <div className="dl-plot-resizable" ref={container} style={{width:renderedWidth?`${renderedWidth}px`:undefined}}>{initialWidth!==undefined&&children}<div className="dl-plot-zoom" role="group" aria-label={t('Zoom del gráfico')}><button aria-label={t('Reducir gráfico')} title={t('Reducir gráfico')} onClick={()=>zoom(.9)}>−</button><button aria-label={t('Ampliar gráfico')} title={t('Ampliar gráfico')} onClick={()=>zoom(1.1)}>+</button></div><button className="dl-plot-resize-handle" aria-label={t('Cambiar tamaño del gráfico')} title={t('Arrastra para cambiar tamaño · doble clic para ajustar')} onDoubleClick={()=>onResize({width:initialWidth,height:430})}
    onPointerDown={event=>{if(event.button!==0||!container.current)return;event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);const currentWidth=container.current.clientWidth;drag.current={x:event.clientX,y:event.clientY,width:currentWidth,height,nextWidth:currentWidth,nextHeight:height};container.current.classList.add('dl-plot-resizing');}}
    onPointerMove={event=>{const d=drag.current;if(!d||!container.current)return;d.nextWidth=Math.round(Math.max(300,Math.min(2400,d.width+event.clientX-d.x)));d.nextHeight=Math.round(Math.max(200,Math.min(1600,d.height+event.clientY-d.y)));container.current.style.width=d.nextWidth+'px';container.current.style.setProperty('--plot-resize-height',d.nextHeight+'px');}}
    onPointerUp={event=>{const d=drag.current;if(!d)return;drag.current=null;event.currentTarget.releasePointerCapture(event.pointerId);container.current?.classList.remove('dl-plot-resizing');onResize({width:d.nextWidth,height:d.nextHeight});}}
    onPointerCancel={()=>{drag.current=null;container.current?.classList.remove('dl-plot-resizing');if(container.current)container.current.style.width=width?width+'px':'';}}
    onKeyDown={event=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();onResize({width:Math.max(300,Math.min(2400,(renderedWidth??700)+(event.key==='ArrowLeft'?-10:event.key==='ArrowRight'?10:0))),height:Math.max(200,Math.min(1600,height+(event.key==='ArrowUp'?-10:event.key==='ArrowDown'?10:0)))});}}>↘</button></div>;
}
