import { sessionTopic, type SessionEventName, type SessionEvents, type SessionStatus } from '@hc/shared';
import type { RealtimeChannel } from '@supabase/supabase-js';

import { log } from './log';
import { supabase } from './supabase';

export interface HomeworkSession {
  id: string;
  household_id: string;
  child_id: string;
  status: SessionStatus;
  capture_interval_s: number;
  started_at: string;
}

const SESSION_COLUMNS = 'id, household_id, child_id, status, capture_interval_s, started_at';

/** The household's current session (active or paused), if any. */
export async function findOpenSession(householdId: string): Promise<HomeworkSession | null> {
  const { data, error } = await supabase
    .from('homework_sessions')
    .select(SESSION_COLUMNS)
    .eq('household_id', householdId)
    .in('status', ['active', 'paused'])
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as HomeworkSession | null;
}

/** Starts a session for the household's first child. */
export async function startSession(householdId: string): Promise<HomeworkSession> {
  const { data: child, error: childErr } = await supabase
    .from('children')
    .select('id')
    .eq('household_id', householdId)
    .order('created_at')
    .limit(1)
    .single();
  if (childErr) throw childErr;
  const { data, error } = await supabase
    .from('homework_sessions')
    .insert({ household_id: householdId, child_id: child.id, subject: 'maths', language: 'fr' })
    .select(SESSION_COLUMNS)
    .single();
  if (error) throw error;
  log('session', 'started', data);
  return data as HomeworkSession;
}

export async function setSessionStatus(sessionId: string, status: SessionStatus) {
  const { error } = await supabase
    .from('homework_sessions')
    .update({ status, ...(status === 'finished' ? { ended_at: new Date().toISOString() } : {}) })
    .eq('id', sessionId);
  if (error) throw error;
}

/** Private Realtime channel for one session. Call subscribe() on the result. */
export async function sessionChannel(sessionId: string): Promise<RealtimeChannel> {
  await supabase.realtime.setAuth();
  return supabase.channel(sessionTopic(sessionId), { config: { private: true, broadcast: { self: false } } });
}

export function sendEvent<E extends SessionEventName>(channel: RealtimeChannel, event: E, payload: SessionEvents[E]) {
  log('live', `→ ${event}`, payload);
  return channel.send({ type: 'broadcast', event, payload });
}

export function onEvent<E extends SessionEventName>(
  channel: RealtimeChannel,
  event: E,
  handler: (payload: SessionEvents[E]) => void,
) {
  return channel.on('broadcast', { event }, ({ payload }) => {
    log('live', `← ${event}`, payload);
    handler(payload as SessionEvents[E]);
  });
}

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.includes(',') ? b64.slice(b64.indexOf(',') + 1) : b64;
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
