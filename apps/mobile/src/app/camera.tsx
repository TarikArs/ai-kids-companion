import type { ExerciseChoice, ExerciseFocus } from '@hc/shared';
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
import { CameraView, useCameraPermissions } from 'expo-camera';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useKeepAwake } from 'expo-keep-awake';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { IconButton } from '@/components/icon-button';
import { Body, Button, Screen, Title } from '@/components/ui';
import {
  base64ToBytes,
  findOpenSession,
  onEvent,
  sendEvent,
  sessionChannel,
  setSessionStatus,
  startSession,
  type HomeworkSession,
} from '@/lib/session';
import { useAppStore } from '@/lib/store';
import { functionError, supabase } from '@/lib/supabase';
import { colors, radius, space } from '@/lib/theme';
import { log, logError } from '@/lib/log';
import { ACTION_LABEL, exerciseName, loadFocus, requestHelp } from '@/lib/exercise';
import { TUTOR_NAME } from '@/lib/tutor';
import { useUnpair } from '@/lib/use-unpair';

// 2048 px: pencil digits stay readable when the server zooms on an answer.
const MAX_SIDE = 2048;
// A 2048 px JPEG of a real page is usually 250-700 KB. Black, empty or very blurry photos compress far smaller.
const MIN_PHOTO_BYTES = 70_000;
const MAX_TALK_MS = 45_000;

// Small speech recording: mono, 16 kHz, 32 kbps (speech-to-text is billed per minute, small files upload fast).
const TALK_OPTIONS: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 32000,
  android: { ...RecordingPresets.HIGH_QUALITY.android, outputFormat: 'mpeg4', audioEncoder: 'aac' },
  ios: { ...RecordingPresets.HIGH_QUALITY.ios, outputFormat: IOSOutputFormat.MPEG4AAC, audioQuality: AudioQuality.MEDIUM },
  web: { mimeType: 'audio/webm', bitsPerSecond: 32000 },
};

