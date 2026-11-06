// Exercise help: the photo is the context, one exercise is the focus, the child asks for help on it
// (by voice in child-talk, by buttons in explain-exercise). One executor for both, so voice and taps stay in sync.

import { expectedAnswer, ownCalculationSlip, sameAnswer } from './arithmetic.ts';
import { checkCopy, copyModel } from './copy.ts';
import { broadcast, type Turn } from './broadcast.ts';
import { FOCUS_TEXT, isArabic, LANGUAGE_NAME, PHRASES, SPEAKING_STYLE, tutorLang, VERDICT_TEXT, type Lang } from './language.ts';
import { HELP_ACTIONS, type Decision, type FocusState, type HelpAction, type Intent, type Practice } from './intent.ts';
import { downloadB64, type PageContext, type PageExercise, type SnapshotRow } from './page.ts';
import { admin } from './supabase.ts';
import { speechUrl } from './tts.ts';
import { checkOpen, confirm, guideQuestion, hintFor, judge, practiceLines, type Line, type LineStatus } from './verdict.ts';

const MODEL = Deno.env.get('OPENAI_VISION_MODEL') ?? 'gpt-6-luna';
const EFFORT = Deno.env.get('OPENAI_REASONING_EFFORT') ?? 'low';
const EFFORT_ADVANCED = Deno.env.get('OPENAI_REASONING_EFFORT_ADVANCED') ?? 'medium';
const FOCUS_COLOR = '#7FD3FF';

export interface HelpCtx {
  session: { id: string; household_id: string };
  topic: string;
  /** The turn this request belongs to (echoed on every message). */
  turn?: Turn | null;
  grade: string;
  advanced: boolean;
  /** Parent's tutor language ('auto' / null = follow the page). */
  setting: string | null | undefined;
  snap: (SnapshotRow & { taken_at?: string }) | null;
  /** The photo as already in memory (analyze-snapshot): no second download for the checks. */
  photoB64?: string;
  page: PageContext | null;
  focus: FocusState | null;
  pending: HelpAction | null;
  log: (step: string, data?: unknown) => void;
}

export const languageFor = (c: HelpCtx, fallback?: string | null): Lang => tutorLang(c.setting, c.page?.lang ?? fallback ?? 'fr');
const forcedLang = (c: HelpCtx): Lang | null => (c.setting && c.setting !== 'auto' ? tutorLang(c.setting, null) : null);
const exName = (e: { n: number; label?: string }) => e.label ?? String(e.n);
/** "604 - 259 = ?" -> "604 - 259": how an item is said and shown. */
export const itemLabel = (q: string) => q.replace(/\s*=\s*[?…_.]+\s*$/, '').trim() || q;

/** Broadcast tagged with the request's turn. */
const bc = (c: HelpCtx, event: string, payload: Record<string, unknown>): Promise<void> =>
  broadcast(c.topic, event, c.turn ? { ...payload, turn: c.turn } : payload);

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
  if (changed || by === 'tap') await bc(c, 'focus.changed', { focus, by });
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
  const audioUrl = await speechUrl(text, language, c.session.household_id);
  const messageId = crypto.randomUUID();
  const annotations = opts.annotations ?? [];
  await bc(c, 'tutor.say', {
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
    // Handwriting practice ("Recopier A"): checked in code against the model.
    const model = copyModel(it.q);
    const copied = model ? checkCopy(model, it.a) : null;
    const expected = model ?? expectedAnswer(it.q);
    return {
      ...it,
      expected,
      ok: copied ? copied.ok : expected !== null && it.a !== null ? sameAnswer(it.a, expected) : null,
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
    // similar: generated by runSimilar
    default:
      return '';
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
${exerciseBlock(e, c.page!, 'none')}
${convo ? `Recent conversation:\n${convo}\n` : ''}
${taskFor(c, action, level)}
Look at the photo yourself to confirm the exercise and her answers (the list above may contain reading mistakes; the photo may be sideways).
No printed instruction is common (e.g. a model letter followed by dots = copy it along the line): infer the task from the layout.
If the exercise or her answers really cannot be read, say exactly what you cannot see and ask her to show it closer. Never invent.
${languageRule(c)}
Warm and encouraging. No lists, no numbering, no emojis: it is read aloud. Numbers as digits.
Return JSON only: {"lang":"fr|fus|ar|en","text":"..."}`;
  const out = await askModelJson(
    [
      { type: 'text', text: prompt },
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}`, detail: 'high' } },
    ],
    c.advanced ? EFFORT_ADVANCED : EFFORT,
  );
  const language = forcedLang(c) ?? tutorLang(null, String(out.lang ?? c.page?.lang ?? 'fr'));
  c.log('help', { action, exercise: exName(e), level, language, text: out.text });
  return { text: String(out.text ?? '').trim(), language };
}

