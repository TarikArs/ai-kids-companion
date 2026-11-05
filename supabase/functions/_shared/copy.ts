// Handwriting practice ("Écris", "Recopie"): a model letter or word, then slots to fill. Checked in code, not by AI:
// every thing she wrote on the line must be the model (any form: capital, small, cursive), e.g. model "A": "A a" is
// right, "A a e" is wrong ("e").

import { westernDigits } from './arithmetic.ts';

const fold = (s: string) =>
  westernDigits(s)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[ً-ٰٟ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');

/** Model of a copy item: the model field, or "Recopier A" / "Copy A" / "انسخ ب" as the whole item text. */
export function copyModel(q: string, model?: string | null): string | null {
  if (model && fold(model)) return model.trim();
  // Only the exact format the reader is told to use ("Recopier A"): a normal item starting with "Écris…" is not a copy line.
  const m = q.match(/^\s*(?:recopier|copy|انسخ)\s+(\S{1,12})\s*$/i);
  return m && fold(m[1]) ? m[1].trim() : null;
}

/** null = nothing to check. Otherwise: right or wrong, and the wrong pieces. */
export function checkCopy(model: string, written: string | null): { ok: boolean; wrong: string[] } | null {
  if (!written) return null;
  const target = fold(model);
  // "?" = a letter too badly formed to read: counts as one to redo.
  const pieces = written.split(/[\s,;]+/).filter((p) => p.trim());
  if (!pieces.length || !target) return null;
  const wrong = pieces.filter((p) => fold(p) !== target);
  return { ok: wrong.length === 0, wrong };
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Second, focused look before praising a copy line: the first reading tends to "see" the model letter everywhere.
 * Each slot is read on its own, told that mistakes are likely. Returns the letters per line (same order as asked).
 */
export async function verifyCopyLines(
  imageB64: string,
  lines: { model: string; region?: Box }[],
  model: string,
): Promise<(string[] | null)[]> {
  const list = lines
    .map((l, i) => `${i}: model "${l.model}"${l.region ? ` at x=${l.region.x.toFixed(2)} y=${l.region.y.toFixed(2)} w=${l.region.w.toFixed(2)} h=${l.region.h.toFixed(2)}` : ''}`)
    .join('\n');
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Deno.env.get('OPENAI_API_KEY')}` },
      body: JSON.stringify({
        model,
        reasoning_effort: 'medium',
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Handwriting practice: on each line below, a model letter is printed, then a child wrote letters in the slots.
Your job is to CATCH MISTAKES: children often write another letter (E instead of A), a mirrored letter, or add an extra stroke.
For each line, read every handwritten slot after the model ONE BY ONE, as if you did not know the model.
Write exactly the letter you see; "?" if it is badly formed or has extra strokes; skip empty slots (dots, lines).
The photo may be sideways. Positions are fractions of the image.
Lines:
${list}
Return JSON only: {"l":[{"i":0,"s":["A","?","E"]}]}`,
              },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageB64}`, detail: 'high' } },
            ],
          },
        ],
      }),
    });
    if (!res.ok) return lines.map(() => null);
    const out = JSON.parse((await res.json()).choices[0].message.content);
    const byIndex = new Map<number, string[]>();
    for (const l of Array.isArray(out.l) ? out.l : []) {
      if (typeof l?.i === 'number' && Array.isArray(l.s)) byIndex.set(l.i, l.s.map(String));
    }
    return lines.map((_, i) => byIndex.get(i) ?? null);
  } catch {
    return lines.map(() => null);
  }
}
