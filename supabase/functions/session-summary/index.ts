// session-summary: end of the session, like a teacher. Called by the Camera's "Terminer" before the session closes.
//
// POST { session_id, turn? }   Caller: a member of the household.
// 1. Gathers what happened: plan, answers checked (right / wrong), hints, explanations, reading fixes, duration.
// 2. One text-only call writes two texts: a short spoken recap for the child (real achievements + ONE thing to practise)
//    and a short report for the parent.
// 3. Silia says the recap on the Board; the report is saved on the session (homework_sessions.summary) for the parent app.

import { corsHeaders, json } from '../_shared/cors.ts';
import { parseTurn, turnSender } from '../_shared/broadcast.ts';
import { gradeLabel, SPEAKING_STYLE, tutorLang, type Lang } from '../_shared/language.ts';
import { makeLog } from '../_shared/log.ts';
import type { SessionPlan } from '../_shared/plan.ts';
import { admin, getCaller, isHouseholdMember } from '../_shared/supabase.ts';
import { speechUrl } from '../_shared/tts.ts';

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;
const inBackground = (p: Promise<unknown>) => (typeof EdgeRuntime !== 'undefined' ? EdgeRuntime.waitUntil(p) : p);

const MODEL = Deno.env.get('OPENAI_VISION_MODEL') ?? 'gpt-6-luna';

