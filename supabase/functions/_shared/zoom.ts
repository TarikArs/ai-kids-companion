// Zoom pass: crop each uncertain answer from the full-resolution photo, enlarge it, and read it again.
// Like a teacher leaning closer. Only for answers that need it, in one call with small images.

import { encodeBase64 } from 'jsr:@std/encoding@1/base64';

import { decodeJpegB64, Image } from './image.ts';

interface Item {
  key: string;
  type: string;
  child_answer: string | null;
  confidence: number;
  region?: { x: number; y: number; w: number; h: number };
}

const MAX_ZOOMS = 4;
const digits = (s: string | null) => (s?.match(/\d/g) ?? []).length;

export async function zoomAnswers(
  imageB64: string,
  items: Item[],
  opts: { threshold: number; longThreshold: number; model: string },
): Promise<{ tried: boolean; report?: unknown }> {
  const candidates = items
    .filter((i) => i.region && i.region.w > 0 && i.region.h > 0)
    .filter(
      (i) =>
        i.child_answer === null ||
        i.confidence < opts.threshold ||
        (digits(i.child_answer) >= 4 && i.confidence < opts.longThreshold),
    )
    .slice(0, MAX_ZOOMS);
  if (!candidates.length) return { tried: false };

  let image: Image;
  try {
    image = await decodeJpegB64(imageB64);
  } catch (e) {
    return { tried: true, report: { error: `decode: ${(e as Error).message}` } };
  }

  // Crop each answer with a generous margin (the printed exercise next to it helps), enlarge small crops.
  const crops: string[] = [];
  for (const it of candidates) {
    const r = it.region!;
    const mx = r.w * 0.8 + 0.03, my = r.h * 0.8 + 0.02;
    const x0 = Math.max(0, r.x - mx), y0 = Math.max(0, r.y - my);
    const x1 = Math.min(1, r.x + r.w + mx), y1 = Math.min(1, r.y + r.h + my);
    const crop = image.clone().crop(
      Math.round(x0 * image.width),
      Math.round(y0 * image.height),
      Math.max(16, Math.round((x1 - x0) * image.width)),
      Math.max(16, Math.round((y1 - y0) * image.height)),
    );
    if (crop.width < 600) crop.resize(600, Image.RESIZE_AUTO);
    crops.push(encodeBase64(await crop.encodeJPEG(88)));
  }

  const content: unknown[] = [
    {
      type: 'text',
      text: `Each image is a close-up of a homework answer written by a child (pencil, possibly faint).
For image number N, read ONLY the child's handwriting for the exercise given below, digit by digit, exactly as written,
even if it is wrong. Never compute or correct it. Give an honest confidence. null only if nothing can be made out.
${candidates.map((c, n) => `Image ${n + 1}: exercise "${c.key}"`).join('\n')}
Return JSON only: {"r":[{"n":1,"a":"..." or null,"c":0.0}]}`,
    },
    ...crops.map((b64) => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}`, detail: 'high' } })),
  ];

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Deno.env.get('OPENAI_API_KEY')}` },
    body: JSON.stringify({
      model: opts.model,
      reasoning_effort: 'low',
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content }],
    }),
  });
  if (!res.ok) return { tried: true, report: { error: `OpenAI ${res.status}` } };
  const body = await res.json();
  const out = JSON.parse(body.choices[0].message.content);
  const report: unknown[] = [];
  for (const z of Array.isArray(out.r) ? out.r : []) {
    const it = candidates[Number(z.n) - 1];
    if (!it) continue;
    const a = z.a === null || z.a === undefined || z.a === '' ? null : String(z.a);
    const c = Number(z.c ?? 0);
    report.push({ k: it.key, before: { a: it.child_answer, c: it.confidence }, zoom: { a, c } });
    // Keep the zoomed reading when it is more confident (or when the first pass saw nothing).
    if (a !== null && (it.child_answer === null || c > it.confidence)) {
      it.child_answer = a;
      it.confidence = c;
    } else if (a !== null && a === it.child_answer) {
      it.confidence = Math.max(it.confidence, c); // two readings agree
    }
  }
  return { tried: true, report: { zoomed: report, usage: body.usage } };
}