/**
 * "Exercice similaire": a new practice exercise of the same kind and level, with other numbers or words.
 * Text-only (no photo needed). Arithmetic answers are recomputed in code, never trusted from the model.
 */
async function runSimilar(c: HelpCtx, e: PageExercise): Promise<{ text: string; language: Lang; practice: Practice | null }> {
  const prompt = `You are Silia, the kind teacher of a girl in ${c.grade}. She wants to practise more on this exercise of her homework.
${exerciseBlock(e, c.page!, 'none')}
TASK: create ONE new practice exercise of the SAME kind, SAME layout and SAME difficulty as on her page, with different
numbers, letters or words (3 items; 2 for word problems). Never copy an item of her page.
Return JSON only: {"lang":"fr|fus|ar|en","kind":"copy|fill|other","title":"...","instr":"...","items":[{"q":"...","a":"...","m":"","slots":3}],"intro":"..."}
kind: copy = handwriting practice (a model letter or word, then empty slots to write it in, like "Recopier A" on her page);
fill = items with a blank to complete (a calculation "45 - 18 = ?", a word with a gap); other = anything else.
title: short title in the exercise's language. instr: the instruction as it would be printed on such a page, ONE line,
in the exercise's language (e.g. "Écris la lettre dans chaque case."). q: each item as she would read it, with ? for the
blank. a: its right answer, short. For copy: q = "Recopier D", m = the model ("D"), a = the model, slots = the number of
empty slots per line on her page (3 if unsure).
intro: 1 or 2 short sentences, read aloud: here is a similar exercise on the board (it replaces the photo), write the answers on your sheet,
then tell me or show me the page. No emojis.
${languageRule(c)}`;
  const out = await askModelJson(prompt, EFFORT_ADVANCED);
  const language = forcedLang(c) ?? tutorLang(null, String(out.lang ?? c.page?.lang ?? 'fr'));
  const items = (Array.isArray(out.items) ? out.items : [])
    .slice(0, 4)
    .map((it: Record<string, unknown>) => {
      const m = typeof it.m === 'string' && it.m.trim() ? it.m.trim().slice(0, 12) : undefined;
      const q = String(it.q ?? (m ? `Recopier ${m}` : '')).trim();
      const computed = expectedAnswer(q); // arithmetic: the code's answer wins
      const slots = Math.min(6, Math.max(1, Math.round(Number(it.slots) || 3)));
      return { q, a: m ?? computed ?? String(it.a ?? '').trim(), ...(m ? { m, slots } : {}) };
    })
    .filter((it: { q: string; a: string }) => it.q && it.a);
  if (!items.length) return { text: '', language, practice: null };
  const kind = (['copy', 'fill', 'other'].includes(String(out.kind)) ? out.kind : 'other') as Practice['kind'];
  const practice: Practice = {
    title: String(out.title ?? e.title).slice(0, 80),
    ...(out.instr ? { instr: String(out.instr).slice(0, 140) } : {}),
    kind: kind === 'copy' && !items.every((i: { m?: string }) => i.m) ? 'other' : kind,
    items,
  };
  c.log('similar', { exercise: exName(e), practice });
  return { text: String(out.intro ?? '').trim(), language, practice };
}

