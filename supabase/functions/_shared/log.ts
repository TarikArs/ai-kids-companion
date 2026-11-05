// One JSON line per step, visible in Supabase > Edge Functions > (function) > Logs.
// Each request gets a short id so its steps can be followed together.
export function makeLog(fn: string) {
  const req = crypto.randomUUID().slice(0, 8);
  const t0 = Date.now();
  return (step: string, data?: unknown) =>
    console.log(JSON.stringify({ fn, req, ms: Date.now() - t0, step, ...(data !== undefined ? { data } : {}) }));
}

import { admin } from './supabase.ts';

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

/**
 * One row per turn in turn_logs: time per step, model, tokens, outcome. Used to measure speed and cost
 * (see the queries in supabase/queries/speed.sql). Never blocks the answer; a missing table is ignored.
 */
export function logTurn(row: {
  fn: string;
  session_id: string;
  household_id: string;
  turn_id?: string | null;
  priority?: string | null;
  ms: number;
  timings?: Record<string, number>;
  model?: string;
  effort?: string;
  usage?: unknown;
  outcome?: string;
  extra?: Record<string, unknown>;
}) {
  const p = Promise.resolve(admin.from('turn_logs').insert(row)).then(({ error }) => {
    if (error) console.log(JSON.stringify({ fn: row.fn, step: 'turn log not saved', error: error.message }));
  });
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(p);
}
