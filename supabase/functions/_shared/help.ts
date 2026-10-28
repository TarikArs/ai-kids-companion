// Exercise help: the photo is the context, one exercise is the focus, the child asks for help on it
// (by voice in child-talk, by buttons in explain-exercise). One executor for both, so voice and taps stay in sync.

import { expectedAnswer, ownCalculationSlip, sameAnswer } from './arithmetic.ts';
import { broadcast } from './broadcast.ts';
import { FOCUS_TEXT, isArabic, LANGUAGE_NAME, SPEAKING_STYLE, tutorLang, type Lang } from './language.ts';
import { HELP_ACTIONS, type Decision, type FocusState, type HelpAction, type Intent } from './intent.ts';
import { downloadB64, type PageContext, type PageExercise, type SnapshotRow } from './page.ts';
import { admin } from './supabase.ts';
import { speechUrl } from './tts.ts';

const MODEL = Deno.env.get('OPENAI_VISION_MODEL') ?? 'gpt-6-luna';
const EFFORT = Deno.env.get('OPENAI_REASONING_EFFORT') ?? 'low';
const EFFORT_ADVANCED = Deno.env.get('OPENAI_REASONING_EFFORT_ADVANCED') ?? 'medium';
const FOCUS_COLOR = '#7FD3FF';

export interface HelpCtx {
  session: { id: string; household_id: string };
  topic: string;
  grade: string;
  advanced: boolean;
  /** Parent's tutor language ('auto' / null = follow the page). */
  setting: string | null | undefined;
  snap: (SnapshotRow & { taken_at?: string }) | null;
  page: PageContext | null;
  focus: FocusState | null;
  pending: HelpAction | null;
  log: (step: string, data?: unknown) => void;
}

export const languageFor = (c: HelpCtx, fallback?: string | null): Lang => tutorLang(c.setting, c.page?.lang ?? fallback ?? 'fr');
const forcedLang = (c: HelpCtx): Lang | null => (c.setting && c.setting !== 'auto' ? tutorLang(c.setting, null) : null);
const exName = (e: { n: number; label?: string }) => e.label ?? String(e.n);

// ---------- focus state ----------

export async function loadFocus(sessionId: string): Promise<{ focus: FocusState | null; pending: HelpAction | null }> {
  const { data, error } = await admin.from('homework_sessions').select('focus, pending_action').eq('id', sessionId).maybeSingle();
  if (error || !data) return { focus: null, pending: null }; // migration not applied yet: no memory, still works
  const f = data.focus as FocusState | null;
  return { focus: f && typeof f.index === 'number' ? f : null, pending: (data.pending_action as HelpAction | null) ?? null };
}

async function saveFocus(c: HelpCtx, e: PageExercise | null, by: 'voice' | 'tap' | 'auto', action: HelpAction | null, pending: HelpAction | null) {
  const focus = e
    ? {
        index: e.n,
        title: e.title,
        ...(e.label ? { label: e.label } : {}),
        ...(e.r ? { region: e.r } : {}),
        ...(c.snap ? { snapshot_id: c.snap.id } : {}),
        ...(action ? { action } : {}),
        at: new Date().toISOString(),
      }
    : null;
  const changed = (c.focus?.index ?? null) !== (focus?.index ?? null) || c.focus?.action !== focus?.action || c.pending !== pending;
  const { error } = await admin.from('homework_sessions').update({ focus, pending_action: pending }).eq('id', c.session.id);
  if (error) c.log('focus not saved (migration?)', error.message);
  c.focus = focus;
  c.pending = pending;
  if (changed || by === 'tap') await broadcast(c.topic, 'focus.changed', { focus, by });
}

async function savePending(c: HelpCtx, pending: HelpAction | null) {
  if (c.pending === pending) return;
  c.pending = pending;
  const { error } = await admin.from('homework_sessions').update({ pending_action: pending }).eq('id', c.session.id);
  if (error) c.log('pending not saved (migration?)', error.message);
}

export const choicesOf = (exs: PageExercise[]) =>
  exs.map((e) => ({ index: e.n, title: e.title, status: e.s, ...(e.r ? { region: e.r } : {}), ...(e.label ? { label: e.label } : {}) }));

// ---------- talking ----------

