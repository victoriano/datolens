import type { AnalysisSampling, DesktopApi, Distributions, Filter } from '../../contracts/desktop-api';
import { createQueryQueue } from './sampling';

const queues = new WeakMap<DesktopApi, ReturnType<typeof createQueryQueue>>();
const caches = new WeakMap<DesktopApi, Map<string, Distributions>>();
const MAX_CACHED_COLUMNS = 256;
export interface DistributionOptions {
  sampling?: AnalysisSampling;
  statistics?: string[];
  revision?: string;
  onPartial?: (result: Distributions) => void;
  onPending?: () => void;
}
function cacheKey(datasetId: string, filters: Filter[], options: DistributionOptions) {
  const context = JSON.stringify([datasetId, options.revision, options.sampling ?? { mode: 'auto' }, filters]);
  return (id: string) => JSON.stringify([context, id, options.statistics?.includes(id) ?? false]);
}
/** Read before paint so revisiting a loaded card never mounts a loading placeholder. */
export function cachedDistributions(api: DesktopApi, datasetId: string, columns: string[], filters: Filter[], options: DistributionOptions = {}) {
  const cache = caches.get(api), key = cacheKey(datasetId, filters, options);
  const ready = options.revision === undefined ? [] : columns.flatMap(id => {
    const cacheId = key(id), value = cache?.get(cacheId);
    if (!value) return [];
    cache!.delete(cacheId); cache!.set(cacheId, value);
    return [value];
  });
  return ready.length ? { ...ready[0], variables: ready.flatMap(result => result.variables) } : null;
}
/** Keep previous cards within the same query context when another viewport batch arrives. */
export function mergeDistributions(previous: Distributions | null, incoming: Distributions): Distributions {
  if (!previous || incoming.deferredReason) return incoming;
  const byId = new Map(previous.variables.map(variable => [variable.column, variable]));
  for (const variable of incoming.variables) { byId.delete(variable.column); byId.set(variable.column, variable); }
  while (byId.size > MAX_CACHED_COLUMNS) byId.delete(byId.keys().next().value!);
  // A cache hit must not trigger a new render just because priority/order changed.
  if (byId.size === previous.variables.length && previous.variables.every(variable => byId.get(variable.column) === variable)
    && previous.selectedCount === incoming.selectedCount && previous.analyzedRows === incoming.analyzedRows
    && previous.totalRows === incoming.totalRows && previous.sampled === incoming.sampled
    && previous.automaticRows === incoming.automaticRows && previous.deferredReason === incoming.deferredReason) return previous;
  return { ...incoming, variables: [...byId.values()] };
}
/** Viewport demand only. Cache each column by source revision, population, filters and statistics. */
export async function queryDistributions(api: DesktopApi, datasetId: string, columns: string[], filters: Filter[], cancelled: () => boolean, options: DistributionOptions = {}): Promise<Distributions | null> {
  let queue = queues.get(api);
  if (!queue) { queue = createQueryQueue(); queues.set(api, queue); }
  let cache = caches.get(api);
  if (!cache) { cache = new Map(); caches.set(api, cache); }
  const sampling = options.sampling ?? { mode: 'auto' };
  const key = cacheKey(datasetId, filters, options);
  const ready = new Map<string, Distributions['variables'][number]>();
  let combined: Distributions | null = null;
  const publish = (result: Distributions) => {
    combined = { ...result, variables: columns.flatMap(id => { const variable = ready.get(id); return variable ? [variable] : []; }) };
    options.onPartial?.(combined);
  };
  // No cache without an explicit revision: callers must opt into safe invalidation.
  if (options.revision !== undefined) for (const id of columns) {
    const cached = cache.get(key(id));
    if (cached) { cache.delete(key(id)); cache.set(key(id), cached); cached.variables.forEach(variable => ready.set(variable.column, variable)); combined = cached; }
  }
  if (combined && !cancelled()) publish(combined);
  const missing = columns.filter(id => !ready.has(id));
  // Two cards per call give the first useful paint and let row queries interleave.
  for (let offset = 0; offset < Math.max(columns.length ? 0 : 1, missing.length); offset += 2) {
    if (cancelled()) return null;
    const ids = missing.slice(offset, offset + 2);
    const result = await queue(async () => {
      // A superseded request may have completed while this batch waited for IPC.
      // Recheck *inside* the queue and cache before releasing it to the next caller.
      const cached = cachedDistributions(api, datasetId, ids, filters, options);
      const loaded = new Set(cached?.variables.map(variable => variable.column));
      const needed = ids.filter(id => !loaded.has(id));
      if (ids.length && !needed.length) return cached!;
      options.onPending?.();
      const fresh = await api.getDistributions({ datasetId, columns: needed, filters, sampling, statistics: (options.statistics ?? []).filter(id => needed.includes(id)) });
      if (options.revision !== undefined && !fresh.deferredReason) for (const variable of fresh.variables) {
        const cacheKey = key(variable.column);
        cache!.delete(cacheKey); cache!.set(cacheKey, { ...fresh, variables: [variable] });
        while (cache!.size > MAX_CACHED_COLUMNS) cache!.delete(cache!.keys().next().value!);
      }
      return cached && !fresh.deferredReason ? { ...fresh, variables: [...cached.variables, ...fresh.variables] } : fresh;
    }, cancelled);
    if (!result) return null;
    if (cancelled()) return null;
    result.variables.forEach(variable => ready.set(variable.column, variable));
    publish(result);
    if (result.deferredReason) return combined;
  }
  return cancelled() ? null : combined;
}
