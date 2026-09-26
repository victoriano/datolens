import type { PlotConfig } from './types';
import { t } from '../../ui';
const escape=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
/** Vega's view.width/height exclude axes; retain the complete SVG viewport. */
export function composeSvg(config:PlotConfig,parts:{svg:string;name:string}[]):string {
  const panels=parts.map(part=>{
    const root=part.svg.match(/^<svg\b[^>]*>/)?.[0]??'';
    const width=Number(root.match(/\bwidth="([\d.]+)"/)?.[1]),height=Number(root.match(/\bheight="([\d.]+)"/)?.[1]);
    if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw new Error(t('No se pudo determinar el tamaño de la imagen.'));
    return {...part,width,height};
  });
  const width=Math.max(...panels.map(panel=>panel.width))+32,ink=config.theme==='dark'?'#eeeeee':'#333333';
  let y=24;const elements:string[]=[];
  const text=(value:string,size:number)=>{elements.push(`<text x="16" y="${y}" font-family="-apple-system,sans-serif" font-size="${size}" fill="${ink}">${escape(value)}</text>`);y+=size+12;};
  for(const value of [config.showTitle?config.title:'',config.showSubtitle?config.subtitle:'',config.showDescription?config.description:''].filter(Boolean))text(value,16);
  for(const panel of panels){if(panel.name)text(config.kind==='seasonal'?t(panel.name):panel.name,13);elements.push(`<g transform="translate(16,${y})">${panel.svg}</g>`);y+=panel.height+16;}
  if(config.showFooter&&config.footer)text(config.footer,11);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${y}" viewBox="0 0 ${width} ${y}"><rect width="100%" height="100%" fill="${escape(config.background)}"/>${elements.join('')}</svg>`;
}
