import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import * as Speech from 'expo-speech';

import { log, logError } from './log';
import { phraseByPath } from './phrases';

// The tutor's voice: the ElevenLabs mp3 when the server sends one, the device voice otherwise.

const DEVICE_LANG: Record<string, string> = { fr: 'fr-FR', ar: 'ar-MA', fus: 'ar-SA', en: 'en-US' };

let current: AudioPlayer | null = null;

export function stopVoice() {
  Speech.stop();
  if (current) {
    current.pause();
    current.remove();
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
  log('voice', `speak (${cached ? 'cached phrase' : audioUrl ? 'ElevenLabs' : phrase ? 'phrase not loaded → device voice' : 'device voice'}, ${language})`, text);

  const deviceVoice = () =>
    Speech.speak(text, {
      language: DEVICE_LANG[language] ?? 'fr-FR',
      rate: 0.95,
      pitch: 1.1,
      onDone,
      onStopped: onDone,
      onError: onDone,
    });

  if (!audioUrl) return deviceVoice();

  try {
    const player = createAudioPlayer(audioUrl);
    current = player;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (current === player) {
        player.remove();
        current = null;
      }
      onDone();
    };
    player.addListener('playbackStatusUpdate', (status) => {
      if (status.didJustFinish) finish();
    });
    player.play();
  } catch (e) {
    logError('voice', 'audio player failed, device voice instead', e);
    deviceVoice();
  }
}
