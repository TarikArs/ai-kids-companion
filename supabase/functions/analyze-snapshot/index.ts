// analyze-snapshot: reads a notebook photo, decides whether the tutor speaks, tells the Board.
//
// POST { snapshot_id, image_b64?, mode? }   Caller: a member of the household (usually the Camera).
// mode "check" (Corriger button): every answer on the page is checked again (not only new ones) and the tutor always replies.
// Corriger without an answer from the Camera: the Board sends its current (already analyzed) photo, no image_b64.
// image_b64 (optional): the JPEG sent directly by the Camera, so the function skips the Storage download.
//
// Flow: download photo -> vision model reads the child's answers -> arithmetic checked in code
// -> compare with earlier observations -> hint / praise / silence -> broadcast to session:<id>.

import { encodeBase64 } from 'jsr:@std/encoding@1/base64';

import { evalExpression, expectedAnswer, formatAnswer, ownCalculationSlip, sameAnswer } from '../_shared/arithmetic.ts';
import { introFor, pickIntro, regionOf, type PageExerciseLite } from '../_shared/intro.ts';
import type { PageContext } from '../_shared/page.ts';
import { activate, BREAK_SECONDS, doneText, finishActive, loadPlan, planFromDiary, planText, savePlan, subjectOf, type Subject } from '../_shared/plan.ts';
import { broadcast, parseTurn, turnSender } from '../_shared/broadcast.ts';
import { corsHeaders, json } from '../_shared/cors.ts';
import { CHECK_TEXT, gradeLabel, PHRASES, SPEAKING_STYLE, tutorLang, type Lang } from '../_shared/language.ts';
import { makeLog } from '../_shared/log.ts';
import { admin, getCaller, isHouseholdMember } from '../_shared/supabase.ts';
import { lastTtsError, phrasePath, speechUrl } from '../_shared/tts.ts';

// Supabase Edge Runtime: keeps background work alive after the response is sent.
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;
const inBackground = (p: Promise<unknown>) => (typeof EdgeRuntime !== 'undefined' ? EdgeRuntime.waitUntil(p) : p);

const MODEL = Deno.env.get('OPENAI_VISION_MODEL') ?? 'gpt-6-luna';
const EFFORT = Deno.env.get('OPENAI_REASONING_EFFORT') ?? 'low';
const THRESHOLD = Number(Deno.env.get('TUTOR_CONFIDENCE_THRESHOLD') ?? '0.8');
const PRAISE_COOLDOWN_S = 45;
const ENCOURAGE_COOLDOWN_S = 120;
// Long answers (4+ digits, decimals) are easy to "read" as the expected value: praise only when the reading is very sure.
const PRAISE_CONFIDENCE_LONG = Number(Deno.env.get('TUTOR_PRAISE_CONFIDENCE_LONG') ?? '0.92');
const digitCount = (s: string) => (s.match(/\d/g) ?? []).length;
const CHECKABLE_TYPES = new Set(['fill_in', 'number_line', 'word_problem']);


interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ReadItem {
  key: string;
  type: string;
  child_answer: string | null;
  confidence: number;
  region?: Region;
  hint?: string;
  solution?: string;
  solutionConfidence?: number;
  /** Position of its exercise on the page (1, 2, 3…). */
  ex?: number;
  /** Open answers (not arithmetic): the model's own check against the page, its confidence, and why (never shown). */
  okModel?: boolean | null;
  okConf?: number;
  why?: string;
}

interface Reading {
  rot: 0 | 90 | 180 | 270;
  page_visible: boolean;
  hand_blocking: boolean;
  language?: string;
  items: ReadItem[];
  exercises: PageExerciseLite[];
  /** Subject of the page. */
  subject: Subject;
  /** The photo shows the homework diary (list of tasks), not an exercise page. */
  diary: boolean;
  tasks: { s?: string; d?: string }[];
}

