// Text-to-speech with ElevenLabs, cached in the private tts-cache bucket.
// Same voice + model + spoken text = same file, generated once.
// The voice never gets digits: numbers and signs are written out in words (spoken.ts), and Standard Arabic gets its
// vowel marks (tashkeel) so words are not guessed. Arabic uses the higher-quality multilingual model.

import { isArabic, type Lang } from './language.ts';
import { spokenText } from './spoken.ts';
import { admin } from './supabase.ts';

const KEY = Deno.env.get('ELEVENLABS_API_KEY');
// Kill switch: ELEVENLABS_ENABLED=false stops every NEW generation (no credits used). Cached audio still works (free).
const ENABLED = (Deno.env.get('ELEVENLABS_ENABLED') ?? 'true').toLowerCase() !== 'false';
const MODEL = Deno.env.get('ELEVENLABS_MODEL') ?? 'eleven_flash_v2_5';
/** Arabic (Darija and Fusha): the fast model mispronounces it; the multilingual model costs more credits per sentence. */
const MODEL_AR = Deno.env.get('ELEVENLABS_MODEL_AR') ?? 'eleven_multilingual_v2';
const modelFor = (lang: Lang) => (isArabic(lang) ? MODEL_AR : MODEL);
/** Only the v2.5 models (flash, turbo) take a language_code. */
const takesLanguageCode = (model: string) => /v2_5/.test(model);
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

/** Storage path of the cached audio for this text (same voice + model + spoken text = same path). Null if TTS is not configured. */
export async function phrasePath(text: string, lang: Lang): Promise<string | null> {
  const voice = VOICES[lang] ?? VOICES.fr;
  if (!KEY || !voice) return null;
  return `${lang}/${await sha256(`${voice}|${modelFor(lang)}|${spokenText(text, lang)}`)}.mp3`;
}

/** Standard Arabic with full vowel marks, for the voice only (one small, fast text call). Falls back to the plain text. */
async function withTashkeel(text: string): Promise<string> {
  const key = Deno.env.get('OPENAI_API_KEY');
  if (!key || !/[\u0600-\u06FF]/.test(text)) return text;
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: Deno.env.get('OPENAI_VISION_MODEL') ?? 'gpt-6-luna',
        reasoning_effort: 'none',
        max_completion_tokens: 800,
        messages: [
          {
            role: 'user',
            content: `Add full Arabic diacritics (tashkeel) to this Modern Standard Arabic text, spoken by a teacher to a girl (feminine forms). Do not change, add or remove any word or punctuation. Return the text only.\n\n${text}`,
          },
        ],
      }),
    });
    if (!res.ok) return text;
    const out = String((await res.json()).choices?.[0]?.message?.content ?? '').trim();
    // Same words without the marks, or it is not used.
    const bare = (x: string) => x.replace(/[\u064B-\u065F\u0670]/g, '').replace(/\s+/g, ' ').trim();
    return out && bare(out) === bare(text) ? out : text;
  } catch {
    return text;
  }
}

/** Parent setting (households.voice_enabled). Off = no ElevenLabs request at all. Unknown (migration missing) = on. */
export async function voiceEnabled(householdId: string): Promise<boolean> {
  const { data, error } = await admin.from('households').select('voice_enabled').eq('id', householdId).maybeSingle();
  return error || !data ? true : data.voice_enabled !== false;
}

/**
 * Signed URL (1 h) of the spoken text, or null when the parent turned the voice off, TTS is not configured, or it fails.
 * Voice off: returns before any ElevenLabs or Storage request (zero credits); the Board shows the text only.
 * householdId null = app-wide phrases (warm-phrases): only the global ELEVENLABS_ENABLED switch applies.
 */
export async function speechUrl(text: string, lang: Lang, householdId: string | null): Promise<string | null> {
  // null: app-wide audio (warm-phrases, run by the admin), not tied to a household's setting.
  if (householdId && !(await voiceEnabled(householdId))) {
    lastTtsError = 'voice off (parent setting): text only';
    return null;
  }
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
  const model = modelFor(lang);
  const spoken = spokenText(text, lang);
  const say = lang === 'fus' ? await withTashkeel(spoken) : spoken;

  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_64`, {
      method: 'POST',
      headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({
        text: say,
        model_id: model,
        ...(takesLanguageCode(model) ? { language_code: lang === 'fus' ? 'ar' : lang } : {}),
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
    console.log(JSON.stringify({ fn: 'tts', step: 'generated (ElevenLabs)', lang, model, chars: say.length, ms: Date.now() - tts0, ...(say !== text ? { spoken: say } : {}) }));
    if (data?.signedUrl) lastTtsError = '';
    return data?.signedUrl ?? null;
  } catch (e) {
    lastTtsError = `TTS: ${(e as Error).message}`;
    console.error(lastTtsError);
    return null;
  }
}
