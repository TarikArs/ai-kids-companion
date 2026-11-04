// Empty exercise: like a teacher, Silia introduces the exercise the child is about to start (once per exercise).

import { expectedAnswer } from './arithmetic.ts';
import { SPEAKING_STYLE, type Lang } from './language.ts';
import { admin } from './supabase.ts';

export interface PageExerciseLite {
  /** Position on the page: 1, 2, 3… */
  n: number;
  /** Number printed on the page, when it differs from the position. */
  label?: string;
  title: string;
  instr: string;
  r?: Box;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ItemLite {
  ex?: number;
  key: string;
  child_answer: string | null;
  region?: Box;
}

/** Same exercise on another photo of the same page = same key. */
export const introKey = (e: PageExerciseLite) =>
  `intro:${`${e.title}|${e.instr}`.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 120)}`;

/**
 * The exercise she is about to start: the first one when nothing is written yet, otherwise the next empty exercise
 * after the last one she finished. null while she is still in the middle of an exercise.
 */
export function nextEmptyExercise(exs: PageExerciseLite[], items: ItemLite[]): PageExerciseLite | null {
  if (!exs.length) return null;
  const sorted = [...exs].sort((a, b) => a.n - b.n);
  const itemsOf = (n: number) => items.filter((i) => i.ex === n);
  const answered = (n: number) => itemsOf(n).some((i) => i.child_answer);
  const worked = sorted.filter((e) => answered(e.n)).map((e) => e.n);
  if (!worked.length) return sorted[0];
  const last = Math.max(...worked);
  if (itemsOf(last).some((i) => !i.child_answer)) return null; // still working on it: do not talk about the next one
  return sorted.find((e) => e.n > last && !answered(e.n)) ?? null;
}

/** Box around the answer places of an exercise (to frame it on the Board). */
export function regionOf(n: number, items: ItemLite[]): Box | undefined {
  const boxes = items.filter((i) => i.ex === n && i.region).map((i) => i.region!);
  if (!boxes.length) return undefined;
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const y1 = Math.max(...boxes.map((b) => b.y + b.h));
  const pad = 0.02;
  const cx = Math.max(0, x0 - pad);
  const cy = Math.max(0, y0 - pad);
  return { x: cx, y: cy, w: Math.min(1, x1 + pad) - cx, h: Math.min(1, y1 + pad) - cy };
}

/** The exercise to introduce now, or null (none, still working, or already introduced in this session). */
export async function pickIntro(sessionId: string, exs: PageExerciseLite[], items: ItemLite[]) {
  const exercise = nextEmptyExercise(exs, items);
  if (!exercise) return null;
  const key = introKey(exercise);
  const { data, error } = await admin.from('tutor_messages').select('id').eq('session_id', sessionId).eq('action', key).limit(1);
  if (error) return null; // migration not applied: never risk repeating the intro on every photo
  if (data?.length) return null;
  return { exercise, key, region: exercise.r ?? regionOf(exercise.n, items) };
}

const FALLBACK: Record<Lang, (n: number, title: string, instr: string) => string> = {
  fr: (n, t, i) => `Exercice ${n} : ${t}. ${i} Commence par le premier, je regarde !`,
  ar: (n, t, i) => `التمرين ${n}: ${t}. ${i} بداي بالأول، أنا كنشوف!`,
  fus: (n, t, i) => `التمرين ${n}: ${t}. ${i} ابدئي بالأول، أنا أنظر!`,
  en: (n, t, i) => `Exercise ${n}: ${t}. ${i} Start with the first one, I'm watching!`,
};

/** One or two short sentences: what to do, then "start with the first one". Never an answer. */
export async function introFor(e: PageExerciseLite, items: ItemLite[], lang: Lang, grade: string, model: string): Promise<string> {
  const mine = items.filter((i) => i.ex === e.n);
  const name = Number(e.label) || e.n;
  const fallback = FALLBACK[lang](name, e.title, e.instr).replace(/\s+/g, ' ').trim();
  const secrets = mine.map((i) => expectedAnswer(i.key)).filter((x): x is string => !!x);
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Deno.env.get('OPENAI_API_KEY')}` },
      body: JSON.stringify({
        model,
        reasoning_effort: 'low',
        max_completion_tokens: 300,
        messages: [
          {
            role: 'user',
            content: `You are Silia, the kind teacher of a girl in ${grade}. She is about to start exercise ${name} of her homework page.
Title: "${e.title}". Printed instruction: "${e.instr}". First items: ${mine.slice(0, 3).map((i) => `"${i.key}"`).join(', ') || '(none read)'}.
In ${SPEAKING_STYLE[lang]}, say in 1 or 2 short sentences what she has to do (start like "Exercise ${name}:" in that language),
then invite her to start with the first item, naming it. Max 28 words, warm, read aloud, no emojis. Never give an answer.
Reply with the sentences only.`,
          },
        ],
      }),
    });
    if (!res.ok) return fallback;
    const text = String((await res.json()).choices?.[0]?.message?.content ?? '').trim();
    const leaks = secrets.some((s) => new RegExp(`(^|\\D)${s.replace('.', '\\.')}(\\D|$)`).test(text));
    return text && !leaks ? text : fallback;
  } catch {
    return fallback;
  }
}
