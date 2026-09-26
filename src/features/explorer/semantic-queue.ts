/** One call at a time, no automatic retries. Stop keeps the current result. */
export async function runSemanticQueue<Job, Result>({ jobs, maxCalls, shouldStop, run, onResult }: {
  jobs: Job[];
  maxCalls: number;
  shouldStop: () => boolean;
  run: (job: Job, index: number) => Promise<Result>;
  onResult: (job: Job, result: { value: Result } | { error: unknown }) => void;
}): Promise<number> {
  const limit = Number.isFinite(maxCalls) ? Math.max(0, Math.floor(maxCalls)) : 0;
  let calls = 0;
  for (const job of jobs.slice(0, limit)) {
    if (shouldStop()) break;
    let result: { value: Result } | { error: unknown };
    try { result = { value: await run(job, calls++) }; }
    catch (error) { result = { error }; }
    onResult(job, result);
  }
  return calls;
}
