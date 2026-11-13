// Zoom on one exercise before judging it. A photo of a whole page (6 exercises) leaves few pixels per digit: « 30 ; 50 »
// was read « 3 ; 5 ». The exercise's box is cut out of the photo, enlarged, and read again on its own; the answers and
// their boxes from this zoomed reading replace the first ones (boxes mapped back to the whole photo).

import { decodeBase64, encodeBase64 } from 'jsr:@std/encoding@1/base64';
import jpeg from 'npm:jpeg-js@0.4.4';

import { clampRegion, herAnswer, READ_MODEL, statusOf, type PageExercise, type PageItem, type Region } from './page.ts';

/** Zoom only when the exercise is a small part of the photo (a page with several exercises). */
const ZOOM_MAX_AREA = 0.45;
/** Exercises where she circles, ticks, colours, links or numbers things. */
const MARKS = /entour|colori|relie|coche|soulign|numérot|circle|match|tick|colou?r|number/i;
const MARGIN = 0.03;
const OUT_MAX_SIDE = 1600;

/** The box cut out of the photo, enlarged (up to ×2.5, at most 1600 px), as a JPEG; null if it cannot be done. */
/** The photo decoded once per request: several crops of the same photo must not decode it again (memory limit). */
type Decoded = { width: number; height: number; data: Uint8Array };
let decoded: { key: string; img: Decoded } | null = null;
function decodeOnce(b64: string): Decoded {
  const key = `${b64.length}:${b64.slice(0, 64)}:${b64.slice(-64)}`;
  if (decoded?.key === key) return decoded.img;
  const img = jpeg.decode(decodeBase64(b64), { useTArray: true, maxMemoryUsageInMB: 512 }) as unknown as Decoded;
  decoded = { key, img };
  return img;
}

