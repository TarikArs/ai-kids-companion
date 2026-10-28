// Text-to-speech with ElevenLabs, cached in the private tts-cache bucket.
// Same voice + model + text = same file, generated once.

import type { Lang } from './language.ts';
import { admin } from './supabase.ts';

const KEY = Deno.env.get('ELEVENLABS_API_KEY');
// Kill switch: ELEVENLABS_ENABLED=false stops every NEW generation (no credits used). Cached audio still works (free).
const ENABLED = (Deno.env.get('ELEVENLABS_ENABLED') ?? 'true').toLowerCase() !== 'false';
const MODEL = Deno.env.get('ELEVENLABS_MODEL') ?? 'eleven_flash_v2_5';
const VOICES: Record<Lang, string | undefined> = {
  fr: Deno.env.get('ELEVENLABS_VOICE_FR'),
  ar: Deno.env.get('ELEVENLABS_VOICE_AR'),
  // Standard Arabic: its own voice if set, otherwise the Darija voice (Ghizlane also speaks Fusha).
  fus: Deno.env.get('ELEVENLABS_VOICE_FUS') ?? Deno.env.get('ELEVENLABS_VOICE_AR'),
  en: Deno.env.get('ELEVENLABS_VOICE_EN'),
};

/** Why the last speech request failed (shown in the app to diagnose), empty when it worked. */
export let lastTtsError = '';

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Storage path of the cached audio for this text (same voice + model + text = same path). Null if TTS is not configured. */
export async function phrasePath(text: string, lang: Lang): Promise<string | null> {
  const voice = VOICES[lang] ?? VOICES.fr;
  if (!KEY || !voice) return null;
  return `${lang}/${await sha256(`${voice}|${MODEL}|${text}`)}.mp3`;
}

/** Signed URL (1 h) of the spoken text, or null when TTS is not configured or fails (the Board then uses the device voice). */
export async function speechUrl(text: string, lang: Lang): Promise<string | null> {
  const voice = VOICES[lang] ?? VOICES.fr;
  const path = await phrasePath(text, lang);
  if (!KEY) {
    lastTtsError = 'ELEVENLABS_API_KEY missing in Supabase secrets';
    return null;
  }
  if (!voice || !path) {
    lastTtsError = `No voice set for ${lang} (ELEVENLABS_VOICE_${lang.toUpperCase()})`;
    return null;
  }
  if (!text.trim()) return null;
  const bucket = admin.storage.from('tts-cache');

  const cached = await bucket.createSignedUrl(path, 3600);
  if (cached.data?.signedUrl) {
    console.log(JSON.stringify({ fn: 'tts', step: 'cache hit', lang, chars: text.length }));
    return cached.data.signedUrl;
  }
  if (!ENABLED) {
    lastTtsError = 'ElevenLabs disabled (ELEVENLABS_ENABLED=false): text only';
    console.log(JSON.stringify({ fn: 'tts', step: 'skipped (disabled)', lang, chars: text.length }));
    return null;
  }
  const tts0 = Date.now();

  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_64`, {
      method: 'POST',
      headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({
        text,
        model_id: MODEL,
        language_code: lang === 'fus' ? 'ar' : lang,
        voice_settings: { stability: 0.5, similarity_boost: 0.8, speed: 0.92 },
      }),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      lastTtsError = `ElevenLabs ${res.status} (${lang}, voice ${voice}): ${detail}`;
      console.error(lastTtsError);
      return null;
    }
    const audio = new Uint8Array(await res.arrayBuffer());
    const { error } = await bucket.upload(path, audio, { contentType: 'audio/mpeg', upsert: true });
    if (error) {
      lastTtsError = `tts-cache upload: ${error.message}`;
      console.error(lastTtsError);
    }
    const { data } = await bucket.createSignedUrl(path, 3600);
    console.log(JSON.stringify({ fn: 'tts', step: 'generated (ElevenLabs)', lang, chars: text.length, ms: Date.now() - tts0 }));
    if (data?.signedUrl) lastTtsError = '';
    return data?.signedUrl ?? null;
  } catch (e) {
    lastTtsError = `TTS: ${(e as Error).message}`;
    console.error(lastTtsError);
    return null;
  }
}
