// One JSON line per step, visible in Supabase > Edge Functions > (function) > Logs.
// Each request gets a short id so its steps can be followed together.
export function makeLog(fn: string) {
  const req = crypto.randomUUID().slice(0, 8);
  const t0 = Date.now();
  return (step: string, data?: unknown) =>
    console.log(JSON.stringify({ fn, req, ms: Date.now() - t0, step, ...(data !== undefined ? { data } : {}) }));
}
