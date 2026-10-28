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
import { broadcast } from '../_shared/broadcast.ts';
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
}

interface Reading {
  rot: 0 | 90 | 180 | 270;
  page_visible: boolean;
  hand_blocking: boolean;
  language?: string;
  items: ReadItem[];
}

// Compact keys keep the model's output short: output tokens are the main cost in time.
const promptFor = (grade: string) => `Photo of homework by a child in ${grade}. READ what the child wrote; do not correct.
Return JSON only, compact:
{"rot":0,"v":true,"h":false,"lang":"fr","i":[{"k":"6 - 2 = ?","t":"fill_in","a":"4","c":0.95,"r":[x,y,w,h]}]}
rot: how many degrees the photo must be turned CLOCKWISE so the printed text reads upright (0, 90, 180 or 270).
v: a homework page is visible. h: a hand or object covers answers.
i: every item where the child must write. k: the exercise as printed with ? for the blank.
t: fill_in|number_line|word_problem|matching|copy|counting|other.
a: COPY the child's handwriting digit by digit, exactly as written, even if it is wrong or unfinished. Never write what the
answer should be, never correct it, never complete it. Faint pencil: give your best reading and a LOWER confidence c.
Only when nothing can be made out (empty, cut off, fully illegible): a = null.
c: confidence 0-1 in a. r: box around the child's answer as fractions (0-1) of image width and height.
For math items that are not a simple "a op b = ?" (word problems, multi-step), add
x: the calculation that gives the CORRECT answer from the numbers on the page, using only digits, + - * / ( ) and ceil/floor/round
(e.g. bus of 46 seats, 748 people, how many trips -> "ceil(748/46)"), and xc: your confidence 0-1 that x is the right calculation.
Do not write the result itself, only the calculation.
The photo may be sideways or upside down: read it in any orientation. r is always in THIS photo's coordinates, as it is.
If the child wrote a whole calculation (e.g. "120 - 80 + 10 = 300"), a = everything she wrote, including her result.
Arabic, French and English pages are all possible; Arabic digits are fine.`;

interface CompactItem {
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
  }));
  const rot = [90, 180, 270].includes(Number(raw.rot)) ? (Number(raw.rot) as 90 | 180 | 270) : 0;
  const reading: Reading = { page_visible: raw.v !== false, hand_blocking: raw.h === true, language: raw.lang, items, rot };
  return { reading, usage: body.usage };
}

