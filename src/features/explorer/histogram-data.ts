import type { Bin } from '../../contracts/desktop-api';
import type { changeset } from 'vega';

type Datum = Omit<Bin, 'left' | 'right'> & { left: number | string; right: number | string };
const counts = ['background', 'foreground', 'rBackground', 'rForeground'] as const;

/** Keep Vega's input tuples (including date-transform inputs) alive across crossfilters. */
export function createHistogramUpdater(vega: { changeset: typeof changeset }, isDate: boolean) {
  let tuples = new Map<string, Datum>();
  return (bins: Bin[]) => {
    const changes = vega.changeset(), next = new Map<string, Datum>();
    let changed = false;
    for (const bin of bins) {
      if (!Number.isFinite(bin.left) || !Number.isFinite(bin.right)) continue;
      const key = JSON.stringify([bin.left, bin.right]);
      let tuple = tuples.get(key);
      if (tuple) {
        for (const field of counts) if (tuple[field] !== bin[field]) {
          changes.modify(tuple, field, bin[field]); changed = true;
        }
      } else {
        tuple = { ...bin, left: isDate ? new Date(bin.left!).toISOString() : bin.left!, right: isDate ? new Date(bin.right!).toISOString() : bin.right! };
        changes.insert(tuple); changed = true;
      }
      next.set(key, tuple);
    }
    for (const [key, tuple] of tuples) if (!next.has(key)) { changes.remove(tuple); changed = true; }
    tuples = next;
    return changed ? changes : null;
  };
}
