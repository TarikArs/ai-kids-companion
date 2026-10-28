import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { supabase } from './supabase';

// Web: closes the Google popup/redirect page when it comes back.
WebBrowser.maybeCompleteAuthSession();

/** Link back into the app: https://<site>/path on web, kidscompanion://path (or exp://…/--/path in Expo Go) on phones. */
export function authRedirect(path: 'auth-callback' | 'reset-password'): string {
  if (Platform.OS === 'web') return `${(globalThis as any).location?.origin ?? ''}/${path}`;
  return Linking.createURL(path);
}

/** Query + hash parameters of an auth link (?code=… or #access_token=…). */
export function authParams(url: string): Record<string, string> {
  const out: Record<string, string> = {};
  const parts = [url.split('?')[1]?.split('#')[0], url.split('#')[1]].filter(Boolean) as string[];
  for (const part of parts) {
    for (const pair of part.split('&')) {
      const [k, v = ''] = pair.split('=');
      if (k) out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '));
    }
  }
  return out;
}

/** Finishes sign-in from an auth link. Throws a readable error. */
export async function completeAuth(params: Record<string, string | undefined>): Promise<void> {
  if (params.error_description || params.error) {
    throw new Error(params.error_description ?? params.error);
  }
  if (params.code) {
    const { error } = await supabase.auth.exchangeCodeForSession(params.code);
    if (error) {
      if (/verifier/i.test(error.message)) throw new Error('Ouvre le lien sur le même appareil que celui de la demande.');
      throw error;
    }
    return;
  }
  if (params.access_token && params.refresh_token) {
    const { error } = await supabase.auth.setSession({ access_token: params.access_token, refresh_token: params.refresh_token });
    if (error) throw error;
    return;
  }
  throw new Error('Lien incomplet. Réessaie.');
}

/** "Continuer avec Google". Returns false when the parent closed the Google window. */
export async function signInWithGoogle(): Promise<boolean> {
  const redirectTo = authRedirect('auth-callback');
  if (Platform.OS === 'web') {
    // The page goes to Google, then comes back to /auth-callback.
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
    if (error) throw error;
    return true;
  }
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } },
  });
  if (error) throw error;
  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') return false;
  await completeAuth(authParams(result.url));
  return true;
}

/** Sends the "new password" e-mail. The link opens /reset-password in the app. */
export async function sendPasswordReset(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: authRedirect('reset-password') });
  if (error) throw error;
}
