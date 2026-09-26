import type { AnalysisSampling } from '../../contracts/desktop-api';

export const MAX_SAMPLE_ROWS = 5_000_000;
export function normalizeSampling(value: unknown): AnalysisSampling {
  if (value && typeof value === 'object' && 'mode' in value) {
    if (value.mode === 'full') return { mode: 'full' };
    if (value.mode === 'rows' && 'rows' in value && typeof value.rows === 'number' && Number.isSafeInteger(value.rows) && value.rows >= 1 && value.rows <= MAX_SAMPLE_ROWS) return { mode: 'rows', rows: value.rows };
  }
  return { mode: 'auto' };
}

/** One native call in flight. Superseded work is dropped before it reaches IPC. */
export function createQueryQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return function enqueue<T>(work: () => Promise<T>, cancelled: () => boolean): Promise<T | null> {
    const next = tail.then(() => cancelled() ? null : work());
    tail = next.catch(() => {});
    return next;
  };
}
