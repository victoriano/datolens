/** UI acceptance fixture only. No native bridge, credentials, network or AI calls. */
import { createRoot } from 'react-dom/client';
import type { DesktopApi, EnrichmentCell, EnrichmentDefinition, RunStatus } from '../../contracts/desktop-api';
import { EnrichmentPanel } from './EnrichmentPanel';
import '../../styles/global.css';
const dataset = {id:'preview', name:'Empresas · fixture', sourcePath:'/fixture.csv', revision:'v1', rowCount:3, columns:[{id:'company',name:'Empresa',dataType:'VARCHAR',kind:'text' as const},{id:'A',name:'Sector',dataType:'VARCHAR',kind:'categorical' as const},{id:'B',name:'Oportunidad',dataType:'VARCHAR',kind:'text' as const}]};
let definitions: EnrichmentDefinition[] = [{id:'A',name:'Sector',provider:'gemini',model:'gemini-2.5-flash',prompt:'Clasifica {{company}} en un sector.',inputColumns:['company'],outputColumn:'A',outputKind:'categorical',dependsOn:[],revision:1},{id:'B',name:'Oportunidad',provider:'gemini',model:'gemini-2.5-flash',prompt:'Propón una oportunidad para {{company}} en {{A}}.',inputColumns:['company','A'],outputColumn:'B',outputKind:'text',dependsOn:['A'],revision:1}];
let run:RunStatus = {id:'run-fixture',state:'paused',succeeded:1,failed:0,pending:1};
let cell:EnrichmentCell = {key:{rowId:'row-1',enrichmentId:'B'},state:'stale',generation:2,definitionRevision:1,fingerprint:'fixture',value:'Automatización de informes',error:null,attempts:1,applied:true};
const unsupported = async():Promise<never> => {throw new Error('Esta operación requiere la app nativa.');};
const api:DesktopApi = {
  openDataset:async()=>dataset,listSheets:async()=>[],queryPage:unsupported,getDistributions:unsupported,loadView:async()=>null,saveView:async()=>{},exportDataset:unsupported,
  listEnrichments:async()=>definitions,saveEnrichment:async(_,d)=>{definitions=[...definitions.filter(item=>item.id!==d.id),d];},deleteEnrichment:async(_,id)=>{definitions=definitions.filter(d=>d.id!==id);},
  hasProviderKey:async()=>true,saveProviderKey:unsupported,removeProviderKey:unsupported,
  listRuns:async()=>[run],getCells:async()=>[cell],getCellHistory:async()=>[{...cell,state:'succeeded'}],
  planRun:async()=>({id:'run-preview',datasetRevision:'v1',cellCount:2,estimatedCalls:1,missingInputs:[]}),startRun:async id=>(run={id,state:'running',succeeded:0,failed:0,pending:2}),getRunStatus:async()=>run,
  pauseRun:async()=>{run={...run,state:'paused'};},resumeRun:async()=>{run={...run,state:'completed',succeeded:2,pending:0};cell={...cell,state:'succeeded'};},cancelRun:async()=>{run={...run,state:'cancelled'};}
};
createRoot(document.getElementById('root')!).render(<main style={{maxWidth:430,margin:'24px auto',border:'1px solid #e4e5eb',borderRadius:8}}><div style={{padding:'8px 16px',background:'#fff4d7',fontSize:11}}>FIXTURE DE INTERFAZ · sin llamadas a Gemini</div><EnrichmentPanel api={api} dataset={dataset} selectedRowIds={['row-1']} selectedCells={[{rowId:'row-1',columnId:'B'}]}/></main>);
