import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import * as Speech from 'expo-speech';

import { log, logError } from './log';
import { phraseByPath } from './phrases';

// The tutor's voice: an mp3 (cached phrase, or ElevenLabs when enabled on the server), else the device's own voice.
// TVs often have few device voices: we pick one that exists for the language, and report when there is none.

const DEVICE_LANG: Record<string, string> = { fr: 'fr-FR', ar: 'ar-MA', fus: 'ar-SA', en: 'en-US' };
const PREFIX: Record<string, string> = { fr: 'fr', ar: 'ar', fus: 'ar', en: 'en' };
/** An mp3 that has not started after this long is given up (expired link, slow network): device voice instead. */
const START_TIMEOUT_MS = 6000;

let current: AudioPlayer | null = null;
let voices: Speech.Voice[] | null = null;
let voicesLoading: Promise<void> | null = null;
const issueListeners = new Set<(message: string) => void>();

/** Called with a short message when a language has no voice on this device (shown on the Board). */
export function onVoiceIssue(cb: (message: string) => void): () => void {
  issueListeners.add(cb);
  return () => issueListeners.delete(cb);
}

function loadVoices(): Promise<void> {
  voicesLoading ??= Speech.getAvailableVoicesAsync()
    .then((v) => {
      voices = v;
      const langs = [...new Set(v.map((x) => x.language.slice(0, 2)))];
      log('voice', `${v.length} device voices`, langs);
    })
    .catch(() => {
      voices = [];
    });
  return voicesLoading;
}
loadVoices();

/** Best installed voice for the language (exact region first, then any region), or null. */
function deviceVoiceFor(language: string): Speech.Voice | null {
  if (!voices?.length) return null;
  const exact = DEVICE_LANG[language] ?? 'fr-FR';
  const prefix = PREFIX[language] ?? 'fr';
  const ok = (v: Speech.Voice) => !/network|notinstalled/i.test(v.identifier);
  return (
    voices.find((v) => v.language.replace('_', '-') === exact && ok(v)) ??
    voices.find((v) => v.language.toLowerCase().startsWith(prefix) && ok(v)) ??
    voices.find((v) => v.language.toLowerCase().startsWith(prefix)) ??
    null
  );
}

const NAMES: Record<string, string> = { fr: 'française', ar: 'arabe', fus: 'arabe', en: 'anglaise' };
const warned = new Set<string>();

export function stopVoice() {
  Speech.stop();
  if (current) {
    try {
      current.pause();
      current.remove();
    } catch {
      // already released
    }
    current = null;
  }
}

export function playVoice({
  text,
  language = 'fr',
  audioUrl,
  phrase,
  onDone,
}: {
  text: string;
  language?: string;
  audioUrl?: string;
  /** Path of a familiar phrase already loaded on this device: played without any server call. */
  phrase?: string;
  onDone: () => void;
}) {
  stopVoice();
  const cached = phraseByPath(phrase);
  audioUrl = cached?.url ?? audioUrl;
  log('voice', `speak (${cached ? 'cached phrase' : audioUrl ? 'mp3' : 'device voice'}, ${language})`, text);

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    onDone();
  };

  const deviceVoice = async () => {
    if (!voices) await loadVoices();
    const voice = deviceVoiceFor(language);
    if (!voice && voices && voices.length && !warned.has(language)) {
      warned.add(language);
      const msg = `Pas de voix ${NAMES[language] ?? language} sur cet appareil : texte seulement`;
      log('voice', msg);
      issueListeners.forEach((cb) => cb(msg));
    }
    Speech.speak(text, {
      language: voice?.language ?? DEVICE_LANG[language] ?? 'fr-FR',
      ...(voice ? { voice: voice.identifier } : {}),
      rate: 0.95,
      pitch: 1.1,
      onDone: finish,
      onStopped: finish,
      onError: (e) => {
        log('voice', 'device voice error', String(e));
        finish();
      },
    });
    // Safety: some TV engines never call back. Free the mouth after the time the sentence would take.
    setTimeout(finish, Math.min(30_000, 2000 + text.length * 90));
  };

  if (!audioUrl) {
    void deviceVoice();
    return;
  }

  try {
    const player = createAudioPlayer(audioUrl);
    current = player;
    let started = false;
    const release = () => {
      if (current === player) {
        try {
          player.remove();
        } catch {
          // already released
        }
        current = null;
      }
    };
    player.addListener('playbackStatusUpdate', (status) => {
      if (status.playing) started = true;
      if (status.didJustFinish) {
        release();
        finish();
      }
    });
    player.play();
    setTimeout(() => {
      if (started || done || current !== player) return;
      log('voice', 'mp3 did not start (expired link or network): device voice instead');
      release();
      void deviceVoice();
    }, START_TIMEOUT_MS);
  } catch (e) {
    logError('voice', 'audio player failed, device voice instead', e);
    void deviceVoice();
  }
}
