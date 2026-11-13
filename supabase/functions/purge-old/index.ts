// purge-old: deletes what the privacy policy promises to keep only RETENTION_DAYS (default 30) days:
// homework photos (files + rows), what the child said or typed, Silia's messages, technical logs, recorded audio,
// and cached voice files that are not shared familiar phrases. Session summaries and the account stay.
//
// POST {}   Header: x-admin-token: <PURGE_TOKEN>   (secret set with `supabase secrets set`)
// Called once a day by pg_cron (migration 20261111100000_privacy.sql). Deployed with --no-verify-jwt:
// the admin token is the only access check.

import { corsHeaders, json } from '../_shared/cors.ts';
import { admin } from '../_shared/supabase.ts';

const DAYS = Number(Deno.env.get('RETENTION_DAYS') ?? '30') || 30;
const BATCH = 500;

/** Constant-time comparison: the token is not guessable byte by byte. */
function sameToken(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/** Removes storage files in batches; returns how many were removed. */
async function removeFiles(bucket: string, paths: string[]): Promise<number> {
  let n = 0;
  for (let i = 0; i < paths.length; i += 100) {
    const part = paths.slice(i, i + 100);
    const { error } = await admin.storage.from(bucket).remove(part);
    if (error) throw new Error(`${bucket}: ${error.message}`);
    n += part.length;
  }
  return n;
}

/** Old files of a bucket (storage schema is read through a service-role-only SQL function). */
async function oldObjects(bucket: string, before: string): Promise<string[]> {
  const { data, error } = await admin.rpc('storage_objects_before', { p_bucket: bucket, p_before: before, p_limit: BATCH * 4 });
  if (error) throw new Error(`storage_objects_before(${bucket}): ${error.message}`);
  return ((data ?? []) as { name: string }[]).map((r) => r.name);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const expected = Deno.env.get('PURGE_TOKEN') ?? '';
  const given = req.headers.get('x-admin-token') ?? '';
  if (expected.length < 24) return json({ error: 'PURGE_TOKEN is not set (min 24 characters)' }, 500);
  if (!sameToken(given, expected)) return json({ error: 'Admin only' }, 403);

  const before = new Date(Date.now() - DAYS * 86_400_000).toISOString();
  const done: Record<string, number> = {};
  try {
    // 1. Homework photos: files first, then the rows (observations follow by cascade).
    let photos = 0;
    for (;;) {
      const { data, error } = await admin.from('snapshots').select('id, storage_path').lt('created_at', before).limit(BATCH);
      if (error) throw new Error(`snapshots: ${error.message}`);
      if (!data?.length) break;
      await removeFiles('snapshots', data.map((r) => r.storage_path as string).filter(Boolean));
      const { error: del } = await admin.from('snapshots').delete().in('id', data.map((r) => r.id as string));
      if (del) throw new Error(`snapshots delete: ${del.message}`);
      photos += data.length;
      if (data.length < BATCH) break;
    }
    done.photos = photos;
    // Photo files whose row is already gone (failed uploads).
    done.photo_files = await removeFiles('snapshots', await oldObjects('snapshots', before));

    // 2. What the child said or typed, Silia's messages, technical logs.
    for (const table of ['child_utterances', 'tutor_messages', 'turn_logs', 'feedback_signals']) {
      const { error, count } = await admin.from(table).delete({ count: 'exact' }).lt('created_at', before);
      if (error) throw new Error(`${table}: ${error.message}`);
      done[table] = count ?? 0;
    }

    // 3. Recorded audio (if any) and cached voice files, except the shared familiar phrases.
    done.audio_in = await removeFiles('audio-in', await oldObjects('audio-in', before));
    const { data: phrases, error: pe } = await admin.from('tutor_phrases').select('audio_path');
    if (pe) throw new Error(`tutor_phrases: ${pe.message}`);
    const keep = new Set((phrases ?? []).map((r) => r.audio_path as string));
    done.tts_cache = await removeFiles('tts-cache', (await oldObjects('tts-cache', before)).filter((p) => !keep.has(p)));
  } catch (e) {
    console.error(JSON.stringify({ fn: 'purge-old', error: (e as Error).message, done }));
    return json({ error: (e as Error).message, done }, 500);
  }
  console.log(JSON.stringify({ fn: 'purge-old', before, done }));
  return json({ before, done });
});
