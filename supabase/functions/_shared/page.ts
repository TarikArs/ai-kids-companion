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
  /** The zoom saw nothing where the first reading saw an answer: kept until a close-up check decides. */
  d?: boolean;
}

export interface PageExercise {
  /** Position on the page: 1, 2, 3… in reading order. */
  n: number;
  /** Number printed on the page ("10"), if any. */
  label?: string;
  title: string;
  /** Printed instruction (consigne), or the task inferred from the layout. */
  instr: string;
  /** Printed statement / data of the exercise (word problem, riddle, story lines), verbatim. */
  tx?: string;
  s: 'empty' | 'partial' | 'done';
  r?: Region;
  items: PageItem[];
  /** Already read again from a zoom on its box (zoom.ts): not zoomed twice. */
  z?: boolean;
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
{"rot":0,"v":true,"h":false,"lang":"fr","e":[{"n":1,"lb":"1","ti":"Soustractions posées","in":"Pose et calcule.","tx":"","r":[x,y,w,h]}],"i":[{"e":1,"k":"6 - 2 = ?","t":"fill_in","a":"4","w":"c","c":0.95,"r":[x,y,w,h]}]}
rot: how many degrees the photo must be turned CLOCKWISE so the printed text reads upright (0, 90, 180 or 270).
v: a homework page is visible (true even if a little is cut off or a finger holds the edge). h: a hand or object
hides MOST of the page so its answers cannot be read; a finger or thumb holding the page edge is NOT h. lang: fr|ar|en, the page's language.
e: the separate exercises in reading order, EVEN EMPTY ONES and small boxes at the top (« Calcul rapide »,
« Calcul mental », a warm-up band): each is an exercise of its own: n = position 1, 2, 3…; lb = the number printed on the page
("" if none); ti = short title in the page's language; in = the printed instruction (max 20 words); tx = the printed
statement and data of the exercise, VERBATIM (word problem, riddle, numbers given, short text; max 80 words; "" if the
items already say everything). For a TABLE, tx = its rows as printed, cells separated by « | », one row per line, ? for a
blank (« gonfler | dégonfler | regonfler / plier | déplier | ?plier »): the pattern of the rows is needed to find the
answers. A matching exercise (« Relie… ») is NOT a table: tx = the words and the boxes as two separate lists
(« Mots : vaisselle, four, carafe, bol. Maisons : f, l. »), never side by side. r = the exercise's box.
Many exercises have NO printed instruction: infer the task from the layout and write it in the page's language, never
"no instruction". A model letter, digit or word at the start of a line followed by dots, slots or empty space = handwriting
practice (t=copy): "Écris la lettre A dans chaque case". One item per line: k = "Recopier A", m = the model ("A"),
a = EVERYTHING she wrote on that line after the model, separated by spaces, exactly as written even if it is another
letter (e.g. "A a e"); a = null only if all slots are empty. Dots or lines are empty slots, not answers. Erased pencil (grey ghost marks, smudges left by a rubber) = erased = empty: a = null.
PRINTED or HANDWRITTEN — the most important rule. Workbooks PRINT many words in school cursive (joined-up) script:
model sentences to copy, words after a blank (« ____plier »), labels. Printed cursive is perfectly regular, the same ink
and colour as the page, aligned with the layout. Her handwriting is pencil or pen: irregular, grey or coloured, often
slightly off the line. A printed word is NEVER her answer, even in cursive. If you are not sure it is hers, it is printed.
Worked example rows (« Regarde bien l'exemple », the first row of a table already filled in print, often shaded) are the
model: no items for them. Example answers PRINTED on the page (often blue, in a handwriting-like font, on the first line
or the first box: « Nine. », « Matt », « Let's run. », « C 1 ») are part of the example: no item, or a = null.
Choosing a label by colouring it (« colorie l'étiquette qui convient »): one item per sentence, k = "L'éléphant est
maigre | gros", a = the label she coloured, null if none.
i: every item where the child must write, empty ones too (a = null); e = the n of its exercise. k: the item as printed with ? for the blank:
ONLY printed text goes in k, never letters that are not printed. « Écris les lettres qui manquent » with a blank line before
the printed word « plier » -> k = "?plier", a = only what she wrote ON the blank (null if the blank line is empty).
Matching (« Relie », words to boxes): one item per word, k = "Relier « vaisselle »" , a = the box her drawn line reaches
(e.g. "l"), null when no line was drawn. Printed dots are not lines.
Circling, ticking or colouring IN A ROW (« Sur chaque ligne, entoure les mots identiques au modèle »): one item per row,
t=other, k = "Ligne « un » : un | ui | un | une" (the row's model, then its printed choices), a = the choices she marked,
with their place (« 1 un, 3 un »), null if she marked nothing in that row. Pictures to circle (« Entoure les images… »):
one item per picture, k = its printed word, a = "entouré" or null. Colouring a word grid (« Colorie les cases… »): one
item per word of the list, k = "Colorier ÎLE", a = the letters of the cells she coloured for it, with the colour
(« bleu : R, I »), null if none.
Dictation (« Dictée »): there is NO model on the page; t=dictation, one item per line, k = "Dictée ligne 1", a = what she
wrote, null if the line is empty.
Reading aloud only (« Lis les syllabes / les mots / les phrases »): nothing to write, no items.
Copying a sentence (« Écriture », a printed model then empty lines): t=copy, k = "Recopier « Il ira à l'île. »",
m = the model sentence, a = ONLY what she wrote on the lines under or next to the model, null if they are empty.
w: who wrote a: "c" = the child (pencil or pen strokes), "p" = it is printed on the page. Never guess letters that should
be there: no pencil strokes on a blank = a null.
t: fill_in|number_line|word_problem|matching|copy|counting|dictation|other.
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
  w?: string;
}

/**
 * The reading sometimes gives printed text as her answer (workbooks print words in cursive): the printed word after a
 * blank (« ?plier » -> « plier »), a copy model (« Il ira à l'île. »), or anything it marks as printed (w = "p").
 * Returns null (nothing written by her) in those cases.
 */
const flatText = (x: string) => x.normalize('NFC').toLowerCase().replace(/[’']/g, "'").replace(/[\s…_.]+/g, '');
export function herAnswer(q: string, a: string | null, m?: string, w?: string): string | null {
  if (!a || !a.trim()) return null;
  if (w === 'p') return null;
  const fa = flatText(a);
  // Only an item with a blank (?) can have its printed part read as her answer.
  if (q.includes('?') && (fa === flatText(q) || fa === flatText(q.replace(/\?/g, '')))) return null;
  if (q.includes('?') && q.split('?').some((part) => flatText(part).length >= 3 && flatText(part) === fa)) return null;
  if (m && /\s/.test(m.trim()) && fa === flatText(m)) return null;
  return a;
}

export const statusOf = (items: PageItem[]): PageExercise['s'] => {
  const filled = items.filter((i) => i.a).length;
  return filled === 0 ? 'empty' : filled === items.length ? 'done' : 'partial';
};

export const DEFAULT_HINT_LANG =
  "in the page's language (French page: French; Arabic page: simple Modern Standard Arabic, speaking to a girl; English page: English), with very, very easy words a little girl knows, no difficult school words";

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
    .map((e: { n?: number; lb?: string; ti?: string; in?: string; tx?: string; r?: number[] }, idx: number) => {
      const n = typeof e.n === 'number' ? e.n : idx + 1;
      const label = String(e.lb ?? '').trim();
      const mine: PageItem[] = items
        .filter((it) => it.e === n)
        .slice(0, 30)
        .map((it) => {
          const r = clampRegion(it.r);
          const m = typeof it.m === 'string' && it.m.trim() ? it.m.trim().slice(0, 80) : undefined;
          const hn = typeof it.hn === 'string' && it.hn.trim() ? it.hn.trim().slice(0, 200) : undefined;
          return {
            q: String(it.k ?? ''),
            a: herAnswer(String(it.k ?? ''), it.a === null || it.a === undefined ? null : String(it.a), m, it.w),
            c: Number(it.c ?? 0),
            t: String(it.t ?? 'other'),
            ...(m ? { m } : {}),
            ...(hn ? { hn } : {}),
            ...(r ? { r } : {}),
          };
        });
      const r = clampRegion(e.r) ?? boxAround(mine);
      return {
        n,
        ...(label && label !== String(n) ? { label } : {}),
        title: String(e.ti ?? '').slice(0, 80) || String(n),
        instr: String(e.in ?? '').slice(0, 200),
        ...(String(e.tx ?? '').trim() ? { tx: String(e.tx).trim().slice(0, 600) } : {}),
        s: statusOf(mine),
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

/** The exercise as given to a text model: instruction + printed statement (a word problem needs its data). */
export const exerciseBrief = (e: PageExercise) =>
  `Exercise "${e.title}". Instruction: "${e.instr || '(none printed)'}".${e.tx ? `\nPrinted statement of the exercise: "${e.tx}"` : ''}`;

/** Needs the printed page text to be understood (a story, Vrai/Faux, a word problem whose statement was not read). */
export const needsPageText = (e: PageExercise, about: RegExp) =>
  about.test(`${e.title} ${e.instr} ${e.items.map((l) => l.q).join(' ')}`) || (!e.tx && e.items.some((i) => i.t === 'word_problem'));
