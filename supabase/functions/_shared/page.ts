// The page on a photo: exercises, instructions and the child's visible answers. Read ONCE per photo with one vision
// call (analyze-snapshot, when Lina presses « Silia, regarde »), then cached in snapshots.exercises for every
// later request on that photo (voice, typed answers, the exercise buttons).

import { encodeBase64 } from 'jsr:@std/encoding@1/base64';

import { admin } from './supabase.ts';

const MODEL = Deno.env.get('OPENAI_VISION_MODEL') ?? 'gpt-6-luna';
// Fast reading (benchmark: effort "none" ~3 s, "low" ~8 s). A "wrong" is confirmed with VERIFY_EFFORT (verdict.ts).
export const READ_MODEL = Deno.env.get('OPENAI_READ_MODEL') ?? MODEL;
export const READ_EFFORT = Deno.env.get('OPENAI_READ_EFFORT') ?? 'low';

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One place where the child must answer. a = her handwriting as written, null = nothing visible. */
export interface PageItem {
  q: string;
  a: string | null;
  /** Confidence 0-1 in a. */
  c: number;
  /** fill_in | number_line | word_problem | matching | copy | counting | other */
  t?: string;
  /** Copy line: the model letter or word. */
  m?: string;
  /** Hint written during the reading, used only when the code confirms the answer is wrong. */
  hn?: string;
  /** Box of her answer on the photo. */
  r?: Region;
}

export interface PageExercise {
  /** Position on the page: 1, 2, 3… in reading order. */
  n: number;
  /** Number printed on the page ("10"), if any. */
  label?: string;
  title: string;
  /** Printed instruction (consigne), or the task inferred from the layout. */
  instr: string;
  s: 'empty' | 'partial' | 'done';
  r?: Region;
  items: PageItem[];
}

export interface PageContext {
  lang: string;
  /** false: no readable page on the photo. */
  readable: boolean;
  why?: string;
  /** Printed text, read later and only for reading aloud (pageText). */
  text: string;
  exercises: PageExercise[];
}

export interface Reading extends PageContext {
  /** Degrees to turn the photo clockwise so the page reads upright. */
  rot: 0 | 90 | 180 | 270;
  handBlocking: boolean;
  usage: unknown;
}

export interface SnapshotRow {
  id: string;
  storage_path: string;
  page_text?: string | null;
  page_lang?: string | null;
  exercises?: PageContext | null;
}

export const clampRegion = (r: unknown): Region | undefined =>
  Array.isArray(r) && r.length === 4 && r.every((v) => typeof v === 'number' && v >= 0 && v <= 1)
    ? { x: r[0], y: r[1], w: r[2], h: r[3] }
    : undefined;

