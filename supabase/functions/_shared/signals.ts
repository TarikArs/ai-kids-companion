// Quality signals (table feedback_signals): what went wrong or right, measured from what the child does next.
// Never blocks the answer; a missing table is ignored. Read by supabase/queries/quality.sql.

import { admin } from './supabase.ts';

/** Bump when a prompt changes: the report compares versions. */
export const PROMPT_VERSION = '2026-11-08.1';

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

export type SignalKind =
  | 'photo' // a photo was read (data: exercises, same_page, since_prev_s)
  | 'action' // a help action (data: action, by)
  | 'verdict' // a check (data: right, wrong, unsure, open, empty)
  | 'unsure_asked' // « Je lis X, c'est bien ça ? » (data: q, read)
  | 'wrong_said' // Silia said an answer is wrong (data: q, a)
  | 'misread' // after « je lis X ? » she gave something else (data: q, read, said)
  | 'read_confirmed' // after « je lis X ? » she confirmed it
  | 'verdict_disputed' // after « wrong » she gave the same answer again (data: q, a, said)
  | 'timeout'; // the Board waited 45 s for an answer (written by the Board)

export function signal(
  c: { session: { id: string; household_id: string }; snap?: { id: string } | null; log?: (s: string, d?: unknown) => void },
  kind: SignalKind,
  data: Record<string, unknown> = {},
  extra: { exercise?: number | null; model?: string; ms?: number } = {},
) {
  const p = Promise.resolve(
    admin.from('feedback_signals').insert({
      household_id: c.session.household_id,
      session_id: c.session.id,
      snapshot_id: c.snap?.id ?? null,
      kind,
      exercise: extra.exercise ?? null,
      data,
      prompt_version: PROMPT_VERSION,
      model: extra.model ?? null,
      ms: extra.ms ?? null,
    }),
  ).then(({ error }) => {
    if (error) c.log?.('signal not saved', error.message);
  });
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(p);
}

const key = (s: string) => s.toLowerCase().replace(/[\s.,;:!?«»"']+/g, '');
const YES = /^(oui|ouais|yes|yeah|c'?est ça|exact|نعم|اه|إيه|واه|صحيح)\b/i;

/**
 * Her answer right after Silia asked « je lis X ? » or said X was wrong (last 5 minutes): was the reading or the verdict
 * wrong? Heuristic on purpose (« probable »): the report counts them, a person reviews them.
 */
export async function judgeFollowUp(
  c: { session: { id: string; household_id: string }; snap?: { id: string } | null; log?: (s: string, d?: unknown) => void },
  said: string,
) {
  const since = new Date(Date.now() - 5 * 60_000).toISOString();
  const { data } = await admin
    .from('feedback_signals')
    .select('kind, data, exercise, snapshot_id')
    .eq('session_id', c.session.id)
    .in('kind', ['unsure_asked', 'wrong_said'])
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1);
  const last = data?.[0] as { kind: string; data: { q?: string; read?: string; a?: string }; exercise: number | null; snapshot_id: string | null } | undefined;
  if (!last) return;
  const ctx = { ...c, snap: last.snapshot_id ? { id: last.snapshot_id } : c.snap };
  const s = key(said);
  if (!s) return;
  if (last.kind === 'unsure_asked') {
    const read = key(last.data.read ?? '');
    if (YES.test(said.trim()) || (read && s.includes(read))) signal(ctx, 'read_confirmed', { q: last.data.q }, { exercise: last.exercise });
    else signal(ctx, 'misread', { q: last.data.q, read: last.data.read, said: said.slice(0, 80) }, { exercise: last.exercise });
  } else {
    const a = key(last.data.a ?? '');
    if (a && s.includes(a)) signal(ctx, 'verdict_disputed', { q: last.data.q, a: last.data.a, said: said.slice(0, 80) }, { exercise: last.exercise });
  }
}
