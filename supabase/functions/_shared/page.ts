// Page context: what is on the photo (printed text, exercises, their instructions, the child's visible answers).
// Extracted ONCE per photo with one vision call, then cached in snapshots.exercises (and page_text for the reading check).

import { encodeBase64 } from 'jsr:@std/encoding@1/base64';

import { admin } from './supabase.ts';

const MODEL = Deno.env.get('OPENAI_VISION_MODEL') ?? 'gpt-6-luna';

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
  c: number;
}

export interface PageExercise {
  /** Position on the page: 1, 2, 3… in reading order. */
  n: number;
  /** Number printed on the page ("10"), if any. */
  label?: string;
  title: string;
  /** Printed instruction (consigne). */
  instr: string;
  s: 'empty' | 'partial' | 'done';
  r?: Region;
  items: PageItem[];
}

export interface PageContext {
  lang: string;
  /** false: no readable page on the photo; why says what is wrong. */
  readable: boolean;
  why?: string;
  text: string;
  exercises: PageExercise[];
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

const prompt = (grade: string) => `Photo of a homework page of a child in ${grade}. It may be sideways or upside down: read it in any orientation.
Return JSON only, like:
{"lang":"fr","ok":true,"why":"","text":"...","ex":[{"n":1,"lb":"1","title":"...","instr":"...","s":"partial","r":[0.1,0.2,0.8,0.3],"it":[{"q":"7 - 2 = ?","a":"5","c":0.9}]}]}
lang: fr|ar|en, the page's language.
ok: false when no page can be read (too dark, blurry, cut off, no homework page); then why = what is wrong, 2-6 English words.
text: the PRINTED text of the page exactly, in reading order (Arabic stays in Arabic script), no handwriting, max 2000 characters.
ex: the separate exercises in reading order. n: position 1, 2, 3… lb: the exercise number printed on the page ("" if none).
title: short title in the page's language (the printed title, or 3-6 words). instr: the printed instruction (consigne) exactly.
s: empty|partial|done from the child's answers. r: the exercise's box as fractions (0-1) of THIS image's width and height.
it: every place where the child must answer, in order. q: the item as printed, with ? for the blank (word problem: its question).
a: the child's handwriting copied exactly, even if wrong (a whole calculation if she wrote one); null if nothing is written or it cannot be seen.
c: confidence 0-1 in a. Never correct, complete or invent: unreadable = null. Skip exercises cut off so much they cannot be read.`;

function parse(raw: Record<string, unknown>): PageContext {
  const exs = (Array.isArray(raw.ex) ? raw.ex : []) as Record<string, unknown>[];
  return {
    lang: String(raw.lang ?? 'fr'),
    readable: raw.ok !== false,
    why: raw.ok === false ? String(raw.why ?? '') : undefined,
    text: String(raw.text ?? ''),
    exercises: exs.slice(0, 12).map((e, i) => {
      const label = String(e.lb ?? '').trim();
      return {
        n: i + 1,
        ...(label && label !== String(i + 1) ? { label } : {}),
        title: String(e.title ?? `${i + 1}`).slice(0, 80),
        instr: String(e.instr ?? '').slice(0, 400),
        s: (['empty', 'partial', 'done'].includes(String(e.s)) ? e.s : 'empty') as PageExercise['s'],
        r: clampRegion(e.r),
        items: (Array.isArray(e.it) ? e.it : []).slice(0, 30).map((it: Record<string, unknown>) => ({
          q: String(it.q ?? ''),
          a: it.a === null || it.a === undefined || it.a === '' ? null : String(it.a),
          c: Number(it.c ?? 0),
        })),
      };
    }),
  };
}

export async function downloadB64(storagePath: string): Promise<string> {
  const { data: file, error } = await admin.storage.from('snapshots').download(storagePath);
  if (error || !file) throw new Error(`download: ${error?.message}`);
  return encodeBase64(new Uint8Array(await file.arrayBuffer()));
}

/** Page context of a photo: cached, or extracted now (one vision call) and cached in the background. */
export async function pageContext(
  snap: SnapshotRow,
  grade: string,
  background: (p: Promise<unknown>) => unknown,
): Promise<PageContext> {
  if (snap.exercises && Array.isArray(snap.exercises.exercises)) return snap.exercises;
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
            { type: 'text', text: prompt(grade) },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}`, detail: 'high' } },
          ],
        },
      ],
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${body.slice(0, 300)}`);
  const ctx = parse(JSON.parse(JSON.parse(body).choices[0].message.content));
  background(
    (async () => {
      const { error } = await admin
        .from('snapshots')
        .update({ exercises: ctx, page_text: ctx.text, page_lang: ctx.lang })
        .eq('id', snap.id);
      // exercises column missing (migration not applied): keep at least the page text for the reading check.
      if (error) await admin.from('snapshots').update({ page_text: ctx.text, page_lang: ctx.lang }).eq('id', snap.id);
    })(),
  );
  return ctx;
}

/** Latest photo of the session with a readable page (analyzed first, else one still being analyzed). */
export async function latestSnapshot(sessionId: string): Promise<(SnapshotRow & { taken_at: string }) | null> {
  const get = async (statuses: string[], withExercises: boolean) =>
    await admin
      .from('snapshots')
      .select(withExercises ? 'id, storage_path, taken_at, page_text, page_lang, exercises' : 'id, storage_path, taken_at, page_text, page_lang')
      .eq('session_id', sessionId)
      .in('status', statuses)
      .order('taken_at', { ascending: false })
      .limit(1)
      .maybeSingle();
  let withEx = true;
  let res = await get(['analyzed'], withEx);
  if (res.error) {
    withEx = false; // exercises column missing
    res = await get(['analyzed'], withEx);
  }
  if (!res.data) res = await get(['uploaded'], withEx);
  return (res.data as unknown as (SnapshotRow & { taken_at: string }) | null) ?? null;
}
