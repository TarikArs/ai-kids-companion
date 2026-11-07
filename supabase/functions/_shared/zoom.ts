// Zoom on one exercise before judging it. A photo of a whole page (6 exercises) leaves few pixels per digit: « 30 ; 50 »
// was read « 3 ; 5 ». The exercise's box is cut out of the photo, enlarged, and read again on its own; the answers and
// their boxes from this zoomed reading replace the first ones (boxes mapped back to the whole photo).

import { decodeBase64, encodeBase64 } from 'jsr:@std/encoding@1/base64';
import jpeg from 'npm:jpeg-js@0.4.4';

import { clampRegion, READ_MODEL, type PageExercise, type PageItem, type Region } from './page.ts';

/** Zoom only when the exercise is a small part of the photo (a page with several exercises). */
const ZOOM_MAX_AREA = 0.45;
const MARGIN = 0.03;
const OUT_MAX_SIDE = 1600;

/** The box cut out of the photo, enlarged (up to ×2.5, at most 1600 px), as a JPEG; null if it cannot be done. */
function cropB64(b64: string, r: Region): { b64: string; box: Region } | null {
  try {
    const img = jpeg.decode(decodeBase64(b64), { useTArray: true, maxMemoryUsageInMB: 512 });
    const x0 = Math.max(0, r.x - MARGIN);
    const y0 = Math.max(0, r.y - MARGIN);
    const x1 = Math.min(1, r.x + r.w + MARGIN);
    const y1 = Math.min(1, r.y + r.h + MARGIN);
    const box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    const sx = Math.round(x0 * img.width);
    const sy = Math.round(y0 * img.height);
    const sw = Math.max(1, Math.round(box.w * img.width));
    const sh = Math.max(1, Math.round(box.h * img.height));
    const scale = Math.min(2.5, OUT_MAX_SIDE / Math.max(sw, sh));
    const W = Math.round(sw * scale);
    const H = Math.round(sh * scale);
    const out = new Uint8Array(W * H * 4);
    // Bilinear enlargement: smoother pencil strokes than nearest pixel.
    for (let y = 0; y < H; y++) {
      const fy = sy + (y + 0.5) / scale - 0.5;
      const y0i = Math.max(0, Math.min(img.height - 1, Math.floor(fy)));
      const y1i = Math.min(img.height - 1, y0i + 1);
      const ty = Math.min(1, Math.max(0, fy - y0i));
      for (let x = 0; x < W; x++) {
        const fx = sx + (x + 0.5) / scale - 0.5;
        const x0i = Math.max(0, Math.min(img.width - 1, Math.floor(fx)));
        const x1i = Math.min(img.width - 1, x0i + 1);
        const tx = Math.min(1, Math.max(0, fx - x0i));
        const o = (y * W + x) * 4;
        for (let ch = 0; ch < 3; ch++) {
          const a = img.data[(y0i * img.width + x0i) * 4 + ch];
          const b = img.data[(y0i * img.width + x1i) * 4 + ch];
          const c = img.data[(y1i * img.width + x0i) * 4 + ch];
          const d = img.data[(y1i * img.width + x1i) * 4 + ch];
          out[o + ch] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
        }
        out[o + 3] = 255;
      }
    }
    return { b64: encodeBase64(jpeg.encode({ data: out, width: W, height: H }, 88).data), box };
  } catch (e) {
    console.error('zoom crop failed', (e as Error).message);
    return null;
  }
}

/**
 * The exercise read again from a zoom on its box. Returns the exercise with the new answers (or the same one when the
 * zoom is not needed or fails). `z` marks it as zoomed so it is done once per photo.
 */
export async function zoomExercise(e: PageExercise, photo: () => Promise<string>, grade: string, log: (s: string, d?: unknown) => void): Promise<PageExercise> {
  if (e.z || !e.r || !e.items.length || e.r.w * e.r.h > ZOOM_MAX_AREA) return e;
  const crop = cropB64(await photo(), e.r);
  if (!crop) return e;
  const prompt = `Zoom on ONE exercise of a homework page, done by a child in ${grade}: "${e.title}". Instruction: "${e.instr}".
The places where she must answer, in order:
${e.items.map((it, i) => `${i}. ${it.q}`).join('\n')}
READ what the child wrote for each place, digit by digit, exactly as written, even if it is wrong. Never correct, never
complete, never write what the answer should be. Two numbers written in one place (« 30 ; 50 ») = both, as written.
Dots or lines are empty slots, not answers: nothing written = null. She often erases and starts over: faint grey
ghost marks or smudges left by a rubber are ERASED = null; only clear, dark strokes are answers. The image may be sideways.
Also tx = the printed statement and data of this exercise, VERBATIM (word problem, riddle, numbers given; max 80 words; "" if none).
Return JSON only: {"tx":"...","i":[{"n":0,"a":"30 ; 50","c":0.95,"r":[x,y,w,h]}]}
n = the place number above; a = her answer or null; c = confidence 0-1; r = box of her answer as fractions (0-1) of THIS image.`;
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Deno.env.get('OPENAI_API_KEY')}` },
      body: JSON.stringify({
        model: READ_MODEL,
        reasoning_effort: Deno.env.get('OPENAI_ZOOM_EFFORT') ?? 'low',
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${crop.b64}`, detail: 'high' } },
            ],
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}`);
    const out = JSON.parse((await res.json()).choices[0].message.content) as { tx?: string; i?: { n?: number; a?: string | null; c?: number; r?: number[] }[] };
    const items: PageItem[] = e.items.map((it, n) => {
      const z = (out.i ?? []).find((x) => x.n === n);
      if (!z) return it;
      const zr = clampRegion(z.r);
      const r = zr ? { x: crop.box.x + zr.x * crop.box.w, y: crop.box.y + zr.y * crop.box.h, w: zr.w * crop.box.w, h: zr.h * crop.box.h } : it.r;
      const a = z.a === null || z.a === undefined || String(z.a).trim() === '' ? null : String(z.a);
      return { ...it, a, c: Number(z.c ?? it.c), ...(r ? { r } : {}) };
    });
    log('zoom', { exercise: e.n, before: e.items.map((i) => i.a), after: items.map((i) => i.a) });
    const tx = String(out.tx ?? '').trim().slice(0, 600);
    return { ...e, items, ...(tx ? { tx } : {}), z: true };
  } catch (err) {
    log('zoom failed', (err as Error).message);
    return e;
  }
}
