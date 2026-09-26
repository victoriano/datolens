import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from './i18n';
import './variable-picker.css';

type Variable = { id: string; name: string };
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
export function VariablePicker({ columns, value, onChange, label, placeholder, emptyLabel }: {
  columns: Variable[]; value: string; onChange(value: string): void;
  label: string; placeholder: string; emptyLabel?: string;
}) {
  const { language } = useI18n();
  const uid = useId(), trigger = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{top:number;left:number;width:number}|null>(null);
  const [query, setQuery] = useState(''), [active, setActive] = useState(0);
  const options = [...(emptyLabel !== undefined ? [{id:'',name:emptyLabel}] : []), ...columns].filter(c => normalize(c.name).includes(normalize(query)));
  const close = (focus = false) => { setPosition(null); if (focus) trigger.current?.focus(); };
  const open = () => {
    const rect = trigger.current!.getBoundingClientRect(), width = Math.min(Math.max(rect.width, 260), window.innerWidth - 16);
    setQuery(''); setActive(0);
    setPosition({top:Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 288)),left:Math.max(8,Math.min(rect.left,window.innerWidth-width-8)),width});
  };
  useEffect(() => {
    if (!position) return;
    popup.current?.querySelector('input')?.focus();
    const outside = (e: PointerEvent) => { if (!popup.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) close(); };
    const scroll = (e: Event) => { if (!popup.current?.contains(e.target as Node)) close(); };
    document.addEventListener('pointerdown',outside); window.addEventListener('resize',scroll); document.addEventListener('scroll',scroll,true);
    return () => { document.removeEventListener('pointerdown',outside); window.removeEventListener('resize',scroll); document.removeEventListener('scroll',scroll,true); };
  }, [position]);
  useEffect(() => { popup.current?.querySelector('[data-active="true"]')?.scrollIntoView({block:'nearest'}); }, [active, query]);
  return <><button type="button" ref={trigger} className="dl-variable-picker-trigger" aria-label={label} aria-haspopup="listbox" aria-expanded={!!position} onClick={() => position ? close() : open()} onKeyDown={e => { if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();open();} }}><span>{columns.find(c=>c.id===value)?.name ?? emptyLabel ?? placeholder}</span><span aria-hidden="true">⌄</span></button>{position && createPortal(<div className="dl-variable-picker-popup" ref={popup} style={position} onKeyDown={e => {
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close(true);}
    if(e.key==='Tab')close(true);
  }}>
    <input role="combobox" aria-label={language==='en'?'Search variables':'Buscar variables'} placeholder={language==='en'?'Search variables…':'Buscar variables…'} aria-expanded="true" aria-controls={uid} aria-activedescendant={options[active] ? uid+'-'+active : undefined} autoComplete="off" value={query} onChange={e=>{setQuery(e.target.value);setActive(0);}} onKeyDown={e=>{
      if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setActive(i=>Math.max(0,Math.min(options.length-1,i+(e.key==='ArrowDown'?1:-1))));}
      if(e.key==='Enter'){e.preventDefault();if(options[active]){onChange(options[active].id);close(true);}}
    }}/>
    <div role="listbox" id={uid} aria-label={label} className="dl-variable-picker-options">{options.map((option,index)=><div role="option" aria-selected={option.id===value} id={uid+'-'+index} key={option.id} data-active={active===index} title={option.name} onMouseDown={e=>e.preventDefault()} onClick={()=>{onChange(option.id);close(true);}}><span>{option.name}</span><span>{option.id===value?'✓':''}</span></div>)}{!options.length&&<p>{language==='en'?'No matching variables':'No hay variables que coincidan'}</p>}</div>
    <small>{options.length} {language==='en'?'options':'opciones'}</small>
  </div>, document.body)}</>;
}

export function VariableChecklist({columns,value,onChange,label,maxSelected}:{
  columns:Variable[];value:string[];onChange(value:string[]):void;label:string;maxSelected?:number;
}) {
  const {language}=useI18n(), [query,setQuery]=useState('');
  const matches=columns.filter(c=>normalize(c.name).includes(normalize(query)));
  return <div className="dl-variable-checklist"><input type="search" aria-label={label+' · '+(language==='en'?'Search variables':'Buscar variables')} placeholder={language==='en'?'Search variables…':'Buscar variables…'} value={query} onChange={e=>setQuery(e.target.value)}/><div className="dl-variable-checklist-options">{matches.map(column=><label key={column.id} title={column.name}><input type="checkbox" checked={value.includes(column.id)} disabled={maxSelected!==undefined&&!value.includes(column.id)&&value.length>=maxSelected} onChange={e=>onChange(e.target.checked?[...value,column.id]:value.filter(id=>id!==column.id))}/><span>{column.name}</span></label>)}{!matches.length&&<p>{language==='en'?'No matching variables':'No hay variables que coincidan'}</p>}</div><small>{value.length} {language==='en'?'selected':'seleccionadas'} · {matches.length} {language==='en'?'results':'resultados'}</small></div>;
}
