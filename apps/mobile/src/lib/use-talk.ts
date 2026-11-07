import type { RealtimeChannel } from '@supabase/supabase-js';
import {
  AudioModule,
  AudioQuality,
  IOSOutputFormat,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  type RecordingOptions,
} from 'expo-audio';
import { File } from 'expo-file-system';
import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { t } from './i18n';
import { log, logError } from './log';
import { newTurn, sendEvent } from './session';
import { functionError, supabase } from './supabase';
import { TUTOR_NAME } from './tutor';

// Push-to-talk for the Board (TV / tablet / one phone): one press to start, one press to stop; the recording goes to
// child-talk exactly like the Camera's « Parler ». Silia's answer arrives on the session channel as usual.

const MAX_TALK_MS = 90_000;

/** Small speech recording: mono, 16 kHz, 32 kbps (speech-to-text is billed per minute, small files upload fast). */
const TALK_OPTIONS: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 32000,
  android: { ...RecordingPresets.HIGH_QUALITY.android, outputFormat: 'mpeg4', audioEncoder: 'aac' },
  ios: { ...RecordingPresets.HIGH_QUALITY.ios, outputFormat: IOSOutputFormat.MPEG4AAC, audioQuality: AudioQuality.MEDIUM },
  web: { mimeType: 'audio/webm', bitsPerSecond: 32000 },
};

async function fileToBase64(uri: string): Promise<{ b64: string; mime: string; bytes: number }> {
  if (Platform.OS !== 'web') {
    const file = new File(uri);
    if (!file.exists || file.size === 0) throw new Error(`empty recording (${file.size} bytes)`);
    return { b64: await file.base64(), mime: 'audio/mp4', bytes: file.size };
  }
  const blob = await (await fetch(uri)).blob();
  const dataUrl: string = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  return { b64: dataUrl.slice(dataUrl.indexOf(',') + 1), mime: blob.type || 'audio/webm', bytes: blob.size };
}

export type TalkState = 'idle' | 'recording' | 'sending';

export function useTalk({
  sessionId,
  channel,
  onStart,
  onSent,
  onProblem,
  makeTurn = newTurn,
}: {
  sessionId: string | null | undefined;
  /** The turn of this request (the Board marks it as the one it waits for). */
  makeTurn?: () => { id: string };
  channel: () => RealtimeChannel | null;
  /** Recording started (Silia listens). */
  onStart?: () => void;
  /** Recording sent: Silia thinks. */
  onSent?: () => void;
  /** Something went wrong: a short text for the child. */
  onProblem?: (text: string) => void;
}) {
  const recorder = useAudioRecorder(TALK_OPTIONS);
  const recState = useAudioRecorderState(recorder, 250);
  const [talk, setTalk] = useState<TalkState>('idle');

  const stop = useCallback(async () => {
    if (!sessionId) return;
    setTalk('sending');
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      const ch = channel();
      if (ch) sendEvent(ch, 'child.talk.end', {});
      const uri = recorder.uri;
      if (!uri) throw new Error('no recording');
      const { b64, mime, bytes } = await fileToBase64(uri);
      log('board', `talk: ${(bytes / 1000).toFixed(1)} KB ${mime}`);
      onSent?.();
      const { data, error } = await supabase.functions.invoke('child-talk', { body: { session_id: sessionId, audio_b64: b64, mime, turn: makeTurn() } });
      if (error) throw new Error(await functionError(error));
      if (data?.mode === 'empty') onProblem?.(t('Je n’ai rien entendu. Réessaie plus près du téléphone.'));
    } catch (e) {
      logError('board', 'talk failed', e);
      onProblem?.(t('Je n’ai pas bien entendu. Réessaie.'));
    } finally {
      setTalk('idle');
    }
  }, [recorder, sessionId, channel, onSent, onProblem, makeTurn]);

  const start = useCallback(async () => {
    if (!sessionId || talk !== 'idle') return;
    const perm = await AudioModule.requestRecordingPermissionsAsync();
    if (!perm.granted) {
      onProblem?.(t('Autorise le micro pour parler à {name}.', { name: TUTOR_NAME }));
      return;
    }
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setTalk('recording');
      const ch = channel();
      if (ch) sendEvent(ch, 'child.talk.start', {});
      onStart?.();
    } catch (e) {
      logError('board', 'mic failed', e);
      setTalk('idle');
      onProblem?.(t('Je n’ai pas bien entendu. Réessaie.'));
    }
  }, [recorder, sessionId, talk, channel, onStart, onProblem]);

  // Safety stop after 90 s.
  useEffect(() => {
    if (talk === 'recording' && recState.durationMillis >= MAX_TALK_MS) void stop();
  }, [talk, recState.durationMillis, stop]);

  return { talk, seconds: Math.floor(recState.durationMillis / 1000), start, stop };
}
