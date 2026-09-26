/** Isolated UI fixture: no keys are persisted, no provider requests are sent. */
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { QueryDialog } from './QueryDialog';
import { createFixtureApi } from '../explorer/fixture-api';
import type { Dataset } from '../../contracts/desktop-api';
import { sourceKey } from './model';
import { UiPreferencesProvider } from '../../ui';
import '../../styles/explorer.css';
import '../../styles/native.css';
import './workspace.css';
const source:Dataset={id:'qa',name:'Clientes',sourcePath:'/fixture/clientes.csv',revision:'v1',rowCount:3,columns:[{id:'name',name:'name',dataType:'VARCHAR',kind:'text'},{id:'total',name:'total',dataType:'DOUBLE',kind:'numeric'}]};
let connected=new URLSearchParams(location.search).has('connected');
const api={...createFixtureApi(),hasProviderKey:async()=>connected,saveProviderKey:async()=>{connected=true;},openDataset:async()=>source,
  analysisModels:async()=>[{id:'gemini-3.8-flash',provider:'gemini' as const},{id:'gemini-3.7-flash',provider:'gemini' as const},{id:'gemini-3.5-flash',provider:'gemini' as const}],
  suggestWorkspaceQuery:async()=>({name:'Clientes destacados',sql:'SELECT name, total FROM t1 WHERE total > 10',explanation:'Conserva los clientes cuyo total supera 10.'}),
  createQueryDataset:async(request:{sql:string})=>({...source,name:request.sql}),
};
function Preview(){const [open,setOpen]=useState(true);const [result,setResult]=useState('');return <UiPreferencesProvider><div className="dl-native-shell"><main className="dl-explorer"><h1>QA fixture · No network, no saved keys</h1><button onClick={()=>setOpen(true)}>Open query fixture</button><output>{result}</output>{open&&<QueryDialog api={api} tabs={[{key:sourceKey(source.sourcePath),path:source.sourcePath,name:source.name,dataset:source}]} onClose={()=>setOpen(false)} onResult={dataset=>setResult(dataset.name)}/>}</main></div></UiPreferencesProvider>;}
createRoot(document.getElementById('root')!).render(<Preview/>);