// Compact keys keep the model's output short: output tokens are the main cost in time.
const readPrompt = (grade: string, hintLang: string) => `Photo of homework by a child in ${grade}. READ what the child wrote; do not correct.
Return JSON only, compact:
{"rot":0,"v":true,"h":false,"lang":"fr","e":[{"n":1,"lb":"1","ti":"Soustractions posées","in":"Pose et calcule.","r":[x,y,w,h]}],"i":[{"e":1,"k":"6 - 2 = ?","t":"fill_in","a":"4","c":0.95,"r":[x,y,w,h]}]}
rot: how many degrees the photo must be turned CLOCKWISE so the printed text reads upright (0, 90, 180 or 270).
v: a homework page is visible. h: a hand or object covers answers. lang: fr|ar|en, the page's language.
e: the separate exercises in reading order, EVEN EMPTY ONES: n = position 1, 2, 3…; lb = the number printed on the page
("" if none); ti = short title in the page's language; in = the printed instruction (max 20 words); r = the exercise's box.
Many exercises have NO printed instruction: infer the task from the layout and write it in the page's language, never
"no instruction". A model letter, digit or word at the start of a line followed by dots, slots or empty space = handwriting
practice (t=copy): "Écris la lettre A dans chaque case". One item per line: k = "Recopier A", m = the model ("A"),
a = EVERYTHING she wrote on that line after the model, separated by spaces, exactly as written even if it is another
letter (e.g. "A a e"); a = null only if all slots are empty. Dots or lines are empty slots, not answers.
i: every item where the child must write, empty ones too (a = null); e = the n of its exercise. k: the item as printed with ? for the blank.
t: fill_in|number_line|word_problem|matching|copy|counting|other.
a: COPY the child's handwriting digit by digit, exactly as written, even if it is wrong or unfinished. Never write what the
answer should be, never correct it, never complete it. Faint pencil: give your best reading and a LOWER confidence c.
Only when nothing can be made out (empty, cut off, fully illegible): a = null. A whole calculation she wrote: a = all of it.
c: confidence 0-1 in a. r: box around the child's answer as fractions (0-1) of THIS image's width and height.
hn: ONLY for an item where you think her answer may be wrong: ONE short kind hint (max 16 words) ${hintLang}, that helps her
find the mistake herself. Never the answer, never say she is wrong.
The photo may be sideways or upside down: read it in any orientation. Arabic digits are fine.`;

interface RawItem {
  e?: number;
  k?: string;
  t?: string;
  m?: string;
  a?: string | null;
  c?: number;
  r?: number[];
  hn?: string;
}

export const DEFAULT_HINT_LANG =
  "in the page's language (French page: simple French; Arabic page: simple Modern Standard Arabic, speaking to a girl; English page: simple English)";

