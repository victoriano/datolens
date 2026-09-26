import { expect, test } from 'bun:test';
import { runSemanticQueue } from './semantic-queue';

test('a failed variable retains other results and obeys the exact call budget without retries', async () => {
  const attempted: string[] = [], completed: string[] = [], errors: string[] = [];
  const count = await runSemanticQueue({ jobs: ['agreement', 'bad', 'frequency', 'brand'], maxCalls: 3, shouldStop: () => false,
    run: async job => { attempted.push(job); if (job === 'bad') throw new Error('Provider failure'); return `${job} proposal`; },
    onResult: (job, result) => { if ('error' in result) errors.push(job); else completed.push(result.value); },
  });
  expect(count).toBe(3);
  expect(attempted).toEqual(['agreement', 'bad', 'frequency']);
  expect(completed).toEqual(['agreement proposal', 'frequency proposal']);
  expect(errors).toEqual(['bad']);
});

test('stop waits for the active request and preserves it without starting the next one', async () => {
  let stop = false, release: () => void = () => {};
  const results: number[] = [];
  const pending = new Promise<void>(resolve => { release = resolve; });
  const run = runSemanticQueue({ jobs: [1, 2, 3], maxCalls: 3, shouldStop: () => stop,
    run: async job => { await pending; return job; },
    onResult: (_, result) => { if ('value' in result) results.push(result.value); },
  });
  stop = true; release();
  expect(await run).toBe(1); expect(results).toEqual([1]);
});

test('closing the dialog invalidates late results as well as queued calls', async () => {
  let version = 1, release: () => void = () => {};
  const pending = new Promise<void>(resolve => { release = resolve; });
  const results: number[] = [];
  const run = runSemanticQueue({ jobs: [1, 2], maxCalls: 2, shouldStop: () => version !== 1,
    run: async job => { await pending; return job; },
    onResult: (_, result) => { if (version === 1 && 'value' in result) results.push(result.value); },
  });
  version++; release();
  expect(await run).toBe(1); expect(results).toEqual([]);
});
