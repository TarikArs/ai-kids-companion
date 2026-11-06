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
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FocusPressable as Pressable } from '@/components/focus-pressable';
import { IconButton } from '@/components/icon-button';
import { ScanOverlay } from '@/components/scan-overlay';
import { Body, Button, Screen, Title } from '@/components/ui';
import { exerciseName, loadFocus, requestHelp, sendTyped } from '@/lib/exercise';
import { log, logError } from '@/lib/log';
import {
  base64ToBytes,
  findOpenSession,
  newTurn,
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
import { TUTOR_NAME } from '@/lib/tutor';
import { useUnpair } from '@/lib/use-unpair';

// Photos are taken ONLY when Lina presses « Silia, regarde » (here or on the Board). 1536 px: pencil digits stay readable.
const MAX_SIDE = 1536;
/** The dashed page guide on screen: only what is inside it is sent (side margins in px, top/bottom in screen fractions). */
const GUIDE = { side: 24, top: 0.16, bottom: 0.28 };
/** Kept around the guide when cropping (fraction of the cropped size): a page edge just outside the line is not cut. */
const CROP_MARGIN = 0.04;

type Box = { x: number; y: number; w: number; h: number };

/**
 * The guide's area in photo pixels. The preview fills the screen like "cover" (scaled up, centred, edges cut), so the
 * guide is mapped back through the same scale and offset. null = unknown screen size or the photo is not in the
 * screen's orientation: the whole photo is sent rather than a wrong crop.
 */
function guideCrop(photoW: number, photoH: number, screenW: number, screenH: number): Box | null {
  if (!screenW || !screenH || photoW > photoH !== screenW > screenH) return null;
  const scale = Math.max(screenW / photoW, screenH / photoH);
  const offX = (photoW * scale - screenW) / 2;
  const offY = (photoH * scale - screenH) / 2;
  const left = GUIDE.side;
  const right = screenW - GUIDE.side;
  const top = screenH * GUIDE.top;
  const bottom = screenH * (1 - GUIDE.bottom);
  const mx = (right - left) * CROP_MARGIN;
  const my = (bottom - top) * CROP_MARGIN;
  const x0 = Math.max(0, Math.round((left - mx + offX) / scale));
  const y0 = Math.max(0, Math.round((top - my + offY) / scale));
  const x1 = Math.min(photoW, Math.round((right + mx + offX) / scale));
  const y1 = Math.min(photoH, Math.round((bottom + my + offY) / scale));
  return x1 - x0 > 100 && y1 - y0 > 100 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}
// A 1536 px JPEG of a real page is usually 150-450 KB. Black, empty or very blurry photos compress far smaller.
const MIN_PHOTO_BYTES = 40_000;
// Long enough to read a whole passage aloud.
const MAX_TALK_MS = 90_000;

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

/** Rejects after `ms`: a stuck step must never freeze the screen. */
function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${what}: trop long (${ms / 1000} s)`)), ms))]);
}

/** Recording as base64. Native: Expo's File API (fetch of a local file can return an empty blob on Android). */
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
  const setDevice = useAppStore((s) => s.setDevice);
  const setRole = useAppStore((s) => s.setRole);
  const unpair = useUnpair();
  /** Parent's phone in Camera mode: "back to parent" instead of unlinking. */
  const backToParent = () => {
    setDevice(null);
    setRole('parent');
    router.replace('/parent');
  };
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  /** Each photo gets a number: « Reprendre la photo » or a newer photo makes the older result irrelevant. */
  const captureIdRef = useRef(0);
  const captureRef = useRef<((requestId?: string) => void) | null>(null);
  const recorder = useAudioRecorder(TALK_OPTIONS);
  const recState = useAudioRecorderState(recorder, 250);

  const [ready, setReady] = useState(false);
  /** Screen size of the camera view: maps the page guide onto the photo. */
  const screenRef = useRef({ w: 0, h: 0 });
  const [session, setSession] = useState<HomeworkSession | null>(null);
  /** The photo just taken, frozen on screen with the scan while Silia reads it. */
  const [looking, setLooking] = useState<string | null>(null);
  const [taking, setTaking] = useState(false);
  const [talk, setTalk] = useState<TalkState>('idle');
  const [status, setStatus] = useState('');
  const [details, setDetails] = useState('');
  const [showDetails, setShowDetails] = useState(false);
  const [choices, setChoices] = useState<ExerciseChoice[]>([]);
  /** Typed answer ("8"): the field is open, and what she typed. */
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState('');
  const [sending, setSending] = useState(false);
  /** Active exercise (synced with the Board: voice, taps on either screen). */
  const [focus, setFocus] = useState<ExerciseFocus | null>(null);

  // Resume an open session after a restart.
  useEffect(() => {
    if (!device) return;
    findOpenSession(device.householdId)
      .then(setSession)
      .catch((e) => setStatus(e.message));
  }, [device]);

  // Join the session channel while a session is open. Silia's words are on the Board; here only the state.
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
      onEvent(ch, 'capture.request', (p) => captureRef.current?.(p.request_id));
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

  // ---------- « Silia, regarde »: the only way a photo is taken ----------
  const capture = useCallback(
    async (requestId?: string) => {
      // « Silia, regarde » on the Board: tell it whether this phone takes the photo (else it reads its own photo after 2 s).
      const failed = (reason: string) => {
        if (requestId && channelRef.current) sendEvent(channelRef.current, 'capture.failed', { request_id: requestId, reason });
      };
      if (!device || !session || !cameraRef.current || talk !== 'idle') return failed('busy');
      if (requestId && channelRef.current) sendEvent(channelRef.current, 'capture.ack', { request_id: requestId });
      const myId = ++captureIdRef.current;
      const turn = newTurn();
      setTaking(true);
      setChoices([]);
      const t0 = Date.now();
      try {
        const photo = await withTimeout(cameraRef.current.takePictureAsync({ quality: 0.8, shutterSound: false }), 10_000, 'Photo');
        // Upright size first, then keep only the page guide's area, then resize.
        const base = await ImageManipulator.manipulate(photo.uri).renderAsync();
        const context = ImageManipulator.manipulate(base);
        const crop = guideCrop(base.width, base.height, screenRef.current.w, screenRef.current.h);
        if (crop) context.crop({ originX: crop.x, originY: crop.y, width: crop.w, height: crop.h });
        else log('camera', 'photo: full image (guide area unknown)');
        const outW = crop?.w ?? base.width;
        const outH = crop?.h ?? base.height;
        if (Math.max(outW, outH) > MAX_SIDE) {
          context.resize(outW >= outH ? { width: MAX_SIDE, height: null } : { width: null, height: MAX_SIDE });
        }
        const saved = await (await context.renderAsync()).saveAsync({ format: SaveFormat.JPEG, compress: 0.8, base64: true });
        if (!saved.base64) throw new Error('Image conversion failed');
        const bytes = Math.round(saved.base64.length * 0.75);
        log('camera', `photo: ${Math.round(bytes / 1000)} KB, ${saved.width}x${saved.height}, ${Date.now() - t0} ms`);
        if (bytes < MIN_PHOTO_BYTES) {
          failed('dark');
          setStatus('Je ne vois pas bien le cahier. Vise la page, avec de la lumière.');
          setDetails(`Photo trop sombre ou floue (${Math.round(bytes / 1000)} Ko), pas envoyée.`);
          return;
        }
        if (myId !== captureIdRef.current) return;
        setLooking(saved.uri);

        const path = `${device.householdId}/${session.id}/${Date.now()}.jpg`;
        const { data: snap, error: rowErr } = await supabase
          .from('snapshots')
          .insert({ household_id: device.householdId, session_id: session.id, storage_path: path, width: saved.width, height: saved.height })
          .select('id')
          .single();
        if (rowErr) throw rowErr;
        // In parallel: upload the file for the Board, and send the same image to the AI.
        const upload = supabase.storage
          .from('snapshots')
          .upload(path, base64ToBytes(saved.base64), { contentType: 'image/jpeg' })
          .then(({ error }) => {
            if (error) throw error;
            if (channelRef.current) sendEvent(channelRef.current, 'snapshot.new', { snapshot_id: snap.id, storage_path: path });
          });
        const analyze = supabase.functions.invoke('analyze-snapshot', { body: { snapshot_id: snap.id, image_b64: saved.base64, turn } });
        const [, { data, error: fnErr }] = await withTimeout(Promise.all([upload, analyze]), 60_000, 'Analyse');
        if (myId !== captureIdRef.current) return; // « Reprendre la photo », or a newer photo took over
        if (fnErr) throw new Error(await functionError(fnErr));
        log('camera', `photo: answered in ${Date.now() - t0} ms`, data);
        setDetails(`${Math.round(bytes / 1000)} Ko · ${((Date.now() - t0) / 1000).toFixed(1)} s · lecture ${((data?.timings?.vision_ms ?? 0) / 1000).toFixed(1)} s · ${data?.done ?? ''}`);
        if (data?.ask) setChoices(data.choices ?? []);
      } catch (e) {
        logError('camera', 'photo failed', e);
        failed((e as Error).message);
        setStatus('Oups, la photo n’est pas passée. Réessaie.');
        setDetails(`Erreur photo : ${(e as Error).message}`);
      } finally {
        if (myId === captureIdRef.current) {
          setTaking(false);
          setLooking(null);
        }
      }
    },
    [device, session, talk],
  );

  useEffect(() => {
    captureRef.current = (requestId) => void capture(requestId);
  }, [capture]);

  /** Back to the live camera: the answer for the old photo is ignored here. */
  function retake() {
    captureIdRef.current++;
    setTaking(false);
    setLooking(null);
  }

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
      log('camera', `talk: stopped, ${audioInfo}`);
      const { data, error } = await supabase.functions.invoke('child-talk', { body: { session_id: session.id, audio_b64: b64, mime, turn: newTurn() } });
      if (error) throw new Error(await functionError(error));
      if (data?.mode === 'empty') setStatus('Je n’ai rien entendu. Réessaie plus près du téléphone.');
      setDetails(
        [
          audioInfo,
          data?.transcript ? `Entendu : « ${data.transcript} »` : '',
          data?.intent ? `Compris : ${data.intent.act}${data.intent.ex != null ? ` exercice ${data.intent.ex}` : ''} → ${data.done ?? ''}` : '',
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
    }
  }, [recorder, session]);

  async function startTalk() {
    if (!session || talk !== 'idle') return;
    const perm = await AudioModule.requestRecordingPermissionsAsync();
    if (!perm.granted) {
      setStatus(`Autorise le micro pour parler à ${TUTOR_NAME}.`);
      return;
    }
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setTalk('recording');
      setTyping(false);
      setChoices([]);
      if (channelRef.current) sendEvent(channelRef.current, 'child.talk.start', {});
    } catch (e) {
      setTalk('idle');
      setDetails(`Erreur micro : ${(e as Error).message}`);
    }
  }

  // Safety stop after 90 s.
  useEffect(() => {
    if (talk === 'recording' && recState.durationMillis >= MAX_TALK_MS) stopTalk();
  }, [talk, recState.durationMillis, stopTalk]);

  // ---------- typed answer ----------
  async function sendAnswer() {
    const text = typed.trim();
    if (!session || !text) return;
    setSending(true);
    const { error } = await sendTyped(session.id, text);
    setSending(false);
    if (error) {
      setDetails(`Erreur réponse écrite : ${error}`);
      return;
    }
    setTyped('');
    setTyping(false);
  }

  /** Tap on an exercise (several on the page), or « Changer » on the active one. */
  async function choose(choice?: ExerciseChoice) {
    if (!session) return;
    setChoices([]);
    const { data, error } = await requestHelp(session.id, choice ? { choice } : { action: 'choose' });
    if (error) {
      setDetails(`Erreur exercice : ${error}`);
      return;
    }
    if (data?.ask) setChoices(data.choices ?? []);
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
      if (next === 'finished') {
        // Like a teacher: a short recap for her and a report for the parent, BEFORE the session closes
        // (the Board is still listening to this session).
        setStatus(`${TUTOR_NAME} fait le bilan…`);
        try {
          const { data } = await withTimeout(supabase.functions.invoke('session-summary', { body: { session_id: session.id, turn: newTurn() } }), 25_000, 'Bilan');
          log('camera', 'summary', data);
        } catch (e) {
          logError('camera', 'summary failed (session closed anyway)', e);
        }
      }
      await setSessionStatus(session.id, next);
      if (channelRef.current) sendEvent(channelRef.current, 'session.state', { status: next });
      setSession(next === 'finished' ? null : { ...session, status: next });
      setStatus(next === 'finished' ? 'Bravo, devoirs terminés !' : next === 'paused' ? 'Pause' : 'C’est reparti !');
    } catch (e) {
      setDetails((e as Error).message);
    }
  }

  if (!device) return null;
  if (!permission) {
    return (
      <Screen center>
        <Body>Caméra…</Body>
      </Screen>
    );
  }
  if (!permission.granted) {
    return (
      <Screen center>
        <Title>Caméra</Title>
        <Body muted>La caméra photographie le cahier quand tu appuies sur « {TUTOR_NAME}, regarde ». Elle ne filme pas l’enfant.</Body>
        <Button label="Autoriser la caméra" onPress={requestPermission} />
      </Screen>
    );
  }

  const paused = session?.status === 'paused';
  const idle = talk === 'idle' && !taking;
  const chip = !session
    ? 'Prêt'
    : paused
      ? 'En pause'
      : talk === 'recording'
        ? `Je t’écoute · ${Math.floor(recState.durationMillis / 1000)} s`
        : looking
          ? 'Photo envoyée'
          : `${TUTOR_NAME} t’attend`;
  const dot = !session ? colors.muted : paused || looking ? colors.accent : talk === 'recording' ? '#E5484D' : colors.success;

  return (
    <View
      style={styles.root}
      onLayout={(e) => {
        screenRef.current = { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height };
      }}
    >
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" animateShutter={false} onCameraReady={() => setReady(true)} />
      {/* Guide: the whole page must be inside. */}
      {session && !looking ? <View style={styles.guide} pointerEvents="none" /> : null}
      {looking ? (
        <View style={styles.frozen}>
          <View style={styles.frozenPhoto}>
            <Image source={{ uri: looking }} style={StyleSheet.absoluteFill} resizeMode="contain" />
            <ScanOverlay color={colors.accent} corners={false} />
          </View>
        </View>
      ) : null}

      <SafeAreaView style={styles.overlay} pointerEvents="box-none">
        <View style={styles.topBar}>
          <View style={styles.chip}>
            <View style={[styles.dot, { backgroundColor: dot }]} />
            <Text style={styles.chipText}>{chip}</Text>
          </View>
          <View style={styles.topActions}>
            {status || details ? <IconButton icon="info" label="Détails" size={44} onPress={() => setShowDetails((v) => !v)} /> : null}
            {session ? (
              <>
                <IconButton icon={paused ? 'play' : 'pause'} label={paused ? 'Reprendre' : 'Pause'} size={44} onPress={() => changeStatus(paused ? 'active' : 'paused')} />
                <IconButton icon="flag" label="Terminer les devoirs" size={44} onPress={() => changeStatus('finished')} />
              </>
            ) : device.viaParent ? null : (
              <IconButton icon="unlink" label="Délier cet appareil" caption="Délier" size={44} onPress={unpair} />
            )}
            {device.viaParent ? <IconButton icon="home" label="Retour à l’espace parent" caption="Parent" size={44} onPress={backToParent} /> : null}
          </View>
        </View>

        <View style={styles.bottom}>
          {showDetails && (status || details) ? <Text style={styles.details}>{[status, details].filter(Boolean).join('\n')}</Text> : null}

          {looking ? (
            // One clear state, no text from Silia here: her answer is on the TV.
            <View style={styles.lookingBox}>
              <Text style={styles.lookingTitle}>{TUTOR_NAME} regarde…</Text>
              <Text style={styles.lookingHint}>Regarde la télé, elle te répond.</Text>
              <Pressable accessibilityRole="button" onPress={retake} style={styles.retake}>
                <Text style={styles.retakeText}>Reprendre la photo</Text>
              </Pressable>
            </View>
          ) : (
            <>
              {focus && !choices.length && session ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Exercice en cours : ${exerciseName(focus)}, ${focus.title}. Toucher pour changer d’exercice.`}
                  onPress={() => choose()}
                  disabled={!idle}
                  style={({ pressed }) => [styles.focusChip, pressed && { opacity: 0.8 }]}
                >
                  <Text style={styles.focusNumber}>{exerciseName(focus)}</Text>
                  <Text style={styles.focusTitle} numberOfLines={1}>
                    {focus.title}
                  </Text>
                </Pressable>
              ) : null}
              {choices.length ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choices}>
                  {choices.map((c) => (
                    <Pressable
                      key={c.index}
                      accessibilityRole="button"
                      accessibilityLabel={`Exercice ${exerciseName(c)} : ${c.title}`}
                      onPress={() => choose(c)}
                      style={({ pressed }) => [styles.choice, pressed && { opacity: 0.8 }]}
                    >
                      <Text style={styles.choiceNumber}>{exerciseName(c)}</Text>
                      <Text style={styles.focusTitle} numberOfLines={1}>
                        {c.title}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              ) : null}
              {session && typing ? (
                <View style={styles.typeRow}>
                  <TextInput
                    value={typed}
                    onChangeText={setTyped}
                    placeholder="Ta réponse…"
                    placeholderTextColor={colors.muted}
                    autoFocus
                    returnKeyType="send"
                    onSubmitEditing={sendAnswer}
                    style={styles.typeInput}
                    maxLength={200}
                  />
                  <IconButton icon="send" label="Envoyer ma réponse" size={48} tone="accent" onPress={sendAnswer} loading={sending} disabled={!typed.trim()} />
                </View>
              ) : null}

              {!session ? (
                <View style={styles.mainRow}>
                  <IconButton icon="play" label="Commencer les devoirs" caption="Commencer" size={88} tone="accent" onPress={begin} />
                </View>
              ) : (
                <View style={styles.mainRow}>
                  <IconButton
                    icon={talk === 'recording' ? 'stop' : 'mic'}
                    label={talk === 'recording' ? 'J’ai fini de parler' : `Parler à ${TUTOR_NAME}`}
                    caption={talk === 'recording' ? 'Stop' : 'Parler'}
                    size={68}
                    tone={talk === 'recording' ? 'danger' : 'dark'}
                    onPress={talk === 'recording' ? stopTalk : startTalk}
                    loading={talk === 'thinking'}
                    disabled={taking || paused}
                  />
                  <IconButton
                    icon="eye"
                    label={`${TUTOR_NAME}, regarde`}
                    caption={`${TUTOR_NAME}, regarde`}
                    size={112}
                    tone="accent"
                    onPress={() => capture()}
                    loading={taking}
                    disabled={!ready || !idle || paused}
                  />
                  <IconButton
                    icon="keyboard"
                    label="Écrire ma réponse"
                    caption="Écrire"
                    size={68}
                    tone="dark"
                    onPress={() => setTyping((v) => !v)}
                    disabled={!idle || paused}
                  />
                </View>
              )}
            </>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  overlay: { flex: 1, justifyContent: 'space-between', padding: space.md },
  guide: {
    position: 'absolute',
    left: GUIDE.side,
    right: GUIDE.side,
    top: `${GUIDE.top * 100}%`,
    bottom: `${GUIDE.bottom * 100}%`,
    borderWidth: 3,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,201,60,0.9)',
    borderRadius: 18,
  },
  frozen: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  frozenPhoto: { width: '84%', height: '56%', marginBottom: '20%', borderRadius: 10, borderWidth: 4, borderColor: colors.accent, overflow: 'hidden' },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm },
  topActions: { flexDirection: 'row', gap: space.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: 'rgba(27,35,64,0.88)',
    paddingHorizontal: space.md,
    height: 44,
    borderRadius: radius.pill,
    flexShrink: 1,
  },
  dot: { width: 12, height: 12, borderRadius: 6 },
  chipText: { color: colors.text, fontWeight: '900', fontSize: 15 },
  bottom: { gap: space.sm },
  details: { color: colors.muted, fontSize: 12, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: radius.md, padding: space.sm, overflow: 'hidden' },
  lookingBox: { alignItems: 'center', gap: space.sm, paddingBottom: space.md },
  lookingTitle: { color: colors.text, fontSize: 22, fontWeight: '900' },
  lookingHint: { color: colors.muted, fontSize: 15 },
  retake: { marginTop: space.md, height: 48, paddingHorizontal: 22, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.12)', justifyContent: 'center' },
  retakeText: { color: colors.text, fontWeight: '800', fontSize: 16 },
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
  focusChip: {
    alignSelf: 'center',
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    height: 40,
    backgroundColor: 'rgba(27,35,64,0.92)',
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: '#7FD3FF',
    paddingLeft: 4,
    paddingRight: 14,
  },
  focusNumber: {
    minWidth: 32,
    height: 32,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#7FD3FF',
    color: '#1B2340',
    fontSize: 16,
    fontWeight: '900',
    textAlign: 'center',
    lineHeight: 32,
    paddingHorizontal: 4,
  },
  focusTitle: { color: colors.text, fontSize: 15, fontWeight: '800', flexShrink: 1 },
  typeRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  typeInput: {
    flex: 1,
    height: 48,
    backgroundColor: 'rgba(27,35,64,0.95)',
    color: colors.text,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    fontSize: 20,
    fontWeight: '800',
  },
  mainRow: { flexDirection: 'row', justifyContent: 'space-evenly', alignItems: 'flex-end', paddingBottom: space.sm },
});