type Kind = 'explain' | 'hint' | 'question' | 'encourage' | 'praise';

async function say(
  c: HelpCtx,
  text: string,
  language: Lang,
  kind: Kind,
  opts: { exercise?: PageExercise; action?: HelpAction; annotations?: unknown[] } = {},
): Promise<string> {
  const audioUrl = await speechUrl(text, language);
  const messageId = crypto.randomUUID();
  const annotations = opts.annotations ?? [];
  await broadcast(c.topic, 'tutor.say', {
    message_id: messageId,
    kind,
    text,
    language,
    ...(audioUrl ? { audio_url: audioUrl } : {}),
    ...(c.snap ? { snapshot_id: c.snap.id } : {}),
    annotations,
    ...(opts.exercise ? { exercise_index: opts.exercise.n } : {}),
  });
  const row = { id: messageId, household_id: c.session.household_id, session_id: c.session.id, kind, text, language, annotations };
  const { error } = await admin
    .from('tutor_messages')
    .insert({ ...row, exercise_index: opts.exercise?.n ?? null, action: opts.action ?? null });
  if (error) await admin.from('tutor_messages').insert(row); // new columns missing (migration not applied)
  return messageId;
}

const frame = (e: PageExercise, color = FOCUS_COLOR) => (e.r ? [{ shape: 'text', region: e.r, text: exName(e), color }] : []);

