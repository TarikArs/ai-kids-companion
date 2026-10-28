// What the child asks by voice, and what to do with it. Pure functions (no I/O): tested in isolation.
//
// quickIntent: clear short commands ("explique l'exercice 2", "corrige-le", "اشرحي التمرين الثاني") without any AI call.
// decide: intent + page context + active exercise -> one decision (help, ask which exercise, ask what help, answer…).

import { westernDigits } from './arithmetic.ts';
import type { PageContext, PageExercise } from './page.ts';

export type HelpAction = 'explain' | 'solve' | 'correct';
export const HELP_ACTIONS: HelpAction[] = ['explain', 'solve', 'correct'];

export interface Intent {
  /** select = an exercise named without saying what to do; choose = "another exercise" / "which ones are there". */
  act: HelpAction | 'select' | 'choose' | 'question' | 'clarify';
  /** Exercise number the child said (printed number or position), null = none said. */
  ex: number | null;
  /** ex is a position (tap on a choice), not a number heard. */
  byPosition?: boolean;
  /** Short clarification question (model), for act = clarify. */
  clarify?: string;
}

export interface FocusState {
  index: number;
  title: string;
  label?: string;
  action?: HelpAction;
}

export type Decision =
  | { do: 'help'; action: HelpAction; exercise: PageExercise; focusChanged: boolean; auto?: boolean }
  | { do: 'ask_which'; action: HelpAction | null; reason: 'several' | 'not_found' | 'choose'; missing?: number }
  | { do: 'ask_action'; exercise: PageExercise }
  | { do: 'answer'; exercise: PageExercise | null }
  | { do: 'clarify'; text: string }
  | { do: 'no_photo' }
  | { do: 'unreadable'; why?: string }
  | { do: 'no_exercise' };

// ---------- quick intent (no AI) ----------

