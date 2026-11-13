// delete-account: the signed-in parent deletes their account (Settings → Delete my account).
// For each family the parent owns: every stored file of the family, the paired devices' sign-ins, then the family
// (children, sessions, photos, messages, summaries… follow by cascade). Families shared as a second parent are only
// left. Finally the parent's own sign-in is deleted.
//
// POST { confirm: "DELETE" }   Caller: a signed-in parent (not a device).

import { corsHeaders, json } from '../_shared/cors.ts';
import { admin, getCaller } from '../_shared/supabase.ts';

const BUCKETS = ['snapshots', 'audio-in', 'avatars'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const user = await getCaller(req);
  if (!user || user.is_anonymous) return json({ error: 'Parent sign-in required' }, 401);
  const body = (await req.json().catch(() => ({}))) as { confirm?: string };
  if (body.confirm !== 'DELETE') return json({ error: 'confirm must be "DELETE"' }, 400);

  try {
    const { data: owned, error: oe } = await admin.from('household_members').select('household_id').eq('user_id', user.id).eq('role', 'owner');
    if (oe) throw new Error(`household_members: ${oe.message}`);

    for (const { household_id } of owned ?? []) {
      // 1. Files: every object under <household_id>/ in the family buckets.
      for (const bucket of BUCKETS) {
        const { data: files, error } = await admin.rpc('household_storage_objects', { p_bucket: bucket, p_household: household_id });
        if (error) throw new Error(`household_storage_objects(${bucket}): ${error.message}`);
        const paths = ((files ?? []) as { name: string }[]).map((f) => f.name);
        for (let i = 0; i < paths.length; i += 100) {
          const { error: re } = await admin.storage.from(bucket).remove(paths.slice(i, i + 100));
          if (re) throw new Error(`${bucket}: ${re.message}`);
        }
      }
      // 2. The paired devices' anonymous sign-ins.
      const { data: devices, error: de } = await admin.from('devices').select('user_id').eq('household_id', household_id);
      if (de) throw new Error(`devices: ${de.message}`);
      // 3. The family and everything that hangs from it.
      const { error: he } = await admin.from('households').delete().eq('id', household_id);
      if (he) throw new Error(`households: ${he.message}`);
      for (const d of devices ?? []) {
        const { error } = await admin.auth.admin.deleteUser(d.user_id as string);
        if (error && !/not.?found/i.test(error.message)) throw new Error(`device sign-in: ${error.message}`);
      }
    }

    // 4. The parent (memberships in other families go with it by cascade).
    const { error: ue } = await admin.auth.admin.deleteUser(user.id);
    if (ue) throw new Error(`parent sign-in: ${ue.message}`);
  } catch (e) {
    console.error(JSON.stringify({ fn: 'delete-account', user: user.id, error: (e as Error).message }));
    return json({ error: (e as Error).message }, 500);
  }
  console.log(JSON.stringify({ fn: 'delete-account', user: user.id, done: true }));
  return json({ deleted: true });
});
