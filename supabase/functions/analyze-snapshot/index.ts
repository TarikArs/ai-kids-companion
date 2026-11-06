// analyze-snapshot: Lina pressed « Silia, regarde » (on the Camera, or on the Board). The ONLY way a photo is read.
//
// POST { snapshot_id, image_b64?, turn? }   Caller: a member of the household.
// image_b64: the JPEG sent directly by the Camera (no Storage download). Without it (the Board's current photo, when the
// Camera did not answer within 2 s), the photo is downloaded.
//
// Flow: one fast reading of the whole page (exercises + her answers), cached on the snapshot, then:
// - a practice exercise (« Exercice similaire ») is open and this photo is her work on it -> checked against its answers;
// - the active exercise is on this page, or there is only one -> verdict on it (only when sure, see _shared/verdict.ts);
// - several exercises -> « Je vois 3 exercices sur ta page. On commence par le 1 ? » (choices on the Board and the Camera);
// - no readable page -> she is asked for a new photo.

import { encodeBase64 } from 'jsr:@std/encoding@1/base64';

import { parseTurn, turnSender } from '../_shared/broadcast.ts';
import { corsHeaders, json } from '../_shared/cors.ts';
import { checkPractice, execute, loadFocus, type HelpCtx } from '../_shared/help.ts';
import type { Decision, FocusState } from '../_shared/intent.ts';
import { gradeLabel, SPEAKING_STYLE, tutorLang } from '../_shared/language.ts';
import { logTurn, makeLog } from '../_shared/log.ts';
import { DEFAULT_HINT_LANG, pageOf, READ_EFFORT, READ_MODEL, readPage, type PageContext, type PageExercise } from '../_shared/page.ts';
import { admin, getCaller, isHouseholdMember } from '../_shared/supabase.ts';

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** The active exercise, if it is on this page (titles vary between readings: its items are compared too). */
async function activeOnPage(focus: FocusState | null, exs: PageExercise[]): Promise<PageExercise | null> {
  if (!focus) return null;
  const same = exs.find((e) => e.n === focus.index);
  if (!same) return null;
  if (norm(same.title) === norm(focus.title)) return same;
  if (!focus.snapshot_id) return null;
  const { data } = await admin.from('snapshots').select('exercises').eq('id', focus.snapshot_id).maybeSingle();
  const before = (data?.exercises as PageContext | null)?.exercises?.find((e) => e.n === focus.index);
  if (!before || !same.items.length) return null;
  const qs = new Set(before.items.map((i) => norm(i.q)));
  return same.items.filter((i) => qs.has(norm(i.q))).length * 2 >= same.items.length ? same : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const log = makeLog('analyze-snapshot');
  const body = (await req.json().catch(() => ({}))) as { snapshot_id?: unknown; image_b64?: unknown; turn?: unknown };
  const { snapshot_id, image_b64 } = body;
  const turn = parseTurn(body.turn);
  if (typeof snapshot_id !== 'string') return json({ error: 'snapshot_id is required' }, 400);

  const [user, { data: snap }] = await Promise.all([
    getCaller(req),
    admin.from('snapshots').select('id, household_id, session_id, storage_path').eq('id', snapshot_id).maybeSingle(),
  ]);
  if (!user) return json({ error: 'Sign in first' }, 401);
  if (!snap) return json({ error: 'Snapshot not found' }, 404);
  const [allowed, { data: session }] = await Promise.all([
    isHouseholdMember(user.id, snap.household_id),
    admin.from('homework_sessions').select('rotation, children(tutor_language, grade)').eq('id', snap.session_id).maybeSingle(),
  ]);
  if (!allowed) return json({ error: 'Not allowed' }, 403);
  const child = session?.children as { tutor_language?: string; grade?: number } | null;
  const grade = gradeLabel(child?.grade);

  const send = turnSender(`session:${snap.session_id}`, turn);
  // The Board shows the photo with the scan and « Je regarde ton exercice… » right away.
  send('tutor.thinking', { snapshot_id: snap.id });
  const started = Date.now();
  const t: Record<string, number> = {};
  let last = started;
  const lap = (name: string) => {
    const now = Date.now();
    t[name] = now - last;
    last = now;
  };

  try {
    let b64: string;
    if (typeof image_b64 === 'string' && image_b64.length > 1000) {
      b64 = image_b64.includes(',') ? image_b64.slice(image_b64.indexOf(',') + 1) : image_b64;
    } else {
      const { data: file, error } = await admin.storage.from('snapshots').download(snap.storage_path);
      if (error || !file) throw new Error(`download: ${error?.message}`);
      b64 = encodeBase64(new Uint8Array(await file.arrayBuffer()));
    }
    lap('download_ms');

    const setting = child?.tutor_language;
    const hintLang = setting && setting !== 'auto' ? `in ${SPEAKING_STYLE[tutorLang(setting, null)]}` : DEFAULT_HINT_LANG;
    const [reading, { focus, pending }] = await Promise.all([readPage(b64, grade, hintLang), loadFocus(snap.session_id)]);
    lap('vision_ms');
    log('reading', {
      readable: reading.readable,
      hand: reading.handBlocking,
      lang: reading.lang,
      rot: reading.rot,
      exercises: reading.exercises.map((e) => `${e.n}. ${e.title}: ${e.items.map((i) => `${i.q} -> ${i.a ?? '-'} (${i.c})`).join(' | ')}`),
      usage: reading.usage,
    });

    // Orientation is decided ONCE per session (the phone stays on its stand); the Board's rotate button can correct it.
    if (session && (session as { rotation?: number | null }).rotation === null && reading.readable) {
      await admin.from('homework_sessions').update({ rotation: reading.rot }).eq('id', snap.session_id);
      send('session.rotation', { rotation: reading.rot });
    }

    const usable = reading.readable && !reading.handBlocking;
    const page: PageContext = usable ? pageOf(reading) : { ...pageOf(reading), readable: false };
    // Saved BEFORE answering: a tap on an exercise right after uses this reading (no second reading of the page).
    await admin.from('snapshots').update({ status: usable ? 'analyzed' : 'skipped', exercises: page, page_lang: page.lang }).eq('id', snap.id);
    if (!usable) send('snapshot.rejected', { snapshot_id: snap.id, reason: reading.handBlocking ? 'hand_blocking' : 'no_page' });

    const c: HelpCtx = {
      session: { id: snap.session_id, household_id: snap.household_id },
      topic: `session:${snap.session_id}`,
      turn,
      grade,
      advanced: Number(child?.grade ?? 1) >= 4,
      setting,
      snap: { id: snap.id, storage_path: snap.storage_path, exercises: page },
      photoB64: b64,
      page,
      focus,
      pending,
      log,
    };
    const exs = page.exercises;
    const target = (await activeOnPage(focus, exs)) ?? (exs.length === 1 ? exs[0] : null);
    const decision: Decision = !usable
      ? { do: 'unreadable', why: reading.handBlocking ? 'hand' : 'no page' }
      : !exs.length
        ? { do: 'no_exercise' }
        : target
          ? { do: 'help', action: 'correct', exercise: target, focusChanged: focus?.index !== target.n }
          : { do: 'ask_which', action: 'correct', reason: 'several' };
    // After « Exercice similaire »: is this photo her work on that practice? Then it is checked against its answers.
    const outcome = (usable ? await checkPractice(c) : null) ?? (await execute(c, decision, 'tap'));
    lap('answer_ms');

    const ms = Date.now() - started;
    logTurn({
      fn: 'analyze-snapshot',
      session_id: snap.session_id,
      household_id: snap.household_id,
      turn_id: turn?.id ?? null,
      ms,
      timings: t,
      model: READ_MODEL,
      effort: READ_EFFORT,
      usage: reading.usage,
      outcome: outcome.done,
      extra: { exercises: exs.length, image_kb: Math.round((b64.length * 0.75) / 1000) },
    });
    return json({ ...outcome, exercises: exs.length, ms, timings: t });
  } catch (e) {
    console.error(e);
    await admin.from('snapshots').update({ status: 'failed' }).eq('id', snap.id);
    await send('tutor.say', { message_id: crypto.randomUUID(), kind: 'system', text: '', language: 'fr', annotations: [] });
    return json({ error: (e as Error).message }, 500);
  }
});