/**
 * « Silia, regarde » / Corriger on one exercise: verdicts only when the code is sure (verdict.ts), otherwise she guides
 * and asks for Lina's answer. Ticks and circles on the photo, and the per-line result for the Board.
 */
async function runVerdict(c: HelpCtx, e: PageExercise): Promise<Spoken> {
  const lang = languageFor(c);
  const lines = await confirm(await checkOpen(e, judge(e), lang, c.grade), photoOf(c), c.grade, c.log);
  const next = c.page!.exercises.filter((x) => x.n > e.n).sort((a, b) => a.n - b.n)[0];
  return await speakLines(c, lines, { index: e.n, title: e.title, label: e.label, frame: frame(e), next, guideFor: e });
}

type Spoken = { text: string; language: Lang; kind: Kind; annotations: unknown[] };

/** The photo as base64, downloaded once at most. */
function photoOf(c: HelpCtx): () => Promise<string> {
  let b64 = c.photoB64 ?? null;
  return async () => (b64 ??= await downloadB64(c.snap!.storage_path));
}

/**
 * « Silia, regarde » after an « Exercice similaire »: when the photo is her work on that practice exercise, her answers
 * are checked against the practice answers (known: Silia wrote them; arithmetic recomputed in code). null = the photo is
 * something else (her page): the normal flow goes on.
 */
export async function checkPractice(c: HelpCtx): Promise<Outcome | null> {
  const practice = c.focus?.practice;
  if (!practice || !c.page?.readable || !c.page.exercises.length) return null;
  const lines = await practiceLines(practice, c.page.exercises, c.grade, c.log);
  if (!lines) return null;
  const lang = languageFor(c);
  await confirm(lines, photoOf(c), c.grade, c.log);
  const allRight = lines.every((l) => l.status === 'right');
  const v = await speakLines(c, lines, {
    index: c.focus!.index,
    title: `Exercice similaire · ${practice.title}`,
    practice: true,
    done: allRight ? VERDICT_TEXT[lang].practiceDone : undefined,
  });
  if (allRight) {
    // Done: the next photo is her page again.
    const { practice: _done, ...rest } = c.focus!;
    c.focus = rest;
    await admin.from('homework_sessions').update({ focus: rest }).eq('id', c.session.id);
  }
  await say(c, v.text, v.language, v.kind, { action: 'similar', annotations: v.annotations });
  return { done: 'help', text: v.text, language: v.language, exercise: c.focus!.index, action: 'similar' };
}