const norm = (s: string) =>
  westernDigits(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // Latin accents
    .replace(/[ً-ٰٟـ]/g, '') // Arabic diacritics + tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/[’'`]/g, ' ')
    .replace(/[.,!?;:،؟«»"()-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const ACTION_PATTERNS: Record<HelpAction, RegExp> = {
  explain: /\b(expliqu\w*|explain\w*)\b|(^|\s)(ا?شرح\S*|فسر\S*|فهمي?ني|فهميني)(\s|$)|c est quoi|comprends? pas|don t understand/,
  solve: /\b(resou\w*|resoud\w*|resolv\w*|solve\w*|on (le |la )?fai[ts]|faisons|let s do|work on|help me (do|with))\b|(^|\s)(نحل\S*|لنحل\S*|حل|حلي|حليه|حليها|ساعديني)(\s|$)/,
  correct: /\b(corrig\w*|correct\w*|verifi\w*|check\w*|c est (juste|bon)|is it (right|correct))\b|(^|\s)(صحح\S*|يصحح\S*|تحقق\S*|راجع\S*)(\s|$)/,
};

const ORDINALS: [RegExp, number][] = [
  [/\b(premier|premiere|first)\b|(^|\s)(الاول|اول|لول)(\s|$)/, 1],
  [/\b(deuxieme|second|seconde)\b|(^|\s)(الثاني|التاني|ثاني)(\s|$)/, 2],
  [/\b(troisieme|third)\b|(^|\s)(الثالث|التالت)(\s|$)/, 3],
  [/\b(quatrieme|fourth)\b|(^|\s)(الرابع)(\s|$)/, 4],
  [/\b(cinquieme|fifth)\b|(^|\s)(الخامس)(\s|$)/, 5],
  [/\b(sixieme|sixth)\b|(^|\s)(السادس)(\s|$)/, 6],
  [/\b(septieme|seventh)\b|(^|\s)(السابع)(\s|$)/, 7],
  [/\b(huitieme|eighth)\b|(^|\s)(الثامن)(\s|$)/, 8],
  [/\b(neuvieme|ninth)\b|(^|\s)(التاسع)(\s|$)/, 9],
  [/\b(dixieme|tenth)\b|(^|\s)(العاشر)(\s|$)/, 10],
];

const CARDINALS: Record<string, number> = {
  un: 1, une: 1, one: 1, 'واحد': 1,
  deux: 2, two: 2, 'اثنين': 2, 'جوج': 2, 'زوج': 2,
  trois: 3, three: 3, 'ثلاثه': 3, 'ثلاثة': 3, 'تلاته': 3, 'تلاتة': 3,
  quatre: 4, four: 4, 'اربعه': 4, 'اربعة': 4, 'ربعه': 4, 'ربعة': 4,
  cinq: 5, five: 5, 'خمسه': 5, 'خمسة': 5,
  six: 6, 'سته': 6, 'ستة': 6,
  sept: 7, seven: 7, 'سبعه': 7, 'سبعة': 7,
  huit: 8, eight: 8, 'ثمانيه': 8, 'ثمانية': 8, 'تمنيه': 8, 'تمنية': 8,
  neuf: 9, nine: 9, 'تسعه': 9, 'تسعة': 9,
  dix: 10, ten: 10, 'عشره': 10, 'عشرة': 10,
};

const EXERCISE_WORD = /(?:^|\s)(exercices?|exos?|exercises?|numero|number|n°|\S*تمرين|تمارين|رقم)(?=\s|$)/;

/** Exercise number said by the child: "exercice 2", "l'exercice numéro deux", "le deuxième", "التمرين الثاني". */
export function exerciseRef(text: string): number | null {
  const t = norm(text);
  const after = t.match(new RegExp(`${EXERCISE_WORD.source}\\s+(?:(?:n°|numero|number|رقم)\\s+)?(\\d{1,2}|\\S+)`));
  if (after) {
    const w = after[2];
    if (/^\d{1,2}$/.test(w)) return Number(w);
    if (CARDINALS[w]) return CARDINALS[w];
    for (const [re, n] of ORDINALS) if (re.test(w)) return n;
  }
  for (const [re, n] of ORDINALS) if (re.test(t)) return n;
  return null;
}

/** Clear, short command understood without AI; null = let the model understand it. */
export function quickIntent(transcript: string): Intent | null {
  const t = norm(transcript);
  if (!t) return null;
  const words = t.split(' ').length;
  if (words > 10) return null;
  const actions = HELP_ACTIONS.filter((a) => ACTION_PATTERNS[a].test(t));
  const ex = exerciseRef(t);
  if (actions.length > 1) return null; // "explique et corrige": the model decides
  if (actions.length === 1) return { act: actions[0], ex };
  if (ex !== null && words <= 5) return { act: 'select', ex }; // "exercice 2", "le deuxième"
  return null;
}

/** Looks like a command to the tutor (not reading the page aloud). */
export const looksLikeCommand = (transcript: string) => quickIntent(transcript) !== null || EXERCISE_WORD.test(norm(transcript));

// ---------- exercise lookup ----------

/** Printed number first ("exercice 10" on a page numbered 9, 10, 11), then position. */
export function findExercise(exs: PageExercise[], ref: number, byPosition = false): PageExercise | null {
  if (!byPosition) {
    const printed = exs.find((e) => e.label === String(ref));
    if (printed) return printed;
  }
  return exs.find((e) => e.n === ref) ?? null;
}

export const focusExercise = (exs: PageExercise[], focus: FocusState | null) =>
  focus ? (exs.find((e) => e.n === focus.index) ?? null) : null;

// ---------- decision ----------

export function decide(intent: Intent, ctx: PageContext | null, focus: FocusState | null, pending: HelpAction | null): Decision {
  const needsPage = intent.act !== 'question' && intent.act !== 'clarify';
  if (needsPage && !ctx) return { do: 'no_photo' };
  if (needsPage && ctx && !ctx.readable) return { do: 'unreadable', why: ctx.why };
  const exs = ctx?.readable ? ctx.exercises : [];

  if (intent.act === 'clarify') return intent.clarify ? { do: 'clarify', text: intent.clarify } : { do: 'ask_which', action: pending, reason: 'choose' };
  if (intent.act === 'question') return { do: 'answer', exercise: focusExercise(exs, focus) };
  if (!exs.length) return { do: 'no_exercise' };
  if (intent.act === 'choose') return { do: 'ask_which', action: pending, reason: 'choose' };

  // An exercise was named (voice) or tapped.
  if (intent.ex !== null) {
    const e = findExercise(exs, intent.ex, intent.byPosition);
    const action = intent.act === 'select' ? pending : intent.act;
    if (!e) return { do: 'ask_which', action, reason: 'not_found', missing: intent.ex };
    const focusChanged = !focus || focus.index !== e.n;
    if (!action) return { do: 'ask_action', exercise: e };
    return { do: 'help', action, exercise: e, focusChanged };
  }

  if (intent.act === 'select') return { do: 'ask_which', action: pending, reason: 'choose' };

  // "Explain it" / "Correct it": the active exercise, else the only one, else ask which.
  const current = focusExercise(exs, focus);
  if (current) return { do: 'help', action: intent.act, exercise: current, focusChanged: false };
  if (focus) return { do: 'ask_which', action: intent.act, reason: 'not_found', missing: focus.label ? Number(focus.label) || focus.index : focus.index };
  if (exs.length === 1) return { do: 'help', action: intent.act, exercise: exs[0], focusChanged: true, auto: true };
  return { do: 'ask_which', action: intent.act, reason: 'several' };
}
