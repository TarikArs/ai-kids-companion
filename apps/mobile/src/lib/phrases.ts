import { log } from './log';
import { supabase } from './supabase';

// Familiar tutor phrases (generated once by warm-phrases), loaded at Board start.

export type PhraseKind = 'praise' | 'encourage' | 'hint' | 'explain' | 'filler' | 'greeting' | 'pause' | 'resume' | 'end' | 'ask' | 'read_good';

export interface Phrase {
  lang: string;
  kind: PhraseKind;
  text: string;
  audio_path: string;
  url: string;
}

const byPath = new Map<string, Phrase>();
let all: Phrase[] = [];

/** Loads the list and signs every audio URL for 24 h. Safe to call again. */
export async function loadPhrases(): Promise<number> {
  const { data, error } = await supabase.from('tutor_phrases').select('lang, kind, text, audio_path');
  if (error || !data?.length) return 0;
  const { data: signed } = await supabase.storage
    .from('tts-cache')
    .createSignedUrls(
      data.map((p) => p.audio_path),
      60 * 60 * 24,
    );
  const urls = new Map((signed ?? []).filter((s) => s.signedUrl && s.path).map((s) => [s.path as string, s.signedUrl]));
  all = data.filter((p) => urls.has(p.audio_path)).map((p) => ({ ...(p as Omit<Phrase, 'url'>), url: urls.get(p.audio_path)! }));
  byPath.clear();
  for (const p of all) byPath.set(p.audio_path, p);
  log('phrases', `${all.length} familiar phrases loaded`, [...new Set(all.map((p) => p.lang))]);
  return all.length;
}

export function phraseByPath(path?: string): Phrase | undefined {
  return path ? byPath.get(path) : undefined;
}

/** A random phrase of this kind in this language, falling back to French. */
export function pickPhrase(kind: PhraseKind, lang = 'fr'): Phrase | undefined {
  const pool = all.filter((p) => p.kind === kind && p.lang === lang);
  const list = pool.length ? pool : all.filter((p) => p.kind === kind && p.lang === 'fr');
  return list[Math.floor(Math.random() * list.length)];
}
