// Server-side Realtime Broadcast to a private channel (service role bypasses channel RLS).
const url = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

export async function broadcast(topic: string, event: string, payload: unknown): Promise<void> {
  const res = await fetch(`${url}/realtime/v1/api/broadcast`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messages: [{ topic, event, payload, private: true }] }),
  });
  if (!res.ok) console.error('broadcast failed', event, res.status, await res.text());
}

/** A turn of the conversation: who started it decides who may interrupt whom (child > auto). */
export interface Turn {
  id: string;
  priority: 'child' | 'auto';
}

export function parseTurn(x: unknown): Turn | null {
  const t = x as Partial<Turn> | null | undefined;
  return t && typeof t.id === 'string' && (t.priority === 'child' || t.priority === 'auto') ? { id: t.id.slice(0, 64), priority: t.priority } : null;
}

/** Broadcast that carries the turn it belongs to, so the Board can drop or queue stale messages. */
export const turnSender = (topic: string, turn: Turn | null) => (event: string, payload: Record<string, unknown>) =>
  broadcast(topic, event, turn ? { ...payload, turn } : payload);
