// Reading check without AI tokens: align what the child said (transcript) with the printed page text, word by word.

import { westernDigits } from './arithmetic.ts';

/** Lowercase, no accents, no Arabic diacritics, unified Arabic letters, no punctuation. */
export function normalizeWord(w: string): string {
  return westernDigits(w)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // Latin accents
    .replace(/[ً-ٰٟـ]/g, '') // Arabic diacritics + tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

export function words(text: string): { raw: string; norm: string }[] {
  return text
    .split(/[\s ]+/)
    .map((raw) => ({ raw: raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''), norm: normalizeWord(raw) }))
    .filter((w) => w.norm.length > 0);
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

/** Same word, tolerating small transcription noise on longer words. */
export function similar(a: string, b: string): boolean {
  if (a === b) return true;
  const len = Math.max(a.length, b.length);
  return len >= 5 && editDistance(a, b) <= 1;
}

export interface ReadingResult {
  matched: number;
  spanStart: number; // index in page words
  spanEnd: number; // exclusive
  /** Page words she said differently. */
  substituted: { expected: string; said: string }[];
  /** Page words she skipped inside the part she read. */
  skipped: string[];
  /** Share of the read span she got right (0..1). */
  accuracy: number;
  /** True when the transcript clearly is a reading of the page. */
  isReading: boolean;
}

/**
 * Local alignment (Smith-Waterman) of the transcript against the page: finds the part of the page she read,
 * then lists substituted and skipped words in that part.
 */
export function checkReading(pageText: string, transcript: string): ReadingResult {
  const P = words(pageText).slice(0, 1500);
  const T = words(transcript).slice(0, 400);
  const empty: ReadingResult = { matched: 0, spanStart: 0, spanEnd: 0, substituted: [], skipped: [], accuracy: 0, isReading: false };
  if (!P.length || !T.length) return empty;

  const MATCH = 2, MISMATCH = -1, GAP = -1;
  const rows = T.length + 1, cols = P.length + 1;
  const H = new Int32Array(rows * cols);
  let best = 0, bi = 0, bj = 0;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const diag = H[(i - 1) * cols + (j - 1)] + (similar(T[i - 1].norm, P[j - 1].norm) ? MATCH : MISMATCH);
      const up = H[(i - 1) * cols + j] + GAP; // extra word said
      const left = H[i * cols + (j - 1)] + GAP; // page word skipped
      const v = Math.max(0, diag, up, left);
      H[i * cols + j] = v;
      if (v > best) [best, bi, bj] = [v, i, j];
    }
  }
  if (best === 0) return empty;

  // Traceback.
  const substituted: ReadingResult['substituted'] = [];
  const skipped: string[] = [];
  let matched = 0;
  let i = bi, j = bj;
  while (i > 0 && j > 0 && H[i * cols + j] > 0) {
    const v = H[i * cols + j];
    const isSim = similar(T[i - 1].norm, P[j - 1].norm);
    if (v === H[(i - 1) * cols + (j - 1)] + (isSim ? MATCH : MISMATCH)) {
      if (isSim) matched++;
      else substituted.unshift({ expected: P[j - 1].raw, said: T[i - 1].raw });
      i--;
      j--;
    } else if (v === H[i * cols + (j - 1)] + GAP) {
      skipped.unshift(P[j - 1].raw);
      j--;
    } else {
      i--;
    }
  }
  // Local alignment drops a misread word at the very start or end: compare those 1:1 (up to 3 words each side).
  let spanStart = j, spanEnd = bj;
  for (let k = 0; k < 3 && i - 1 - k >= 0 && spanStart - 1 >= 0; k++) {
    const said = T[i - 1 - k], expected = P[spanStart - 1];
    if (similar(said.norm, expected.norm)) matched++;
    else substituted.unshift({ expected: expected.raw, said: said.raw });
    spanStart--;
  }
  for (let k = 0; k < 3 && bi + k < T.length && spanEnd < P.length; k++) {
    const said = T[bi + k], expected = P[spanEnd];
    if (similar(said.norm, expected.norm)) matched++;
    else substituted.push({ expected: expected.raw, said: said.raw });
    spanEnd++;
  }
  const span = Math.max(1, spanEnd - spanStart);
  return {
    matched,
    spanStart,
    spanEnd,
    substituted,
    skipped,
    accuracy: matched / span,
    isReading: matched >= Math.max(3, Math.ceil(T.length * 0.5)),
  };
}
