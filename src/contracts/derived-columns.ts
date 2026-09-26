import type { CellValue, Column, Dataset, EnrichmentDefinition, Filter, ViewSaveResult } from './desktop-api';

export interface DerivedDefinition { id:string; name:string; expression:string }
export type ColumnProposal =
  | { kind:'enrichment'; definition:EnrichmentDefinition; explanation:string }
  | { kind:'formula'; formula:DerivedDefinition; explanation:string };
export interface DerivedPreview {
  datasetRevision:string; fingerprint:string; column:Column; inputColumns:string[];
  rows:Array<{rowId:string;inputs:Record<string,CellValue>;value:CellValue}>; totalRows:number;
}
export interface DerivedCreated { dataset:Dataset; column:Column; save:ViewSaveResult }
export interface DerivedColumnsApi {
  suggestColumn(request:{datasetId:string;message:string;language:'es'|'en';previous?:ColumnProposal}):Promise<ColumnProposal>;
  previewDerivedColumn(request:{datasetId:string;formula:DerivedDefinition;rowIds?:string[];filters?:Filter[]}):Promise<DerivedPreview>;
  createDerivedColumn(request:{datasetId:string;formula:DerivedDefinition;expectedRevision:string;expectedFingerprint:string}):Promise<DerivedCreated>;
}
