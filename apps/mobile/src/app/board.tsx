import type { Annotation, ExerciseChoice, ExerciseFocus, HelpAction } from '@hc/shared';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { useKeepAwake } from 'expo-keep-awake';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui';
import { AnnotatedPhoto } from '@/features/board/annotated-photo';
import { Avatar, type AvatarMood, type AvatarReaction } from '@/features/board/avatar';
import { findOpenSession, onEvent, sendEvent, sessionChannel, type HomeworkSession } from '@/lib/session';
import { useAppStore } from '@/lib/store';
import { functionError, supabase } from '@/lib/supabase';
import { colors, radius, space } from '@/lib/theme';
import { useUnpair } from '@/lib/use-unpair';
import { log } from '@/lib/log';
import { ACTION_LABEL, exerciseName, loadFocus, requestHelp } from '@/lib/exercise';
import { TUTOR_NAME } from '@/lib/tutor';
import { loadPhrases, pickPhrase } from '@/lib/phrases';
import { playVoice, stopVoice } from '@/lib/voice';

interface Photo {
  id: string;
  uri: string;
  width: number;
  height: number;
  rotation: number;
}

const GREETING = `Bonjour ! Je suis ${TUTOR_NAME}. Montre-moi ton cahier.`;

export default function Board() {
  useKeepAwake();
  const device = useAppStore((s) => s.device);
  const muted = useAppStore((s) => s.muted);
  const setMuted = useAppStore((s) => s.setMuted);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const unpair = useUnpair();
  const { width, height } = useWindowDimensions();
  const landscape = width >= height;

  const [started, setStarted] = useState(false);
  const [session, setSession] = useState<HomeworkSession | null>(null);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [bubble, setBubble] = useState(GREETING);
  const [mood, setMood] = useState<AvatarMood>('idle');
  const [link, setLink] = useState('connexion…');
  const [bubbleLang, setBubbleLang] = useState('fr');
  const [explaining, setExplaining] = useState(false);
  const [reaction, setReaction] = useState<AvatarReaction | null>(null);
  const [choices, setChoices] = useState<ExerciseChoice[]>([]);
  /** Active exercise: stays until the child names or taps another one (synced with the Camera). */
  const [focus, setFocus] = useState<ExerciseFocus | null>(null);

  const startedRef = useRef(false);
  const lastTextRef = useRef(GREETING);
  const lastVoiceRef = useRef<{ language: string; audioUrl?: string; phrase?: string }>({ language: 'fr' });
  const speakingRef = useRef(false);
  const listeningRef = useRef(false);
  /** Language chosen by the parent (null = auto: follow the exercise). */
  const forcedLangRef = useRef<string | null>(null);
  const photoIdRef = useRef<string | null>(null);
  /** Pending Corriger request to the Camera, with its 2 s fallback timer. */
  const correctRef = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const checkBoardPhotoRef = useRef<(why: string) => void>(() => undefined);

  // Safety net: never stay "thinking" forever (lost reply, server error, network cut).
  useEffect(() => {
    if (mood !== 'thinking') return;
    const timer = setTimeout(() => {
      log('board', 'no reply after 45 s: back to idle');
      setMood('idle');
      setExplaining(false);
    }, 45_000);
    return () => clearTimeout(timer);
  }, [mood]);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const speak = useCallback(
    (text: string, opts: { messageId?: string; language?: string; audioUrl?: string; phrase?: string } = {}) => {
    lastTextRef.current = text;
    lastVoiceRef.current = { language: opts.language ?? 'fr', audioUrl: opts.audioUrl, phrase: opts.phrase };
    if (!startedRef.current || !text) return;
    setMood('speaking');
    speakingRef.current = true;
    if (mutedRef.current) {
      // Text only: no voice. The mouth moves for about the time it would take to say it.
      const ms = Math.min(8000, Math.max(1500, text.length * 55));
      log('voice', `muted, text only (${ms} ms)`, text);
      setTimeout(() => {
        speakingRef.current = false;
        setMood('idle');
        if (opts.messageId && channelRef.current) {
          sendEvent(channelRef.current, 'tutor.speaking.end', { message_id: opts.messageId });
        }
      }, ms);
      return;
    }
    playVoice({
      text,
      language: opts.language,
      audioUrl: opts.audioUrl,
      phrase: opts.phrase,
      onDone: () => {
        speakingRef.current = false;
        setMood('idle');
        if (opts.messageId && channelRef.current) {
          sendEvent(channelRef.current, 'tutor.speaking.end', { message_id: opts.messageId });
        }
      },
    });
    },
    [],
  );

  /** Says a familiar phrase of this kind in the current language (no server call). */
  const sayFamiliar = useCallback(
    (kind: 'filler' | 'greeting' | 'pause' | 'resume' | 'end', fallback: string, show = true) => {
      const lang = forcedLangRef.current ?? lastVoiceRef.current.language;
      const p = pickPhrase(kind, lang);
      const text = p?.text ?? fallback;
      if (show) {
        setBubble(text);
        setBubbleLang(p?.lang ?? 'fr');
      }
      speak(text, { language: p?.lang ?? 'fr', phrase: p?.audio_path });
    },
    [speak],
  );

  const loadPhoto = useCallback(async (snapshotId: string) => {
    let { data: snap, error: selErr } = await supabase
      .from('snapshots')
      .select('id, storage_path, width, height, rotation')
      .eq('id', snapshotId)
      .maybeSingle();
    if (selErr) {
      // rotation column missing (migration not applied yet): load without it.
      ({ data: snap } = await supabase.from('snapshots').select('id, storage_path, width, height').eq('id', snapshotId).maybeSingle());
    }
    if (!snap) {
      console.warn('board: snapshot not readable', snapshotId);
      return;
    }
    const { data: signed, error: signErr } = await supabase.storage
      .from('snapshots')
      .createSignedUrl(snap.storage_path, 3600);
    log('board', `photo ${snap.id} ${signed ? 'loaded' : 'NOT loaded'}`);
    if (!signed) {
      console.warn('board: signed url failed', signErr?.message);
      setLink(`photo: ${signErr?.message ?? 'erreur'}`);
      return;
    }
    photoIdRef.current = snap.id;
    setPhoto({ id: snap.id, uri: signed.signedUrl, width: snap.width ?? 1280, height: snap.height ?? 960, rotation: (snap as { rotation?: number }).rotation ?? 0 });
  }, []);

  // Follow the household's open session (a new one starts when the Camera taps "Commencer").
  useEffect(() => {
    if (!device) return;
    let watcher: RealtimeChannel | null = null;
    const refresh = () =>
      findOpenSession(device.householdId)
        .then((s) =>
          setSession((cur) => {
            if (cur?.id === s?.id && cur?.status === s?.status) return cur;
            log('board', s ? `session ${s.id} (${s.status})` : 'no open session');
            return s;
          }),
        )
        .catch(() => undefined);
    refresh();
    (async () => {
      await supabase.realtime.setAuth();
      watcher = supabase
        .channel(`household-sessions:${device.householdId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'homework_sessions', filter: `household_id=eq.${device.householdId}` },
          refresh,
        )
        .subscribe();
    })();
    return () => {
      if (watcher) supabase.removeChannel(watcher);
    };
  }, [device]);

  // Fallback when Realtime is down: check the session and the latest photo every 10 s.
  useEffect(() => {
    if (!device) return;
    const id = setInterval(async () => {
      try {
        const open = await findOpenSession(device.householdId);
        setSession((cur) => (cur?.id === open?.id && cur?.status === open?.status ? cur : open));
        if (!open) return;
        const { data: latest } = await supabase
          .from('snapshots')
          .select('id')
          .eq('session_id', open.id)
          .not('status', 'in', '(skipped,failed)')
          .order('taken_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (latest && latest.id !== photoIdRef.current) loadPhoto(latest.id);
      } catch (e) {
        console.warn('board poll', e);
      }
    }, 10_000);
    return () => clearInterval(id);
  }, [device, loadPhoto]);

  // Join the session channel and react to the Camera and the tutor.
  const sessionId = session?.id;
  useEffect(() => {
    if (!sessionId || !device) return;
    let channel: RealtimeChannel | null = null;
    let cancelled = false;

    (async () => {
      const { data: latest } = await supabase
        .from('snapshots')
        .select('id')
        .eq('session_id', sessionId)
        .not('status', 'in', '(skipped,failed)')
        .order('taken_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latest && !cancelled) loadPhoto(latest.id);
      loadFocus(sessionId).then((f) => !cancelled && setFocus(f));

      const ch = await sessionChannel(sessionId);
      if (cancelled) return;
      channel = ch;
      onEvent(ch, 'snapshot.new', (p) => {
        setAnnotations([]);
        setChoices([]);
        loadPhoto(p.snapshot_id);
      });
      onEvent(ch, 'focus.changed', (p) => {
        log('board', `active exercise: ${p.focus ? `${exerciseName(p.focus)} ${p.focus.title}` : 'none'} (${p.by})`);
        setFocus(p.focus);
        setChoices([]);
      });
      onEvent(ch, 'capture.ack', (p) => {
        if (correctRef.current?.id !== p.request_id) return;
        log('board', 'corriger: Camera is taking the photo');
        clearTimeout(correctRef.current.timer);
        correctRef.current = null;
      });
      onEvent(ch, 'capture.failed', (p) => {
        log('board', `corriger: Camera photo failed (${p.reason})`);
        checkBoardPhotoRef.current(`camera photo failed: ${p.reason}`);
      });
      onEvent(ch, 'snapshot.rotation', (p) => {
        if (p.snapshot_id === photoIdRef.current) setPhoto((cur) => (cur && cur.id === p.snapshot_id ? { ...cur, rotation: p.rotation } : cur));
      });
      onEvent(ch, 'snapshot.rejected', async (p) => {
        if (p.snapshot_id !== photoIdRef.current) return;
        // Go back to the last photo with a readable page.
        const { data: good } = await supabase
          .from('snapshots')
          .select('id')
          .eq('session_id', sessionId)
          .eq('status', 'analyzed')
          .order('taken_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        setAnnotations([]);
        if (good) loadPhoto(good.id);
        else {
          photoIdRef.current = null;
          setPhoto(null);
        }
      });
      // The child speaks (push-to-talk on the Camera): stop talking at once and listen, like a teacher.
      onEvent(ch, 'child.talk.start', () => {
        stopVoice();
        speakingRef.current = false;
        listeningRef.current = true;
        setChoices([]);
        setMood('listening');
      });
      onEvent(ch, 'child.talk.end', () => {
        listeningRef.current = false;
        setMood('thinking');
      });
      onEvent(ch, 'tutor.thinking', () => {
        // A short "Hmm…" while she looks, unless she is already talking or listening.
        if (!speakingRef.current && !listeningRef.current && Math.random() < 0.6) sayFamiliar('filler', 'Hmm…', false);
        setMood('thinking');
      });
      onEvent(ch, 'tutor.say', async (p) => {
        if (!p.text) {
          setMood('idle');
          return;
        }
        if (p.snapshot_id && p.snapshot_id !== photoIdRef.current) await loadPhoto(p.snapshot_id);
        setAnnotations(p.annotations);
        setChoices([]);
        if (p.kind === 'praise' || p.kind === 'hint' || p.kind === 'explain') setReaction({ type: p.kind, at: Date.now() });
        setBubble(p.text);
        setBubbleLang(p.language);
        setExplaining(false);
        speak(p.text, { messageId: p.message_id, language: p.language, audioUrl: p.audio_url, phrase: p.phrase });
      });
      onEvent(ch, 'tutor.ask_exercise', async (p) => {
        if (p.snapshot_id !== photoIdRef.current) await loadPhoto(p.snapshot_id);
        setExplaining(false);
        setChoices(p.choices);
        setAnnotations(
          p.choices
            .filter((c) => c.region)
            .map((c) => ({ shape: 'text' as const, region: c.region!, text: exerciseName(c), color: '#FFC93C' })),
        );
        setBubble(p.text);
        setBubbleLang(p.language);
        setReaction({ type: 'hint', at: Date.now() });
        speak(p.text, { language: p.language, phrase: p.phrase, audioUrl: p.audio_url });
      });
      onEvent(ch, 'board.annotate', (p) => {
        setMood('idle');
        setAnnotations((cur) => (p.clear ? p.annotations : [...cur, ...p.annotations]));
      });
      onEvent(ch, 'session.state', (p) => {
        if (p.status === 'finished') sayFamiliar('end', 'Bravo ! Les devoirs sont finis.');
        else if (p.status === 'paused') sayFamiliar('pause', 'Pause. Je t’attends.');
        else sayFamiliar('resume', 'C’est reparti !');
      });
      ch.subscribe((state, err) => {
        setLink(state === 'SUBSCRIBED' ? 'en direct' : `${state}${err ? `: ${err.message}` : ''}`);
        log('board', `live channel: ${state}`, err?.message);
        if (err) console.warn('board channel', state, err);
        if (state === 'SUBSCRIBED') ch.track({ role: 'board', device_id: device.id, joined_at: new Date().toISOString() });
      });
      channelRef.current = ch;
    })();

    return () => {
      cancelled = true;
      channelRef.current = null;
      if (channel) supabase.removeChannel(channel);
    };
  }, [sessionId, device, loadPhoto, speak, sayFamiliar]);

  // The tutor's language before any message: the parent's choice, or (auto) the last language she spoke.
  const loadLanguage = useCallback(async () => {
    if (!device) return 'fr';
    const { data: child } = await supabase
      .from('children')
      .select('tutor_language')
      .eq('household_id', device.householdId)
      .order('created_at')
      .limit(1)
      .maybeSingle();
    const setting = child?.tutor_language;
    if ((setting && setting !== 'auto' ? setting : null) !== forcedLangRef.current) log('board', `tutor language setting: ${setting ?? 'auto'}`);
    forcedLangRef.current = setting && setting !== 'auto' ? setting : null;
    if (forcedLangRef.current) return forcedLangRef.current;
    const { data: last } = await supabase
      .from('tutor_messages')
      .select('language')
      .eq('household_id', device.householdId)
      .neq('kind', 'system')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return last?.language ?? lastVoiceRef.current.language ?? 'fr';
  }, [device]);

  // Familiar phrases (Bravo, Hmm…) + the language, loaded at start; the greeting is shown in that language.
  useEffect(() => {
    let cancelled = false;
    Promise.all([loadPhrases().catch(() => 0), loadLanguage().catch(() => 'fr')]).then(([, lang]) => {
      if (cancelled || startedRef.current) return;
      lastVoiceRef.current = { language: lang };
      const greeting = pickPhrase('greeting', lang);
      if (greeting) {
        setBubble(greeting.text);
        setBubbleLang(greeting.lang);
        lastTextRef.current = greeting.text;
        lastVoiceRef.current = { language: greeting.lang, phrase: greeting.audio_path };
      }
    });
    const id = setInterval(() => {
      loadLanguage().catch(() => undefined);
    }, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [loadLanguage]);

  /** Corriger: ask the Camera for a fresh photo; no answer within 2 s (or it fails): check the photo on the Board. */
  function correct() {
    setMood('thinking');
    if (!channelRef.current) {
      void checkBoardPhoto('no live channel');
      return;
    }
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    if (correctRef.current) clearTimeout(correctRef.current.timer);
    correctRef.current = { id: requestId, timer: setTimeout(() => void checkBoardPhoto('camera did not answer in 2 s'), 2000) };
    log('board', `corriger: asking the Camera for a photo (${requestId})`);
    sendEvent(channelRef.current, 'capture.request', { mode: 'check', request_id: requestId });
  }

  async function checkBoardPhoto(why: string) {
    if (correctRef.current) clearTimeout(correctRef.current.timer);
    correctRef.current = null;
    const snapshotId = photoIdRef.current;
    if (!snapshotId) {
      log('board', `corriger: ${why}, and no photo on the Board`);
      setMood('idle');
      setLink('Corriger : pas de photo');
      return;
    }
    log('board', `corriger: ${why} -> checking the Board photo ${snapshotId}`);
    const { error } = await supabase.functions.invoke('analyze-snapshot', { body: { snapshot_id: snapshotId, mode: 'check' } });
    if (error) {
      setMood('idle');
      setLink(`corriger : ${await functionError(error)}`);
    }
  }
  checkBoardPhotoRef.current = (why) => void checkBoardPhoto(why);

  /** Exercise help (buttons and choice taps): same server logic as the child's voice requests. */
  async function explainExercise(choice?: ExerciseChoice, action?: HelpAction | 'choose') {
    if (!session) return;
    setExplaining(true);
    setChoices([]);
    setMood('thinking');
    const { error } = await requestHelp(session.id, { choice, action });
    setExplaining(false);
    if (error) {
      setMood('idle');
      setLink(`exercice : ${error}`);
    }
  }

  function start() {
    startedRef.current = true;
    setStarted(true);
    sayFamiliar('greeting', GREETING);
  }

  function fullscreen() {
    if (Platform.OS === 'web') (globalThis as any).document?.documentElement?.requestFullscreen?.();
  }

  // The active exercise stays framed on its photo while nothing else is drawn.
  const focusFrame: Annotation[] =
    focus?.region && focus.snapshot_id === photo?.id
      ? [{ shape: 'text', region: focus.region, text: exerciseName(focus), color: '#7FD3FF' }]
      : [];
  const shown = annotations.length ? annotations : focusFrame;

  const statusLabel = !session ? 'En attente de la caméra' : session.status === 'paused' ? 'En pause' : 'Devoirs en cours';

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>{TUTOR_NAME}</Text>
        <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <Text style={styles.chip}>
            <Text style={{ color: session?.status === 'active' ? colors.success : colors.muted }}>● </Text>
            {statusLabel}
          </Text>
          {session ? <Text style={[styles.chip, { color: colors.muted }]}>{link}</Text> : null}
        </View>
      </View>

      <View style={[styles.main, { flexDirection: landscape ? 'row' : 'column' }]}>
        <View style={[styles.wood, { flex: landscape ? 3 : 2 }]}>
          <View style={styles.chalkboard}>
            {photo ? (
              <AnnotatedPhoto uri={photo.uri} width={photo.width} height={photo.height} rotation={photo.rotation} annotations={shown} />
            ) : (
              <Text style={styles.chalkText}>J’attends la première photo du cahier…</Text>
            )}
          </View>
        </View>

        <View style={[styles.side, { flex: landscape ? 2 : 1, flexDirection: landscape ? 'column' : 'row' }]}>
          {focus && !choices.length ? (
            <View style={styles.focusCard}>
              <View style={styles.focusRow}>
                <Text style={styles.focusNumber}>{exerciseName(focus)}</Text>
                <View style={{ flexShrink: 1, flexGrow: 1 }}>
                  <Text style={styles.focusCaption}>Exercice en cours{focus.action ? ` · ${ACTION_LABEL[focus.action]}` : ''}</Text>
                  <Text style={styles.focusTitle} numberOfLines={2}>
                    {focus.title}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Changer d’exercice"
                  onPress={() => explainExercise(undefined, 'choose')}
                  style={({ pressed }) => [styles.focusChange, pressed && { opacity: 0.8 }]}
                >
                  <Text style={styles.focusChangeText}>Changer</Text>
                </Pressable>
              </View>
              <View style={styles.focusActions}>
                {(['explain', 'solve', 'correct'] as const).map((a) => (
                  <Pressable
                    key={a}
                    accessibilityRole="button"
                    accessibilityLabel={`${ACTION_LABEL[a]} l’exercice ${exerciseName(focus)}`}
                    disabled={explaining}
                    onPress={() => explainExercise(undefined, a)}
                    style={({ pressed }) => [styles.focusAction, focus.action === a && styles.focusActionOn, pressed && { opacity: 0.8 }]}
                  >
                    <Text style={styles.focusActionText}>{ACTION_LABEL[a]}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
          {choices.length ? (
            <View style={styles.choices}>
              {choices.map((c) => (
                <Pressable
                  key={c.index}
                  accessibilityRole="button"
                  accessibilityLabel={`Exercice ${exerciseName(c)} : ${c.title}`}
                  onPress={() => explainExercise(c)}
                  style={({ pressed }) => [styles.choice, focus?.index === c.index && styles.choiceOn, pressed && { opacity: 0.8 }]}
                >
                  <Text style={styles.choiceNumber}>{exerciseName(c)}</Text>
                  <Text style={styles.choiceTitle} numberOfLines={2}>
                    {c.title}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <View style={[styles.bubble, !landscape && { flex: 1 }]}>
            <Text
              style={[
                styles.bubbleText,
                (bubbleLang === 'ar' || bubbleLang === 'fus') && {
                  writingDirection: 'rtl',
                  textAlign: 'right',
                  fontSize: 28,
                  lineHeight: 40,
                },
              ]}
            >
              {bubble}
            </Text>
          </View>
          <View style={{ flex: landscape ? 1 : 0.8, width: '100%', alignItems: 'center', justifyContent: 'center' }}>
            <Avatar mood={mood} reaction={reaction} language={bubbleLang} />
            <Text style={styles.nameTag}>{TUTOR_NAME}</Text>
          </View>
        </View>
      </View>

      <View style={styles.footer}>
        <Button label="Corriger" onPress={correct} disabled={!session || session.status !== 'active'} />
        <Button label="Explique-moi" onPress={() => explainExercise()} loading={explaining} disabled={!session || !photo} />
        <Button label="Répéter" variant="secondary" onPress={() => speak(lastTextRef.current, lastVoiceRef.current)} />
        <Button
          label={muted ? 'Son : coupé' : 'Son : activé'}
          variant="secondary"
          onPress={() => {
            if (!muted) stopVoice();
            setMuted(!muted);
          }}
        />
        {Platform.OS === 'web' ? <Button label="Plein écran" variant="secondary" onPress={fullscreen} /> : null}
        <Button label="Délier" variant="ghost" onPress={unpair} />
      </View>

      {!started ? (
        <View style={styles.startOverlay}>
          <Pressable accessibilityRole="button" onPress={start} style={styles.startButton}>
            <Text style={styles.startText}>Commencer les devoirs</Text>
          </Pressable>
          <Text style={styles.startHint}>Active {TUTOR_NAME}, ta maîtresse.</Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, padding: space.md, gap: space.md, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md, minWidth: 0 },
  title: { color: colors.text, fontSize: 26, fontWeight: '900' },
  chip: {
    color: colors.text,
    backgroundColor: colors.surface,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    fontWeight: '800',
    overflow: 'hidden',
  },
  main: { flex: 1, gap: space.md, minHeight: 0, minWidth: 0 },
  wood: { backgroundColor: '#A06A3F', borderRadius: radius.lg, padding: 12, minHeight: 0, minWidth: 0 },
  chalkboard: {
    flex: 1,
    backgroundColor: '#1F4A3D',
    borderRadius: 14,
    padding: space.md,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  chalkText: { color: '#F4F1E8', fontSize: 28, fontWeight: '700', textAlign: 'center' },
  side: { alignItems: 'center', gap: space.md, minHeight: 0, minWidth: 0 },
  bubble: {
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    padding: space.lg,
    alignSelf: 'stretch',
    justifyContent: 'center',
    minWidth: 0,
    maxWidth: '100%',
  },
  bubbleText: { color: colors.bg, fontSize: 24, fontWeight: '800', lineHeight: 30, flexShrink: 1 },
  choices: { alignSelf: 'stretch', gap: space.sm },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 56,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  choiceNumber: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: colors.accent,
    color: colors.onAccent,
    fontSize: 22,
    fontWeight: '900',
    textAlign: 'center',
    lineHeight: 40,
  },
  choiceTitle: { color: colors.text, fontSize: 18, fontWeight: '800', flexShrink: 1 },
  choiceOn: { borderWidth: 3, borderColor: '#7FD3FF' },
  focusCard: { alignSelf: 'stretch', gap: space.sm, backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.md, borderWidth: 3, borderColor: '#7FD3FF' },
  focusRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  focusNumber: {
    minWidth: 44,
    height: 44,
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: '#7FD3FF',
    color: '#1B2340',
    fontSize: 22,
    fontWeight: '900',
    textAlign: 'center',
    lineHeight: 44,
    paddingHorizontal: 6,
  },
  focusCaption: { color: colors.muted, fontSize: 13, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  focusTitle: { color: colors.text, fontSize: 18, fontWeight: '900' },
  focusChange: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.12)' },
  focusChangeText: { color: colors.text, fontWeight: '800' },
  focusActions: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  focusAction: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.08)' },
  focusActionOn: { backgroundColor: '#7FD3FF33', borderWidth: 2, borderColor: '#7FD3FF' },
  focusActionText: { color: colors.text, fontWeight: '800', fontSize: 15 },
  footer: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm, flexWrap: 'wrap' },
  nameTag: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 2,
    backgroundColor: colors.surface,
    paddingHorizontal: space.lg,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  startOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(27,35,64,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
    padding: space.lg,
  },
  startButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingHorizontal: 48,
    paddingVertical: 28,
  },
  startText: { color: colors.onAccent, fontSize: 30, fontWeight: '900' },
  startHint: { color: colors.muted, fontSize: 18 },
});
