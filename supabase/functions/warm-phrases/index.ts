// warm-phrases: generates every familiar phrase once (all languages) and lists them in tutor_phrases.
// Run again after changing a phrase, a voice or the TTS model. Already generated phrases cost nothing.
//
// POST {}   Caller: a parent (not a device).

import { corsHeaders, json } from '../_shared/cors.ts';
import { PHRASES, type Lang, type PhraseKind } from '../_shared/language.ts';
import { admin, getCaller } from '../_shared/supabase.ts';
import { lastTtsError, phrasePath, speechUrl } from '../_shared/tts.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const user = await getCaller(req);
  if (!user || user.is_anonymous) return json({ error: 'Parents only' }, 403);
  const { data: member } = await admin.from('household_members').select('user_id').eq('user_id', user.id).limit(1).maybeSingle();
  if (!member) return json({ error: 'Parents only' }, 403);

  const rows: { lang: Lang; kind: PhraseKind; text: string; audio_path: string; updated_at: string }[] = [];
  const failed: string[] = [];
  const errors = new Set<string>();
  for (const lang of Object.keys(PHRASES) as Lang[]) {
    for (const kind of Object.keys(PHRASES[lang]) as PhraseKind[]) {
      for (const text of PHRASES[lang][kind]) {
        const url = await speechUrl(text, lang); // generates only when missing
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