export function cropB64(b64: string, r: Region, maxSide = OUT_MAX_SIDE): { b64: string; box: Region } | null {
  try {
    const img = decodeOnce(b64);
    const x0 = Math.max(0, r.x - MARGIN);
    const y0 = Math.max(0, r.y - MARGIN);
    const x1 = Math.min(1, r.x + r.w + MARGIN);
    const y1 = Math.min(1, r.y + r.h + MARGIN);
    const box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    const sx = Math.round(x0 * img.width);
    const sy = Math.round(y0 * img.height);
    const sw = Math.max(1, Math.round(box.w * img.width));
    const sh = Math.max(1, Math.round(box.h * img.height));
    const scale = Math.min(2.5, maxSide / Math.max(sw, sh));
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
  // No answer place read for an exercise where she marks things (« Entoure les images », « Relie », « Colorie… »): the
  // zoom lists them itself.
  const listThem = !e.items.length && MARKS.test(`${e.title} ${e.instr}`);
  if (e.z || !e.r || (!e.items.length && !listThem) || e.r.w * e.r.h > ZOOM_MAX_AREA) return e;
  const crop = cropB64(await photo(), e.r);
  if (!crop) return e;
  const prompt = `Zoom on ONE exercise of a homework page, done by a child in ${grade}: "${e.title}". Instruction: "${e.instr}".
${
  listThem
    ? `No answer places were listed: find every place where she must mark or write, in order (one per picture, word,
label or row), and give each one a short k (its printed word, e.g. "coiffer"), n = 0, 1, 2…`
    : `The places where she must answer, in order:\n${e.items.map((it, i) => `${i}. ${it.q}`).join('\n')}`
}
READ what the child wrote for each place, digit by digit, exactly as written, even if it is wrong. Never correct, never
complete, never write what the answer should be. Two numbers written in one place (« 30 ; 50 ») = both, as written.
Dots or lines are empty slots, not answers: nothing written = null. She often erases and starts over: faint grey
ghost marks or smudges left by a rubber are ERASED = null; only clear, dark strokes are answers. The image may be sideways.
Workbooks PRINT words in school cursive (models to copy, the word after a blank « ____plier »): printed text, even in
cursive, is NEVER her answer. For a blank before a printed word, a = only the letters she wrote on the blank.
Also tx = the printed statement and data of this exercise, VERBATIM (word problem, riddle, numbers given; max 80 words; "" if none).
Return JSON only: {"tx":"...","i":[{"n":0,"k":"","a":"30 ; 50","w":"c","c":0.95,"r":[x,y,w,h]}]}
For a circle or a tick: a = "entouré" / "coché"; a coloured label or word to choose: a = the label or word she coloured (not the colour); a grid cell: the colour. null if not marked.
w = who wrote a: "c" the child (pencil or pen strokes), "p" printed on the page. For a TABLE to complete (rows of words
with blanks), tx = its rows, cells separated by « | ». A matching exercise (« Relie… ») is NOT a table: tx = the instruction,
then the words and the boxes as two separate lists (« Mots : vaisselle, four, carafe, bol. Maisons : f, l. »), never
side by side, because pairs would look like answers.
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
    const out = JSON.parse((await res.json()).choices[0].message.content) as {
      tx?: string;
      i?: { n?: number; k?: string; a?: string | null; w?: string; c?: number; r?: number[] }[];
    };
    const base: PageItem[] = listThem
      ? (out.i ?? []).slice(0, 30).map((z) => ({ q: String(z.k ?? '').slice(0, 120) || `${(z.n ?? 0) + 1}`, a: null, c: 0, t: 'other' }))
      : e.items;
    const items: PageItem[] = base.map((it, n) => {
      const z = (out.i ?? []).find((x) => x.n === n);
      if (!z) return it;
      const zr = clampRegion(z.r);
      const r = zr ? { x: crop.box.x + zr.x * crop.box.w, y: crop.box.y + zr.y * crop.box.h, w: zr.w * crop.box.w, h: zr.h * crop.box.h } : it.r;
      const a = herAnswer(it.q, z.a === null || z.a === undefined ? null : String(z.a), it.m, z.w);
      // The zoom sees nothing where the first reading saw her answer (colouring, capitals, numbers she wrote): the
      // first reading is kept, less sure, and the close-up check below decides.
      if (a === null && it.a) return { ...it, c: Math.min(it.c, 0.75), d: true };
      if (listThem) return { ...it, a, c: Number(z.c ?? 0.8), ...(r ? { r } : {}) };
      // The zoom calls a written answer a mark (« entouré ») while the first reading read words: the words stay.
      const MARK_WORD = /^(entour|coch|circled|ticked)/i;
      if (a && it.a && MARK_WORD.test(a.trim()) && !MARK_WORD.test(it.a.trim())) return it;
      return { ...it, a, c: Number(z.c ?? it.c), ...(r ? { r } : {}) };
    });
    log('zoom', { exercise: e.n, before: e.items.map((i) => i.a), after: items.map((i) => i.a) });
    // The first reading's statement is kept when it already has the table's rows (the zoom sometimes drops them).
    const zt = String(out.tx ?? '')
      .trim()
      .slice(0, 600);
    const tx = e.tx && e.tx.includes('|') && !zt.includes('|') ? e.tx : zt;
    const checked = await blankCheck(items, await photo(), log);
    return { ...e, items: checked, s: statusOf(checked), ...(tx ? { tx } : {}), z: true };
  } catch (err) {
    log('zoom failed', (err as Error).message);
    return e;
  }
}

/** Short answers (1 to 6 characters) to a blank: the reading sometimes « sees » the expected letters on an empty line. */
const SHORT_BLANK = /^\S{1,6}$/;

/**
 * Before any verdict, each short fill-in answer is looked at on its own: its box is cut out and the model only says
 * whether pencil or pen strokes are there. A blank line with nothing on it gives a = null (« pas encore fait »).
 */
async function blankCheck(items: PageItem[], b64: string, log: (s: string, d?: unknown) => void): Promise<PageItem[]> {
  // At most 3 close-ups at a time: the function has little memory.
  let running = 0;
  const queue: (() => void)[] = [];
  const slot = async () => {
    if (running >= 3) await new Promise<void>((res) => queue.push(res));
    running++;
  };
  const release = () => {
    running--;
    queue.shift()?.();
  };
  return await Promise.all(
    items.map(async (it) => {
      await slot();
      try {
        return await closeUp(it);
      } finally {
        release();
      }
    }),
  );
  async function closeUp(it: PageItem): Promise<PageItem> {
    if (!it.a || !it.r) return it;
    const fold = (x: string) =>
      x
        .normalize('NFC')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]/gu, '');
    // A copy line « read » as just its printed model (« v » for the model « v »): is there anything she wrote?
    const copyEcho = it.t === 'copy' && !!it.m && fold(it.a) === fold(it.m);
    const shortBlank = it.t !== 'copy' && it.t !== 'matching' && SHORT_BLANK.test(it.a.trim());
    if (!it.d && !copyEcho && !shortBlank) return it;
    // Around her answer, never smaller than a small part of the page: a box read a little off still contains it.
    const pw = Math.max(it.r.w * 2.2, 0.16);
    const ph = Math.max(it.r.h * 2.6, 0.07);
    const cx = it.r.x + it.r.w / 2;
    const cy = it.r.y + it.r.h / 2;
    const pad = { x: cx - pw / 2, y: cy - ph / 2, w: pw, h: ph };
    const box = { x: Math.max(0, pad.x), y: Math.max(0, pad.y), w: Math.min(1 - Math.max(0, pad.x), pad.w), h: Math.min(1 - Math.max(0, pad.y), pad.h) };
    const crop = cropB64(b64, box, 900);
    if (!crop) return it;
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Deno.env.get('OPENAI_API_KEY')}` },
        body: JSON.stringify({
          model: READ_MODEL,
          reasoning_effort: 'low',
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `Close-up of a workbook page. Do NOT think about what the answer should be. Look only for marks
made by the child: pencil or pen writing (often irregular, in capitals or joined-up), crayon colouring, a circle, a tick,
a line she drew. Printed text (even in school cursive), printed lines, printed boxes and printed pictures do not count.
${copyEcho ? `The printed model « ${it.m} » at the start of the line does not count: only what she wrote after it.\n` : ''}Return JSON only: {"hw":true,"a":"..."}
hw = true only if you really see her marks there; a = exactly what she wrote or marked (null if hw is false).`,
                },
                { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${crop.b64}`, detail: 'high' } },
              ],
            },
          ],
        }),
      });
      if (!res.ok) return it;
      const out = JSON.parse((await res.json()).choices[0].message.content) as { hw?: boolean; a?: string | null };
      if (out.hw === false) {
        log('close-up: nothing written', { q: it.q, read: it.a });
        return { ...it, a: null, d: undefined };
      }
      // Her marks are there: the first reading stands (a little more sure).
      return it.d ? { ...it, c: Math.max(it.c, 0.85), d: undefined } : it;
    } catch {
      return it;
    }
  }
}
