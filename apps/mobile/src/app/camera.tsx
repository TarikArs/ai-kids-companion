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
import { useStayAwake } from '@/lib/keep-awake';
import { router } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, PanResponder, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FocusPressable as Pressable } from '@/components/focus-pressable';
import { IconButton } from '@/components/icon-button';
import { Chunky, ChunkyButton, NotebookPage, Polaroid, Tape, type Crayon } from '@/components/paper';
import { Icon, type IconName } from '@/components/icons';
import { ScanOverlay } from '@/components/scan-overlay';
import { Avatar } from '@/features/board/avatar';
import { font, hardShadow, paper } from '@/lib/paper-theme';
import { StatusBar } from 'expo-status-bar';
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
  startSession,
  type HomeworkSession,
} from '@/lib/session';
import { useAppStore } from '@/lib/store';
import { functionError, supabase } from '@/lib/supabase';
import { colors, radius, space } from '@/lib/theme';
import { TUTOR_NAME } from '@/lib/tutor';
import { useRevokedWatch } from '@/lib/use-revoked';
import { useUnpair } from '@/lib/use-unpair';
import { applyFamilyLang, t } from '@/lib/i18n';

// Photos are taken ONLY when Lina presses « Silia, regarde » (here or on the Board). 1536 px: pencil digits stay readable.
const MAX_SIDE = 1536;
/** The dashed page guide on screen: only what is inside it is sent (side margins in px, top/bottom in screen fractions). */
const GUIDE = { side: 24, top: 0.13, bottom: 0.37 };

