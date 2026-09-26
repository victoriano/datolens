import { useCallback, useState } from 'react';
import type { Dataset } from '../../contracts/desktop-api';
import { registerTabs, sourceKey, workbookTabs, type DatasetTab } from './model';
const STORAGE = 'datolens.open-datasets.v1';
const ACTIVE = 'datolens.active-dataset.v1';
const LAST_FILE = 'datolens.last-opened-file.v1';
export function isUserLocalSourcePath(path: string): boolean {
  return !/^https?:\/\//i.test(path) && !/[\\/]remote-sources[\\/]source-[^\\/]+[\\/]/i.test(path);
}
export function lastWorkspaceFilePath(): string | undefined {
  try {
    const last = localStorage.getItem(LAST_FILE);
    if (last && isUserLocalSourcePath(last)) return last;
    const active = rememberedWorkspaceSource()?.path;
    if (active && isUserLocalSourcePath(active)) return active;
    return readTabs().reverse().find(tab => isUserLocalSourcePath(tab.path))?.path;
  }
  catch { return undefined; }
}
export function rememberedWorkspaceSource(): {path:string;sheet?:string} | null | undefined {
  try {
    const raw = localStorage.getItem(ACTIVE);
    if (raw === null) return undefined;
    const value = JSON.parse(raw);
    if (value === null) return null;
    return typeof value.path === 'string' && (value.sheet === undefined || typeof value.sheet === 'string') ? value : undefined;
  } catch { return undefined; }
}
function readTabs(): DatasetTab[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE) || '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((v): v is DatasetTab => !!v && typeof v.path === 'string' && typeof v.name === 'string' && (v.sheet === undefined || typeof v.sheet === 'string'))
      .slice(0, 200).map(({path, sheet, name}) => ({key:sourceKey(path,sheet),path,sheet,name}));
  } catch { return []; }
}
export function useDatasetWorkspace() {
  const [tabs, setTabs] = useState<DatasetTab[]>(readTabs);
  const update = useCallback((change: (tabs: DatasetTab[]) => DatasetTab[]) => setTabs(current => {
    const next = change(current);
    try { localStorage.setItem(STORAGE, JSON.stringify(next.map(({key,path,sheet,name}) => ({key,path,sheet,name})))); } catch { /* Session navigation remains available if browser storage is full. */ }
    return next;
  }), []);
  const registerWorkbook = useCallback((path: string, names: string[]) => update(current => registerTabs(current,workbookTabs(path,names))), [update]);
  const registerDataset = useCallback((dataset: Dataset) => {
    try {localStorage.setItem(ACTIVE,JSON.stringify({path:dataset.sourcePath,sheet:dataset.sheet}));if(isUserLocalSourcePath(dataset.sourcePath))localStorage.setItem(LAST_FILE,dataset.sourcePath);} catch {}
    update(current => registerTabs(current,[{key:sourceKey(dataset.sourcePath,dataset.sheet),path:dataset.sourcePath,sheet:dataset.sheet,name:dataset.name,dataset}]));
  }, [update]);
  const remove = useCallback((key: string) => update(current => {
    const next=current.filter(tab => tab.key !== key);
    if (!next.length) {try {localStorage.setItem(ACTIVE,'null');} catch {}}
    return next;
  }), [update]);
  return {tabs,registerWorkbook,registerDataset,remove};
}