/** Last turns of the conversation (20 min), oldest first, for follow-ups ("et après ?", "j'ai trouvé 50"). */
async function history(sessionId: string): Promise<string> {
  const since = new Date(Date.now() - 20 * 60_000).toISOString();
  const [{ data: kid }, { data: tutor }] = await Promise.all([
    admin.from('child_utterances').select('transcript, created_at').eq('session_id', sessionId).gte('created_at', since).order('created_at', { ascending: false }).limit(5),
    admin.from('tutor_messages').select('text, created_at').eq('session_id', sessionId).neq('kind', 'system').gte('created_at', since).order('created_at', { ascending: false }).limit(5),
  ]);
  const turns = [
    ...(kid ?? []).filter((k) => k.transcript).map((k) => ({ at: k.created_at, line: `Child: ${k.transcript}` })),
    ...(tutor ?? []).map((t) => ({ at: t.created_at, line: `Silia: ${t.text}` })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  return turns.slice(-8).map((t) => t.line).join('\n');
}

// ---------- prompts ----------

/** Answers checked in code (never by the model). */
function codeChecks(e: PageExercise) {
  return e.items.map((it) => {
    const expected = expectedAnswer(it.q);
    return {
      ...it,
      expected,
      ok: expected !== null && it.a !== null ? sameAnswer(it.a, expected) : null,
      slip: it.a ? ownCalculationSlip(it.a) : null,
    };
  });
}

function exerciseBlock(e: PageExercise, page: PageContext, secret: 'none' | 'verdicts' | 'answers'): string {
  const items = codeChecks(e)
    .map((it, i) => {
      const seen = it.a === null ? 'nothing visible' : `"${it.a}"${it.c < 0.6 ? ' (hard to read)' : ''}`;
      let check = '';
      if (secret !== 'none' && it.ok !== null) check = it.ok ? ' [code check: right]' : ` [code check: wrong${secret === 'answers' ? `, right answer ${it.expected}` : ''}]`;
      if (secret !== 'none' && it.slip) check += ` [her own calculation ${it.slip.calculation} makes ${it.slip.makes}, not ${it.slip.wrote}]`;
      if (secret === 'answers' && it.ok === null && it.expected !== null) check += ` [right answer ${it.expected}]`;
      return `${i + 1}. ${it.q || '(item)'} -> ${seen}${check}`;
    })
    .join('\n');
  const others = page.exercises.filter((x) => x.n !== e.n).map((x) => `${exName(x)}. ${x.title}`).join('; ');
  return `ACTIVE EXERCISE: number ${exName(e)} on the page${e.label ? ` (position ${e.n})` : ''}, "${e.title}"${
    e.r ? `, around x=${e.r.x.toFixed(2)} y=${e.r.y.toFixed(2)} w=${e.r.w.toFixed(2)} h=${e.r.h.toFixed(2)} (fractions of the photo)` : ''
  }.
Printed instruction: "${e.instr || '(not read)'}"
Her answers as read from the photo:
${items || '(no answer places found)'}
${others ? `Other exercises on the page (context only, do not work on them): ${others}` : ''}`;
}

function languageRule(c: HelpCtx): string {
  const forced = forcedLang(c);
  return forced
    ? `Write ONLY in ${LANGUAGE_NAME[forced]}, whatever the page's language${isArabic(forced) ? ', speaking to a girl (feminine forms)' : ''}. Put "lang":"${forced}".`
    : `Write in the exercise's own language: French page -> clear simple French; Arabic page -> simple Modern Standard Arabic (Fusha) in Arabic script, speaking to a girl (feminine forms), "lang":"fus"; English page -> simple English.`;
}

function taskFor(c: HelpCtx, action: HelpAction, level: number): string {
  const len = c.advanced ? 'max 16 words per sentence' : 'max 10 words per sentence';
  switch (action) {
    case 'explain':
      return `TASK: explain the ACTIVE EXERCISE. Do NOT just read the instruction back. Think first (what is asked, the method, the traps).
Say in your own words what has to be done, give the method step by step at the level of ${c.grade}${
        c.advanced ? ' (proper school vocabulary)' : ' (very concrete: fingers, objects, start from the bigger number…)'
      }, work ONE similar example with DIFFERENT numbers or words, then invite her to try.
${level >= 2 ? 'She already heard an explanation and is still stuck: explain it differently, simpler and more concrete, one step per sentence.' : ''}
${c.advanced ? '5 to 9' : '4 to 7'} sentences, ${len}. NEVER give the answer of an item on the page.`;
    case 'solve':
      return `TASK: solve the ACTIVE EXERCISE TOGETHER, like a teacher sitting next to her. She must do the work herself.
Look at the recent conversation: if you already started, continue from where you are. Otherwise start with the first item not done yet.
Say in one sentence what we are looking for, then give ONLY the next small step and ask her to do it and tell you the result.
3 to 5 sentences, ${len}. NEVER say the final answer of an item.`;
    case 'correct':
      return `TASK: correct the ACTIVE EXERCISE. Review her visible answers. The [code check] marks are exact arithmetic: trust them over your own.
Check the other answers (words, matching, spelling…) yourself on the photo.
If some answers are wrong: name the item (its position or its numbers), say kindly what went wrong and explain how to find the right answer, step by step, so she can fix it herself (max the 2 first mistakes).
If every visible answer is right: praise precisely what she did well.
If answers are empty, cut off or unreadable: say which ones you cannot see, instead of guessing.
3 to 7 sentences, ${len}. Do not just announce right results: explain the correction.`;
  }
}

async function askModelJson(content: unknown, effort: string, maxTokens?: number): Promise<Record<string, unknown>> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Deno.env.get('OPENAI_API_KEY')}` },
    body: JSON.stringify({
      model: MODEL,
      reasoning_effort: effort,
      response_format: { type: 'json_object' },
      ...(maxTokens ? { max_completion_tokens: maxTokens } : {}),
      messages: [{ role: 'user', content }],
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${body.slice(0, 300)}`);
  return JSON.parse(JSON.parse(body).choices[0].message.content);
}

async function explainLevel(c: HelpCtx, e: PageExercise): Promise<number> {
  const since = new Date(Date.now() - 20 * 60_000).toISOString();
  const { count, error } = await admin
    .from('tutor_messages')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', c.session.id)
    .eq('exercise_index', e.n)
    .eq('action', 'explain')
    .gte('created_at', since);
  return error ? 1 : (count ?? 0) + 1;
}

