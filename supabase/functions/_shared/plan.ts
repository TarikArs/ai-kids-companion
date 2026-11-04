// The evening's plan, like a teacher: read the homework diary, agree on an order (math first, while the head is fresh),
// follow which subject she is on, and offer a short break when a subject is finished.

import type { Lang } from './language.ts';
import { admin } from './supabase.ts';

export type Subject = 'math' | 'french' | 'arabic' | 'english' | 'science' | 'islamic' | 'social' | 'other';
const SUBJECTS: Subject[] = ['math', 'french', 'arabic', 'english', 'science', 'islamic', 'social', 'other'];

export interface PlanItem {
  id: string;
  subject: Subject;
  label: string;
  status: 'todo' | 'active' | 'done';
}

export interface SessionPlan {
  items: PlanItem[];
  snapshot_id?: string;
}

export const BREAK_SECONDS = 60;

export const subjectOf = (code: unknown): Subject => (SUBJECTS.includes(code as Subject) ? (code as Subject) : 'other');

/** Diary tasks -> plan. Math first (hardest while fresh), then the diary's order; the first one is active. */
export function planFromDiary(tasks: { s?: string; d?: string }[], snapshotId: string): SessionPlan | null {
  const items: PlanItem[] = tasks
    .filter((t) => (t.d ?? '').trim())
    .slice(0, 8)
    .map((t, i) => ({ id: `p${i + 1}`, subject: subjectOf(t.s), label: String(t.d).trim().slice(0, 60), status: 'todo' as const }));
  if (!items.length) return null;
  items.sort((a, b) => Number(b.subject === 'math') - Number(a.subject === 'math'));
  items[0].status = 'active';
  return { items, snapshot_id: snapshotId };
}

const join = (lang: Lang, xs: string[]) => {
  if (xs.length <= 1) return xs.join('');
  const and = { fr: ' et ', ar: ' و', fus: ' و', en: ' and ' }[lang];
  return `${xs.slice(0, -1).join(lang === 'ar' || lang === 'fus' ? '، ' : ', ')}${and}${xs[xs.length - 1]}`;
};

/** "Je vois trois devoirs : … On commence par … ?" */
export function planText(lang: Lang, plan: SessionPlan): string {
  const labels = plan.items.map((i) => i.label);
  const first = labels[0];
  const n = labels.length;
  switch (lang) {
    case 'ar':
      return `شفت ${n} ديال الواجبات: ${join(lang, labels)}. نبداو بـ${first}؟`;
    case 'fus':
      return `أرى ${n} واجبات: ${join(lang, labels)}. هل نبدأ بـ${first}؟`;
    case 'en':
      return `I see ${n} homework task${n > 1 ? 's' : ''}: ${join(lang, labels)}. Shall we start with ${first}?`;
    default:
      return `Je vois ${n} devoir${n > 1 ? 's' : ''} : ${join(lang, labels)}. On commence par ${first} ?`;
  }
}

/** Subject finished: bravo, a one-minute break, then the next one (or: everything is done). */
export function doneText(lang: Lang, done: string, next: string | null): string {
  switch (lang) {
    case 'ar':
      return next
        ? `برافو، سالينا ${done}! نرتاحو دقيقة: نوضي وتمطّي مزيان. من بعد، ${next}.`
        : `برافو، سالينا ${done}! كملتي كاع الواجبات. ورّكي على "سالينا" فالتيليفون.`;
    case 'fus':
      return next
        ? `أحسنتِ، انتهينا من ${done}! لنسترِح دقيقة: قفي وتمدّدي جيدًا. بعد ذلك، ${next}.`
        : `أحسنتِ، انتهينا من ${done}! أنهيتِ كل الواجبات. اضغطي على "إنهاء" في الهاتف.`;
    case 'en':
      return next
        ? `Well done, ${done} is finished! Let's take a one-minute break: stand up and stretch. Then, ${next}.`
        : `Well done, ${done} is finished! All your homework is done. Press Finish on the phone.`;
    default:
      return next
        ? `Bravo, ${done}, c’est fini ! On fait une pause d’une minute : lève-toi et étire-toi bien. Ensuite, ${next}.`
        : `Bravo, ${done}, c’est fini ! Tous tes devoirs sont faits. Appuie sur Terminer sur le téléphone.`;
  }
}

/** The plan, or null (none yet, or the column is not there). */
export async function loadPlan(sessionId: string): Promise<SessionPlan | null> {
  const { data, error } = await admin.from('homework_sessions').select('plan').eq('id', sessionId).maybeSingle();
  if (error || !data?.plan) return null;
  const plan = data.plan as SessionPlan;
  return Array.isArray(plan.items) && plan.items.length ? plan : null;
}

export async function savePlan(sessionId: string, plan: SessionPlan): Promise<boolean> {
  const { error } = await admin.from('homework_sessions').update({ plan }).eq('id', sessionId);
  return !error;
}

/** She is on a page of this subject: it becomes the active plan item (the previous active one stays as it is). */
export function activate(plan: SessionPlan, subject: Subject): boolean {
  const target = plan.items.find((i) => i.subject === subject && i.status !== 'done');
  if (!target || target.status === 'active') return false;
  for (const i of plan.items) if (i.status === 'active') i.status = 'todo';
  target.status = 'active';
  return true;
}

/** The active subject is finished: mark it done, the next to-do becomes active. Returns both labels. */
export function finishActive(plan: SessionPlan): { done: PlanItem; next: PlanItem | null } | null {
  const done = plan.items.find((i) => i.status === 'active');
  if (!done) return null;
  done.status = 'done';
  const next = plan.items.find((i) => i.status === 'todo') ?? null;
  if (next) next.status = 'active';
  return { done, next };
}