/** Says the verdict of checked lines: hint for the first mistake, « je lis… ? » when unsure, praise when all right. */
async function speakLines(
  c: HelpCtx,
  lines: Line[],
  meta: { index: number; title: string; label?: string; frame?: unknown[]; next?: PageExercise; guideFor?: PageExercise; practice?: boolean; done?: string },
): Promise<Spoken> {
  const lang = languageFor(c);
  const V = VERDICT_TEXT[lang];
  const by = (st: LineStatus) => lines.filter((l) => l.status === st);
  const [right, wrong, unsure, open, empty] = [by('right'), by('wrong'), by('unsure'), by('open'), by('empty')];
  const ticks = right.filter((l) => l.r).map((l) => ({ shape: 'tick', region: l.r, color: '#5BD68A' }));
  const prefix = right.length ? `${V.rightPrefix(right.length)} ` : '';
  const name = meta.label ?? String(meta.index);
  let kind: Kind;
  let text: string;
  let mode: 'verdict' | 'guide' | 'start';
  let annotations: unknown[] = ticks;
  if (empty.length === lines.length) {
    kind = 'question';
    mode = 'start';
    text = meta.practice ? V.guide : V.notStarted(name);
    annotations = meta.frame ?? [];
  } else if (wrong.length) {
    const w = wrong[0];
    kind = 'hint';
    mode = 'verdict';
    text = `${prefix}${(await hintFor(w, lang, c.grade)) ?? PHRASES[lang].hint[0]}`;
    annotations = [...(w.r ? [{ shape: 'circle', region: w.r, color: '#FF5A5A' }] : []), ...ticks];
  } else if (unsure.length) {
    const u = unsure[0];
    kind = 'question';
    mode = 'guide';
    text = `${prefix}${V.unsure(itemLabel(u.q), u.a ?? '')}`;
  } else if (open.length && meta.guideFor) {
    kind = 'question';
    mode = 'guide';
    text = `${prefix}${(await guideQuestion(meta.guideFor, open, lang, c.grade)) ?? V.guide}`;
  } else {
    kind = 'praise';
    mode = 'verdict';
    text = meta.done ?? (empty.length ? `${prefix}${PHRASES[lang].encourage[0]}` : `${V.allGood}${meta.next ? ` ${V.next(exName(meta.next))}` : ''}`);
  }
  c.log('verdict', { exercise: name, practice: !!meta.practice, mode, lines: lines.map((l) => `${l.q} -> ${l.a ?? '-'} [${l.status}]`) });
  const next = meta.next;
  await bc(c, 'exercise.result', {
    ...(c.snap ? { snapshot_id: c.snap.id } : {}),
    exercise_index: meta.index,
    title: meta.title,
    ...(meta.label ? { label: meta.label } : {}),
    mode,
    lines: lines.map((l) => ({ q: itemLabel(l.q), a: l.a, status: l.status })),
    ...(meta.practice ? { practice: true } : {}),
    ...(next && kind === 'praise' && !empty.length ? { next: { index: next.n, title: next.title, ...(next.label ? { label: next.label } : {}) } } : {}),
  });
  const judged = [...right, ...wrong];
  if (judged.length && c.snap) {
    const { error } = await admin.from('observations').insert(
      judged.map((l) => ({
        household_id: c.session.household_id,
        session_id: c.session.id,
        snapshot_id: c.snap!.id,
        item_id: `${meta.practice ? 'practice: ' : ''}${l.q.toLowerCase().replace(/\s+/g, ' ').trim()}`,
        observed_answer: l.a,
        is_correct: l.status === 'right',
        confidence: l.c,
        region: l.r ?? null,
      })),
    );
    if (error) c.log('observations not saved', error.message);
  }
  return { text, language: lang, kind, annotations };
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
${
    c.page?.text
      ? `Her homework page says:\n"""${c.page.text.slice(0, 1500)}"""`
      : c.page?.readable && c.page.exercises.length
        ? `Exercises on her page: ${c.page.exercises.map((x) => `${exName(x)}. ${x.title}: ${x.instr}`).join(' | ').slice(0, 800)}`
        : 'There is no readable photo of her page yet.'
  }
${e ? `${exerciseBlock(e, c.page!, 'answers')}\nYou are ${mode === 'solve' ? 'solving this exercise together, step by step' : mode === 'correct' ? 'correcting this exercise with her' : mode === 'similar' ? 'practising with a similar exercise you gave her' : 'helping her with this exercise'}. The right answers above are SECRET: never say them; use them only to tell her whether a step or a result she says is right.` : 'No exercise is selected.'}
${
    c.focus?.practice
      ? `Practice exercise Silia gave her (on the Board; the answers are SECRET, use them only to check hers):\n${c.focus.practice.items
          .map((it, i) => `${i + 1}. ${it.q} -> ${it.a}`)
          .join('\n')}\nIf she gives answers to this practice exercise, check each one: praise the right ones, a kind hint for a wrong one.`
      : ''
  }
${convo ? `Recent conversation:\n${convo}` : ''}
She just said: "${transcript}"
Answer in ${SPEAKING_STYLE[lang]}, 1 to 4 short sentences, warm, read aloud (no lists, no emojis).
If she gives a step or a result: say if it is right (praise) or not quite (kind hint), then give the next small step.
If her answer to an item cannot be seen on the photo, say so instead of guessing. Never give the final answer of an item.
If Silia just asked her to retell the text in her own words: compare with the page text, praise what she understood,
and gently add the ONE key point she missed (if any).
If what she said is unclear, kindly ask her to repeat. Reply with the answer only.`;
  // No answer the code can check (counting objects in a picture, a reading question…): Silia looks at the photo
  // herself to check what she says, instead of answering blind.
  const needsPhoto = !!e && !!c.snap && !c.focus?.practice && codeChecks(e).every((it) => it.expected === null);
  const content = needsPhoto
    ? [
        {
          type: 'text',
          text: `${prompt}\nThe photo of her page is attached: check her answer on it yourself (count the objects carefully, one by one).`,
        },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${await downloadB64(c.snap!.storage_path)}`, detail: 'high' } },
      ]
    : prompt;
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Deno.env.get('OPENAI_API_KEY')}` },
    body: JSON.stringify({ model: MODEL, reasoning_effort: 'low', ...(needsPhoto ? {} : { max_completion_tokens: 700 }), messages: [{ role: 'user', content }] }),
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
      // The first exercise she has written in (else the first one): « On commence par le 1 ? »
      const suggested = exs.find((e) => e.s !== 'empty') ?? exs[0];
      const text =
        d.reason === 'not_found' && d.missing !== undefined
          ? T.notFound(d.missing, exs.map((e) => exName(e)))
          : d.reason === 'several' && d.action === 'correct'
            ? VERDICT_TEXT[lang].pick(exs.length, exName(suggested))
            : T.askWhich(d.action);
      await savePending(c, d.action);
      const choices = choicesOf(exs);
      const audioUrl = await speechUrl(text, lang, c.session.household_id);
      await bc(c, 'tutor.ask_exercise', {
        snapshot_id: c.snap!.id,
        language: lang,
        text,
        ...(audioUrl ? { audio_url: audioUrl } : {}),
        choices,
        suggested: suggested.n,
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
      if (d.action === 'similar') {
        const { text, language, practice } = await runSimilar(c, d.exercise);
        if (!practice) {
          const fallback = FOCUS_TEXT[language].askWhich('similar');
          await say(c, fallback, language, 'question', { exercise: d.exercise });
          return { done: d.do, text: fallback, language, exercise: d.exercise.n, action: d.action };
        }
        // Kept with the active exercise: her answers (voice or photo) are checked against it.
        c.focus = { ...(c.focus ?? { index: d.exercise.n, title: d.exercise.title }), practice };
        await admin.from('homework_sessions').update({ focus: c.focus }).eq('id', c.session.id);
        await bc(c, 'practice.show', {
          exercise_index: d.exercise.n,
          title: practice.title,
          ...(practice.instr ? { instr: practice.instr } : {}),
          kind: practice.kind,
          // Questions and layout only: the answers stay here, to check hers.
          items: practice.items.map((it) => ({ q: it.q, ...(it.m ? { m: it.m, slots: it.slots } : {}) })),
          language,
        });
        await say(c, text || practice.title, language, 'explain', { exercise: d.exercise, action: d.action });
        return { done: d.do, text, language, exercise: d.exercise.n, action: d.action };
      }
      if (d.action === 'correct') {
        const v = await runVerdict(c, d.exercise);
        await say(c, v.text, v.language, v.kind, { exercise: d.exercise, action: d.action, annotations: v.annotations });
        return { done: d.do, text: v.text, language: v.language, exercise: d.exercise.n, action: d.action };
      }
      const { text, language } = await runHelp(c, d.action, d.exercise);
      const finalText = text || FOCUS_TEXT[language].askWhich(d.action);
      await say(c, finalText, language, 'explain', {
        exercise: d.exercise,
        action: d.action,
        annotations: frame(d.exercise),
      });
      return { done: d.do, text: finalText, language, exercise: d.exercise.n, action: d.action };
    }
  }
}