// Compact keys keep the model's output short: output tokens are the main cost in time.
const promptFor = (grade: string) => `Photo of homework by a child in ${grade}. READ what the child wrote; do not correct.
Return JSON only, compact:
{"rot":0,"v":true,"h":false,"lang":"fr","sub":"math","dy":false,"e":[{"n":1,"lb":"1","ti":"Soustractions posées","in":"Pose et calcule.","r":[x,y,w,h]}],"i":[{"e":1,"k":"6 - 2 = ?","t":"fill_in","a":"4","c":0.95,"r":[x,y,w,h]}]}
rot: how many degrees the photo must be turned CLOCKWISE so the printed text reads upright (0, 90, 180 or 270).
v: a homework page is visible. h: a hand or object covers answers.
sub: the subject of the page: math|french|arabic|english|science|islamic|social|other.
dy: true when the photo shows a homework diary or a list of tasks to do (cahier de textes), not an exercise page; then add
tk = [{"s":"math","d":"Maths page 42"}]: s = subject code as above, d = the task as a short label in the diary's language.
e: the separate exercises in reading order, EVEN EMPTY ONES: n = position 1, 2, 3…; lb = the number printed on the page
("" if none); ti = short title in the page's language; in = the printed instruction (max 20 words); r = the exercise's box.
i: every item where the child must write, empty ones too (a = null); e = the n of its exercise. k: the exercise as printed with ? for the blank.
t: fill_in|number_line|word_problem|matching|copy|counting|other.
a: COPY the child's handwriting digit by digit, exactly as written, even if it is wrong or unfinished. Never write what the
answer should be, never correct it, never complete it. Faint pencil: give your best reading and a LOWER confidence c.
Only when nothing can be made out (empty, cut off, fully illegible): a = null.
c: confidence 0-1 in a. r: box around the child's answer as fractions (0-1) of image width and height.
For math items that are not a simple "a op b = ?" (word problems, multi-step), add
x: the calculation that gives the CORRECT answer from the numbers on the page, using only digits, + - * / ( ) and ceil/floor/round
(e.g. bus of 46 seats, 748 people, how many trips -> "ceil(748/46)"), and xc: your confidence 0-1 that x is the right calculation.
Do not write the result itself, only the calculation.
For answers that are NOT arithmetic (a word, a sentence, a reading question, matching, copying), also judge them against
the page: ok = true (right) / false (wrong) / null (cannot tell), okc = your confidence 0-1 in ok, and when ok is false,
w = a short English note for the teacher saying where on the page the right answer is (never shown to the child).
Skip ok for arithmetic: it is checked elsewhere.
The photo may be sideways or upside down: read it in any orientation. r is always in THIS photo's coordinates, as it is.
If the child wrote a whole calculation (e.g. "120 - 80 + 10 = 300"), a = everything she wrote, including her result.
Arabic, French and English pages are all possible; Arabic digits are fine.`;

interface CompactItem {
  e?: number;
  ok?: boolean | null;
  okc?: number;
  w?: string;
  k: string;
  t?: string;
  a?: string | null;
  c?: number;
  r?: number[];
  x?: string;
  xc?: number;
}

async function readPage(imageB64: string, grade: string): Promise<{ reading: Reading; usage: unknown }> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
    },
    body: JSON.stringify({
      model: MODEL,
      reasoning_effort: EFFORT,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: promptFor(grade) },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageB64}`, detail: 'high' } },
          ],
        },
      ],
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${text.slice(0, 300)}`);
  const body = JSON.parse(text);
  const raw = JSON.parse(body.choices[0].message.content);
  const items: ReadItem[] = (Array.isArray(raw.i) ? raw.i : []).map((it: CompactItem) => ({
    key: String(it.k ?? ''),
    type: String(it.t ?? 'other'),
    child_answer: it.a === undefined || it.a === null ? null : String(it.a),
    confidence: Number(it.c ?? 0),
    region: Array.isArray(it.r) && it.r.length === 4 ? { x: it.r[0], y: it.r[1], w: it.r[2], h: it.r[3] } : undefined,
    solution: typeof it.x === 'string' ? it.x : undefined,
    solutionConfidence: Number(it.xc ?? 0),
    ex: typeof it.e === 'number' ? it.e : undefined,
    okModel: typeof it.ok === 'boolean' ? it.ok : null,
    okConf: Number(it.okc ?? 0),
    why: typeof it.w === 'string' ? it.w.slice(0, 200) : undefined,
  }));
  const exercises: PageExerciseLite[] = (Array.isArray(raw.e) ? raw.e : [])
    .slice(0, 12)
    .map((e: { n?: number; lb?: string; ti?: string; in?: string; r?: number[] }, i: number) => {
      const label = String(e.lb ?? '').trim();
      const box = clampRegion(Array.isArray(e.r) && e.r.length === 4 ? { x: e.r[0], y: e.r[1], w: e.r[2], h: e.r[3] } : undefined);
      return {
        n: typeof e.n === 'number' ? e.n : i + 1,
        ...(label && label !== String(i + 1) ? { label } : {}),
        title: String(e.ti ?? '').slice(0, 80),
        instr: String(e.in ?? '').slice(0, 200),
        ...(box ? { r: box } : {}),
      };
    });
  const rot = [90, 180, 270].includes(Number(raw.rot)) ? (Number(raw.rot) as 90 | 180 | 270) : 0;
  const reading: Reading = {
    page_visible: raw.v !== false,
    hand_blocking: raw.h === true,
    language: raw.lang,
    items,
    exercises,
    rot,
    subject: subjectOf(raw.sub),
    diary: raw.dy === true,
    tasks: Array.isArray(raw.tk) ? raw.tk : [],
  };
  return { reading, usage: body.usage };
}

