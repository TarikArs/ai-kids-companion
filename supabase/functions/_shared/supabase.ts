import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2';

const url = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

/** Service-role client: bypasses RLS. Only use after checking who the caller is. */
export const admin: SupabaseClient = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** Returns the signed-in user behind the request (parent or anonymous device), or null. */
export async function getCaller(req: Request): Promise<User | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return null;
  const client = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser();
  return error ? null : data.user;
}

/** True when the user is a parent of the household or one of its paired, non-revoked devices. */
export async function isHouseholdMember(userId: string, householdId: string): Promise<boolean> {
  const [{ data: member }, { data: device }] = await Promise.all([
    admin.from('household_members').select('user_id').eq('household_id', householdId).eq('user_id', userId).maybeSingle(),
    admin
      .from('devices')
      .select('id')
      .eq('household_id', householdId)
      .eq('user_id', userId)
      .is('revoked_at', null)
      .maybeSingle(),
  ]);
  return !!member || !!device;
}
