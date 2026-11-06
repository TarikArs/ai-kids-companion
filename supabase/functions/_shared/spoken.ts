// What the voice reads. The Board shows the text as written (digits stay digits); the voice gets numbers and signs
// written out in words, in the right register: « 7 − 2 = 5 » -> « sept moins deux égale cinq »,
// « سبعة ناقص اثنين يساوي خمسة » (Fusha), « سبعة ناقص جوج كيساوي خمسة » (Darija). Pure functions, no I/O.

import type { Lang } from './language.ts';

// ---------- French ----------
const FR = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize'];
const FR_TENS: Record<number, string> = { 2: 'vingt', 3: 'trente', 4: 'quarante', 5: 'cinquante', 6: 'soixante', 8: 'quatre-vingt' };

function fr99(n: number): string {
  if (n < 17) return FR[n];
  if (n < 20) return `dix-${FR[n - 10]}`;
  const tens = Math.floor(n / 10);
  const u = n % 10;
  if (tens === 7) return n === 71 ? 'soixante-et-onze' : `soixante-${fr99(n - 60)}`;
  if (tens === 9) return `quatre-vingt-${fr99(n - 80)}`;
  if (u === 0) return tens === 8 ? 'quatre-vingts' : FR_TENS[tens];
  if (u === 1 && tens !== 8) return `${FR_TENS[tens]}-et-un`;
  return `${FR_TENS[tens]}-${FR[u]}`;
}

function fr999(n: number): string {
  if (n < 100) return fr99(n);
  const h = Math.floor(n / 100);
  const r = n % 100;
  const head = h === 1 ? 'cent' : `${FR[h]}-cent${r === 0 ? 's' : ''}`;
  return r ? `${head}-${fr99(r)}` : head;
}

function frInt(n: number): string | null {
  if (n < 1000) return fr999(n);
  if (n >= 1_000_000) return null;
  const th = Math.floor(n / 1000);
  const r = n % 1000;
  const head = th === 1 ? 'mille' : `${fr999(th).replace(/cents$/, 'cent')}-mille`;
  return r ? `${head}-${fr999(r)}` : head;
}

