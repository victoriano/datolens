import type { Bin, Distribution } from '../../contracts/desktop-api';

function sameFields(a: object | undefined, b: object | undefined) {
  if (a === b) return true;
  if (!a || !b) return false;
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && Object.is(left[key], right[key]));
}
const binKey = (bin: Bin) => JSON.stringify([bin.value, bin.left, bin.right]);

/** IPC results are fresh objects. Retain equal data at the chart and individual bar boundaries. */
export function shareDistribution(previous: Distribution | undefined, incoming: Distribution): Distribution {
  if (!previous || previous.column !== incoming.column || previous.kind !== incoming.kind) return incoming;
  if (previous === incoming) return previous;
  const byBin = new Map(previous.bins.map(bin => [binKey(bin), bin]));
  const shared = incoming.bins.map(bin => {
    const old = byBin.get(binKey(bin));
    return sameFields(old, bin) ? old! : bin;
  });
  const bins = shared.length === previous.bins.length && shared.every((bin, i) => bin === previous.bins[i]) ? previous.bins : shared;
  const statistics = sameFields(previous.statistics, incoming.statistics) ? previous.statistics : incoming.statistics;
  return bins === previous.bins && statistics === previous.statistics && previous.truncated === incoming.truncated
    ? previous : { ...incoming, bins, statistics };
}
