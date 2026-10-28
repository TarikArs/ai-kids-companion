// pair-device: links a Board or Camera device to a household.
//
// POST { action: "create", household_id, role: "board" | "camera" }
//   Caller: a parent of the household. Returns a 6-digit code valid 10 minutes.
//
// POST { action: "claim", code, name? }
//   Caller: the device, signed in anonymously. Links it to the household.
//   Returns { device_id, household_id, role }.
//
// Rule: ONE Camera per household. A second one is refused (409 camera_exists) when the code is created and when it is
// claimed; the parent removes the old Camera first. Several Boards are allowed.

import { admin, getCaller } from '../_shared/supabase.ts';
import { corsHeaders, json } from '../_shared/cors.ts';

const ROLES = ['board', 'camera'] as const;
type Role = (typeof ROLES)[number];
const CODE_TTL_MINUTES = 10;
const CAMERA_EXISTS = 'Une caméra est déjà reliée. Retire-la d’abord dans l’espace parent.';

/** Active Camera of the household, other than this user (a phone re-pairing itself is fine). */
async function otherCamera(householdId: string, userId?: string) {
  let q = admin.from('devices').select('id').eq('household_id', householdId).eq('role', 'camera').is('revoked_at', null);
  if (userId) q = q.neq('user_id', userId);
  const { data } = await q.limit(1).maybeSingle();
  return data;
}

function newCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return n.toString().padStart(6, '0');
}

async function createCode(userId: string, householdId: unknown, role: unknown) {
  if (typeof householdId !== 'string' || !ROLES.includes(role as Role)) {
    return json({ error: 'household_id and role (board|camera) are required' }, 400);
  }
  const { data: member } = await admin
    .from('household_members')
    .select('role')
    .eq('household_id', householdId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!member) return json({ error: 'Only a parent of this household can add a device' }, 403);
  if (role === 'camera') {
    if (await otherCamera(householdId)) return json({ error: CAMERA_EXISTS, code: 'camera_exists' }, 409);
    // Older unused Camera codes: only the newest one stays valid.
    await admin.from('pairing_codes').delete().eq('household_id', householdId).eq('role', 'camera').is('used_at', null);
  }

  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60_000).toISOString();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newCode();
    const { error } = await admin.from('pairing_codes').insert({
      code,
      household_id: householdId,
      role,
      created_by: userId,
      expires_at: expiresAt,
    });
    if (!error) return json({ code, role, expires_at: expiresAt });
    if (error.code !== '23505') return json({ error: error.message }, 500); // not a duplicate code
    // Duplicate: drop the old row if it is expired or used, then retry with a new code.
    await admin.from('pairing_codes').delete().eq('code', code).or(`used_at.not.is.null,expires_at.lt."${new Date().toISOString()}"`);
  }
  return json({ error: 'Could not generate a code, try again' }, 503);
}

async function claimCode(userId: string, code: unknown, name: unknown) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
    return json({ error: 'A 6-digit code is required' }, 400);
  }
  // Mark the code used atomically: only one device can claim it.
  const now = new Date().toISOString();
  const { data: claimed, error } = await admin
    .from('pairing_codes')
    .update({ used_at: now, used_by: userId })
    .eq('code', code)
    .is('used_at', null)
    .gt('expires_at', now)
    .select('household_id, role')
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!claimed) return json({ error: 'Code is wrong, expired or already used' }, 404);
  if (claimed.role === 'camera' && (await otherCamera(claimed.household_id, userId))) {
    return json({ error: CAMERA_EXISTS, code: 'camera_exists' }, 409);
  }

  const { data: device, error: devErr } = await admin
    .from('devices')
    .upsert(
      {
        household_id: claimed.household_id,
        user_id: userId,
        role: claimed.role,
        name: typeof name === 'string' ? name.slice(0, 60) : null,
        last_seen_at: now,
        revoked_at: null,
      },
      { onConflict: 'user_id' },
    )
    .select('id, household_id, role')
    .single();
  if (devErr) {
    if (devErr.code === '23505') return json({ error: CAMERA_EXISTS, code: 'camera_exists' }, 409); // DB guard (race)
    return json({ error: devErr.message }, 500);
  }

  return json({ device_id: device.id, household_id: device.household_id, role: device.role });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const user = await getCaller(req);
  if (!user) return json({ error: 'Sign in first' }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  switch (body.action) {
    case 'create':
      if (user.is_anonymous) return json({ error: 'Devices cannot create codes' }, 403);
      return createCode(user.id, body.household_id, body.role);
    case 'claim':
      return claimCode(user.id, body.code, body.name);
    default:
      return json({ error: 'action must be "create" or "claim"' }, 400);
  }
});
