import { useEffect, useRef, useState } from 'react';
import type { Dataset, DatasetStorage, DesktopApi } from '../../contracts/desktop-api';
import { useI18n } from '../../ui';
import { sourceKey, type DatasetTab } from './model';
import { QueryDialog } from './QueryDialog';
import { RemoteDatasetDialog } from './RemoteDatasetDialog';
import './workspace.css';
interface Props { api: DesktopApi; tabs: DatasetTab[]; dataset: Dataset | null; opening: boolean; storageByTab?: Record<string,DatasetStorage>; onOpen(path: string, sheet?: string): void; onAdd(): void; onClose(tab: DatasetTab): void; onResult(dataset: Dataset): void | Promise<void>; onOpenSettings?: () => void }
export function WorkspaceBar({ api,tabs,dataset,opening,storageByTab,onOpen,onAdd,onClose,onResult,onOpenSettings }: Props) {
  const { language,locale } = useI18n();
  const tr = (es:string,en:string)=>language==='en'?en:es;
  const [queryOpen,setQueryOpen]=useState(false);
  const [addOpen,setAddOpen]=useState(false);
  const [addPosition,setAddPosition]=useState({left:0,top:0});
  const [remoteOpen,setRemoteOpen]=useState(false);
  const addMenu=useRef<HTMLDivElement>(null);
  const tabList=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!addOpen)return;
    const dismiss=(event:PointerEvent)=>{if(!addMenu.current?.contains(event.target as Node))setAddOpen(false);};
    const resize=()=>setAddOpen(false);
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setAddOpen(false);addMenu.current?.querySelector('button')?.focus();}};
    document.addEventListener('pointerdown',dismiss);
    document.addEventListener('keydown',escape,true);
    window.addEventListener('resize',resize);
    return()=>{document.removeEventListener('pointerdown',dismiss);document.removeEventListener('keydown',escape,true);window.removeEventListener('resize',resize);};
  },[addOpen]);
  const active=dataset?sourceKey(dataset.sourcePath,dataset.sheet):null;
  useEffect(()=>{
    tabList.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({block:'nearest',inline:'nearest'});
  },[active,tabs.length]);
  return <><nav className="dl-app-header dl-workspace-bar" aria-label={tr('Datasets abiertos','Open datasets')}><div className="dl-dataset-tabs"><div className="dl-dataset-tab-list" ref={tabList} role="tablist" aria-label={tr('Tablas y hojas','Tables and sheets')}>
    {tabs.map(tab=>{
      const storage=storageByTab?.[tab.key];
      const title=tab.path+(tab.sheet?` / ${tab.sheet}`:'')+(storage?`\n${tr('Caché','Cache')}: ${(storage.cacheBytes / 1024 ** 2).toLocaleString(locale,{maximumFractionDigits:1})} MB`:'');
      return <div className={`dl-dataset-tab ${tab.key===active?'is-active':''}`} key={tab.key}><button type="button" role="tab" aria-selected={tab.key===active} disabled={opening} title={title} onClick={()=>onOpen(tab.path,tab.sheet)}><span>{tab.sheet||tab.name}</span>{tab.sheet&&<small>{tab.name}</small>}</button><button className="dl-close-tab" type="button" disabled={opening} aria-label={`${tr('Cerrar','Close')} ${tab.sheet||tab.name}`} onClick={()=>onClose(tab)}>×</button></div>;
    })}
  </div></div><div className="dl-add-dataset-menu" ref={addMenu} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setAddOpen(false);addMenu.current?.querySelector('button')?.focus();}}}><button className="dl-add-dataset" type="button" disabled={opening} aria-label={tr('Añadir más datasets','Add more datasets')} title={tr('Añadir más datasets','Add more datasets')} aria-haspopup="menu" aria-expanded={addOpen} onClick={event=>{const rect=event.currentTarget.getBoundingClientRect();setAddPosition({left:Math.max(8,Math.min(rect.left,window.innerWidth-268)),top:rect.bottom+6});setAddOpen(value=>!value);}}><svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg></button>{addOpen&&<div className="dl-add-options" style={addPosition} role="menu" aria-label={tr('Añadir dataset','Add dataset')}>
    <button role="menuitem" onClick={()=>{setAddOpen(false);onAdd();}}>{tr('Abrir archivo del Mac…','Open file from Mac…')}</button>
    <button role="menuitem" disabled={!api.importDatasetUrl} onClick={()=>{setAddOpen(false);setRemoteOpen(true);}}>{tr('Cargar desde una URL…','Load from a URL…')}</button>
    {api.createQueryDataset&&tabs.length>0&&<button role="menuitem" onClick={()=>{setAddOpen(false);setQueryOpen(true);}}>{tr('Derivar de los datasets abiertos…','Derive from open datasets…')}</button>}
  </div>}</div><div className="dl-titlebar-space" aria-hidden="true"/>{onOpenSettings&&<button className="dl-settings-button" type="button" aria-label={tr('Ajustes','Settings')} title={tr('Ajustes (⌘,)','Settings (⌘,)')} onClick={onOpenSettings}><svg aria-hidden="true" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9.5 3-.5 2a7.6 7.6 0 0 0-1.5.9l-2-.6L3 9.5 4.5 11a7.6 7.6 0 0 0 0 2L3 14.5l2.5 4.2 2-.6A7.6 7.6 0 0 0 9 19l.5 2h5l.5-2a7.6 7.6 0 0 0 1.5-.9l2 .6 2.5-4.2-1.5-1.5a7.6 7.6 0 0 0 0-2L21 9.5l-2.5-4.2-2 .6A7.6 7.6 0 0 0 15 5l-.5-2Z"/><circle cx="12" cy="12" r="3"/></svg></button>}</nav>{queryOpen&&<QueryDialog api={api} tabs={tabs} onClose={()=>setQueryOpen(false)} onResult={onResult}/ >}{remoteOpen&&<RemoteDatasetDialog api={api} onClose={()=>setRemoteOpen(false)} onResult={onResult}/>}</>;
}
