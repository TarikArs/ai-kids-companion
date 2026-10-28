// explain-exercise: the buttons (Board and Camera) for exercise help. Voice requests go through child-talk;
// both use the same executor (_shared/help.ts), so the active exercise stays in sync.
//
// POST { session_id }                         "Explique-moi": explains the active exercise; no active one -> the only
//                                             exercise, or asks which one (tutor.ask_exercise with choices).
// POST { session_id, exercise_index }         Tap on a choice (position on the page): becomes the active exercise,
//                                             then the waiting help (said by voice before the choice) or an explanation.
// POST { session_id, action }                 action: explain | solve | correct on the active exercise; "choose" = show the choices.
//
// The photo is the context: exercises, instructions and the child's visible answers are extracted once per photo.

import { corsHeaders, json } from '../_shared/cors.ts';
import { gradeLabel } from '../_shared/language.ts';
import { makeLog } from '../_shared/log.ts';
import { decide, HELP_ACTIONS, type HelpAction, type Intent } from '../_shared/intent.ts';
import { execute, loadFocus, type HelpCtx } from '../_shared/help.ts';
import { latestSnapshot, pageContext } from '../_shared/page.ts';
import { broadcast } from '../_shared/broadcast.ts';
import { admin, getCaller, isHouseholdMember } from '../_shared/supabase.ts';

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;
const inBackground = (p: Promise<unknown>) => (typeof EdgeRuntime !== 'undefined' ? EdgeRuntime.waitUntil(p) : p);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const log = makeLog('explain-exercise');
  const body = await req.json().catch(() => ({}));
  const { session_id, exercise_index, action } = body as { session_id?: unknown; exercise_index?: unknown; action?: unknown };
  if (typeof session_id !== 'string') return json({ error: 'session_id is required' }, 400);

  const [user, { data: session }] = await Promise.all([
    getCaller(req),
    admin.from('homework_sessions').select('id, household_id, children(tutor_language, grade)').eq('id', session_id).maybeSingle(),
  ]);
  if (!user) return json({ error: 'Sign in first' }, 401);
  if (!session) return json({ error: 'Session not found' }, 404);
  if (!(await isHouseholdMember(user.id, session.household_id))) return json({ error: 'Not allowed' }, 403);

  const child = session.children as { tutor_language?: string; grade?: number } | null;
  const gradeNum = Number(child?.grade ?? 1);
  const topic = `session:${session.id}`;
  const started = Date.now();
  broadcast(topic, 'tutor.thinking', {});

  try {
    const [snap, { focus, pending }] = await Promise.all([latestSnapshot(session.id), loadFocus(session.id)]);
    const grade = gradeLabel(gradeNum);
    const page = snap ? await pageContext(snap, grade, inBackground) : null;
    const c: HelpCtx = {
      session: { id: session.id, household_id: session.household_id },
      topic,
      grade,
      advanced: gradeNum >= 4,
      setting: child?.tutor_language,
      snap,
      page,
      focus,
      pending,
      log,
    };

    const asked = HELP_ACTIONS.includes(action as HelpAction) ? (action as HelpAction) : null;
    const intent: Intent =
      action === 'choose'
        ? { act: 'choose', ex: null }
        : typeof exercise_index === 'number'
          ? { act: asked ?? pending ?? 'explain', ex: exercise_index, byPosition: true } // tap: the waiting help, else explain
          : { act: asked ?? 'explain', ex: null };
    log('start', {
      session: session.id,
      intent,
      focus: focus ? `${focus.index} ${focus.title}` : null,
      pending,
      photo: snap?.id ?? null,
      exercises: page?.exercises.map((e) => `${e.n}${e.label ? `(${e.label})` : ''}. ${e.title} [${e.items.length} items]`),
      readable: page?.readable,
    });

    const outcome = await execute(c, decide(intent, page, focus, pending), 'tap');
    return json({ ...outcome, ms: Date.now() - started });
  } catch (e) {
    console.error(e);
    broadcast(topic, 'tutor.say', { message_id: crypto.randomUUID(), kind: 'system', text: '', language: 'fr', annotations: [] });
    return json({ error: (e as Error).message }, 500);
  }
});
