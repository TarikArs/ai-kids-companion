import type { ExerciseChoice, ExerciseFocus, HelpAction } from '@hc/shared';

import { log } from './log';
import { functionError, supabase } from './supabase';

/** Active exercise of the session (null if none, or the column is not there yet). */
export async function loadFocus(sessionId: string): Promise<ExerciseFocus | null> {
  const { data, error } = await supabase.from('homework_sessions').select('focus').eq('id', sessionId).maybeSingle();
  if (error) return null;
  const f = data?.focus as ExerciseFocus | null | undefined;
  return f && typeof f.index === 'number' ? f : null;
}

/** "Exercice 10 · Je lis et je réponds" (printed number when there is one). */
export const exerciseName = (e: { index: number; label?: string }) => e.label ?? String(e.index);

export const ACTION_LABEL: Record<HelpAction, string> = { explain: 'Expliquer', solve: 'Résoudre', correct: 'Corriger' };

/**
 * Exercise help through explain-exercise (same server logic as voice requests):
 * - nothing: explain the active exercise (or ask which one);
 * - choice: tap on an exercise -> it becomes the active one;
 * - action: explain / solve / correct the active exercise; 'choose' shows the list again.
 */
export async function requestHelp(
  sessionId: string,
  opts: { choice?: ExerciseChoice; action?: HelpAction | 'choose' } = {},
): Promise<{ data: any; error: string | null }> {
  log('exercise', `help: ${opts.choice ? `tap exercise ${exerciseName(opts.choice)}` : ''}${opts.action ? ` action ${opts.action}` : ''}` || 'help: explain');
  const { data, error } = await supabase.functions.invoke('explain-exercise', {
    body: {
      session_id: sessionId,
      ...(opts.choice ? { exercise_index: opts.choice.index } : {}),
      ...(opts.action ? { action: opts.action } : {}),
    },
  });
  return { data, error: error ? await functionError(error) : null };
}
