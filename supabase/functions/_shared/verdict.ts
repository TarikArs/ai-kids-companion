// Verdicts only when sure. The code decides right / wrong, never the model:
// - arithmetic ("532 - 178 = ?"): expected answer computed in code; a "wrong" from the fast reading is confirmed by a
//   deeper reading before Silia says it;
// - copying letters ("Recopier A"): checked in code, and a second slot-by-slot look before any "Bravo".
// - written words (conjugation, spelling, a word to complete): the reading of her answer must be confident, then a
//   text-only check of THAT answer against the item (the hard part is reading handwriting, not knowing « je mange »);
//   a "wrong" is confirmed by the deeper reading like arithmetic. Hard to read: « Je lis…, c'est bien ça ? ».
// Nothing written, or not checkable without the picture (counting objects…): Silia guides and asks for her answer.

import { expectedAnswer, ownCalculationSlip, sameAnswer } from './arithmetic.ts';
import { checkCopy, copyModel, verifyCopyLines } from './copy.ts';
import type { Practice } from './intent.ts';
import { SPEAKING_STYLE, type Lang } from './language.ts';
import { readPage, type PageExercise, type PageItem, type Region } from './page.ts';

const MODEL = Deno.env.get('OPENAI_VISION_MODEL') ?? 'gpt-6-luna';
/** Deeper reading that confirms a "wrong" (empty = no confirmation, the fast reading is trusted). */
const VERIFY_EFFORT = Deno.env.get('OPENAI_VERIFY_EFFORT') ?? '';
const READ_EFFORT = Deno.env.get('OPENAI_READ_EFFORT') ?? 'low';
/** Below this reading confidence, Silia asks « Je lis 66, c'est bien ça ? » instead of judging. */
const THRESHOLD = Number(Deno.env.get('TUTOR_CONFIDENCE_THRESHOLD') ?? '0.8');
/** Long answers (4+ digits) are easy to "read" as the expected value: praised only when the reading is very sure. */
const PRAISE_CONFIDENCE_LONG = Number(Deno.env.get('TUTOR_PRAISE_CONFIDENCE_LONG') ?? '0.92');

/** right / wrong: checked in code. unsure: hard to read. empty: nothing written. open: not checkable from the photo. */
export type LineStatus = 'right' | 'wrong' | 'unsure' | 'empty' | 'open';

export interface Line {
  q: string;
  a: string | null;
  status: LineStatus;
  c: number;
  expected?: string;
  copy?: boolean;
  r?: Region;
  hn?: string;
  /** Wrong copy: what she wrote that is not the model (for the hint). */
  why?: string;
}

const flat = (x: string) => x.toLowerCase().replace(/[\s…_]+/g, '').replace(/\.{2,}/g, '.');
const same = (a: string, b: string) => !!flat(b) && flat(a) === flat(b);
const digitCount = (s: string) => (s.match(/\d/g) ?? []).length;
const NOT_ARITHMETIC = new Set(['copy', 'matching', 'counting']);

/** First verdict of each item, from the reading alone (no I/O). */
export function judge(e: PageExercise): Line[] {
  return e.items.map((it: PageItem): Line => {
    const base = { q: it.q, a: it.a, c: it.c, ...(it.r ? { r: it.r } : {}), ...(it.hn ? { hn: it.hn } : {}) };
    if (!it.a || !it.a.trim()) return { ...base, status: 'empty' };
    // The reading copied the printed item itself (« mang.r » for « mang.r »): nothing written yet.
    if (same(it.a, it.q) || same(it.a, it.q.replace(/\?/g, ''))) return { ...base, a: null, status: 'empty' };
    const model = it.t === 'copy' || it.m ? copyModel(it.q, it.m) : null;
    if (model) {
      const copied = checkCopy(model, it.a);
      if (!copied) return { ...base, status: 'open' };
      return {
        ...base,
        status: copied.ok ? 'right' : 'wrong',
        expected: model,
        copy: true,
        ...(copied.ok ? {} : { why: `on the line of "${model}" she wrote ${copied.wrong.map((w) => `"${w}"`).join(', ')}, which is not "${model}"` }),
      };
    }
    const expected = NOT_ARITHMETIC.has(it.t ?? '') ? null : expectedAnswer(it.q);
    if (expected === null) return { ...base, status: 'open' };
    if (it.c < THRESHOLD) return { ...base, status: 'unsure', expected };
    const ok = sameAnswer(it.a, expected);
    if (ok && digitCount(expected) >= 4 && it.c < PRAISE_CONFIDENCE_LONG) return { ...base, status: 'unsure', expected };
    return { ...base, status: ok ? 'right' : 'wrong', expected };
  });
}