/** Explain / solve together / correct one exercise: looks at the photo again, with the extracted context. */
async function runHelp(c: HelpCtx, action: HelpAction, e: PageExercise): Promise<{ text: string; language: Lang }> {
  const [b64, convo, level] = await Promise.all([
    downloadB64(c.snap!.storage_path),
    action === 'explain' ? Promise.resolve('') : history(c.session.id),
    action === 'explain' ? explainLevel(c, e) : Promise.resolve(1),
  ]);
  const prompt = `Photo of homework done by a child in ${c.grade}. You are Silia, her kind, smart teacher (your name is always Silia).
The photo is the context of the conversation; focus ONLY on the active exercise below.
${exerciseBlock(e, c.page!, action === 'correct' ? 'answers' : 'none')}
${convo ? `Recent conversation:\n${convo}\n` : ''}
${taskFor(c, action, level)}
Look at the photo yourself to confirm the exercise and her answers (the list above may contain reading mistakes; the photo may be sideways).
If the exercise, its instruction or her answers cannot be read, say exactly what you cannot see and ask her to show it closer. Never invent.
${languageRule(c)}
Warm and encouraging. No lists, no numbering, no emojis: it is read aloud. Numbers as digits.
Return JSON only: {"lang":"fr|fus|ar|en","text":"..."}`;
  const out = await askModelJson(
    [
      { type: 'text', text: prompt },
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}`, detail: 'high' } },
    ],
    action === 'correct' || c.advanced ? EFFORT_ADVANCED : EFFORT,
  );
  const language = forcedLang(c) ?? tutorLang(null, String(out.lang ?? c.page?.lang ?? 'fr'));
  c.log('help', { action, exercise: exName(e), level, language, text: out.text });
  return { text: String(out.text ?? '').trim(), language };
}

// ---------- voice: understanding and follow-ups ----------

/** What the child wants, when the quick rules did not understand it (text-only, small). */
export async function classify(c: HelpCtx, transcript: string, lang: Lang): Promise<Intent> {
  const exs = c.page?.readable ? c.page.exercises : [];
  const convo = await history(c.session.id);
  const prompt = `A child (${c.grade}) doing homework spoke to her tutor Silia. Decide what she wants.
Exercises on the photo (position. printed number. title: instruction):
${exs.map((e) => `${e.n}. ${e.label ?? '-'}. ${e.title}: ${e.instr.slice(0, 120)}`).join('\n') || '(no photo or no exercise found)'}
Active exercise: ${c.focus ? `${c.focus.label ?? c.focus.index} "${c.focus.title}"${c.focus.action ? `, last help: ${c.focus.action}` : ''}` : 'none'}.
${c.pending ? `Silia just asked which exercise she wants for: ${c.pending}.` : ''}
${convo ? `Recent conversation:\n${convo}` : ''}
She said: "${transcript}"
Return JSON only: {"act":"explain|solve|correct|select|choose|question|clarify","ex":null,"clarify":""}
act: explain = explain the instruction or the ideas; solve = solve it together step by step; correct = check her answers;
select = she only names an exercise; choose = she wants another exercise or asks which ones there are;
question = anything else (a question, a step result, an answer to Silia, chat): it continues the active exercise;
clarify = her request is really ambiguous (which exercise? what help?): put ONE short question in clarify, in ${SPEAKING_STYLE[lang]}.
ex: the exercise number she said (printed number or position as she said it), "the next one" = active + 1, null for "it"/"this one"/none.
Never invent a number she did not say.`;
  try {
    const out = await askModelJson(prompt, 'low', 300);
    const act = String(out.act);
    const valid = [...HELP_ACTIONS, 'select', 'choose', 'question', 'clarify'];
    const ex = out.ex === null || out.ex === undefined || out.ex === '' ? null : Number(out.ex);
    return {
      act: (valid.includes(act) ? act : 'question') as Intent['act'],
      ex: ex !== null && Number.isFinite(ex) ? ex : null,
      ...(out.clarify ? { clarify: String(out.clarify) } : {}),
    };
  } catch (e) {
    c.log('classify failed', (e as Error).message);
    return { act: 'question', ex: null };
  }
}

/** A question or a step result about the active exercise (text-only, cheap). */
async function answerTurn(c: HelpCtx, transcript: string, e: PageExercise | null, lang: Lang): Promise<string | null> {
  const convo = await history(c.session.id);
  const mode = c.focus?.action;
  const prompt = `You are Silia, the kind teacher of a girl in ${c.grade}, helping with homework (your name is always Silia; in Arabic: سيليا).
${c.page?.text ? `Her homework page says:\n"""${c.page.text.slice(0, 1500)}"""` : 'There is no readable photo of her page yet.'}
${e ? `${exerciseBlock(e, c.page!, 'answers')}\nYou are ${mode === 'solve' ? 'solving this exercise together, step by step' : mode === 'correct' ? 'correcting this exercise with her' : 'helping her with this exercise'}. The right answers above are SECRET: never say them; use them only to tell her whether a step or a result she says is right.` : 'No exercise is selected.'}
${convo ? `Recent conversation:\n${convo}` : ''}
She just said: "${transcript}"
Answer in ${SPEAKING_STYLE[lang]}, 1 to 4 short sentences, warm, read aloud (no lists, no emojis).
If she gives a step or a result: say if it is right (praise) or not quite (kind hint), then give the next small step.
If her answer to an item cannot be seen on the photo, say so instead of guessing. Never give the final answer of an item.
If what she said is unclear, kindly ask her to repeat. Reply with the answer only.`;
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Deno.env.get('OPENAI_API_KEY')}` },
    body: JSON.stringify({ model: MODEL, reasoning_effort: 'low', max_completion_tokens: 700, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) return null;
  return String((await res.json()).choices?.[0]?.message?.content ?? '').trim() || null;
}

// ---------- executor ----------

export interface Outcome {
  done: Decision['do'];
  text: string;
  language: Lang;
  exercise?: number;
  action?: HelpAction | null;
  choices?: ReturnType<typeof choicesOf>;
  ask?: boolean;
}

export async function execute(
  c: HelpCtx,
  d: Decision,
  by: 'voice' | 'tap',
  opts: { transcript?: string; lang?: Lang } = {},
): Promise<Outcome> {
  const lang = opts.lang ?? languageFor(c);
  const T = FOCUS_TEXT[lang];
  c.log('decision', { do: d.do, ...('action' in d ? { action: d.action } : {}), ...('exercise' in d && d.exercise ? { exercise: exName(d.exercise) } : {}) });

  switch (d.do) {
    case 'no_photo':
    case 'unreadable':
    case 'no_exercise': {
      const text = d.do === 'no_photo' ? T.noPhoto : d.do === 'unreadable' ? T.unreadable : T.noExercise;
      await say(c, text, lang, 'encourage');
      return { done: d.do, text, language: lang };
    }
    case 'clarify': {
      await say(c, d.text, lang, 'question');
      return { done: d.do, text: d.text, language: lang };
    }
    case 'ask_which': {
      const exs = c.page!.exercises;
      const text =
        d.reason === 'not_found' && d.missing !== undefined ? T.notFound(d.missing, exs.map((e) => exName(e))) : T.askWhich(d.action);
      await savePending(c, d.action);
      const choices = choicesOf(exs);
      const audioUrl = await speechUrl(text, lang);
      await broadcast(c.topic, 'tutor.ask_exercise', {
        snapshot_id: c.snap!.id,
        language: lang,
        text,
        ...(audioUrl ? { audio_url: audioUrl } : {}),
        choices,
        ...(d.action ? { action: d.action } : {}),
      });
      return { done: d.do, text, language: lang, choices, action: d.action, ask: true };
    }
    case 'ask_action': {
      await saveFocus(c, d.exercise, by, null, null);
      const text = T.askAction(exName(d.exercise), d.exercise.title);
      await say(c, text, lang, 'question', { exercise: d.exercise, annotations: frame(d.exercise) });
      return { done: d.do, text, language: lang, exercise: d.exercise.n };
    }
    case 'answer': {
      const text = (await answerTurn(c, opts.transcript ?? '', d.exercise, lang)) ?? FOCUS_TEXT[lang].askWhich(null);
      await say(c, text, lang, 'question', d.exercise ? { exercise: d.exercise, action: c.focus?.action } : {});
      return { done: d.do, text, language: lang, exercise: d.exercise?.n };
    }
    case 'help': {
      // Focus first: the Board and the Camera show the active exercise while Silia thinks.
      await saveFocus(c, d.exercise, d.auto ? 'auto' : by, d.action, null);
      const { text, language } = await runHelp(c, d.action, d.exercise);
      const finalText = text || FOCUS_TEXT[language].askWhich(d.action);
      await say(c, finalText, language, d.action === 'correct' ? 'hint' : 'explain', {
        exercise: d.exercise,
        action: d.action,
        annotations: frame(d.exercise),
      });
      return { done: d.do, text: finalText, language, exercise: d.exercise.n, action: d.action };
    }
  }
}
