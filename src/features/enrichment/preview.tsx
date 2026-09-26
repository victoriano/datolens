/** UI replay only. Uses recorded real examples; never calls providers or accesses credentials. */
import { createRoot } from 'react-dom/client';
import type { DesktopApi, EnrichmentDefinition, RunStatus } from '../../contracts/desktop-api';
import { EnrichmentPanel } from './EnrichmentPanel';
import live from '../../../src-tauri/crates/datolens-enrichment/tests/live-results-2026-09-22.json';
import '../../styles/global.css';
const dataset={id:'preview',name:'Viviendas · ejemplos',sourcePath:'/examples.csv',revision:'synthetic-live-v1',rowCount:3,columns:[{id:'description',name:'Descripción',dataType:'VARCHAR',kind:'text' as const}]};
let definitions:EnrichmentDefinition[]=[];
let run:RunStatus={id:'run-preview',state:'queued',succeeded:0,failed:0,pending:3};
const unsupported=async():Promise<never>=>{throw new Error('Operación solo disponible en la app nativa.');};
const api:DesktopApi={
  openDataset:async()=>dataset,listSheets:async()=>[],queryPage:unsupported,getDistributions:unsupported,loadView:async()=>null,saveView:async()=>{},exportDataset:unsupported,
  listEnrichments:async()=>definitions,saveEnrichment:async(_,d)=>{definitions=[...definitions.filter(item=>item.id!==d.id),d];},deleteEnrichment:async(_,id)=>{definitions=definitions.filter(d=>d.id!==id);},
  hasProviderKey:async()=>true,checkProviderKeyAccess:unsupported,saveProviderKey:unsupported,removeProviderKey:unsupported,
  listRuns:async()=>[],getCells:async()=>[],getCellHistory:async()=>[],
  suggestEnrichment:async()=>{await new Promise(resolve=>setTimeout(resolve,700));return live.chat.Ok as unknown as Awaited<ReturnType<NonNullable<DesktopApi['suggestEnrichment']>>>;},
  previewEnrichment:async()=>{await new Promise(resolve=>setTimeout(resolve,1000));return live.jev;},
  planRun:async()=>({id:'run-preview',datasetRevision:dataset.revision,cellCount:3,estimatedCalls:3,missingInputs:[]}),startRun:async id=>(run={id,state:'completed',succeeded:3,failed:0,pending:0}),getRunStatus:async()=>run,
  pauseRun:async()=>{run={...run,state:'paused'};},resumeRun:async()=>{run={...run,state:'completed',succeeded:3,pending:0};},cancelRun:async()=>{run={...run,state:'cancelled'};}
};
createRoot(document.getElementById('root')!).render(<main style={{maxWidth:380,margin:'22px auto',border:'1px solid #e4e9df',borderRadius:10,overflow:'hidden'}}><div style={{padding:'8px 18px',background:'#f5f6ef',color:'#939884',fontSize:9,letterSpacing:'.3px'}}>REPLAY DE PRUEBA · respuestas reales guardadas, sin llamadas</div><EnrichmentPanel api={api} dataset={dataset} selectedRowIds={['1','2','3']}/></main>);
