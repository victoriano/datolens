import { useLayoutEffect, useRef, useState } from 'react';
import type { AnalysisSampling, DesktopApi, Distributions, Filter } from '../../contracts/desktop-api';
import { cachedDistributions, queryDistributions } from './distributions';
import { nextDistributionFrame, type DistributionFrame } from './distribution-frame';

export function useDistributions({ api, datasetId, revision, columns, filters, sampling, statistics, enabled, onError }: {
  api: DesktopApi; datasetId?: string; revision: string; columns: string[]; filters: Filter[];
  sampling: AnalysisSampling; statistics: string[]; enabled: boolean; onError: (error: unknown) => void;
}) {
  const [state, setState] = useState<DistributionFrame | null>(null);
  const [busy, setBusy] = useState(false);
  const [failedRequest, setFailedRequest] = useState<string | null>(null);
  // Retain only across filter edits. Another dataset/revision/sample must not inherit old data.
  const source = JSON.stringify([datasetId, revision, sampling]);
  const context = JSON.stringify([datasetId, revision, filters, sampling]);
  // Scrolling can change viewport/overscan priority without changing demand.
  const demand = JSON.stringify([...columns].sort());
  const statisticsKey = JSON.stringify([...statistics].sort());
  const requestKey = JSON.stringify([context, demand, statisticsKey]);
  const latest = useRef({ columns, onError }); latest.current = { columns, onError };
  useLayoutEffect(() => {
    setBusy(false);
    setFailedRequest(null);
    if (!datasetId || !enabled || demand === '[]') return;
    let cancelled = false;
    const ids = latest.current.columns;
    const options = { revision, sampling, statistics };
    const publish = (result: Distributions) => {
      if (cancelled) return;
      setState(previous => nextDistributionFrame(previous, { api, source, context, filtered: filters.length > 0 }, result, ids));
    };
    const cached = cachedDistributions(api, datasetId, ids, filters, options);
    if (cached) publish(cached);
    if (cached?.variables.length === ids.length) return;
    // New cards debounce during fast scrolling; cached cards are already painted.
    const timer = window.setTimeout(() => {
      void queryDistributions(api, datasetId, ids, filters, () => cancelled, {
        ...options, onPartial: publish, onPending: () => { if (!cancelled) setBusy(true); },
      }).catch(error => { if (!cancelled) { setFailedRequest(requestKey); latest.current.onError(error); } })
        .finally(() => { if (!cancelled) setBusy(false); });
    }, 80);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [api, context, demand, statisticsKey, enabled]);
  const frame = state?.api === api && state.source === source ? state : null;
  const stale = !!frame && frame.context !== context;
  return {
    distributions: frame?.result ?? null,
    distributionsFiltered: frame?.filtered ?? filters.length > 0,
    chartsStale: stale,
    chartsBusy: enabled && columns.length > 0 && (busy || (stale && failedRequest !== requestKey)),
  };
}