/** Recording as base64. Native: Expo's File API (fetch of a local file can return an empty blob on Android). */
/** Rejects after `ms`: a stuck step must never freeze the screen. */
function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${what}: trop long (${ms / 1000} s)`)), ms)),
  ]);
}

async function fileToBase64(uri: string): Promise<{ b64: string; mime: string; bytes: number }> {
  if (Platform.OS !== 'web') {
    const file = new File(uri);
    if (!file.exists || file.size === 0) throw new Error(`Enregistrement vide (${file.size} octets)`);
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

type TalkState = 'idle' | 'recording' | 'thinking';

export default function Camera() {
  useKeepAwake();
  const device = useAppStore((s) => s.device);
  const unpair = useUnpair();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const busyRef = useRef(false); // a photo is being processed
  const busySinceRef = useRef(0);
  const captureIdRef = useRef(0); // a newer capture (Corriger) makes an older stuck one irrelevant
  const talkRef = useRef(false); // the child is talking (or waiting for the answer): no photos

  const captureRef = useRef<((mode?: 'check', requestId?: string) => void) | null>(null);
  const recorder = useAudioRecorder(TALK_OPTIONS);
  const recState = useAudioRecorderState(recorder, 250);

  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<HomeworkSession | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [talk, setTalk] = useState<TalkState>('idle');
  const [status, setStatus] = useState('');
  const [details, setDetails] = useState('');
  const [showDetails, setShowDetails] = useState(false);
  const [explaining, setExplaining] = useState(false);
  const [choices, setChoices] = useState<ExerciseChoice[]>([]);
  /** Active exercise (synced with the Board: voice, taps on either screen). */
  const [focus, setFocus] = useState<ExerciseFocus | null>(null);

  // Resume an open session after a restart.
  useEffect(() => {
    if (!device) return;
    findOpenSession(device.householdId)
      .then(setSession)
      .catch((e) => setStatus(e.message));
  }, [device]);

  // Join the session channel while a session is open; show what the tutor says, and her exercise question.
  useEffect(() => {
    if (!session || !device) return;
    let channel: RealtimeChannel | null = null;
    let cancelled = false;
    loadFocus(session.id).then((f) => !cancelled && setFocus(f));
    sessionChannel(session.id).then((ch) => {
      if (cancelled) return;
      channel = ch;
      onEvent(ch, 'focus.changed', (p) => {
        setFocus(p.focus);
        setChoices([]);
      });
      onEvent(ch, 'tutor.say', (p) => {
        if (p.text) setStatus(p.text);
      });
      onEvent(ch, 'capture.request', (p) => captureRef.current?.(p.mode, p.request_id));
      onEvent(ch, 'tutor.ask_exercise', (p) => {
        setChoices(p.choices);
        setStatus(p.text);
      });
      ch.subscribe((state, err) => {
        log('camera', `live channel: ${state}`, err?.message);
        if (state === 'SUBSCRIBED') ch.track({ role: 'camera', device_id: device.id, joined_at: new Date().toISOString() });
      });
      channelRef.current = ch;
    });
    return () => {
      cancelled = true;
      channelRef.current = null;
      if (channel) supabase.removeChannel(channel);
    };
  }, [session, device]);

  // ---------- photos ----------
  const capture = useCallback(async (mode?: 'check', requestId?: string) => {
    // Corriger from the Board: tell it whether this phone takes the photo (else it checks its own photo after 2 s).
    const failed = (reason: string) => {
      if (requestId && channelRef.current) sendEvent(channelRef.current, 'capture.failed', { request_id: requestId, reason });
    };
    if (!device || !session || !cameraRef.current || talkRef.current) return;
    if (busyRef.current) {
      // Corriger while a photo seems stuck: start over. Otherwise ignore the extra press.
      if (mode !== 'check' || Date.now() - busySinceRef.current < 3000) return;
      log('camera', 'photo: previous one looked stuck, starting over (Corriger)');
    }
    if (requestId && channelRef.current) sendEvent(channelRef.current, 'capture.ack', { request_id: requestId });
    const myId = ++captureIdRef.current;
    busyRef.current = true;
    busySinceRef.current = Date.now();
    if (mode === 'check') setStatus('Je vérifie toutes tes réponses…');
    setBusy(true);
    log('camera', 'photo: taking');
    const t0 = Date.now();
    const secs = (ms: number) => (ms / 1000).toFixed(1);
    try {
      const photo = await withTimeout(cameraRef.current.takePictureAsync({ quality: 0.8, shutterSound: false }), 10_000, 'Photo');
      const context = ImageManipulator.manipulate(photo.uri);
      if (Math.max(photo.width, photo.height) > MAX_SIDE) {
        context.resize(photo.width >= photo.height ? { width: MAX_SIDE, height: null } : { width: null, height: MAX_SIDE });
      }
      const rendered = await context.renderAsync();
      const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.8, base64: true });
      if (!saved.base64) throw new Error('Image conversion failed');
      const tPhoto = Date.now();
      const bytes = Math.round(saved.base64.length * 0.75);
      log('camera', `photo: ${Math.round(bytes / 1000)} KB, ${saved.width}x${saved.height}, ${Date.now() - t0} ms`);
      if (bytes < MIN_PHOTO_BYTES) {
        log('camera', 'photo: rejected on the phone (too dark/blurry), not sent');
        failed('dark');
        setStatus('Je ne vois pas bien le cahier. Vise la page.');
        setDetails(`Photo trop sombre ou floue (${Math.round(bytes / 1000)} Ko), pas envoyée.`);
        return;
      }

      const path = `${device.householdId}/${session.id}/${Date.now()}.jpg`;
      const { data: snap, error: rowErr } = await supabase
        .from('snapshots')
        .insert({ household_id: device.householdId, session_id: session.id, storage_path: path, width: saved.width, height: saved.height })
        .select('id')
        .single();
      if (rowErr) throw rowErr;
      const tRow = Date.now();
      log('camera', `photo: row ${snap.id}, uploading + analyzing in parallel`);

      // In parallel: upload the file for the Board, and send the same image to the AI.
      const upload = supabase.storage
        .from('snapshots')
        .upload(path, base64ToBytes(saved.base64), { contentType: 'image/jpeg' })
        .then(({ error }) => {
          if (error) throw error;
          if (channelRef.current) sendEvent(channelRef.current, 'snapshot.new', { snapshot_id: snap.id, storage_path: path });
        });
      const analyze = supabase.functions.invoke('analyze-snapshot', {
        body: { snapshot_id: snap.id, image_b64: saved.base64, ...(mode ? { mode } : {}) },
      });
      const [, { data, error: fnErr }] = await withTimeout(Promise.all([upload, analyze]), 40_000, 'Analyse');
      if (myId !== captureIdRef.current) return; // a newer photo (Corriger) took over
      if (fnErr) throw new Error(await functionError(fnErr));
      const tDone = Date.now();
      log('camera', `photo: analysis done in ${tDone - t0} ms`, data);
      if (data?.reason === 'no_page') setStatus('Je ne vois pas le cahier. Vise la page.');
      else if (data?.reason === 'hand_blocking') setStatus('Une main cache le cahier.');
      else if (data?.action === 'silent') setStatus('');
      setDetails(
        [
          data?.new_items !== undefined
            ? `Lu : ${data.new_items} réponse(s) · ${data.right ?? 0} juste(s) · ${data.wrong ?? 0} fausse(s)`
            : data?.reason
              ? `Rien lu (${data.reason})`
              : '',
          `${Math.round(bytes / 1000)} Ko · ${secs(tDone - t0)} s · photo ${secs(tPhoto - t0)} · fiche ${secs(tRow - tPhoto)} · IA ${secs(
            data?.timings?.vision_ms ?? 0,
          )}`,
        ]
          .filter(Boolean)
          .join('\n'),
      );
    } catch (e) {
      logError('camera', 'photo failed', e);
      failed((e as Error).message);
      setStatus('Oups, la photo n’est pas passée.');
      setDetails(`Erreur photo : ${(e as Error).message}`);
    } finally {
      if (myId === captureIdRef.current) {
        busyRef.current = false;
        setBusy(false);
        setSecondsLeft(session.capture_interval_s);
      }
    }
  }, [device, session]);

  useEffect(() => {
    captureRef.current = (mode, requestId) => {
      void capture(mode, requestId);
    };
  }, [capture]);

  // Timer: counts down while active and nobody is talking; a photo is taken at 0 (also right at the start).
  const active = !!session && session.status === 'active' && ready;
  useEffect(() => {
    if (!active) return;
    const id = setInterval(
      () => setSecondsLeft((s) => (busyRef.current || talkRef.current ? s : Math.max(0, s - 1))),
      1000,
    );
    return () => clearInterval(id);
  }, [active]);

  useEffect(() => {
    if (active && secondsLeft === 0 && !busyRef.current && !talkRef.current) capture();
  }, [active, secondsLeft, capture]);

  // ---------- push-to-talk: one press to start, one press to stop ----------
  const stopTalk = useCallback(async () => {
    if (!session) return;
    setTalk('thinking');
    const durationMs = recorder.getStatus().durationMillis;
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      if (channelRef.current) sendEvent(channelRef.current, 'child.talk.end', {});
      const uri = recorder.uri;
      if (!uri) throw new Error('No recording');
      const { b64, mime, bytes } = await fileToBase64(uri);
      const audioInfo = `Audio : ${(bytes / 1000).toFixed(1)} Ko · ${(durationMs / 1000).toFixed(1)} s · ${mime}`;
      setDetails(audioInfo);
      log('camera', `talk: stopped, ${audioInfo}, sending to child-talk`);
      const { data, error } = await supabase.functions.invoke('child-talk', {
        body: { session_id: session.id, audio_b64: b64, mime },
      });
      if (error) throw new Error(await functionError(error));
      log('camera', 'talk: result', data);
      if (data?.mode === 'empty') setStatus('Je n’ai rien entendu. Réessaie plus près du téléphone.');
      setDetails(
        [
          audioInfo,
          data?.mode === 'empty' ? `Serveur : ${data.note ?? 'transcription vide'}` : '',
          data?.transcript ? `Entendu : « ${data.transcript} »` : '',
          data?.intent ? `Compris : ${data.intent.act}${data.intent.ex != null ? ` exercice ${data.intent.ex}` : ''} → ${data.done ?? ''}` : '',
          data?.mode === 'reading' && typeof data.accuracy === 'number'
            ? `Lecture : ${Math.round(data.accuracy * 100)} % juste`
            : '',
          data?.ms ? `${(data.ms / 1000).toFixed(1)} s` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      );
    } catch (e) {
      logError('camera', 'talk failed', e);
      setStatus('Je n’ai pas bien entendu. Réessaie.');
      setDetails(`Erreur micro : ${(e as Error).message}`);
    } finally {
      setTalk('idle');
      talkRef.current = false;
      setSecondsLeft(session.capture_interval_s); // no photo right after talking
    }
  }, [recorder, session]);

  async function startTalk() {
    if (!session || talk !== 'idle') return;
    const perm = await AudioModule.requestRecordingPermissionsAsync();
    if (!perm.granted) {
      setStatus(`Autorise le micro pour parler à ${TUTOR_NAME}.`);
      return;
    }
    talkRef.current = true; // pauses photos right away
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      log('camera', 'talk: recording (photos paused)');
      setTalk('recording');
      setStatus('Je t’écoute…');
      setChoices([]);
      if (channelRef.current) sendEvent(channelRef.current, 'child.talk.start', {});
    } catch (e) {
      talkRef.current = false;
      setTalk('idle');
      setDetails(`Erreur micro : ${(e as Error).message}`);
    }
  }

  // Safety stop after 45 s.
  useEffect(() => {
    if (talk === 'recording' && recState.durationMillis >= MAX_TALK_MS) stopTalk();
  }, [talk, recState.durationMillis, stopTalk]);

  // ---------- explain ----------
  async function explainExercise(choice?: ExerciseChoice, action?: 'choose') {
    if (!session) return;
    setExplaining(true);
    setChoices([]);
    const { data, error } = await requestHelp(session.id, { choice, action });
    setExplaining(false);
    if (error) {
      logError('camera', 'explain failed', error);
      setStatus('Je n’ai pas pu expliquer. Prends une photo de la page.');
      setDetails(`Erreur explication : ${error}`);
      return;
    }
    log('camera', 'explain: result', data);
    if (data?.ask) {
      setChoices(data.choices ?? []);
      setStatus(data.text);
    }
  }

  // ---------- session ----------
  async function begin() {
    if (!device) return;
    try {
      setSession(await startSession(device.householdId));
      setStatus('C’est parti !');
    } catch (e) {
      setDetails((e as Error).message);
    }
  }

  async function changeStatus(next: 'active' | 'paused' | 'finished') {
    if (!session) return;
    try {
      await setSessionStatus(session.id, next);
      log('camera', `session ${next}`);
      if (channelRef.current) sendEvent(channelRef.current, 'session.state', { status: next });
      setSession(next === 'finished' ? null : { ...session, status: next });
      setStatus(next === 'finished' ? 'Bravo, devoirs terminés !' : next === 'paused' ? 'Pause' : 'C’est reparti !');
    } catch (e) {
      setDetails((e as Error).message);
    }
  }

  if (!device) return null;
  if (!permission) return <Screen center><Body>Caméra…</Body></Screen>;
  if (!permission.granted) {
    return (
      <Screen center>
        <Title>Caméra</Title>
        <Body muted>La caméra photographie le cahier pendant les devoirs. Elle ne filme pas l’enfant.</Body>
        <Button label="Autoriser la caméra" onPress={requestPermission} />
      </Screen>
    );
  }

  const paused = session?.status === 'paused';
  const recordingSecs = Math.floor(recState.durationMillis / 1000);

  return (
    <View style={styles.root}>
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" onCameraReady={() => setReady(true)} />
      <SafeAreaView style={styles.overlay} pointerEvents="box-none">
        {/* top: state + small controls */}
        <View style={styles.topBar}>
          <View style={styles.chip}>
            <View style={[styles.dot, { backgroundColor: !session ? colors.muted : paused ? colors.accent : talk === 'recording' ? '#E5484D' : colors.success }]} />
            {session && !paused && talk === 'idle' ? <Text style={styles.chipText}>{busy ? '…' : `${secondsLeft}s`}</Text> : null}
            {talk === 'recording' ? <Text style={styles.chipText}>{recordingSecs}s</Text> : null}
          </View>
          <View style={styles.topActions}>
            {details ? <IconButton icon="info" label="Détails" size={44} onPress={() => setShowDetails((v) => !v)} /> : null}
            {session ? (
              <>
                <IconButton
                  icon={paused ? 'play' : 'pause'}
                  label={paused ? 'Reprendre' : 'Pause'}
                  size={44}
                  onPress={() => changeStatus(paused ? 'active' : 'paused')}
                />
                <IconButton icon="flag" label="Terminer les devoirs" size={44} onPress={() => changeStatus('finished')} />
              </>
            ) : (
              <IconButton icon="unlink" label="Délier cet appareil" size={44} onPress={unpair} />
            )}
          </View>
        </View>

        {/* bottom: what the tutor says, exercise choices, the 3 main buttons */}
        <View style={styles.bottom}>
          {showDetails && details ? <Text style={styles.details}>{details}</Text> : null}
          {status ? (
            <Text style={styles.status} numberOfLines={3}>
              {status}
            </Text>
          ) : null}
          {focus && !choices.length ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Exercice en cours : ${exerciseName(focus)}, ${focus.title}. Toucher pour changer d’exercice.`}
              onPress={() => explainExercise(undefined, 'choose')}
              disabled={talk !== 'idle' || explaining}
              style={({ pressed }) => [styles.focusChip, pressed && { opacity: 0.8 }]}
            >
              <Text style={styles.focusNumber}>{exerciseName(focus)}</Text>
              <Text style={styles.focusTitle} numberOfLines={1}>
                {focus.title}
                {focus.action ? ` · ${ACTION_LABEL[focus.action]}` : ''}
              </Text>
              <Text style={styles.focusChange}>Changer</Text>
            </Pressable>
          ) : null}
          {choices.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choices}>
              {choices.map((c) => (
                <Pressable
                  key={c.index}
                  accessibilityRole="button"
                  accessibilityLabel={`Exercice ${exerciseName(c)} : ${c.title}`}
                  onPress={() => explainExercise(c)}
                  style={({ pressed }) => [styles.choice, focus?.index === c.index && styles.choiceOn, pressed && { opacity: 0.8 }]}
                >
                  <Text style={styles.choiceNumber}>{exerciseName(c)}</Text>
                  <Text style={styles.choiceTitle} numberOfLines={1}>
                    {c.title}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}

          {!session ? (
            <View style={styles.mainRow}>
              <IconButton icon="play" label="Commencer les devoirs" caption="Commencer" size={88} tone="accent" onPress={begin} />
            </View>
          ) : (
            <View style={styles.mainRow}>
              <IconButton
                icon="bulb"
                label="Explique-moi l’exercice"
                caption="Explique"
                size={64}
                onPress={() => explainExercise()}
                loading={explaining}
                disabled={talk !== 'idle'}
              />
              <IconButton
                icon="camera"
                label="Prendre une photo maintenant"
                caption="Photo"
                size={84}
                tone="accent"
                onPress={() => capture()}
                loading={busy}
                disabled={!ready || talk !== 'idle'}
              />
              <IconButton
                icon="check"
                label="Corriger : vérifier toutes mes réponses maintenant"
                caption="Corriger"
                size={64}
                onPress={() => capture('check')}
                disabled={!ready || talk !== 'idle'}
              />
              <IconButton
                icon={talk === 'recording' ? 'stop' : 'mic'}
                label={talk === 'recording' ? 'J’ai fini de parler' : `Parler à ${TUTOR_NAME}`}
                caption={talk === 'recording' ? 'Stop' : 'Parler'}
                size={64}
                tone={talk === 'recording' ? 'danger' : 'dark'}
                onPress={talk === 'recording' ? stopTalk : startTalk}
                loading={talk === 'thinking'}
              />
            </View>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  overlay: { flex: 1, justifyContent: 'space-between', padding: space.md },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm },
  topActions: { flexDirection: 'row', gap: space.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: 'rgba(27,35,64,0.85)',
    paddingHorizontal: space.md,
    height: 44,
    borderRadius: radius.pill,
  },
  dot: { width: 14, height: 14, borderRadius: 7 },
  chipText: { color: colors.text, fontWeight: '900', fontSize: 16 },
  bottom: { gap: space.sm },
  status: {
    alignSelf: 'center',
    maxWidth: '100%',
    color: colors.text,
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'center',
    backgroundColor: 'rgba(27,35,64,0.88)',
    borderRadius: radius.lg,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    overflow: 'hidden',
  },
  details: {
    color: colors.muted,
    fontSize: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: radius.md,
    padding: space.sm,
    overflow: 'hidden',
  },
  choices: { gap: space.sm, paddingHorizontal: 2 },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    maxWidth: 240,
    height: 48,
    backgroundColor: 'rgba(27,35,64,0.92)',
    borderRadius: radius.pill,
    paddingLeft: 6,
    paddingRight: space.md,
  },
  choiceNumber: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: colors.accent,
    color: colors.onAccent,
    fontSize: 18,
    fontWeight: '900',
    textAlign: 'center',
    lineHeight: 36,
  },
  choiceTitle: { color: colors.text, fontSize: 15, fontWeight: '800', flexShrink: 1 },
  choiceOn: { borderWidth: 2, borderColor: '#7FD3FF' },
  focusChip: {
    alignSelf: 'center',
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    height: 44,
    backgroundColor: 'rgba(27,35,64,0.92)',
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: '#7FD3FF',
    paddingLeft: 4,
    paddingRight: space.md,
  },
  focusNumber: {
    minWidth: 34,
    height: 34,
    borderRadius: 17,
    overflow: 'hidden',
    backgroundColor: '#7FD3FF',
    color: '#1B2340',
    fontSize: 17,
    fontWeight: '900',
    textAlign: 'center',
    lineHeight: 34,
    paddingHorizontal: 4,
  },
  focusTitle: { color: colors.text, fontSize: 15, fontWeight: '800', flexShrink: 1 },
  focusChange: { color: '#7FD3FF', fontSize: 13, fontWeight: '900' },
  mainRow: { flexDirection: 'row', justifyContent: 'space-evenly', alignItems: 'flex-end', paddingBottom: space.sm },
});
