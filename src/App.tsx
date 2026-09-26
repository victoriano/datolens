import { ExplorerApp } from './features/explorer';
import { EnrichmentPanel } from './features/enrichment';
import { desktopApi } from './platform/desktop';
import { UiPreferencesProvider } from './ui';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauri } from '@tauri-apps/api/core';
import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { SettingsDialog } from './ui/SettingsDialog';
import './styles/native.css';

const nativeMac = isTauri() && /Mac/.test(navigator.platform);

function dragTitlebar(event: MouseEvent<HTMLDivElement>) {
  const target = event.target as HTMLElement;
  if (!nativeMac || event.button !== 0 || !target.closest('.dl-app-header') ||
      target.closest('button, input, select, a, summary, [role="tablist"], [role="menu"]')) return;
  event.preventDefault();
  void getCurrentWindow().startDragging().catch(console.error);
}

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [keyRevision, setKeyRevision] = useState(0);
  const enrichmentApi = useMemo(() => ({ ...desktopApi }), [keyRevision]);
  useEffect(() => {
    const open = () => setSettingsOpen(true);
    const keysChanged = () => setKeyRevision(revision => revision + 1);
    window.addEventListener('datolens:open-settings', open);
    window.addEventListener('datolens:provider-keys-changed', keysChanged);
    return () => { window.removeEventListener('datolens:open-settings', open); window.removeEventListener('datolens:provider-keys-changed', keysChanged); };
  }, []);
  return <UiPreferencesProvider><div className={`dl-native-shell${nativeMac ? ' dl-native-mac' : ''}`} onMouseDown={dragTitlebar}><ExplorerApp api={desktopApi} onOpenSettings={() => setSettingsOpen(true)} renderEnrichmentPanel={({dataset,selection,filters,onDataChanged}) =>
    <EnrichmentPanel key={dataset.id} api={enrichmentApi} dataset={dataset} selectedRowIds={selection.rowIds} selectedCells={selection.cells} filters={filters} onDefinitionsChange={onDataChanged} onResultsChange={onDataChanged}/>
  } />{settingsOpen && <SettingsDialog api={desktopApi} onClose={() => setSettingsOpen(false)}/>}</div></UiPreferencesProvider>;
}