const normKey = (k: string) => k.toLowerCase().replace(/\s+/g, ' ').trim();
const compact = (x: string | null | undefined) => String(x ?? '').toLowerCase().replace(/\s+/g, '');
const centre = (r?: Region) => (r ? { x: r.x + r.w / 2, y: r.y + r.h / 2 } : null);

/**
 * The checks that need the photo again: a "wrong" arithmetic answer is read again with the deeper effort (same answer =
 * confirmed; another one = « je lis… c'est bien ça ? »), and a copy line is looked at slot by slot before any "Bravo".
 */
export async function confirm(lines: Line[], photo: () => Promise<string>, grade: string, log: (s: string, d?: unknown) => void): Promise<Line[]> {
  const suspects = lines.filter((l) => l.status === 'wrong' && !l.copy);
  if (VERIFY_EFFORT && VERIFY_EFFORT !== READ_EFFORT && suspects.length) {
    const again = await readPage(await photo(), grade, undefined, VERIFY_EFFORT);
    const items = again.exercises.flatMap((e) => e.items);
    for (const l of suspects) {
      const c = centre(l.r);
      const twin =
        items.find((i) => normKey(i.q) === normKey(l.q)) ??
        items.find((i) => {
          const d = centre(i.r);
          return !!c && !!d && Math.abs(c.x - d.x) < 0.04 && Math.abs(c.y - d.y) < 0.04;
        });
      if (twin && compact(twin.a) === compact(l.a)) {
        if (twin.hn) l.hn = twin.hn;
      } else {
        log('wrong not confirmed by the deeper reading', { q: l.q, fast: l.a, deep: twin?.a ?? null });
        l.status = 'unsure';
      }
    }
  }
  const copies = lines.filter((l) => l.copy && l.status === 'right');
  if (copies.length) {
    const seen = await verifyCopyLines(await photo(), copies.map((l) => ({ model: String(l.expected), region: l.r })), MODEL);
    copies.forEach((l, n) => {
      const letters = seen[n];
      if (!letters) {
        l.status = 'unsure';
        return;
      }
      const again = checkCopy(String(l.expected), letters.join(' '));
      if (again && !again.ok) {
        log('copy second look caught a mistake', { model: l.expected, first: l.a, second: letters });
        l.status = 'wrong';
        l.a = letters.join(' ');
        l.why = `on the line of "${l.expected}" she wrote ${again.wrong.map((w) => (w === '?' ? 'a badly formed letter' : `"${w}"`)).join(', ')}, which is not "${l.expected}"`;
      }
    });
  }
  return lines;
}

/**
 * Written answers that are not arithmetic or copying (« Je (manger) une pomme » -> « mange »): checked by a small
 * text-only call against the item, only when her handwriting was read with confidence. The model also gives the right
 * answer (never said, used to keep the hint from leaking it) and one hint for a wrong answer.
 */