/** Reads the page (one vision call). */
export async function readPage(imageB64: string, grade: string, hintLang = DEFAULT_HINT_LANG, effort = READ_EFFORT): Promise<Reading> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Deno.env.get('OPENAI_API_KEY')}` },
    body: JSON.stringify({
      model: READ_MODEL,
      reasoning_effort: effort,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: readPrompt(grade, hintLang) },
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
  const items = (Array.isArray(raw.i) ? raw.i : []) as RawItem[];
  const exercises: PageExercise[] = (Array.isArray(raw.e) ? raw.e : [])
    .slice(0, 12)
    .map((e: { n?: number; lb?: string; ti?: string; in?: string; r?: number[] }, idx: number) => {
      const n = typeof e.n === 'number' ? e.n : idx + 1;
      const label = String(e.lb ?? '').trim();
      const mine: PageItem[] = items
        .filter((it) => it.e === n)
        .slice(0, 30)
        .map((it) => {
          const r = clampRegion(it.r);
          const m = typeof it.m === 'string' && it.m.trim() ? it.m.trim().slice(0, 12) : undefined;
          const hn = typeof it.hn === 'string' && it.hn.trim() ? it.hn.trim().slice(0, 200) : undefined;
          return {
            q: String(it.k ?? ''),
            a: it.a === null || it.a === undefined || String(it.a).trim() === '' ? null : String(it.a),
            c: Number(it.c ?? 0),
            t: String(it.t ?? 'other'),
            ...(m ? { m } : {}),
            ...(hn ? { hn } : {}),
            ...(r ? { r } : {}),
          };
        });
      const filled = mine.filter((i) => i.a).length;
      const r = clampRegion(e.r) ?? boxAround(mine);
      return {
        n,
        ...(label && label !== String(n) ? { label } : {}),
        title: String(e.ti ?? '').slice(0, 80) || String(n),
        instr: String(e.in ?? '').slice(0, 200),
        s: filled === 0 ? 'empty' : filled === mine.length ? 'done' : 'partial',
        ...(r ? { r } : {}),
        items: mine,
      } satisfies PageExercise;
    });
  const visible = raw.v !== false;
  return {
    lang: String(raw.lang ?? 'fr'),
    readable: visible,
    ...(visible ? {} : { why: 'no page' }),
    text: '',
    exercises,
    rot: [90, 180, 270].includes(Number(raw.rot)) ? (Number(raw.rot) as 90 | 180 | 270) : 0,
    handBlocking: raw.h === true,
    usage: body.usage,
  };
}

/** Box around the answers of an exercise, when the reading gave none for the exercise itself. */
function boxAround(items: PageItem[]): Region | undefined {
  const rs = items.map((i) => i.r).filter((r): r is Region => !!r);
  if (!rs.length) return undefined;
  const x = Math.max(0, Math.min(...rs.map((r) => r.x)) - 0.03);
  const y = Math.max(0, Math.min(...rs.map((r) => r.y)) - 0.03);
  const x1 = Math.min(1, Math.max(...rs.map((r) => r.x + r.w)) + 0.03);
  const y1 = Math.min(1, Math.max(...rs.map((r) => r.y + r.h)) + 0.03);
  return { x, y, w: x1 - x, h: y1 - y };
}

/** The page model kept on the snapshot (no usage, no orientation). */
export const pageOf = (r: Reading): PageContext => ({ lang: r.lang, readable: r.readable, ...(r.why ? { why: r.why } : {}), text: '', exercises: r.exercises });

export async function downloadB64(storagePath: string): Promise<string> {
  const { data: file, error } = await admin.storage.from('snapshots').download(storagePath);
  if (error || !file) throw new Error(`download: ${error?.message}`);
  return encodeBase64(new Uint8Array(await file.arrayBuffer()));
}

/** Page of a photo: cached, or read now (photo whose analysis failed) and cached in the background. */
export async function pageContext(snap: SnapshotRow, grade: string, background: (p: Promise<unknown>) => unknown): Promise<PageContext> {
  if (snap.exercises && Array.isArray(snap.exercises.exercises)) return snap.exercises;
  const page = pageOf(await readPage(await downloadB64(snap.storage_path), grade));
  background(Promise.resolve(admin.from('snapshots').update({ exercises: page, page_lang: page.lang }).eq('id', snap.id)));
  return page;
}

/**
 * Printed text of the page, for reading aloud. The reading for answers does not extract it (it would slow every photo):
 * read once, the first time she reads this page aloud, then cached.
 */
export async function pageText(snap: SnapshotRow, background: (p: Promise<unknown>) => unknown): Promise<string> {
  if (snap.page_text) return snap.page_text;
  if (snap.exercises?.text) return snap.exercises.text;
  const b64 = await downloadB64(snap.storage_path);
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
          content: [
            {
              type: 'text',
              text: 'Transcribe the printed text of this homework page exactly as written, in reading order (Arabic stays in Arabic script), keeping punctuation. The photo may be sideways. No translation, no comments, no handwriting. Return JSON only: {"lang":"fr|ar|en","text":"..."}',
            },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}`, detail: 'high' } },
          ],
        },
      ],
    }),
  });
  if (!res.ok) return '';
  const out = JSON.parse((await res.json()).choices[0].message.content);
  const text = String(out.text ?? '');
  const lang = String(out.lang ?? 'fr');
  background(Promise.resolve(admin.from('snapshots').update({ page_text: text, page_lang: lang }).eq('id', snap.id)));
  return text;
}

/** Latest photo of the session with a readable page (analyzed first, else one still being analyzed). */
export async function latestSnapshot(sessionId: string): Promise<(SnapshotRow & { taken_at: string }) | null> {
  const get = (statuses: string[]) =>
    admin
      .from('snapshots')
      .select('id, storage_path, taken_at, page_text, page_lang, exercises')
      .eq('session_id', sessionId)
      .in('status', statuses)
      .order('taken_at', { ascending: false })
      .limit(1)
      .maybeSingle();
  let res = await get(['analyzed']);
  if (!res.data) res = await get(['uploaded']);
  return (res.data as (SnapshotRow & { taken_at: string }) | null) ?? null;
}