/** One short hint for a wrong answer. Text-only call: fast and cheap. */
async function writeHint(exercise: string, childAnswer: string, expected: string, language: Lang, grade: string, note?: string): Promise<string | null> {
  const noteText = note
    ? ` Teacher's note (NEVER say it, it contains the answer): ${note}. Send her back to that place on the page, without giving the answer.`
    : '';
  // Her own calculation does not give the number she wrote: the hint points at that step.
  const slip = ownCalculationSlip(childAnswer);
  const slipNote = slip
    ? ` Her own calculation "${slip.calculation}" actually makes ${slip.makes}, not ${slip.wrote}: help her redo that calculation carefully (you may say her numbers, not the final answer).`
    : '';
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Deno.env.get('OPENAI_API_KEY')}` },
      body: JSON.stringify({
        model: MODEL,
        reasoning_effort: 'low',
        max_completion_tokens: 400,
        messages: [
          {
            role: 'user',
            content: `You are Silia, her kind teacher. A girl in ${grade} wrote "${childAnswer}" for "${exercise}", which is not right.${slipNote}${noteText} Think about the likely mistake (wrong operation, forgot a remainder, counting slip…), then write ONE short, kind hint in ${SPEAKING_STYLE[language]} (max 16 words), at her level, that helps her find it herself. Never give the answer, never say she is wrong. Reply with the hint only.`,
          },
        ],
      }),
    });
    if (!res.ok) return null;
    const body = await res.json();
    const hint = String(body.choices?.[0]?.message?.content ?? '').trim();
    // Drop a hint that leaks the answer.
    const leaks = expected !== '' && new RegExp(`(^|\\D)${expected}(\\D|$)`).test(hint);
    return hint && !leaks ? hint : null;
  } catch {
    return null;
  }
}

const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
const normKey = (k: string) => k.toLowerCase().replace(/\s+/g, ' ').trim();
const clampRegion = (r?: Region): Region | undefined =>
  r && [r.x, r.y, r.w, r.h].every((v) => typeof v === 'number' && v >= 0 && v <= 1) ? r : undefined;

async function secondsSinceLast(sessionId: string, kind: string): Promise<number> {
  const { data } = await admin
    .from('tutor_messages')
    .select('created_at')
    .eq('session_id', sessionId)
    .eq('kind', kind)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? (Date.now() - Date.parse(data.created_at)) / 1000 : Infinity;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const log = makeLog('analyze-snapshot');
  const body = await req.json().catch(() => ({}));
  const { snapshot_id, image_b64, mode } = body as { snapshot_id?: unknown; image_b64?: unknown; mode?: unknown };
  const turn = parseTurn((body as { turn?: unknown }).turn);
  const checkAll = mode === 'check';
  if (typeof snapshot_id !== 'string') return json({ error: 'snapshot_id is required' }, 400);

  // Who is calling and which snapshot: both lookups in parallel.
  const [user, { data: snap }] = await Promise.all([
    getCaller(req),
    admin.from('snapshots').select('id, household_id, session_id, storage_path, status').eq('id', snapshot_id).maybeSingle(),
  ]);
  if (!user) return json({ error: 'Sign in first' }, 401);
  if (!snap) return json({ error: 'Snapshot not found' }, 404);
  const [allowed, { data: setting }] = await Promise.all([
    isHouseholdMember(user.id, snap.household_id),
    admin.from('homework_sessions').select('children(tutor_language, grade)').eq('id', snap.session_id).maybeSingle(),
  ]);
  if (!allowed) return json({ error: 'Not allowed' }, 403);
  const child = setting?.children as { tutor_language?: string; grade?: number } | null;
  const childSetting = child?.tutor_language;
  const grade = gradeLabel(child?.grade);
  log('start', { snapshot: snapshot_id, status: snap.status, image_sent: typeof image_b64 === 'string', grade, tutor_language: childSetting ?? 'auto' });
  // Corriger may re-check a photo already analyzed (the Board's current photo when the Camera does not answer).
  if (snap.status !== 'uploaded' && !checkAll) return json({ status: snap.status, note: 'already processed' });

  const topic = `session:${snap.session_id}`;
  const send = turnSender(topic, turn);
  const started = Date.now();
  const t: Record<string, number> = {};
  let last = started;
  const lap = (name: string) => {
    const now = Date.now();
    t[name] = now - last;
    last = now;
  };
  send('tutor.thinking', { snapshot_id: snap.id }); // not awaited: no need to wait for it

  try {
    let b64: string;
    if (typeof image_b64 === 'string' && image_b64.length > 1000) {
      b64 = image_b64.includes(',') ? image_b64.slice(image_b64.indexOf(',') + 1) : image_b64;
    } else {
      const { data: file, error: dlErr } = await admin.storage.from('snapshots').download(snap.storage_path);
      if (dlErr || !file) throw new Error(`download: ${dlErr?.message}`);
      b64 = encodeBase64(new Uint8Array(await file.arrayBuffer()));
    }
    lap('download_ms');

    // Earlier observations are fetched while the model reads the page.
    const previousQuery = admin
      .from('observations')
      .select('item_id, observed_answer')
      .eq('session_id', snap.session_id)
      .order('created_at', { ascending: true });
    const [{ reading, usage }, { data: previous }, sincePraise, sinceEncourage, sessionRot] = await Promise.all([
      readPage(b64, grade),
      previousQuery,
      secondsSinceLast(snap.session_id, 'praise'),
      secondsSinceLast(snap.session_id, 'encourage'),
      admin.from('homework_sessions').select('rotation, focus').eq('id', snap.session_id).maybeSingle(),
    ]);
    lap('vision_ms');

    // Orientation is decided ONCE per session (the phone stays on its stand): the first readable photo sets it,
    // later guesses never flip the page on the Board. The Board's rotate button can correct it.
    if (!sessionRot.error && sessionRot.data && sessionRot.data.rotation === null && reading.page_visible) {
      await admin.from('homework_sessions').update({ rotation: reading.rot }).eq('id', snap.session_id);
      send('session.rotation', { rotation: reading.rot });
      log('session rotation set', { rotation: reading.rot });
    } else if (reading.rot) log('rotation guess ignored (session already set)', { guess: reading.rot, session: sessionRot.data?.rotation });

    log('vision', {
      page_visible: reading.page_visible,
      hand_blocking: reading.hand_blocking,
      lang: reading.language,
      items: reading.items.map((i) => ({ k: i.key, t: i.type, a: i.child_answer, c: i.confidence, x: i.solution, xc: i.solutionConfidence })),
      usage,
      timings: t,
    });

    if ((!reading.page_visible || reading.hand_blocking) && checkAll) {
      const lang = tutorLang(childSetting, reading.language);
      const text = { fr: 'Je ne vois pas bien la page. Montre-moi le cahier, puis appuie sur Corriger.', ar: 'ما كنشوفش الصفحة مزيان. ورّيني الكونّاش، ومن بعد ورّكي على صحّح.', fus: 'لا أرى الصفحة جيدًا. أريني الدفتر، ثم اضغطي على صحّح.', en: 'I can’t see the page well. Show me the notebook, then press Check.' }[lang];
      const audioUrl = await speechUrl(text, lang);
      send('snapshot.rejected', { snapshot_id: snap.id, reason: reading.page_visible ? 'hand_blocking' : 'no_page' });
      await send('tutor.say', { message_id: crypto.randomUUID(), kind: 'encourage', text, language: lang, ...(audioUrl ? { audio_url: audioUrl } : {}), annotations: [] });
      inBackground(Promise.resolve(admin.from('snapshots').update({ status: 'skipped' }).eq('id', snap.id)));
      return json({ action: 'encourage', text, reason: reading.page_visible ? 'hand_blocking' : 'no_page' });
    }
    if (!reading.page_visible || reading.hand_blocking) {
      inBackground(Promise.resolve(admin.from('snapshots').update({ status: 'skipped' }).eq('id', snap.id)));
      send('analysis.done', { snapshot_id: snap.id, read: 0, new: 0, right: 0, wrong: 0, quiet: true, reason: reading.page_visible ? 'hand_blocking' : 'no_page' });
      send('snapshot.rejected', { snapshot_id: snap.id, reason: reading.page_visible ? 'hand_blocking' : 'no_page' });
      send('tutor.say', { message_id: crypto.randomUUID(), kind: 'system', text: '', language: 'fr', annotations: [] });
      return json({ action: 'silent', reason: reading.page_visible ? 'hand_blocking' : 'no_page' });
    }

    const language = tutorLang(childSetting, reading.language);
    const phrases = PHRASES[language];

    // ONE page model per photo, shared by every feature (Explique, voice, Corriger): no second reading of the page.
    const pageModel: PageContext = {
      lang: reading.language ?? 'fr',
      readable: true,
      text: '', // printed text: read later, only if she reads aloud (page.ts pageText)
      exercises: reading.exercises.map((e) => {
        const mine = reading.items.filter((i) => i.ex === e.n);
        const filled = mine.filter((i) => i.child_answer).length;
        return {
          n: e.n,
          ...(e.label ? { label: e.label } : {}),
          title: e.title,
          instr: e.instr,
          s: filled === 0 ? 'empty' : filled === mine.length ? 'done' : 'partial',
          r: e.r ?? regionOf(e.n, reading.items),
          items: mine.map((i) => ({ q: i.key, a: i.child_answer, c: i.confidence })),
        };
      }),
    };
    inBackground(Promise.resolve(admin.from('snapshots').update({ exercises: pageModel, page_lang: pageModel.lang }).eq('id', snap.id)));

    // The evening's plan. A homework diary: read the tasks, propose an order (once, while nothing is done yet).
    let plan = await loadPlan(snap.session_id);
    if (reading.diary && reading.tasks.length && !checkAll && !plan?.items.some((i) => i.status === 'done')) {
      const diaryPlan = planFromDiary(reading.tasks, snap.id);
      if (diaryPlan && (await savePlan(snap.session_id, diaryPlan))) {
        send('plan.changed', { plan: diaryPlan });
        const text = planText(language, diaryPlan);
        const audioUrl = await speechUrl(text, language);
        const messageId = crypto.randomUUID();
        await send('tutor.say', { message_id: messageId, kind: 'explain', text, language, ...(audioUrl ? { audio_url: audioUrl } : {}), snapshot_id: snap.id, annotations: [] });
        send('analysis.done', { snapshot_id: snap.id, read: 0, new: 0, right: 0, wrong: 0, quiet: false });
        log('plan from diary', { items: diaryPlan.items.map((i) => `${i.subject}: ${i.label}`) });
        inBackground(
          Promise.all([
            admin.from('snapshots').update({ status: 'analyzed' }).eq('id', snap.id),
            admin.from('tutor_messages').insert({ id: messageId, household_id: snap.household_id, session_id: snap.session_id, kind: 'explain', text, language, annotations: [] }),
          ]),
        );
        return json({ action: 'plan', plan: diaryPlan, text, ms: Date.now() - started });
      }
    }
    // She opened a page of another subject: it becomes the active one in the plan.
    if (plan && !reading.diary && reading.subject !== 'other' && activate(plan, reading.subject)) {
      if (await savePlan(snap.session_id, plan)) send('plan.changed', { plan });
    }

    // Latest observed answer per item in this session.
    const lastSeen = new Map<string, string | null>();
    for (const o of previous ?? []) lastSeen.set(o.item_id, o.observed_answer);

    // Keep only confident, written, NEW answers.
    const fresh = reading.items
      .filter((i) => i.child_answer !== null && i.child_answer !== '' && (i.confidence ?? 0) >= THRESHOLD)
      .map((i) => ({ ...i, key: normKey(i.key), child_answer: String(i.child_answer), region: clampRegion(i.region) }))
      .filter((i) => checkAll || lastSeen.get(i.key) !== i.child_answer);

    const judged = fresh.map((i) => {
      // Expected answer always computed in code: from the printed expression, or from the model's calculation
      // (word problems) when it is confident in that calculation. The model never gives the number itself.
      let expected = CHECKABLE_TYPES.has(i.type) ? expectedAnswer(i.key) : null;
      if (expected === null && CHECKABLE_TYPES.has(i.type) && i.solution && (i.solutionConfidence ?? 0) >= THRESHOLD) {
        const value = evalExpression(i.solution);
        if (value !== null) expected = formatAnswer(value);
      }
      let isCorrect = expected === null ? null : sameAnswer(i.child_answer, expected);
      if (isCorrect === true && digitCount(expected!) >= 4 && (i.confidence ?? 0) < PRAISE_CONFIDENCE_LONG) {
        isCorrect = null; // not sure enough to praise a long answer: stay quiet
      }
      // Open answers (a word, a sentence, a reading question): checked by meaning against the page.
      // "Wrong" only when the model is very sure: a false "wrong" hurts more than a missed one.
      let checkedBy: 'code' | 'meaning' | null = isCorrect === null ? null : 'code';
      if (expected === null && !CHECKABLE_TYPES.has(i.type) && i.okModel !== null && i.okModel !== undefined) {
        if (i.okModel === false && (i.okConf ?? 0) >= 0.9) isCorrect = false;
        else if (i.okModel === true && (i.okConf ?? 0) >= 0.8) isCorrect = true;
        if (isCorrect !== null) checkedBy = 'meaning';
      }
      return { ...i, expected, isCorrect, checkedBy };
    });

    log('judged', {
      language,
      already_seen: reading.items.length - fresh.length,
      new: judged.map((i) => ({ k: i.key, a: i.child_answer, expected: i.expected, correct: i.isCorrect, by: i.checkedBy, c: i.confidence, why: i.why, slip: ownCalculationSlip(i.child_answer) })),
    });
    const wrong = judged.filter((i) => i.isCorrect === false);
    const right = judged.filter((i) => i.isCorrect === true);
    const unchecked = judged.filter((i) => i.isCorrect === null);
    const ticks = right
      .filter((i) => i.region)
      .map((i) => ({ shape: 'tick', region: i.region, color: '#5BD68A' }));

    // The whole page is answered with no mistake and something new was just written: this subject is finished.
    // Bravo, a one-minute break, then the next subject of the plan. Once per page.
    let pageDone: { text: string; key: string } | null = null;
    if (plan && !checkAll && judged.length && !wrong.length && reading.items.length && reading.items.every((i) => i.child_answer)) {
      const key = `page_done:${reading.exercises.map((e) => e.title).join('|').toLowerCase().slice(0, 120)}`;
      const { data: said, error: saidErr } = await admin.from('tutor_messages').select('id').eq('session_id', snap.session_id).eq('action', key).limit(1);
      const fin = !saidErr && !said?.length ? finishActive(plan) : null;
      if (fin && (await savePlan(snap.session_id, plan))) {
        send('plan.changed', { plan });
        if (fin.next) send('session.break', { seconds: BREAK_SECONDS, next: fin.next.label, language });
        pageDone = { text: doneText(language, fin.done.label, fin.next?.label ?? null), key };
        log('subject done', { done: fin.done.label, next: fin.next?.label ?? null });
      }
    }

    let kind: 'hint' | 'praise' | 'encourage' | 'explain' | null = null;
    let text = '';
    let familiar = true; // familiar phrase = already generated, played from the cache
    let annotations: unknown[] = [];

    // An empty exercise she is about to start: introduce it, like a teacher (once per exercise). Not over a mistake.
    const introPick = !checkAll && !wrong.length && !pageDone ? await pickIntro(snap.session_id, reading.exercises, reading.items) : null;
    const intro = introPick ? { ...introPick, text: await introFor(introPick.exercise, reading.items, language, grade, MODEL) } : null;
    if (intro) {
      lap('intro_ms');
      log('intro', { exercise: intro.exercise.n, title: intro.exercise.title, text: intro.text });
    }

    if (wrong.length) {
      const w = wrong[0];
      kind = 'hint';
      const written = await writeHint(w.key, w.child_answer, w.expected ?? '', language, grade, w.why);
      familiar = !written;
      text = written || pick(phrases.hint);
      lap('hint_ms');
      // Corriger: circle every wrong answer; otherwise only the first one.
      const circled = checkAll ? wrong : [w];
      annotations = [
        ...circled.filter((x) => x.region).map((x) => ({ shape: 'circle', region: x.region, color: '#FF9F5A' })),
        ...ticks,
      ];
    } else if (checkAll) {
      // Corriger: always say something.
      familiar = false;
      if (right.length) {
        kind = 'praise';
        text = CHECK_TEXT[language].allGood;
        annotations = ticks;
      } else if (unchecked.length) {
        kind = 'encourage';
        text = CHECK_TEXT[language].cannotCheck;
      } else {
        kind = 'encourage';
        text = CHECK_TEXT[language].noAnswer;
      }
    } else if (pageDone) {
      kind = 'praise';
      familiar = false;
      text = pageDone.text;
      annotations = ticks;
    } else if (intro) {
      kind = 'explain';
      familiar = false;
      // Just finished the previous exercise: a short bravo first, then the next one.
      text = `${right.length ? `${pick(phrases.praise)} ` : ''}${intro.text}`;
      annotations = [...(intro.region ? [{ shape: 'text', region: intro.region, text: intro.exercise.label ?? String(intro.exercise.n), color: '#7FD3FF' }] : []), ...ticks];
      // The introduced exercise becomes the active one (voice "explique-le" and the Board frame follow it).
      const focus = {
        index: intro.exercise.n,
        title: intro.exercise.title,
        ...(intro.exercise.label ? { label: intro.exercise.label } : {}),
        ...(intro.region ? { region: intro.region } : {}),
        snapshot_id: snap.id,
        at: new Date().toISOString(),
      };
      const { error: fe } = await admin.from('homework_sessions').update({ focus, pending_action: null }).eq('id', snap.session_id);
      if (!fe) send('focus.changed', { focus, by: 'auto' });
    } else if (right.length && sincePraise > PRAISE_COOLDOWN_S) {
      kind = 'praise';
      text = pick(phrases.praise);
      annotations = ticks;
    } else if (unchecked.length && sinceEncourage > ENCOURAGE_COOLDOWN_S) {
      kind = 'encourage';
      text = pick(phrases.encourage);
    }

    // Why Silia stays quiet: shown on the Board and the Camera so it never looks frozen.
    const written = reading.items.filter((i) => i.child_answer !== null && i.child_answer !== '');
    const unsure = written.filter((i) => (i.confidence ?? 0) < THRESHOLD);
    let quietReason: 'nothing_new' | 'unsure' | 'no_answers' | 'not_checkable' | 'cooldown' | undefined;
    if (!kind) {
      if (!written.length) quietReason = 'no_answers';
      else if (!fresh.length && unsure.length) quietReason = 'unsure';
      else if (!fresh.length) quietReason = 'nothing_new';
      else if (right.length) quietReason = 'cooldown';
      else quietReason = 'not_checkable';
    }
    // Answers written but unreadable, nothing else to say: tell her (not more than every 2 minutes).
    if (quietReason === 'unsure' && sinceEncourage > ENCOURAGE_COOLDOWN_S) {
      kind = 'encourage';
      text = CHECK_TEXT[language].unsure;
      familiar = false;
      quietReason = undefined;
    }
    send('analysis.done', {
      snapshot_id: snap.id,
      read: written.length,
      new: judged.length,
      right: right.length,
      wrong: wrong.length,
      quiet: !kind,
      ...(quietReason ? { reason: quietReason } : {}),
    });

    // Auto-advance: the active exercise is finished with no mistake -> the next one becomes active (like a teacher
    // moving on). An introduced exercise already became active above.
    const current = sessionRot.data?.focus as { index?: number } | null | undefined;
    if (!intro && !checkAll && typeof current?.index === 'number') {
      const mine = reading.items.filter((i) => i.ex === current.index);
      const finished = mine.length > 0 && mine.every((i) => i.child_answer) && !wrong.some((w) => w.ex === current.index);
      const next = finished ? [...reading.exercises].sort((a, b) => a.n - b.n).find((e) => e.n > current.index!) : undefined;
      if (next) {
        const focus = {
          index: next.n,
          title: next.title,
          ...(next.label ? { label: next.label } : {}),
          ...((next.r ?? regionOf(next.n, reading.items)) ? { region: next.r ?? regionOf(next.n, reading.items) } : {}),
          snapshot_id: snap.id,
          at: new Date().toISOString(),
        };
        const { error: fe } = await admin.from('homework_sessions').update({ focus, pending_action: null }).eq('id', snap.session_id);
        if (!fe) {
          send('focus.changed', { focus, by: 'auto' });
          log('auto-advance', { from: current.index, to: next.n });
        }
      }
    }

    log('decision', { kind: kind ?? 'silent', text, familiar, quiet_reason: quietReason, unsure: unsure.length });
    // Fast path: voice, then tell the Board. Saving happens after the response, in the background.
    const messageId = crypto.randomUUID();
    if (kind) {
      // Familiar phrases: send the cached file's path, the Board already has it. New sentences: ElevenLabs.
      const phrase = familiar ? await phrasePath(text, language) : null;
      const audioUrl = familiar ? null : await speechUrl(text, language);
      lap('tts_ms');
      await send('tutor.say', {
        message_id: messageId,
        kind,
        text,
        language,
        ...(phrase ? { phrase } : {}),
        ...(audioUrl ? { audio_url: audioUrl } : {}),
        snapshot_id: snap.id,
        annotations,
      });
    } else if (ticks.length) {
      await send('board.annotate', { snapshot_id: snap.id, annotations: ticks });
    } else {
      send('tutor.say', { message_id: messageId, kind: 'system', text: '', language, annotations: [] }); // stop "thinking"
    }
    lap('broadcast_ms');

    inBackground(
      (async () => {
        const writes: PromiseLike<unknown>[] = [admin.from('snapshots').update({ status: 'analyzed' }).eq('id', snap.id)];
        if (judged.length) {
          writes.push(
            admin.from('observations').insert(
              judged.map((i) => ({
                household_id: snap.household_id,
                session_id: snap.session_id,
                snapshot_id: snap.id,
                item_id: i.key,
                observed_answer: i.child_answer,
                is_correct: i.isCorrect,
                confidence: i.confidence,
                region: i.region ?? null,
              })),
            ),
          );
        }
        if (kind) {
          const row = { id: messageId, household_id: snap.household_id, session_id: snap.session_id, kind, text, language, annotations };
          const extra =
            intro && kind === 'explain'
              ? { action: intro.key, exercise_index: intro.exercise.n }
              : pageDone && kind === 'praise'
                ? { action: pageDone.key }
                : {};
          writes.push(
            (async () => {
              const res = await admin.from('tutor_messages').insert({ ...row, ...extra });
              return res.error && Object.keys(extra).length ? await admin.from('tutor_messages').insert(row) : res;
            })(),
          );
        }
        const results = await Promise.all(writes);
        for (const r of results as { error?: { message: string } | null }[]) if (r?.error) console.error('save', r.error.message);
      })(),
    );
    lap('save_ms');
    const result = {
      quiet_reason: quietReason,
      read: written.length,
      action: kind ?? 'silent',
      text,
      new_items: judged.length,
      wrong: wrong.length,
      right: right.length,
      ms: Date.now() - started,
      timings: t,
      usage,
      voice: kind ? (familiar ? 'phrase' : lastTtsError ? `error: ${lastTtsError}` : 'elevenlabs') : 'none',
    };
    console.log('result', JSON.stringify(result));
    return json(result);
  } catch (e) {
    console.error(e);
    await admin.from('snapshots').update({ status: 'failed' }).eq('id', snap.id);
    await send('tutor.say', {
      message_id: crypto.randomUUID(),
      kind: 'system',
      text: '',
      language: 'fr',
      annotations: [],
    });
    return json({ error: (e as Error).message }, 500);
  }
});