export async function checkOpen(e: PageExercise, lines: Line[], language: Lang, grade: string): Promise<Line[]> {
  for (const l of lines) if (l.status === 'open' && l.a && l.c < THRESHOLD) l.status = 'unsure';
  const todo = lines.filter((l) => l.status === 'open' && l.a);
  if (!todo.length) return lines;
  const out = await ask(
    `You are checking the homework of a child in ${grade}. Exercise "${e.title}". Instruction: "${e.instr || '(none printed)'}".
Items and what she wrote (her handwriting, already read):
${todo.map((l, i) => `${i}. ${l.q}  ->  she wrote: "${l.a}"`).join('\n')}
For each item: x = the right answer for this item at her level; ok = true if what she wrote is exactly right (spelling and
endings count), false if it is wrong, null if the item cannot be judged without the picture or is really ambiguous.
When ok is false: h = ONE short kind hint in ${SPEAKING_STYLE[language]} (max 16 words) that names the item and helps her
find the mistake herself (the rule, the ending, the helper verb…). Never give the answer in h.
Return JSON only: {"r":[{"i":0,"ok":true,"x":"...","h":""}]}`,
    700,
    'low',
    true,
  );
  let parsed: { r?: { i?: number; ok?: boolean | null; x?: string; h?: string }[] } = {};
  try {
    parsed = JSON.parse(out ?? '{}');
  } catch {
    return lines;
  }
  for (const r of parsed.r ?? []) {
    const l = typeof r.i === 'number' ? todo[r.i] : undefined;
    if (!l || typeof r.ok !== 'boolean') continue;
    l.status = r.ok ? 'right' : 'wrong';
    if (r.x) l.expected = String(r.x).slice(0, 80);
    if (!r.ok && r.h) l.hn = String(r.h).slice(0, 200);
  }
  return lines;
}