const FALLBACK_CHILD: Record<Lang, (n: number) => string> = {
  fr: (n) => `Bravo, tu as bien travaillé ce soir${n ? ` : ${n} réponses vérifiées` : ''} ! À demain !`,
  ar: (n) => `برافو، خدمتي مزيان هاد الليلة${n ? `: ${n} أجوبة` : ''}! نتلاقاو غدا!`,
  fus: (n) => `أحسنتِ، عملتِ جيدًا هذا المساء${n ? `: ${n} أجوبة` : ''}! إلى الغد!`,
  en: (n) => `Well done, you worked well tonight${n ? `: ${n} answers checked` : ''}! See you tomorrow!`,
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const log = makeLog('session-summary');
  const body = (await req.json().catch(() => ({}))) as { session_id?: unknown; turn?: unknown };
  if (typeof body.session_id !== 'string') return json({ error: 'session_id is required' }, 400);

  const [user, { data: session }] = await Promise.all([
    getCaller(req),
    admin.from('homework_sessions').select('id, household_id, started_at, children(name, tutor_language, grade)').eq('id', body.session_id).maybeSingle(),
  ]);
  if (!user) return json({ error: 'Sign in first' }, 401);
  if (!session) return json({ error: 'Session not found' }, 404);
  if (!(await isHouseholdMember(user.id, session.household_id))) return json({ error: 'Not allowed' }, 403);

  const child = session.children as { name?: string; tutor_language?: string; grade?: number } | null;
  const send = turnSender(`session:${session.id}`, parseTurn(body.turn));
  send('tutor.thinking', {});

  try {
    const [{ data: obs }, { data: msgs }, { data: talk }, planRow] = await Promise.all([
      admin.from('observations').select('item_id, observed_answer, is_correct, created_at').eq('session_id', session.id).order('created_at'),
      admin.from('tutor_messages').select('kind, text, language, action, created_at').eq('session_id', session.id).neq('kind', 'system').order('created_at'),
      admin.from('child_utterances').select('transcript').eq('session_id', session.id),
      admin.from('homework_sessions').select('plan').eq('id', session.id).maybeSingle(),
    ]);
    // Latest verdict per item (an answer corrected later counts as right).
    const latest = new Map<string, { a: string | null; ok: boolean | null }>();
    for (const o of obs ?? []) latest.set(o.item_id, { a: o.observed_answer, ok: o.is_correct });
    const verdicts = [...latest.values()];
    const right = verdicts.filter((v) => v.ok === true).length;
    const wrongNow = verdicts.filter((v) => v.ok === false).length;
    const fixedLater = (obs ?? []).filter((o) => o.is_correct === false).map((o) => o.item_id).filter((id) => latest.get(id)?.ok === true);
    const minutes = Math.max(1, Math.round((Date.now() - Date.parse(session.started_at)) / 60_000));
    const plan = (planRow.error ? null : (planRow.data?.plan as SessionPlan | null)) ?? null;
    const language: Lang = tutorLang(child?.tutor_language, msgs?.at(-1)?.language ?? 'fr');
    const helped = (msgs ?? []).filter((m) => m.kind === 'hint' || m.kind === 'explain').map((m) => m.text).slice(-8);
    const readingFixes = (msgs ?? []).map((m) => String(m.action ?? '')).filter((a) => a.startsWith('reading_fix:')).map((a) => a.slice(12));

    const facts = {
      minutes,
      subjects: plan?.items.map((i) => `${i.label} (${i.status})`) ?? [],
      answers_checked: verdicts.length,
      right,
      still_wrong: wrongNow,
      corrected_after_a_hint: [...new Set(fixedLater)].length,
      silia_helped_with: helped,
      words_to_practise_reading: [...new Set(readingFixes)].slice(0, 5),
      times_she_spoke: talk?.length ?? 0,
    };
    log('facts', facts);

    let childText = '';
    let parentText = '';
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Deno.env.get('OPENAI_API_KEY')}` },
        body: JSON.stringify({
          model: MODEL,
          reasoning_effort: 'low',
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'user',
              content: `You are Silia, the kind teacher of ${child?.name ?? 'a girl'}, ${gradeLabel(child?.grade)}. The homework session just ended.
What happened (facts only, do not invent anything else): ${JSON.stringify(facts)}
Write two texts. Return JSON only: {"child":"...","parent":"..."}
child: spoken to her now, in ${SPEAKING_STYLE[language]}: 2 or 3 short sentences. Name 1 or 2 REAL things she did well (from the facts),
then ONE thing to practise tomorrow (the thing that needed the most help), then a warm goodbye. No lists, no emojis, numbers as digits.
parent: for the parent, in French, 3 to 5 short lines: time spent, what was done, what went well, what needed help, one simple
suggestion for tomorrow. Plain, factual, kind. No emojis.`,
            },
          ],
        }),
      });
      if (res.ok) {
        const out = JSON.parse((await res.json()).choices[0].message.content);
        childText = String(out.child ?? '').trim();
        parentText = String(out.parent ?? '').trim();
      }
    } catch (e) {
      log('model failed', (e as Error).message);
    }
    if (!childText) childText = FALLBACK_CHILD[language](verdicts.length);
    if (!parentText) {
      parentText = `Séance de ${minutes} min. ${verdicts.length} réponses vérifiées, ${right} justes${wrongNow ? `, ${wrongNow} à revoir` : ''}.`;
    }

    const summary = {
      child_text: childText,
      parent_text: parentText,
      language,
      minutes,
      answers: verdicts.length,
      right,
      wrong: wrongNow,
      at: new Date().toISOString(),
    };
    const audioUrl = await speechUrl(childText, language);
    const messageId = crypto.randomUUID();
    await send('tutor.say', { message_id: messageId, kind: 'praise', text: childText, language, ...(audioUrl ? { audio_url: audioUrl } : {}), annotations: [] });
    inBackground(
      Promise.all([
        admin.from('homework_sessions').update({ summary }).eq('id', session.id),
        admin.from('tutor_messages').insert({ id: messageId, household_id: session.household_id, session_id: session.id, kind: 'praise', text: childText, language }),
      ]),
    );
    log('summary', summary);
    return json(summary);
  } catch (e) {
    console.error(e);
    send('tutor.say', { message_id: crypto.randomUUID(), kind: 'system', text: '', language: 'fr', annotations: [] });
    return json({ error: (e as Error).message }, 500);
  }
});