// ---------- Modern Standard Arabic (Fusha) ----------
const FUS = ['صفر', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة'];
const FUS_TENS: Record<number, string> = { 2: 'عشرون', 3: 'ثلاثون', 4: 'أربعون', 5: 'خمسون', 6: 'ستون', 7: 'سبعون', 8: 'ثمانون', 9: 'تسعون' };
const FUS_HUNDREDS: Record<number, string> = { 1: 'مئة', 2: 'مئتان', 3: 'ثلاثمئة', 4: 'أربعمئة', 5: 'خمسمئة', 6: 'ستمئة', 7: 'سبعمئة', 8: 'ثمانمئة', 9: 'تسعمئة' };

function fus99(n: number): string {
  if (n <= 10) return FUS[n];
  if (n === 11) return 'أحد عشر';
  if (n === 12) return 'اثنا عشر';
  if (n < 20) return `${FUS[n - 10]} عشر`;
  const u = n % 10;
  const tens = FUS_TENS[Math.floor(n / 10)];
  return u ? `${FUS[u]} و${tens}` : tens;
}

function fus999(n: number): string {
  if (n < 100) return fus99(n);
  const r = n % 100;
  const head = FUS_HUNDREDS[Math.floor(n / 100)];
  return r ? `${head} و${fus99(r)}` : head;
}

function fusInt(n: number): string | null {
  if (n < 1000) return fus999(n);
  if (n >= 1_000_000) return null;
  const th = Math.floor(n / 1000);
  const r = n % 1000;
  const head = th === 1 ? 'ألف' : th === 2 ? 'ألفان' : th <= 10 ? `${FUS[th]} آلاف` : th < 100 ? `${fus99(th)} ألفًا` : `${fus999(th)} ألف`;
  return r ? `${head} و${fus999(r)}` : head;
}

// ---------- Moroccan Darija ----------
const DAR = ['صفر', 'واحد', 'جوج', 'تلاتة', 'ربعة', 'خمسة', 'ستة', 'سبعة', 'تمنية', 'تسعة', 'عشرة'];
const DAR_TEENS: Record<number, string> = { 11: 'حداش', 12: 'طناش', 13: 'تلطاش', 14: 'ربعطاش', 15: 'خمسطاش', 16: 'سطاش', 17: 'سبعطاش', 18: 'تمنطاش', 19: 'تسعطاش' };
const DAR_TENS: Record<number, string> = { 2: 'عشرين', 3: 'تلاتين', 4: 'ربعين', 5: 'خمسين', 6: 'ستين', 7: 'سبعين', 8: 'تمانين', 9: 'تسعين' };
const DAR_HUNDREDS: Record<number, string> = { 1: 'مية', 2: 'ميتين', 3: 'تلت مية', 4: 'ربع مية', 5: 'خمس مية', 6: 'ست مية', 7: 'سبع مية', 8: 'تمن مية', 9: 'تسع مية' };

function dar99(n: number): string {
  if (n <= 10) return DAR[n];
  if (n < 20) return DAR_TEENS[n];
  const u = n % 10;
  const tens = DAR_TENS[Math.floor(n / 10)];
  return u ? `${DAR[u]} و${tens}` : tens;
}

function dar999(n: number): string {
  if (n < 100) return dar99(n);
  const r = n % 100;
  const head = DAR_HUNDREDS[Math.floor(n / 100)];
  return r ? `${head} و${dar99(r)}` : head;
}

function darInt(n: number): string | null {
  if (n < 1000) return dar999(n);
  if (n >= 1_000_000) return null;
  const th = Math.floor(n / 1000);
  const r = n % 1000;
  const head = th === 1 ? 'ألف' : th === 2 ? 'ألفين' : th <= 10 ? `${DAR[th]} آلاف` : `${dar999(th)} ألف`;
  return r ? `${head} و${dar999(r)}` : head;
}

// ---------- English ----------
const EN = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const EN_TENS: Record<number, string> = { 2: 'twenty', 3: 'thirty', 4: 'forty', 5: 'fifty', 6: 'sixty', 7: 'seventy', 8: 'eighty', 9: 'ninety' };
const en99 = (n: number) => (n < 20 ? EN[n] : `${EN_TENS[Math.floor(n / 10)]}${n % 10 ? `-${EN[n % 10]}` : ''}`);
const en999 = (n: number) => (n < 100 ? en99(n) : `${EN[Math.floor(n / 100)]} hundred${n % 100 ? ` and ${en99(n % 100)}` : ''}`);
function enInt(n: number): string | null {
  if (n < 1000) return en999(n);
  if (n >= 1_000_000) return null;
  const r = n % 1000;
  return `${en999(Math.floor(n / 1000))} thousand${r ? ` ${en999(r)}` : ''}`;
}

const INT: Record<Lang, (n: number) => string | null> = { fr: frInt, fus: fusInt, ar: darInt, en: enInt };

const WORDS: Record<Lang, { plus: string; minus: string; times: string; div: string; eq: string; what: string; point: string }> = {
  fr: { plus: 'plus', minus: 'moins', times: 'fois', div: 'divisé par', eq: 'égale', what: 'combien', point: 'virgule' },
  fus: { plus: 'زائد', minus: 'ناقص', times: 'ضرب', div: 'قسمة', eq: 'يساوي', what: 'كم', point: 'فاصلة' },
  ar: { plus: 'زايد', minus: 'ناقص', times: 'ضرب', div: 'على', eq: 'كيساوي', what: 'شحال', point: 'فاصلة' },
  en: { plus: 'plus', minus: 'minus', times: 'times', div: 'divided by', eq: 'equals', what: 'what', point: 'point' },
};

/** One number in words; null when too big (the voice then reads the digits). */
export function numberWords(raw: string, lang: Lang): string | null {
  const [int, frac] = raw.split(/[.,]/);
  const whole = INT[lang](Number(int));
  if (whole === null) return null;
  if (!frac) return whole;
  // "3,05": the decimals digit by digit when they start with 0, else as a number ("3,5" -> trois virgule cinq).
  const decimals = frac.startsWith('0') ? [...frac].map((d) => INT[lang](Number(d))).join(' ') : INT[lang](Number(frac));
  return decimals === null ? null : `${whole} ${WORDS[lang].point} ${decimals}`;
}

/** Text for the voice: signs between numbers and numbers themselves written out. */
export function spokenText(text: string, lang: Lang): string {
  const w = WORDS[lang];
  // Arabic-Indic digits to 0-9 (punctuation such as ؟ stays as it is).
  let s = text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/(\d)\s*=\s*\?/g, `$1 ${w.eq} ${w.what}`)
    .replace(/(\d)\s*=\s*(?=\d)/g, `$1 ${w.eq} `)
    .replace(/(\d)\s*\+\s*(?=\d)/g, `$1 ${w.plus} `)
    .replace(/(\d)\s*[−–-]\s*(?=\d)/g, `$1 ${w.minus} `)
    .replace(/(\d)\s*[×x*]\s*(?=\d)/g, `$1 ${w.times} `)
    .replace(/(\d)\s*[÷:]\s*(?=\d)/g, `$1 ${w.div} `);
  if (lang === 'fr') s = s.replace(/\b1(er|re)\b/g, (_, e) => (e === 'er' ? 'premier' : 'première'));
  return s.replace(/\d+(?:[.,]\d+)?/g, (m) => numberWords(m, lang) ?? m);
}