/** « 1 - Cheval. » and « cheval » are the same word answer (case, numbering, end punctuation ignored; accents count). */
const wordAnswer = (x: string) =>
  x
    .normalize('NFC')
    .toLowerCase()
    .replace(/^\s*\d+\s*[-.)]\s*/, '')
    .replace(/[.,;!?«»"]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Her work on a practice exercise Silia gave (« Exercice similaire »). One small text call finds which exercise of the
 * photo holds her answers and which item answers which question (she may not copy the questions); the answers
 * themselves are taken from the reading and checked in code against the practice answers. null = not this practice.
 */
export async function practiceLines(practice: Practice, exs: PageExercise[], grade: string, log: (s: string, d?: unknown) => void): Promise<Line[] | null> {
  const listing = exs
    .map(
      (e) =>
        `Exercise ${e.n} "${e.title}": ${e.instr}\n` +
        e.items.map((it, k) => `  ${k}. "${it.q}" -> she wrote: ${it.a === null ? '(nothing)' : `"${it.a}"`}`).join('\n'),
    )
    .join('\n');
  const out = await ask(
    `Silia, the teacher, gave a child in ${grade} this practice exercise on the board:
Title: "${practice.title}". Instruction: "${practice.instr ?? ''}".
Items: ${practice.items.map((it, i) => `${i}. ${it.q}`).join(' | ')}
The child then wrote her answers on paper and took a photo. What was read on the photo:
${listing}
Is one exercise on the photo her work on THIS practice exercise (the same items in the same order, or just her answers
numbered 1, 2, 3…, even if she did not copy the questions)? If the photo shows another exercise of her homework, ex = null.
Return JSON only: {"ex":1,"map":[{"i":0,"k":0}]}  i = practice item; k = the photo item (in that exercise) that holds
her answer for it, null if none.`,
    400,
    'low',
    true,
  );
  let m: { ex?: number | null; map?: { i?: number; k?: number | null }[] } = {};
  try {
    m = JSON.parse(out ?? '{}');
  } catch {
    return null;
  }
  const e = typeof m.ex === 'number' ? exs.find((x) => x.n === m.ex) : undefined;
  log('practice match', { ex: m.ex ?? null, map: m.map ?? [] });
  if (!e) return null;
  return practice.items.map((it, i): Line => {
    const k = (m.map ?? []).find((x) => x.i === i)?.k;
    const item = typeof k === 'number' ? e.items[k] : undefined;
    const a = item?.a ?? null;
    const base = { q: it.q, a, c: item?.c ?? 0, expected: it.a, ...(item?.r ? { r: item.r } : {}), ...(item?.hn ? { hn: item.hn } : {}) };
    if (!a || !a.trim()) return { ...base, status: 'empty' };
    if (it.m) {
      const copied = checkCopy(it.m, a.replace(/^\s*\d+\s*[-.)]\s*/, ''));
      if (!copied) return { ...base, status: 'open' };
      return {
        ...base,
        status: copied.ok ? 'right' : 'wrong',
        copy: true,
        ...(copied.ok ? {} : { why: `on the line of "${it.m}" she wrote ${copied.wrong.map((w) => `"${w}"`).join(', ')}, which is not "${it.m}"` }),
      };
    }
    if ((item?.c ?? 0) < THRESHOLD) return { ...base, status: 'unsure' };
    const ok = /\d/.test(it.a) ? sameAnswer(a, it.a) : wordAnswer(a) === wordAnswer(it.a);
    return { ...base, status: ok ? 'right' : 'wrong' };
  });
}

async function ask(content: string, maxTokens: number, effort = 'low', asJson = false): Promise<string | null> {
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Deno.env.get('OPENAI_API_KEY')}` },
      body: JSON.stringify({
        model: MODEL,
        reasoning_effort: effort,
        max_completion_tokens: maxTokens,
        ...(asJson ? { response_format: { type: 'json_object' } } : {}),
        messages: [{ role: 'user', content }],
      }),
    });
    if (!res.ok) return null;
    return String((await res.json()).choices?.[0]?.message?.content ?? '').trim() || null;
  } catch {
    return null;
  }
}

const words = (x: string) => x.toLowerCase().split(/[^\p{L}\p{N}.,]+/u).filter(Boolean);
/** The answer appears in the text as whole words/numbers (« mange » is not in « manger »). */
function contains(text: string, answer: string): boolean {
  const t = words(text);
  const a = words(answer);
  if (!a.length) return false;
  return t.some((_, i) => a.every((w, j) => t[i + j] === w));
}

/** One short hint for a wrong answer: the reading's own hint when it is safe, else a small text-only call. */
export async function hintFor(l: Line, language: Lang, grade: string): Promise<string | null> {
  const expected = l.copy ? '' : (l.expected ?? '');
  const leaks = (h: string) => expected !== '' && contains(h, expected);
  const slip = ownCalculationSlip(l.a ?? '');
  if (l.hn && !l.copy && !slip && !leaks(l.hn)) return l.hn;
  const slipNote = slip
    ? ` Her own calculation "${slip.calculation}" actually makes ${slip.makes}, not ${slip.wrote}: help her redo that calculation carefully (you may say her numbers, not the final answer).`
    : '';
  const note = l.why ? ` Teacher's note: ${l.why}.` : '';
  const hint = await ask(
    `You are Silia, her kind teacher. A girl in ${grade} wrote "${l.a}" for "${l.q}", which is not right.${slipNote}${note} Think about the likely mistake (wrong operation, forgot a carry or a borrow, wrong letter…), then write ONE short, kind hint in ${SPEAKING_STYLE[language]} (max 16 words), at her level, that helps her find it herself. Never give the answer, never say she is wrong. Reply with the hint only.`,
    400,
  );
  return hint && !leaks(hint) ? hint : null;
}

/** Not checkable from the photo (a word, counting, Arabic handwriting): ONE guiding question that asks for her answer. */
export async function guideQuestion(e: PageExercise, open: Line[], language: Lang, grade: string): Promise<string | null> {
  const item = open[0];
  return await ask(
    `You are Silia, the kind teacher of a girl in ${grade}. Exercise "${e.title}": ${e.instr || '(no instruction)'}.
Item: "${item?.q ?? ''}". You cannot be sure of her answer from the photo, so you do NOT judge it.
Write ONE or TWO short sentences in ${SPEAKING_STYLE[language]}: one concrete step that fits THIS exercise and THIS item
(read the instruction: conjugate, count, complete a word…), then ask her to say her answer or type it. Never give the
answer. Never talk about anything that is not in this item. No emojis. Reply with the text only.`,
    300,
    'low',
  );
}
