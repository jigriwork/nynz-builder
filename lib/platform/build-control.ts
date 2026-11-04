/** Keep cancellation, suspension and lease checks live during provider calls. */
export async function watchBuild(check: () => Promise<void>, intervalMs = 2_000) {
  const controller = new AbortController();
  await check();
  let stopped = false;
  let busy = false;
  const timer = setInterval(async () => {
    if (busy || stopped || controller.signal.aborted) return;
    busy = true;
    try { await check(); }
    catch (error) { if (!stopped) controller.abort(error); }
    finally { busy = false; }
  }, intervalMs);
  timer.unref?.();
  return { signal: controller.signal, stop: () => { stopped = true; clearInterval(timer); } };
}