/** The help tiles of the exercise card (Solution only when the parent turned it on). */
const HELP_TILES: { action: 'explain' | 'solve' | 'similar' | 'solution'; label: string; icon: IconName; color: Crayon }[] = [
  { action: 'explain', label: 'Expliquer', icon: 'info', color: 'blue' },
  { action: 'solve', label: 'Ensemble', icon: 'play', color: 'white' },
  { action: 'similar', label: 'Similaire', icon: 'copy', color: 'pink' },
  { action: 'solution', label: 'Solution', icon: 'key', color: 'green' },
];
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
  useStayAwake();
  const device = useAppStore((s) => s.device);
  const setDevice = useAppStore((s) => s.setDevice);
  const setRole = useAppStore((s) => s.setRole);
  const unpair = useUnpair();
  // Removed by the parent: back to the first screen within a few seconds.
  useRevokedWatch();
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
  /** Camera zoom, 0 (none) to 1 (max). The photo is taken with the same zoom as the preview, so the guide still fits. */
  const [zoom, setZoom] = useState(0);
  const zoomRef = useRef(0);
  zoomRef.current = zoom;
  const pinchRef = useRef<{ dist: number; zoom: number } | null>(null);
  const setZoomSafe = (z: number) => setZoom(Math.round(Math.min(1, Math.max(0, z)) * 100) / 100);
  /** Two fingers apart = zoom in, together = zoom out. */
  const pinch = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: (e) => e.nativeEvent.touches.length === 2,
      onMoveShouldSetPanResponder: (e) => e.nativeEvent.touches.length === 2,
      onPanResponderMove: (e) => {
        const t = e.nativeEvent.touches;
        if (t.length !== 2) return;
        const dist = Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY);
        if (!pinchRef.current) pinchRef.current = { dist, zoom: zoomRef.current };
        setZoomSafe(pinchRef.current.zoom + (dist / pinchRef.current.dist - 1) * 0.4);
      },
      onPanResponderRelease: () => (pinchRef.current = null),
      onPanResponderTerminate: () => (pinchRef.current = null),
    }),
  ).current;
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

  // The Camera is always upright: preview, dashed guide and photo stay in the same orientation.
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => undefined);
    return () => {
      ScreenOrientation.unlockAsync().catch(() => undefined);
    };
  }, []);

  /** « Un seul téléphone » (parent setting): after each photo, this phone turns into the Board. */
  const soloRef = useRef(false);
  /** Parent setting « Solution »: the Solution tile on the exercise card. */
  const [solutionOn, setSolutionOn] = useState(false);
  useEffect(() => {
    if (!device) return;
    supabase
      .from('households')
      .select('solo_mode, app_lang, solution_enabled')
      .eq('id', device.householdId)
      .maybeSingle()
      .then(({ data }) => {
        soloRef.current = (data as { solo_mode?: boolean } | null)?.solo_mode === true;
        setSolutionOn((data as { solution_enabled?: boolean } | null)?.solution_enabled === true);
        applyFamilyLang((data as { app_lang?: string } | null)?.app_lang);
      });
  }, [device]);

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
        let base = await ImageManipulator.manipulate(photo.uri).renderAsync();
        // A phone held flat over the notebook often saves the photo sideways (no orientation in the file), while the
        // screen shows it upright: turn it a quarter so it matches what Lina saw, then the guide's crop is right.
        const screen = screenRef.current;
        if (screen.h > screen.w && base.width > base.height) {
          base = await ImageManipulator.manipulate(base).rotate(90).renderAsync();
          log('camera', 'photo: saved sideways, turned to match the screen');
        }
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
          setStatus(t('Je ne vois pas bien le cahier. Vise la page, avec de la lumière.'));
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
        if (soloRef.current) {
          // One phone: it becomes the Board now (the photo and the answer are shown there); the requests go on.
          Promise.all([upload, analyze]).catch((e) => logError('camera', 'solo photo failed', e));
          router.replace({ pathname: '/board', params: { solo: '1', photo: snap.id } });
          return;
        }
        const [, { data, error: fnErr }] = await withTimeout(Promise.all([upload, analyze]), 60_000, 'Analyse');
        if (myId !== captureIdRef.current) return; // « Reprendre la photo », or a newer photo took over
        if (fnErr) throw new Error(await functionError(fnErr));
        log('camera', `photo: answered in ${Date.now() - t0} ms`, data);
        setDetails(`${Math.round(bytes / 1000)} Ko · ${((Date.now() - t0) / 1000).toFixed(1)} s · lecture ${((data?.timings?.vision_ms ?? 0) / 1000).toFixed(1)} s · ${data?.done ?? ''}`);
        if (data?.ask) setChoices(data.choices ?? []);
      } catch (e) {
        logError('camera', 'photo failed', e);
        failed((e as Error).message);
        setStatus(t('Oups, la photo n’est pas passée. Réessaie.'));
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
      if (data?.mode === 'empty') setStatus(t('Je n’ai rien entendu. Réessaie plus près du téléphone.'));
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
      setStatus(t('Je n’ai pas bien entendu. Réessaie.'));
      setDetails(`Erreur micro : ${(e as Error).message}`);
    } finally {
      setTalk('idle');
    }
  }, [recorder, session]);

  async function startTalk() {
    if (!session || talk !== 'idle') return;
    const perm = await AudioModule.requestRecordingPermissionsAsync();
    if (!perm.granted) {
      setStatus(t('Autorise le micro pour parler à {name}.', { name: TUTOR_NAME }));
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
  /** Expliquer / Résoudre ensemble / Exercice similaire / Solution on the active exercise: Silia answers on the Board. */
  async function askHelp(action: 'explain' | 'solve' | 'similar' | 'solution') {
    if (!session) return;
    setChoices([]);
    const { data, error } = await requestHelp(session.id, { action });
    if (error) {
      setDetails(`Erreur exercice : ${error}`);
      return;
    }
    if (data?.ask) setChoices(data.choices ?? []);
  }

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
      setStatus(t('C’est parti !'));
    } catch (e) {
      setDetails((e as Error).message);
    }
  }

  if (!device) return null;
  if (!permission) {
    return (
      <Screen center>
        <Body>{t('Caméra…')}</Body>
      </Screen>
    );
  }
  if (!permission.granted) {
    return (
      <Screen center>
        <Title>{t('Caméra')}</Title>
        <Body muted>{t('La caméra photographie le cahier quand tu appuies sur « {name}, regarde ». Elle ne filme pas l’enfant.', { name: TUTOR_NAME })}</Body>
        <Button label={t('Autoriser la caméra')} onPress={requestPermission} />
      </Screen>
    );
  }

  const paused = session?.status === 'paused';
  const idle = talk === 'idle' && !taking;
  const chip = !session
    ? t('Prêt')
    : paused
      ? t('En pause')
      : talk === 'recording'
        ? t('Je t’écoute · {s} s', { s: Math.floor(recState.durationMillis / 1000) })
        : looking
          ? t('Photo envoyée')
          : t('{name} t’attend', { name: TUTOR_NAME });
  const dot = !session ? paper.inkFaint : paused || looking ? paper.yellow : talk === 'recording' ? paper.red : paper.green;

  return (
    <View
      style={styles.root}
      onLayout={(e) => {
        screenRef.current = { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height };
      }}
    >
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" zoom={zoom} animateShutter={false} onCameraReady={() => setReady(true)} />
      <View style={StyleSheet.absoluteFill} {...pinch.panHandlers} />
      {/* Guide: the whole page must be inside. */}
      {session && !looking ? <View style={styles.guide} pointerEvents="none" /> : null}
      <StatusBar style={looking ? 'dark' : 'light'} />
      {looking ? (
        <NotebookPage style={styles.frozen} top={40}>
          <View style={styles.frozenPhoto}>
            <Tape style={{ top: -12, zIndex: 2 }} />
            <Image source={{ uri: looking }} style={StyleSheet.absoluteFill} resizeMode="contain" />
            <ScanOverlay color={paper.yellow} corners={false} />
          </View>
        </NotebookPage>
      ) : null}

      {session && !looking ? (
        <View style={styles.zoomStick}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('Zoom avant')} onPress={() => setZoomSafe(zoom + 0.05)} disabled={zoom >= 1} style={[styles.zoomBtn, zoom >= 1 && { opacity: 0.4 }]}>
            <Text style={styles.zoomText}>+</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={t('Sans zoom')} onPress={() => setZoomSafe(0)} style={styles.zoomLevel}>
            <Text style={styles.zoomLevelText}>{`${Math.round(zoom * 100)} %`}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={t('Zoom arrière')} onPress={() => setZoomSafe(zoom - 0.05)} disabled={zoom <= 0} style={[styles.zoomBtn, zoom <= 0 && { opacity: 0.4 }]}>
            <Text style={styles.zoomText}>−</Text>
          </Pressable>
        </View>
      ) : null}
      <SafeAreaView style={styles.overlay} pointerEvents="box-none">
        <View style={styles.topBar}>
          {/* the state, as a dot (green = Silia waits, yellow = photo sent / paused, red = recording) */}
          <View accessible accessibilityRole="image" accessibilityLabel={chip} style={[styles.stateDot, { backgroundColor: dot }]} />
          <View style={styles.topActions}>
            {status || details ? <IconButton icon="info" label={t('Détails')} size={44} onPress={() => setShowDetails((v) => !v)} /> : null}
            {session || device.viaParent ? null : (
              <IconButton icon="unlink" label={t('Délier cet appareil')} caption={t('Délier')} size={44} onPress={unpair} />
            )}
            {device.viaParent ? <IconButton icon="home" label={t('Retour à l’espace parent')} size={44} onPress={backToParent} /> : null}
          </View>
        </View>

        <View style={styles.bottom}>
          {showDetails && (status || details) ? <Text style={styles.details}>{[status, details].filter(Boolean).join('\n')}</Text> : null}

          {looking ? (
            // One clear state, no text from Silia here: her answer is on the TV.
            <View style={styles.lookingBox}>
              <View style={styles.lookingRow}>
                <Polaroid caption={TUTOR_NAME} width={96} tilt={4}>
                  <Avatar mood="thinking" />
                </Polaroid>
                <View style={styles.lookingTexts}>
                  <Text style={styles.lookingTitle}>{t('{name} regarde…', { name: TUTOR_NAME })}</Text>
                  <Text style={styles.lookingHint}>{t('Regarde la télé, elle te répond.')}</Text>
                </View>
              </View>
              <ChunkyButton label={t('Reprendre la photo')} onPress={retake} color="white" size="md" icon="camera" />
            </View>
          ) : (
            <>
              {focus && !choices.length && session ? (
                // The exercise in progress and what she can ask about it: the phone is the Board's remote control.
                <NotebookPage style={styles.exCard} top={6}>
                  <View style={styles.exHead}>
                    <Text style={styles.focusNumber}>{exerciseName(focus)}</Text>
                    <Text style={styles.focusTitle} numberOfLines={1}>
                      {focus.title}
                    </Text>
                    <ChunkyButton label={t('Autre')} icon="refresh" color="white" size="sm" onPress={() => choose()} disabled={!idle} />
                  </View>
                  <View style={styles.exTiles}>
                    {HELP_TILES.filter((h) => h.action !== 'solution' || solutionOn).map(({ action, label, icon, color }) => (
                      <Chunky
                        key={action}
                        accessibilityLabel={t(label)}
                        onPress={() => askHelp(action)}
                        color={color}
                        disabled={!idle || paused}
                        radius={12}
                        depth={3}
                        style={styles.exTile}
                      >
                        <Icon name={icon} size={22} color={paper.ink} />
                        <Text style={styles.exTileText} numberOfLines={1}>
                          {t(label)}
                        </Text>
                      </Chunky>
                    ))}
                  </View>
                </NotebookPage>
              ) : null}
              {choices.length ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choices}>
                  {choices.map((c) => (
                    <Pressable
                      key={c.index}
                      accessibilityRole="button"
                      accessibilityLabel={t('Exercice {ex} : {title}', { ex: exerciseName(c), title: c.title })}
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
                    placeholder={t('Ta réponse…')}
                    placeholderTextColor={paper.inkFaint}
                    autoFocus
                    returnKeyType="send"
                    onSubmitEditing={sendAnswer}
                    style={styles.typeInput}
                    maxLength={200}
                  />
                  <IconButton icon="send" label={t('Envoyer ma réponse')} size={48} tone="accent" onPress={sendAnswer} loading={sending} disabled={!typed.trim()} />
                </View>
              ) : null}

              {!session ? (
                <View style={styles.mainRow}>
                  <IconButton icon="play" label={t('Commencer les devoirs')} caption={t('Commencer')} size={88} tone="accent" onPress={begin} />
                </View>
              ) : (
                <View style={styles.mainRow}>
                  <IconButton
                    icon={talk === 'recording' ? 'stop' : 'mic'}
                    label={talk === 'recording' ? t('J’ai fini de parler') : t('Parler à {name}', { name: TUTOR_NAME })}
                    caption={t(talk === 'recording' ? 'Stop' : 'Parler')}
                    size={68}
                    tone={talk === 'recording' ? 'danger' : 'dark'}
                    onPress={talk === 'recording' ? stopTalk : startTalk}
                    loading={talk === 'thinking'}
                    disabled={taking || paused}
                  />
                  <IconButton
                    icon="eye"
                    label={t('{name}, regarde', { name: TUTOR_NAME })}
                    caption={t('{name}, regarde', { name: TUTOR_NAME })}
                    size={92}
                    tone="accent"
                    onPress={() => capture()}
                    loading={taking}
                    disabled={!ready || !idle || paused}
                  />
                  <IconButton
                    icon="keyboard"
                    label={t('Écrire ma réponse')}
                    caption={t('Écrire')}
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
    borderColor: paper.yellow,
    borderRadius: 10,
  },
  frozen: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  frozenPhoto: { width: '78%', height: '50%', marginBottom: '28%', backgroundColor: paper.card, padding: 10, paddingBottom: 34, borderWidth: 2, borderColor: paper.ink, borderRadius: 4, transform: [{ rotate: '-2deg' }], ...hardShadow(5) },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm },
  topActions: { flexDirection: 'row', gap: space.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: paper.stickyYellow,
    paddingHorizontal: 14,
    height: 44,
    borderWidth: 2,
    borderColor: paper.ink,
    borderRadius: 3,
    borderBottomRightRadius: 12,
    flexShrink: 1,
    transform: [{ rotate: '-1.5deg' }],
    ...hardShadow(3),
  },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 1.5, borderColor: paper.ink },
  chipText: { ...font.semi, color: paper.ink, fontSize: 16 },
  bottom: { gap: space.sm },
  details: { ...font.regular, color: paper.ink, fontSize: 12, backgroundColor: paper.page, borderWidth: 1.5, borderColor: paper.ink, borderRadius: 8, padding: space.sm, overflow: 'hidden' },
  lookingRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  lookingTexts: { flex: 1, gap: 4 },
  lookingBox: { gap: space.md, paddingBottom: space.md, paddingHorizontal: space.sm },
  lookingTitle: { ...font.bold, color: paper.ink, fontSize: 26 },
  lookingHint: { ...font.medium, color: paper.inkSoft, fontSize: 17, lineHeight: 23 },
  retake: { alignSelf: 'center' },
  retakeText: { ...font.semi, color: paper.ink },
  choices: { gap: space.sm, paddingHorizontal: 2 },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    maxWidth: 240,
    height: 50,
    backgroundColor: paper.card,
    borderWidth: 2,
    borderColor: paper.ink,
    borderRadius: 10,
    paddingLeft: 6,
    paddingRight: space.md,
    ...hardShadow(3),
  },
  choiceNumber: {
    ...font.bold,
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: paper.yellow,
    borderWidth: 2,
    borderColor: paper.ink,
    color: paper.ink,
    fontSize: 18,
    textAlign: 'center',
    lineHeight: 32,
  },
  focusChip: {
    alignSelf: 'center',
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    height: 44,
    backgroundColor: paper.stickyBlue,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: paper.ink,
    paddingLeft: 4,
    paddingRight: 14,
    ...hardShadow(3),
  },
  focusNumber: {
    ...font.bold,
    minWidth: 32,
    height: 32,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: paper.blue,
    borderWidth: 2,
    borderColor: paper.ink,
    color: paper.ink,
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 28,
    paddingHorizontal: 4,
  },
  focusTitle: { ...font.semi, color: paper.ink, fontSize: 16, flexShrink: 1 },
  typeRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  typeInput: {
    ...font.semi,
    flex: 1,
    height: 52,
    backgroundColor: paper.card,
    color: paper.ink,
    borderWidth: 2.5,
    borderColor: paper.ink,
    borderRadius: 12,
    paddingHorizontal: space.md,
    fontSize: 21,
    ...hardShadow(3),
  },
  stateDot: { width: 22, height: 22, borderRadius: 11, borderWidth: 2.5, borderColor: paper.ink, ...hardShadow(2) },
  zoomStick: { position: 'absolute', right: 10, top: '30%', alignItems: 'center', gap: 8, zIndex: 2 },
  exCard: { borderWidth: 2, borderColor: paper.ink, borderRadius: 14, padding: 10, gap: 10, overflow: 'hidden', ...hardShadow(4) },
  exHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  exTiles: { flexDirection: 'row', gap: 8 },
  exTile: { flex: 1, height: 64, gap: 3, paddingHorizontal: 2 },
  exTileText: { ...font.semi, color: paper.ink, fontSize: 12 },
  zoomRow: { flexDirection: 'row', alignSelf: 'center', alignItems: 'center', gap: space.sm },
  zoomBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: paper.card, borderWidth: 2.5, borderColor: paper.ink, alignItems: 'center', justifyContent: 'center', ...hardShadow(3) },
  zoomText: { ...font.bold, color: paper.ink, fontSize: 26, lineHeight: 30 },
  zoomLevel: { height: 36, paddingHorizontal: space.md, borderRadius: 8, backgroundColor: paper.stickyYellow, borderWidth: 2, borderColor: paper.ink, justifyContent: 'center', ...hardShadow(2) },
  zoomLevelText: { ...font.semi, color: paper.ink, fontSize: 14 },
  mainRow: { flexDirection: 'row', justifyContent: 'space-evenly', alignItems: 'flex-end', paddingBottom: space.sm },
});
