import { expect, test } from 'bun:test';
import { cachedDistributions, mergeDistributions, queryDistributions } from './distributions';
import type { DesktopApi, Distributions } from '../../contracts/desktop-api';
test('remote auto deferral stops after one batch for 4911 columns', async () => {
  let calls = 0, updates = 0;
  const deferred: Distributions = { variables: [], selectedCount: 0, totalRows: 191254, analyzedRows: 0, sampled: true, automaticRows: 100, deferredReason: 'remote_source' };
  const api = { getDistributions: async () => { calls++; return deferred; } } as unknown as DesktopApi;
  const result = await queryDistributions(api, 'pisa', Array.from({ length: 4911 }, (_, i) => `c${i}`), [], () => false, { onPartial: () => updates++ });
  expect(result).toEqual(deferred); expect(calls).toBe(1); expect(updates).toBe(1);
});
test('ordinary distributions still process all batches', async () => {
  let calls = 0;
  const api = { getDistributions: async () => { calls++; return { variables: [], selectedCount: 3, totalRows: 3, analyzedRows: 3, sampled: false }; } } as unknown as DesktopApi;
  await queryDistributions(api, 'local', Array.from({ length: 17 }, (_, i) => `c${i}`), [], () => false);
  expect(calls).toBe(9);
});
test('viewport revisits hit cache; filters, statistics and revision invalidate independently', async () => {
  const calls: string[][] = [];
  const api = { getDistributions: async (request: Parameters<DesktopApi['getDistributions']>[0]) => {
    calls.push(request.columns);
    return { variables: request.columns.map(column => ({column, kind:'categorical', bins:[]})), selectedCount:10, totalRows:100, analyzedRows:10, sampled:true };
  }} as unknown as DesktopApi;
  const options = { revision:'r1' };
  await queryDistributions(api,'pisa',['a','b'],[],()=>false,options);
  await queryDistributions(api,'pisa',['b','c'],[],()=>false,options);
  await queryDistributions(api,'pisa',['a','b'],[],()=>false,options);
  expect(calls).toEqual([['a','b'],['c']]);
  await queryDistributions(api,'pisa',['a'],[{kind:'categorical',column:'b',selected:['x']}],()=>false,options);
  await queryDistributions(api,'pisa',['a'],[],()=>false,{...options,statistics:['a']});
  await queryDistributions(api,'pisa',['a'],[],()=>false,{revision:'r2'});
  expect(calls.length).toBe(5);
});
test('a superseded batch does not publish but its revision-scoped cache remains reusable', async () => {
  let release!: () => void; let cancelled=false, calls=0, published=0;
  const api={getDistributions: async () => {calls++; await new Promise<void>(resolve=>release=resolve);return {variables:[{column:'a',kind:'numeric',bins:[]}],selectedCount:10,totalRows:10,analyzedRows:10,sampled:false};}} as unknown as DesktopApi;
  const pending=queryDistributions(api,'pisa',['a'],[],()=>cancelled,{revision:'r1',onPartial:()=>published++});
  await Promise.resolve(); cancelled=true; release();
  expect(await pending).toBeNull(); expect(published).toBe(0);
  const cached=await queryDistributions(api,'pisa',['a'],[],()=>false,{revision:'r1'});
  expect(cached?.variables[0].column).toBe('a'); expect(calls).toBe(1);
});
test('client cache stays bounded after visiting hundreds of variables',async()=>{
  let calls=0;
  const api={getDistributions:async (request:Parameters<DesktopApi['getDistributions']>[0])=>{calls++;return {variables:request.columns.map(column=>({column,kind:'numeric',bins:[]})),selectedCount:1,totalRows:1,analyzedRows:1,sampled:false};}} as unknown as DesktopApi;
  const ids=Array.from({length:280},(_,i)=>`c${i}`);
  await queryDistributions(api,'pisa',ids,[],()=>false,{revision:'r1'});
  expect(calls).toBe(140);
  await queryDistributions(api,'pisa',['c279'],[],()=>false,{revision:'r1'});expect(calls).toBe(140);
  await queryDistributions(api,'pisa',['c0'],[],()=>false,{revision:'r1'});expect(calls).toBe(141);
});
test('scrolling during a slow batch reuses its result before issuing overlapping IPC', async () => {
  const calls: string[][] = [];
  let release!: () => void, started!: () => void, cancelled = false, stalePublishes = 0;
  const inFlight = new Promise<void>(resolve => { started = resolve; });
  const api = { getDistributions: async (request: Parameters<DesktopApi['getDistributions']>[0]) => {
    calls.push(request.columns);
    if (calls.length === 1) { started(); await new Promise<void>(resolve => { release = resolve; }); }
    return { variables: request.columns.map(column => ({ column, kind: 'numeric', bins: [] })), selectedCount: 10, totalRows: 100, analyzedRows: 10, sampled: true };
  } } as unknown as DesktopApi;
  const first = queryDistributions(api, 'pisa', ['a', 'b'], [], () => cancelled, { revision: 'r1', onPartial: () => stalePublishes++ });
  await inFlight;
  cancelled = true;
  const scrolled = queryDistributions(api, 'pisa', ['b', 'c'], [], () => false, { revision: 'r1' });
  release();
  expect(await first).toBeNull();
  expect((await scrolled)?.variables.map(variable => variable.column)).toEqual(['b', 'c']);
  expect(calls).toEqual([['a', 'b'], ['c']]);
  expect(stalePublishes).toBe(0);
});
test('a fully cached viewport publishes synchronously without Updating or native work', async () => {
  let calls = 0, pending = 0;
  const api = { getDistributions: async (request: Parameters<DesktopApi['getDistributions']>[0]) => {
    calls++;
    return { variables: request.columns.map(column => ({ column, kind: 'numeric', bins: [] })), selectedCount: 10, totalRows: 100, analyzedRows: 10, sampled: true };
  } } as unknown as DesktopApi;
  await queryDistributions(api, 'pisa', ['a', 'b'], [], () => false, { revision: 'r1' });
  const cached = cachedDistributions(api, 'pisa', ['b', 'a'], [], { revision: 'r1' });
  expect(cached?.variables.map(variable => variable.column)).toEqual(['b', 'a']);
  expect(cachedDistributions(api, 'pisa', ['a'], [], { revision: 'r2' })).toBeNull();
  expect(cachedDistributions(api, 'pisa', ['a'], [], { revision: 'r1', sampling: { mode: 'full' } })).toBeNull();
  expect(cachedDistributions(api, 'pisa', ['a'], [], {})).toBeNull();
  await queryDistributions(api, 'pisa', ['b', 'a'], [], () => false, { revision: 'r1', onPending: () => pending++ });
  expect(calls).toBe(1); expect(pending).toBe(0);
});
test('partial viewport results preserve loaded charts and object identities without growing unbounded', () => {
  const result = (ids: string[]): Distributions => ({ variables: ids.map(column => ({ column, kind: 'numeric', bins: [] })), selectedCount: 10, totalRows: 100, analyzedRows: 10, sampled: true });
  const first = result(['a', 'b']);
  const merged = mergeDistributions(first, result(['c']));
  expect(merged.variables.map(variable => variable.column)).toEqual(['a', 'b', 'c']);
  expect(merged.variables[0]).toBe(first.variables[0]);
  expect(mergeDistributions(merged, { ...merged, variables: [merged.variables[2], merged.variables[0]] })).toBe(merged);
  let accumulated = merged;
  for (let i = 0; i < 500; i++) accumulated = mergeDistributions(accumulated, result([`c${i}`]));
  expect(accumulated.variables.length).toBe(256);
  expect(accumulated.variables.at(-1)?.column).toBe('c499');
});
