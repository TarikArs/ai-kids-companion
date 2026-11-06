// warm-phrases: generates every familiar phrase once (all languages) and lists them in tutor_phrases.
// App configuration, NOT per account: the same audio files are shared by every household. Run by the admin after
// changing a phrase, a voice or the TTS model. Phrases already generated cost nothing.
//
// POST {}   Header: x-admin-token: <WARM_PHRASES_TOKEN>   (secret set with `supabase secrets set`)
// Deployed with --no-verify-jwt: the admin token is the only access check.

import { corsHeaders, json } from '../_shared/cors.ts';
import { PHRASES, type Lang, type PhraseKind } from '../_shared/language.ts';
import { admin } from '../_shared/supabase.ts';
import { lastTtsError, phrasePath, speechUrl } from '../_shared/tts.ts';

/** Constant-time comparison: the token is not guessable byte by byte. */
function sameToken(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const expected = Deno.env.get('WARM_PHRASES_TOKEN') ?? '';
  const given = req.headers.get('x-admin-token') ?? '';
  if (expected.length < 24) return json({ error: 'WARM_PHRASES_TOKEN is not set (min 24 characters)' }, 500);
  if (!sameToken(given, expected)) return json({ error: 'Admin only' }, 403);

  const rows: { lang: Lang; kind: PhraseKind; text: string; audio_path: string; updated_at: string }[] = [];
  const failed: string[] = [];
  const errors = new Set<string>();
  for (const lang of Object.keys(PHRASES) as Lang[]) {
    for (const kind of Object.keys(PHRASES[lang]) as PhraseKind[]) {
      for (const text of PHRASES[lang][kind]) {
        const url = await speechUrl(text, lang, null); // generates only when missing
        const path = await phrasePath(text, lang);
        if (!url || !path) {
          failed.push(`${lang}: ${text}`);
          if (lastTtsError) errors.add(lastTtsError);
          continue;
        }
        rows.push({ lang, kind, text, audio_path: path, updated_at: new Date().toISOString() });
      }
    }
  }

  // Replace the whole list so removed phrases disappear.
  await admin.from('tutor_phrases').delete().neq('lang', '');
  const { error } = rows.length ? await admin.from('tutor_phrases').insert(rows) : { error: null };
  if (error) return json({ error: error.message, failed }, 500);
  return json({ ready: rows.length, failed, errors: [...errors] });
});