/** One short hint for a wrong answer. Text-only call: fast and cheap. */
async function writeHint(exercise: string, childAnswer: string, expected: string, language: Lang, grade: string): Promise<string | null> {
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
            content: `You are Silia, her kind teacher. A girl in ${grade} wrote "${childAnswer}" for "${exercise}", which is not right.${slipNote} Think about the likely mistake (wrong operation, forgot a remainder, counting slip…), then write ONE short, kind hint in ${SPEAKING_STYLE[language]} (max 16 words), at her level, that helps her find it herself. Never give the answer, never say she is wrong. Reply with the hint only.`,
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
  const started = Date.now();
  const t: Record<string, number> = {};
  let last = started;
  const lap = (name: string) => {
    const now = Date.now();
    t[name] = now - last;
    last = now;
  };
  broadcast(topic, 'tutor.thinking', { snapshot_id: snap.id }); // not awaited: no need to wait for it

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
    const [{ reading, usage }, { data: previous }, sincePraise, sinceEncourage] = await Promise.all([
      readPage(b64, grade),
      previousQuery,
      secondsSinceLast(snap.session_id, 'praise'),
      secondsSinceLast(snap.session_id, 'encourage'),
    ]);
    lap('vision_ms');

    // Sideways or upside-down photo (phone lying flat): no image work here (Edge CPU limit). Store the angle; the Board turns it.
    if (reading.rot) {
      log('rotated', { by: reading.rot });
      await admin.from('snapshots').update({ rotation: reading.rot }).eq('id', snap.id);
      broadcast(topic, 'snapshot.rotation', { snapshot_id: snap.id, rotation: reading.rot });
    }

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
      broadcast(topic, 'snapshot.rejected', { snapshot_id: snap.id, reason: reading.page_visible ? 'hand_blocking' : 'no_page' });
      await broadcast(topic, 'tutor.say', { message_id: crypto.randomUUID(), kind: 'encourage', text, language: lang, ...(audioUrl ? { audio_url: audioUrl } : {}), annotations: [] });
      inBackground(Promise.resolve(admin.from('snapshots').update({ status: 'skipped' }).eq('id', snap.id)));
      return json({ action: 'encourage', text, reason: reading.page_visible ? 'hand_blocking' : 'no_page' });
    }
    if (!reading.page_visible || reading.hand_blocking) {
      inBackground(Promise.resolve(admin.from('snapshots').update({ status: 'skipped' }).eq('id', snap.id)));
      broadcast(topic, 'snapshot.rejected', { snapshot_id: snap.id, reason: reading.page_visible ? 'hand_blocking' : 'no_page' });
      broadcast(topic, 'tutor.say', { message_id: crypto.randomUUID(), kind: 'system', text: '', language: 'fr', annotations: [] });
      return json({ action: 'silent', reason: reading.page_visible ? 'hand_blocking' : 'no_page' });
    }

    const language = tutorLang(childSetting, reading.language);
    const phrases = PHRASES[language];

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
      return { ...i, expected, isCorrect };
    });

    log('judged', {
      language,
      already_seen: reading.items.length - fresh.length,
      new: judged.map((i) => ({ k: i.key, a: i.child_answer, expected: i.expected, correct: i.isCorrect, c: i.confidence, slip: ownCalculationSlip(i.child_answer) })),
    });
    const wrong = judged.filter((i) => i.isCorrect === false);
    const right = judged.filter((i) => i.isCorrect === true);
    const unchecked = judged.filter((i) => i.isCorrect === null);
    const ticks = right
      .filter((i) => i.region)
      .map((i) => ({ shape: 'tick', region: i.region, color: '#5BD68A' }));

    let kind: 'hint' | 'praise' | 'encourage' | null = null;
    let text = '';
    let familiar = true; // familiar phrase = already generated, played from the cache
    let annotations: unknown[] = [];

    if (wrong.length) {
      const w = wrong[0];
      kind = 'hint';
      const written = await writeHint(w.key, w.child_answer, w.expected ?? '', language, grade);
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
    } else if (right.length && sincePraise > PRAISE_COOLDOWN_S) {
      kind = 'praise';
      text = pick(phrases.praise);
      annotations = ticks;
    } else if (unchecked.length && sinceEncourage > ENCOURAGE_COOLDOWN_S) {
      kind = 'encourage';
      text = pick(phrases.encourage);
    }

    log('decision', { kind: kind ?? 'silent', text, familiar });
    // Fast path: voice, then tell the Board. Saving happens after the response, in the background.
    const messageId = crypto.randomUUID();
    if (kind) {
      // Familiar phrases: send the cached file's path, the Board already has it. New sentences: ElevenLabs.
      const phrase = familiar ? await phrasePath(text, language) : null;
      const audioUrl = familiar ? null : await speechUrl(text, language);
      lap('tts_ms');
      await broadcast(topic, 'tutor.say', {
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
      await broadcast(topic, 'board.annotate', { snapshot_id: snap.id, annotations: ticks });
    } else {
      broadcast(topic, 'tutor.say', { message_id: messageId, kind: 'system', text: '', language, annotations: [] }); // stop "thinking"
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
          writes.push(
            admin.from('tutor_messages').insert({
              id: messageId,
              household_id: snap.household_id,
              session_id: snap.session_id,
              kind,
              text,
              language,
              annotations,
            }),
          );
        }
        const results = await Promise.all(writes);
        for (const r of results as { error?: { message: string } | null }[]) if (r?.error) console.error('save', r.error.message);
      })(),
    );
    lap('save_ms');
    const result = {
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
    await broadcast(topic, 'tutor.say', {
      message_id: crypto.randomUUID(),
      kind: 'system',
      text: '',
      language: 'fr',
      annotations: [],
    });
    return json({ error: (e as Error).message }, 500);
  }
});
