import type { Annotation, ExerciseChoice, ExerciseFocus, HelpAction, SessionEvents, TurnRef } from '@hc/shared';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { useKeepAwake } from 'expo-keep-awake';
import { StatusBar } from 'expo-status-bar';
import { router, useLocalSearchParams } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Platform, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FocusPressable as Pressable } from '@/components/focus-pressable';
import { Icon } from '@/components/icons';
import { Chunky, ChunkyButton, NotebookPage, PaperInput, Polaroid } from '@/components/paper';
import { AnnotatedPhoto } from '@/features/board/annotated-photo';
import { BinderRings, DeskButton, Desk, GraphPaper, IndexTab, Ruler, Washi } from '@/features/board/binder';
import { Avatar, type AvatarMood, type AvatarReaction } from '@/features/board/avatar';
import { PracticeBoard, type PracticeView } from '@/features/board/practice-board';
import { ACTION_LABEL, exerciseName, requestHelp, sendTyped } from '@/lib/exercise';
import { log } from '@/lib/log';
import { loadPhrases, pickPhrase } from '@/lib/phrases';
import { findOpenSession, newTurn, onEvent, sendEvent, sessionChannel, type HomeworkSession } from '@/lib/session';
import { isTV } from '@/lib/device-name';
import { useAppStore } from '@/lib/store';
import { functionError, supabase } from '@/lib/supabase';
import { font, hardShadow, paper } from '@/lib/paper-theme';
import { TUTOR_NAME } from '@/lib/tutor';
import { useTalk } from '@/lib/use-talk';
import { useRevokedWatch } from '@/lib/use-revoked';
import { useUnpair } from '@/lib/use-unpair';
import { onVoiceIssue, playVoice, stopVoice } from '@/lib/voice';
import { applyFamilyLang, t } from '@/lib/i18n';

interface Photo {
  id: string;
  uri: string;
  width: number;
  height: number;
}

type Result = SessionEvents['exercise.result'];
type ResultLine = Result['lines'][number];

const GREETING = `Bonjour ! Je suis ${TUTOR_NAME}. Montre-moi ton cahier.`;

/** Shown at once when Lina presses « Silia, regarde » (before the AI answers). */
const LOOKING: Record<string, string> = {
  fr: 'Je regarde ton exercice…',
  ar: 'خليني نشوف التمرين ديالك…',
  fus: 'دعيني أنظر إلى تمرينكِ…',
  en: 'Let me look at your exercise…',
};

/** A request got no answer in time: say so, never go silent. */
const NO_ANSWER: Record<string, string> = {
  fr: 'Je n’ai pas réussi à lire. Appuie encore sur « Silia, regarde ».',
  ar: 'ما قدرتش نقرا مزيان. ورّكي عاوتاني على «سيليا، شوفي».',
  fus: 'لم أستطع القراءة جيدًا. اضغطي مرة أخرى على «سيليا، انظري».',
  en: 'I couldn’t read it. Press “Silia, look” again.',
};

const CHOICE_STATUS: Record<ExerciseChoice['status'], string> = {
  done: 'Réponses écrites',
  partial: 'Commencé',
  empty: 'Pas encore fait',
};

/** "532 − 178 = 354", "604 − 259 · à revoir", "700 − 465 · pas encore fait". */
function lineText(l: ResultLine): string {
  const calc = /\d/.test(l.q) && /[-+−×x÷:*/]/.test(l.q);
  // « Solution »: the right answer in chalk; her wrong answer stays visible before the arrow.
  if (l.solution && l.status !== 'right') return l.status === 'wrong' ? `${l.q} : ${l.a ?? ''} → ${l.solution}` : `${l.q} → ${l.solution}`;
  switch (l.status) {
    case 'right':
      return `${l.q}${calc ? ' = ' : ' : '}${l.a ?? ''}`;
    case 'wrong':
      return t('{q} : {a} · à revoir', { q: l.q, a: l.a ?? '' });
    case 'unsure':
      return t('{q} · je lis « {a} » ?', { q: l.q, a: l.a ?? '' });
    case 'open':
      return t('{q} · dis-moi ta réponse', { q: l.q });
    default:
      return t('{q} · pas encore fait', { q: l.q });
  }
}

export default function Board() {
  useKeepAwake();
  /**
   * « Un seul téléphone »: the Camera phone opens this screen after a photo (?solo=1&photo=<snapshot id>), sideways,
   * already started, then « Retour à la caméra ». No pairing, no TV.
   */
  const params = useLocalSearchParams<{ solo?: string; photo?: string }>();
  const solo = params.solo === '1';
  const device = useAppStore((s) => s.device);
  const reload = useAppStore((s) => s.reload);
  const unpair = useUnpair();
  // Removed by the parent: back to the first screen within a few seconds.
  useRevokedWatch();
  const { width, height } = useWindowDimensions();
  const landscape = width >= height;
  /** A phone (one-phone mode, or a phone used as Board): smaller text and spacing so everything fits. */
  const compact = Math.min(width, height) < 500;
  /** Board width in landscape, in pixels (a percentage basis collapsed on Android). */
  const boardWidth = landscape ? Math.round(width * (compact ? 0.62 : 0.68)) : undefined;

  /** Parent setting (Espace parent → Voix de Silia). Off = text only, and the server sends no audio at all. */
  const [voiceOn, setVoiceOn] = useState(true);
  /** Parent setting « Solution »: the Solution button on the Board. */
  const [solutionOn, setSolutionOn] = useState(false);
  const mutedRef = useRef(false);
  mutedRef.current = !voiceOn;

  const [started, setStarted] = useState(solo);
  const [session, setSession] = useState<HomeworkSession | null>(null);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [bubble, setBubble] = useState(GREETING);
  const [bubbleLang, setBubbleLang] = useState('fr');
  const [mood, setMood] = useState<AvatarMood>('idle');
  const [reaction, setReaction] = useState<AvatarReaction | null>(null);
  const [link, setLink] = useState('connexion…');
  /** The photo is being read: scan effect over it. */
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Several exercises on the page: the choices, and the one Silia suggests. */
  const [choices, setChoices] = useState<ExerciseChoice[]>([]);
  /** The list of exercises opens in its own window, so the photo and Silia's page keep their room. */
  const [pickOpen, setPickOpen] = useState(false);
  const [suggested, setSuggested] = useState<number | null>(null);
  /** The checked exercise, line by line (or Silia asks for Lina's answer). */
  const [result, setResult] = useState<Result | null>(null);
  /** Active exercise: stays until the child names or taps another one (synced with the Camera). */
  const [focus, setFocus] = useState<ExerciseFocus | null>(null);
  /** "Exercice similaire": shown on the chalkboard (questions only; answers stay on the server). */
  const [practice, setPractice] = useState<PracticeView | null>(null);
  const [practiceView, setPracticeView] = useState(true);
  /** Orientation of the whole session (the Camera stays on its stand). null = not decided yet. */
  const [sessionRotation, setSessionRotation] = useState<number | null>(null);
  const [typed, setTyped] = useState('');
  /** Checks in a row with a mistake (3 = Silia pouts, playfully). */
  const wrongStreakRef = useRef(0);
  /** Last thing that happened (Silia spoke, Lina asked, a photo): Silia nudges her when it has been quiet too long. */
  const lastActivityRef = useRef(Date.now());
  const nudgesRef = useRef(0);
  const lastNudgeRef = useRef(0);
  const markActivity = () => {
    lastActivityRef.current = Date.now();
    nudgesRef.current = 0;
  };
  const busyRef = useRef(false);
  busyRef.current = busy;
  const sessionStatusRef = useRef<string | null>(null);
  sessionStatusRef.current = session?.status ?? null;
  /** The open session, for code that runs outside React's render (timers). */
  const sessionIdRef = useRef<string | null>(null);
  sessionIdRef.current = session?.id ?? null;
  /** Her page shown big, over everything (tap on the photo). */
  const [photoBig, setPhotoBig] = useState(false);
  /** The correction takes the photo's place on the left page; a small arrow turns back to the photo. */
  const [correctionView, setCorrectionView] = useState(true);
  useEffect(() => {
    if (result) setCorrectionView(true);
  }, [result]);
  /** A TV is only watched: no side buttons, the phone (Camera) is the remote control. */
  const tv = useMemo(isTV, []);

  /** Tutor messages already shown (live or by the fallback poll). */
  const shownRef = useRef<Set<string>>(new Set());
  // Solo: the answer may arrive before the live channel is ready, so the poll may show any recent message.
  const pollBaselineRef = useRef<string | null>(solo ? '' : null);
  const showMessageRef = useRef<(p: SessionEvents['tutor.say']) => void>(() => undefined);
  /** Parent changed a setting (language, voice): refresh what depends on it. */
  const settingsChangedRef = useRef<() => void>(() => undefined);
  /** The bubble still shows the greeting (nothing said yet). */
  const greetingShownRef = useRef(true);
  const startedRef = useRef(solo);
  const lastTextRef = useRef(GREETING);
  const lastVoiceRef = useRef<{ language: string; audioUrl?: string; phrase?: string }>({ language: 'fr' });
  const speakingRef = useRef(false);
  /** Language chosen by the parent (null = auto: follow the exercise). */
  const forcedLangRef = useRef<string | null>(null);
  const photoIdRef = useRef<string | null>(null);
  /** When this Board started: older photos are never shown again (a refresh starts empty). */
  const bootAtRef = useRef(new Date().toISOString());
  /** The request Silia is answering. */
  const turnRef = useRef<TurnRef | null>(null);
  /** Pending « Silia, regarde » sent to the Camera, with its 2 s fallback timer. */
  const lookRef = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const checkBoardPhotoRef = useRef<(why: string) => void>(() => undefined);
  const speakRef = useRef<(text: string, opts?: { language?: string }) => void>(() => undefined);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const lang = () => forcedLangRef.current ?? lastVoiceRef.current.language ?? 'fr';

  // Solo: sideways while this screen is open; the photo just taken is shown at once with the scan.
  useEffect(() => {
    if (!solo) return;
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => undefined);
    // No unlock on leaving: the Camera locks itself upright when it opens.
  }, [solo]);

  /** Solo: back to the Camera (portrait). */
  function backToCamera() {
    stopVoice();
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP)
      .catch(() => undefined)
      .finally(() => {
        router.replace('/camera'); // the Camera keeps itself upright
      });
  }

  // Safety net: never stay "thinking" forever. After 45 s Silia says she could not read it (checking one exercise of a
  // full page — zoom, verdict, second look at a mistake — can take 20-30 s; a late answer is still shown).
  useEffect(() => {
    if (mood !== 'thinking') return;
    const timer = setTimeout(() => {
      log('board', 'no reply after 45 s');
      // Quality signal: Silia gave no answer in time (read by supabase/queries/quality.sql).
      const d = useAppStore.getState().device;
      if (d && sessionIdRef.current) {
        void supabase.from('feedback_signals').insert({ household_id: d.householdId, session_id: sessionIdRef.current, kind: 'timeout', data: { solo } });
      }
      setScanning(false);
      setBusy(false);
      turnRef.current = null;
      if (!startedRef.current) return setMood('idle');
      const l = lang();
      const text = NO_ANSWER[l] ?? NO_ANSWER.fr;
      setBubble(text);
      setBubbleLang(l);
      speakRef.current(text, { language: l });
    }, 45_000);
    return () => clearTimeout(timer);
  }, [mood]);

  const speak = useCallback((text: string, opts: { messageId?: string; language?: string; audioUrl?: string; phrase?: string } = {}) => {
    lastTextRef.current = text;
    lastVoiceRef.current = { language: opts.language ?? 'fr', audioUrl: opts.audioUrl, phrase: opts.phrase };
    if (!startedRef.current || !text) return;
    setMood('speaking');
    speakingRef.current = true;
    const done = () => {
      speakingRef.current = false;
      setMood('idle');
      if (opts.messageId && channelRef.current) sendEvent(channelRef.current, 'tutor.speaking.end', { message_id: opts.messageId });
    };
    if (mutedRef.current) {
      // Text only: the mouth moves for about the time it would take to say it.
      setTimeout(done, Math.min(8000, Math.max(1500, text.length * 55)));
      return;
    }
    playVoice({ text, language: opts.language, audioUrl: opts.audioUrl, phrase: opts.phrase, onDone: done });
  }, []);
  speakRef.current = speak;

  /** Says a familiar phrase of this kind in the current language (no server call). */
  const sayFamiliar = useCallback(
    (kind: 'greeting' | 'pause' | 'resume' | 'end' | 'nudge', fallback: string) => {
      const p = pickPhrase(kind, forcedLangRef.current ?? lastVoiceRef.current.language);
      const text = p?.text ?? fallback;
      setBubble(text);
      setBubbleLang(p?.lang ?? 'fr');
      speak(text, { language: p?.lang ?? 'fr', phrase: p?.audio_path });
    },
    [speak],
  );

  // Waiting too long (nothing for 75 s while homework is on): Silia leans in and asks « Tu es là ? » with a recorded
  // phrase (no credits). At most 3 times in a row; anything that happens starts the count again.
  useEffect(() => {
    const timer = setInterval(() => {
      if (!startedRef.current || speakingRef.current || busyRef.current) return;
      if (!sessionIdRef.current || sessionStatusRef.current !== 'active') return;
      const now = Date.now();
      if (nudgesRef.current >= 3 || now - lastActivityRef.current < 75_000 || now - lastNudgeRef.current < 90_000) return;
      nudgesRef.current += 1;
      lastNudgeRef.current = now;
      setReaction({ type: 'nudge', at: now });
      sayFamiliar('nudge', t('Tu es là ? Je t’attends.'));
    }, 5000);
    return () => clearInterval(timer);
  }, [sayFamiliar]);

  const loadPhoto = useCallback(async (snapshotId: string) => {
    const { data: snap } = await supabase.from('snapshots').select('id, storage_path, width, height').eq('id', snapshotId).maybeSingle();
    if (!snap) return;
    // The Camera may still be uploading the file when Silia starts reading it: try again for a few seconds.
    let { data: signed, error } = await supabase.storage.from('snapshots').createSignedUrl(snap.storage_path, 3600);
    for (let i = 0; !signed && i < 6; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      ({ data: signed, error } = await supabase.storage.from('snapshots').createSignedUrl(snap.storage_path, 3600));
    }
    log('board', `photo ${snap.id} ${signed ? 'loaded' : 'NOT loaded'}`);
    if (!signed) {
      setLink(`photo : ${error?.message ?? 'erreur'}`);
      return;
    }
    photoIdRef.current = snap.id;
    setPhoto({ id: snap.id, uri: signed.signedUrl, width: snap.width ?? 1280, height: snap.height ?? 960 });
  }, []);

  // Solo: the photo the Camera just took, with the scan, before Silia's answer arrives.
  useEffect(() => {
    if (!solo || !params.photo) return;
    void loadPhoto(params.photo);
    setScanning(true);
    setBubble(LOOKING[lang()] ?? LOOKING.fr);
    greetingShownRef.current = false;
    setMood('thinking');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solo, params.photo, loadPhoto]);

  // Follow the household's open session (a new one starts when the Camera taps "Commencer"), and the parent's settings.
  useEffect(() => {
    if (!device) return;
    let watcher: RealtimeChannel | null = null;
    const refresh = () =>
      findOpenSession(device.householdId)
        .then((s) => setSession((cur) => (cur?.id === s?.id && cur?.status === s?.status ? cur : s)))
        .catch(() => undefined);
    refresh();
    (async () => {
      await supabase.realtime.setAuth();
      watcher = supabase
        .channel(`household-sessions:${device.householdId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'homework_sessions', filter: `household_id=eq.${device.householdId}` }, refresh)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'children', filter: `household_id=eq.${device.householdId}` }, () =>
          settingsChangedRef.current(),
        )
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'households', filter: `id=eq.${device.householdId}` }, () =>
          settingsChangedRef.current(),
        )
        .subscribe();
    })();
    return () => {
      if (watcher) supabase.removeChannel(watcher);
    };
  }, [device]);

  // Fallback when Realtime is down: check the session, the latest photo and the latest message every 10 s.
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
          .gt('taken_at', bootAtRef.current)
          .order('taken_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (latest && latest.id !== photoIdRef.current) loadPhoto(latest.id);
        const { data: msg } = await supabase
          .from('tutor_messages')
          .select('id, kind, text, language, annotations, created_at')
          .eq('session_id', open.id)
          .neq('kind', 'system')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (msg && pollBaselineRef.current === null)
          pollBaselineRef.current = msg.id; // older than this Board: never replay
        else if (msg && msg.id !== pollBaselineRef.current && !shownRef.current.has(msg.id) && Date.now() - Date.parse(msg.created_at) < 90_000) {
          log('board', 'reply missed live, shown from the poll', msg.id);
          showMessageRef.current({ message_id: msg.id, kind: msg.kind, text: msg.text, language: msg.language, annotations: msg.annotations ?? [] });
        }
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
      // A refresh starts empty: no old photo, exercise or practice; only what Lina asks from now on. The server forgets
      // too: no active exercise, and her earlier answers are not reused (fresh_at). Not in solo: there the Board opens
      // after every photo, and the exercise must be kept.
      if (!solo) {
        supabase
          .from('homework_sessions')
          .update({ focus: null, pending_action: null, fresh_at: bootAtRef.current })
          .eq('id', sessionId)
          .then(({ error }) => {
            if (error) log('board', `fresh start not saved: ${error.message}`);
          });
      }
      supabase
        .from('homework_sessions')
        .select('rotation')
        .eq('id', sessionId)
        .maybeSingle()
        .then(({ data }) => {
          if (!cancelled) setSessionRotation((data as { rotation?: number | null } | null)?.rotation ?? null);
        });

      const ch = await sessionChannel(sessionId);
      if (cancelled) return;
      channel = ch;
      const sameTurn = (t?: TurnRef) => !t || !turnRef.current || t.id === turnRef.current.id;
      /** A new answer replaces the lists of the previous one. */
      const clearPanels = () => {
        setChoices([]);
        setSuggested(null);
        setResult(null);
      };

      onEvent(ch, 'snapshot.new', (p) => {
        markActivity();
        setAnnotations([]);
        clearPanels();
        setPracticeView(false);
        loadPhoto(p.snapshot_id);
      });
      onEvent(ch, 'session.rotation', (p) => setSessionRotation(p.rotation));
      onEvent(ch, 'practice.show', (p) => {
        setPractice({ index: p.exercise_index, title: p.title, instr: p.instr, kind: p.kind, items: p.items, language: p.language });
        setPracticeView(true); // written on the chalkboard, in place of the photo
      });
      onEvent(ch, 'focus.changed', (p) => {
        log('board', `active exercise: ${p.focus ? `${exerciseName(p.focus)} ${p.focus.title}` : 'none'} (${p.by})`);
        setFocus(p.focus);
        setPractice((cur) => (cur && cur.index !== p.focus?.index ? null : cur));
        setChoices([]);
      });
      onEvent(ch, 'capture.ack', (p) => {
        if (lookRef.current?.id !== p.request_id) return;
        clearTimeout(lookRef.current.timer);
        lookRef.current = null;
      });
      onEvent(ch, 'capture.failed', (p) => checkBoardPhotoRef.current(`camera photo failed: ${p.reason}`));
      onEvent(ch, 'snapshot.rejected', () => setScanning(false));
      // The child speaks (push-to-talk on the Camera): stop talking at once and listen, like a teacher.
      onEvent(ch, 'child.talk.start', () => {
        markActivity();
        stopVoice();
        speakingRef.current = false;
        setChoices([]);
        setMood('listening');
      });
      onEvent(ch, 'child.talk.end', () => setMood('thinking'));
      onEvent(ch, 'tutor.thinking', (p) => {
        if (p.turn) turnRef.current = p.turn;
        if (speakingRef.current) {
          stopVoice();
          speakingRef.current = false;
        }
        if (p.snapshot_id) {
          // « Silia, regarde »: the photo with the scan, and « Je regarde ton exercice… » at once.
          if (p.snapshot_id !== photoIdRef.current) void loadPhoto(p.snapshot_id);
          setAnnotations([]);
          clearPanels();
          setPracticeView(false);
          setScanning(true);
          const l = lang();
          setBubble(LOOKING[l] ?? LOOKING.fr);
          setBubbleLang(l);
          greetingShownRef.current = false;
          // A short cached « Je regarde… » / « Hmm… » (no server call), unless the voice is off.
          const filler = pickPhrase('filler', l);
          if (filler && !mutedRef.current) playVoice({ text: filler.text, language: filler.lang, phrase: filler.audio_path, onDone: () => undefined });
        }
        setMood('thinking');
      });
      const playSay = async (p: SessionEvents['tutor.say']) => {
        if (shownRef.current.has(p.message_id)) return;
        shownRef.current.add(p.message_id);
        greetingShownRef.current = false;
        setScanning(false);
        setBusy(false);
        if (p.snapshot_id && p.snapshot_id !== photoIdRef.current) await loadPhoto(p.snapshot_id);
        // Silia marks the sheet (ticks, circles): show the photo, the practice exercise stays one tap away.
        if (p.annotations.length) setPracticeView(false);
        setAnnotations(p.annotations);
        setChoices([]);
        markActivity();
        if (p.kind === 'praise') {
          // All right: sometimes she jumps for joy, sometimes she laughs.
          setReaction({ type: Math.random() < 0.45 ? 'laugh' : 'praise', at: Date.now() });
        } else if (p.kind === 'hint' && wrongStreakRef.current >= 3) {
          // Many mistakes in a row: a playful pout (then the kind hint), and the count starts again.
          wrongStreakRef.current = 0;
          setReaction({ type: 'grumpy', at: Date.now() });
        } else if (p.kind === 'hint' || p.kind === 'explain') setReaction({ type: p.kind, at: Date.now() });
        setBubble(p.text);
        setBubbleLang(p.language);
        speak(p.text, { messageId: p.message_id, language: p.language, audioUrl: p.audio_url, phrase: p.phrase });
      };
      onEvent(ch, 'tutor.say', async (p) => {
        if (!p.text) {
          // "stop thinking" of an older request must not stop the current one
          if (sameTurn(p.turn) && !speakingRef.current) {
            setScanning(false);
            setBusy(false);
            setMood('idle');
          }
          return;
        }
        if (p.turn) turnRef.current = p.turn;
        await playSay(p);
      });
      showMessageRef.current = (p) => void playSay(p);
      onEvent(ch, 'exercise.result', (p) => {
        setResult(p);
        markActivity();
        if (p.mode === 'verdict') {
          if (p.lines.some((l) => l.status === 'wrong')) wrongStreakRef.current += 1;
          else if (p.lines.some((l) => l.status === 'right')) wrongStreakRef.current = 0;
        }
        // Practice exercise all right: it is done, the chalkboard goes back to her page.
        if (p.practice && p.mode === 'verdict' && p.lines.every((l) => l.status === 'right')) setPractice(null);
      });
      onEvent(ch, 'tutor.ask_exercise', async (p) => {
        greetingShownRef.current = false;
        setScanning(false);
        setBusy(false);
        if (p.snapshot_id !== photoIdRef.current) await loadPhoto(p.snapshot_id);
        setPracticeView(false);
        setResult(null);
        setChoices(p.choices);
        setPickOpen(p.choices.length > 0);
        setSuggested(p.suggested ?? null);
        setAnnotations(
          p.choices
            .filter((c) => c.region)
            .map((c) => ({ shape: 'text' as const, region: c.region!, text: exerciseName(c), color: c.index === p.suggested ? '#7FD3FF' : '#FFC93C' })),
        );
        setBubble(p.text);
        setBubbleLang(p.language);
        setReaction({ type: 'hint', at: Date.now() });
        speak(p.text, { language: p.language, phrase: p.phrase, audioUrl: p.audio_url });
      });
      onEvent(ch, 'board.annotate', (p) => setAnnotations((cur) => (p.clear ? p.annotations : [...cur, ...p.annotations])));
      onEvent(ch, 'session.state', (p) => {
        // Finished: the recap (session-summary) is already being said; never cut it with the short goodbye.
        if (p.status === 'finished') {
          if (!speakingRef.current) sayFamiliar('end', 'Bravo ! Les devoirs sont finis.');
        } else if (p.status === 'paused') sayFamiliar('pause', 'Pause. Je t’attends.');
        else sayFamiliar('resume', 'C’est reparti !');
      });
      ch.subscribe((state, err) => {
        setLink(state === 'SUBSCRIBED' ? 'en direct' : `${state}${err ? `: ${err.message}` : ''}`);
        log('board', `live channel: ${state}`, err?.message);
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

  // The voice setting and the tutor's language: the parent's choice, or (auto) the last language Silia spoke.
  const loadLanguage = useCallback(async () => {
    if (!device) return 'fr';
    const { data: home } = await supabase.from('households').select('voice_enabled, solution_enabled, app_lang').eq('id', device.householdId).maybeSingle();
    if (home) {
      // The parent's « Langue de l'app » applies to the Board too (the screens reload in that language).
      applyFamilyLang((home as { app_lang?: string }).app_lang);
      setSolutionOn((home as { solution_enabled?: boolean }).solution_enabled === true);
      const on = (home as { voice_enabled?: boolean }).voice_enabled !== false;
      setVoiceOn((cur) => {
        if (cur !== on && !on) stopVoice();
        return on;
      });
    }
    const { data: child } = await supabase
      .from('children')
      .select('tutor_language')
      .eq('household_id', device.householdId)
      .order('created_at')
      .limit(1)
      .maybeSingle();
    const setting = child?.tutor_language;
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

  const showGreeting = (l: string) => {
    const greeting = pickPhrase('greeting', l);
    if (!greeting) return;
    setBubble(greeting.text);
    setBubbleLang(greeting.lang);
    lastTextRef.current = greeting.text;
    lastVoiceRef.current = { language: greeting.lang, phrase: greeting.audio_path };
  };

  settingsChangedRef.current = () => {
    log('board', 'parent changed a setting: refreshing');
    loadLanguage()
      .then((l) => {
        if (greetingShownRef.current) showGreeting(l);
      })
      .catch(() => undefined);
  };

  // Familiar phrases (Bravo…) + the language, loaded at start; the greeting is shown in that language.
  useEffect(() => {
    let cancelled = false;
    Promise.all([loadPhrases().catch(() => 0), loadLanguage().catch(() => 'fr')]).then(([, l]) => {
      if (cancelled || startedRef.current) return;
      lastVoiceRef.current = { language: l };
      showGreeting(l);
    });
    const id = setInterval(() => loadLanguage().catch(() => undefined), 10_000);
    // Phrase audio links last 24 h: renew them, the TV may stay on for days.
    const renew = setInterval(() => loadPhrases().catch(() => 0), 6 * 3600_000);
    const offVoice = onVoiceIssue(setLink);
    return () => {
      cancelled = true;
      clearInterval(id);
      clearInterval(renew);
      offVoice();
    };
  }, [loadLanguage]);

  /** The child pressed a button on the Board: her request, Silia stops talking. */
  function childTurn() {
    const turn = newTurn();
    turnRef.current = turn;
    if (speakingRef.current) {
      stopVoice();
      speakingRef.current = false;
    }
    return turn;
  }

  /** « Silia, regarde »: ask the Camera for a photo; no answer within 2 s (or it fails): read the photo on the Board. */
  function lookNow() {
    childTurn();
    setBusy(true);
    setMood('thinking');
    if (!channelRef.current) {
      void checkBoardPhoto('no live channel');
      return;
    }
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    if (lookRef.current) clearTimeout(lookRef.current.timer);
    lookRef.current = { id: requestId, timer: setTimeout(() => void checkBoardPhoto('camera did not answer in 2 s'), 2000) };
    log('board', `regarde: asking the Camera for a photo (${requestId})`);
    sendEvent(channelRef.current, 'capture.request', { request_id: requestId });
  }

  async function checkBoardPhoto(why: string) {
    if (lookRef.current) clearTimeout(lookRef.current.timer);
    lookRef.current = null;
    const snapshotId = photoIdRef.current;
    if (!snapshotId) {
      log('board', `regarde: ${why}, and no photo on the Board`);
      setBusy(false);
      setMood('idle');
      setLink('pas de photo : place le téléphone au-dessus du cahier');
      return;
    }
    log('board', `regarde: ${why} -> reading the Board photo ${snapshotId}`);
    const { error } = await supabase.functions.invoke('analyze-snapshot', { body: { snapshot_id: snapshotId, turn: turnRef.current ?? newTurn() } });
    if (error) {
      setBusy(false);
      setMood('idle');
      setLink(`regarde : ${await functionError(error)}`);
    }
  }
  checkBoardPhotoRef.current = (why) => void checkBoardPhoto(why);

  /** Typed answer on the Board ("8"): same path as speaking to Silia. */
  async function sendAnswer() {
    markActivity();
    const text = typed.trim();
    if (!session || !text) return;
    const turn = childTurn();
    setTyped('');
    setMood('thinking');
    const { error } = await sendTyped(session.id, text, turn);
    if (error) {
      setMood('idle');
      setLink(`réponse : ${error}`);
    }
  }

  /** Exercise help and choices: same server logic as the child's voice requests. */
  async function help(choice?: ExerciseChoice, action?: HelpAction | 'choose') {
    markActivity();
    if (!session) return;
    const turn = childTurn();
    setBusy(true);
    setChoices([]);
    setPickOpen(false);
    setMood('thinking');
    const { error } = await requestHelp(session.id, { choice, action, turn });
    if (error) {
      setBusy(false);
      setMood('idle');
      setLink(`exercice : ${error}`);
    }
  }

  /** The page shows sideways: turn it a quarter, for the whole session (saved, shared with every screen). */
  async function rotate() {
    if (!session || !photo) return;
    const next = (((sessionRotation ?? 0) + 90) % 360) as 0 | 90 | 180 | 270;
    setSessionRotation(next);
    if (channelRef.current) sendEvent(channelRef.current, 'session.rotation', { rotation: next });
    await supabase.from('homework_sessions').update({ rotation: next }).eq('id', session.id);
  }

  function start() {
    startedRef.current = true;
    setStarted(true);
    sayFamiliar('greeting', GREETING);
  }

  // The active exercise stays framed on its photo while nothing else is drawn.
  const focusFrame: Annotation[] =
    focus?.region && focus.snapshot_id === photo?.id ? [{ shape: 'text', region: focus.region, text: exerciseName(focus), color: '#7FD3FF' }] : [];
  const shown = annotations.length ? annotations : focusFrame;
  const active = !!session && session.status === 'active';
  const suggestedChoice = choices.find((c) => c.index === suggested) ?? choices[0];
  const guide = result?.mode === 'guide';
  const rtl = bubbleLang === 'ar' || bubbleLang === 'fus';
  const statusLabel = t(
    !session ? 'En attente de la caméra' : session.status === 'paused' ? 'En pause' : scanning ? 'Je regarde ta page…' : 'Devoirs en cours',
  );
  const statusColor = !session ? paper.inkFaint : session.status === 'paused' || scanning ? paper.yellow : paper.green;
  const next = result?.next;
  // What the left page's header shows: the exercises to choose from, the checked exercise, the active one, or the invitation.
  const chalkNumber = choices.length ? null : result ? (result.label ?? String(result.exercise_index)) : focus ? exerciseName(focus) : null;
  const chalkTitle = choices.length
    ? t('Je vois {n} exercices', { n: choices.length })
    : (result?.title ?? focus?.title ?? t('Quand tu as fini, appuie sur « {name}, regarde »', { name: TUTOR_NAME }));
  const chalkInstr = choices.length ? t('Lequel on commence ?') : result?.instr;

  // « Parler » on the Board itself (TV with a microphone, tablet, one phone): same path as the Camera's button.
  const {
    talk,
    seconds,
    start: startTalk,
    stop: stopTalk,
  } = useTalk({
    sessionId: session?.id,
    channel: () => channelRef.current,
    makeTurn: childTurn,
    onStart: () => {
      markActivity();
      setChoices([]);
      setMood('listening');
    },
    onSent: () => setMood('thinking'),
    onProblem: (text) => {
      setMood('idle');
      setBubble(text);
    },
  });

  const rightCount = result ? result.lines.filter((l) => l.status === 'right').length : 0;
  const avatarWidth = compact ? 84 : Math.min(result ? 130 : 200, Math.round(height * (result ? 0.18 : 0.27)));
  const dirOf = (text?: string) => (text && ARABIC.test(text) ? styles.rtl : null);

  /** Phone turned sideways: the photo keeps the whole left page; the exercise and the choices go to Silia's page. */
  const side = compact && landscape;
  /** The exercise in one short line (number, title, instruction): the photo keeps the height. */
  const headerEl = (
    <View style={[styles.headerCard, compact && styles.headerCardCompact]}>
      <Washi width={compact ? 54 : 72} tilt={-4} style={styles.headerTape} />
      {chalkNumber ? <Text style={[styles.number, compact && styles.numberCompact]}>{chalkNumber}</Text> : null}
      <Text style={[styles.headLine, dirOf(chalkTitle)]} numberOfLines={compact ? 2 : 1}>
        <Text style={[styles.exTitle, compact && styles.exTitleCompact]}>{chalkTitle}</Text>
        {chalkInstr ? <Text style={[styles.instr, compact && styles.instrCompact]}>{`  ·  ${chalkInstr}`}</Text> : null}
      </Text>
    </View>
  );
  /** Expliquer / Résoudre ensemble / Autre exercice. */
  const actionButtons = focus ? (
    <>
      {(['explain', 'solve'] as const).map((a) => (
        <ChunkyButton
          key={a}
          label={t(ACTION_LABEL[a])}
          color={focus.action === a ? 'blue' : 'white'}
          size="sm"
          disabled={busy}
          onPress={() => help(undefined, a)}
        />
      ))}
    </>
  ) : null;
  const pickWide = width >= 700;
  const choicesEl = choices.length ? (
    <ScrollView style={styles.pickScroll} contentContainerStyle={styles.pickGrid}>
      {suggestedChoice ? (
        <ChunkyButton
          label={t('Oui, le {ex}', { ex: exerciseName(suggestedChoice) })}
          icon="check"
          color="green"
          size={compact ? 'sm' : 'md'}
          onPress={() => help(suggestedChoice)}
          style={{ width: '100%' }}
        />
      ) : null}
      {choices.map((c, i) => {
        const on = c.index === suggestedChoice?.index;
        return (
          <Pressable
            key={c.index}
            accessibilityRole="button"
            accessibilityLabel={t('Exercice {ex} : {title}', { ex: exerciseName(c), title: c.title })}
            onPress={() => help(c)}
            style={({ pressed }) => [
              styles.choice,
              { width: pickWide ? '31.5%' : '100%' },
              { backgroundColor: STICKIES[i % STICKIES.length], transform: [{ rotate: `${i % 2 ? 1 : -0.8}deg` }] },
              on && styles.choiceOn,
              pressed && { transform: [{ translateX: 3 }, { translateY: 3 }], ...hardShadow(1) },
            ]}
          >
            <Text style={styles.choiceNumber}>{exerciseName(c)}</Text>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.choiceTitle, dirOf(c.title)]} numberOfLines={2}>
                {c.title}
              </Text>
              <Text style={styles.choiceStatus}>{t(CHOICE_STATUS[c.status])}</Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  ) : null;
  /** Long sentences get a smaller font, so the Post-it never eats the correction below it. */
  const speechSize = bubble.length > 260 ? styles.speechSmall : bubble.length > 150 ? styles.speechMedium : null;
  /** TV at 720p, laptops: the index tabs get shorter so all of them stay on screen. */
  const shortTabs = !compact && height < 900;

  /** Her answers, checked: an index card with ✓ and ✗, on her page in place of the photo. */
  const correctionEl = result ? (
    <View style={[styles.indexCard, styles.indexCardPage, compact && styles.cardCompact]}>
      <View style={styles.indexRule} />
      <Text style={styles.cardLabel}>{t(result.mode === 'solution' ? 'Solution' : 'Correction')}</Text>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: compact ? 3 : 8 }}>
        {result.lines.slice(0, 12).map((l, i) =>
          l.solution ? (
            // « Solution »: the question (may be long) and, on its own line and never cut, the right answer
            <View key={i} style={styles.lineRow}>
              <Text style={[styles.mark, { color: MARK_COLOR[l.status] }]}>{MARK[l.status]}</Text>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.lineText, compact && styles.lineTextCompact, dirOf(l.q)]} numberOfLines={3}>
                  {l.q}
                </Text>
                {l.status === 'wrong' && l.a ? (
                  <Text style={[styles.lineMine, compact && styles.lineTextCompact]}>{t('Ta réponse : {a}', { a: l.a })}</Text>
                ) : null}
                <Text style={[styles.lineAnswer, compact && styles.lineTextCompact, dirOf(l.solution)]}>→ {l.solution}</Text>
              </View>
            </View>
          ) : (
            <View key={i} style={styles.lineRow}>
              <Text style={[styles.mark, { color: MARK_COLOR[l.status] }]}>{MARK[l.status]}</Text>
              <Text
                style={[
                  styles.lineText,
                  compact && styles.lineTextCompact,
                  dirOf(l.q),
                  l.status === 'wrong' && styles.lineWrong,
                  l.status === 'empty' && { opacity: 0.55 },
                ]}
                numberOfLines={3}
              >
                {lineText(l)}
              </Text>
            </View>
          ),
        )}
      </ScrollView>
      {/* Silia can misread: the child may say so */}
      <Text style={[styles.aiNote, compact && styles.aiNoteCompact]}>{t('{name} peut se tromper. Tu penses avoir raison ? Dis-le-lui !', { name: TUTOR_NAME })}</Text>
    </View>
  ) : null;
  const showCorrection = !!result && !choices.length && correctionView && !(practice && practiceView);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <Desk style={[styles.deskPad, compact && styles.deskPadCompact]}>
        {/* On the desk, above the binder: Silia's name taped on, the state on a sticky note, a few desk tools. */}
        <View style={[styles.topRow, compact && { minHeight: 36, gap: 8 }]}>
          {/* the state, as a dot: green = homework in progress, yellow = looking / paused, grey = waiting for the camera */}
          <View
            accessible
            accessibilityRole="image"
            accessibilityLabel={statusLabel}
            style={[styles.stateDot, compact && styles.stateDotCompact, { backgroundColor: statusColor }]}
          />
          {session ? (
            <View style={[styles.answerBar, guide && styles.answerBarGuide, compact && styles.answerBarCompact]}>
              <PaperInput
                value={typed}
                onChangeText={setTyped}
                placeholder={t(guide ? 'Ta réponse…' : 'Écris ta réponse…')}
                returnKeyType="send"
                onSubmitEditing={sendAnswer}
                style={[styles.answerTop, compact && styles.answerTopCompact]}
                maxLength={200}
              />
              {typed.trim() ? (
                <Chunky
                  onPress={sendAnswer}
                  color="green"
                  radius={12}
                  depth={4}
                  style={[styles.barButton, compact && styles.barButtonCompact]}
                  accessibilityLabel={t('Envoyer ma réponse')}
                >
                  <Icon name="send" size={compact ? 18 : 22} color={paper.ink} />
                </Chunky>
              ) : null}
              <Chunky
                onPress={talk === 'recording' ? stopTalk : startTalk}
                color={talk === 'recording' ? 'red' : 'yellow'}
                radius={compact ? 18 : 24}
                depth={4}
                disabled={talk === 'sending' || !active}
                style={[styles.barButton, styles.micButton, compact && styles.barButtonCompact]}
                accessibilityLabel={talk === 'recording' ? t('J’ai fini de parler') : t('Parler à {name}', { name: TUTOR_NAME })}
              >
                <Icon name={talk === 'recording' ? 'stop' : 'mic'} size={compact ? 18 : 24} color={paper.ink} />
              </Chunky>
              {talk === 'recording' ? <Text style={styles.micTime}>{seconds} s</Text> : null}
            </View>
          ) : null}
          {/* Only problems are shown (connection lost, voice or photo error); nothing while all is fine. */}
          {session && link !== 'en direct' && link !== 'connexion…' ? (
            <Text style={styles.problem} numberOfLines={1}>
              {link}
            </Text>
          ) : null}
          <View style={{ flex: 1 }} />
          {/* what to do with this exercise: on the desk, next to « Exercices » (on a small screen, under the correction) */}
          {focus && !choices.length && !compact ? <View style={styles.deskActions}>{actionButtons}</View> : null}
          {session && (photo || choices.length) ? (
            <>
              <ChunkyButton
                label={t('Exercices')}
                icon="list"
                color={choices.length ? 'yellow' : 'white'}
                size="sm"
                disabled={!active || (busy && !choices.length)}
                onPress={() => (choices.length ? setPickOpen(true) : help(undefined, 'choose'))}
              />
              {solo ? null : <View style={styles.deskDivider} />}
            </>
          ) : null}
          {solo ? (
            <ChunkyButton label={t('Retour à la caméra')} icon="camera" size={compact ? 'sm' : 'md'} onPress={backToCamera} />
          ) : (
            <View style={styles.deskTools}>
              {Platform.OS === 'web' ? (
                <DeskButton icon="expand" label={t('Plein écran')} onPress={() => (globalThis as any).document?.documentElement?.requestFullscreen?.()} />
              ) : null}
              <DeskButton icon="refresh" label={t('Recharger')} onPress={reload} />
              <DeskButton icon="unlink" label={t('Délier')} onPress={unpair} />
            </View>
          )}
        </View>

        <View style={[styles.binderRow, !landscape && { flexDirection: 'column' }]}>
          {/* the open ring binder: her homework on the left, Silia's page on the right */}
          <View style={[styles.binder, compact && styles.binderCompact, !landscape && { flexDirection: 'column' }]}>
            {/* LEFT PAGE: the exercise and the photo of her page, on ruled notebook paper */}
            <NotebookPage style={[styles.leftPage, compact && styles.pageCompact, compact && styles.leftPageCompact]} top={compact ? 18 : 30}>
              <View style={[styles.leftInner, compact && styles.innerCompact, compact && landscape && styles.leftInnerSide]}>
                {side ? null : headerEl}

                {/* the ruler: how far she got (right answers out of all) */}
                {result && result.lines.length && result.mode !== 'solution' && !choices.length && !compact ? (
                  <Ruler value={rightCount} total={result.lines.length} label={`${rightCount}/${result.lines.length} ✓`} />
                ) : null}

                <View style={styles.workRow}>
                  <View style={styles.photoArea}>
                    {showCorrection ? (
                      <View style={styles.correctionSpot}>
                        {correctionEl}
                        <View style={styles.flipSpotCard}>
                          <ChunkyButton label={`‹ ${t('Photo')}`} color="white" size="sm" onPress={() => setCorrectionView(false)} />
                        </View>
                      </View>
                    ) : practice && practiceView ? (
                      // the similar exercise, written on a small chalkboard pinned to the page
                      <View style={styles.miniBoard}>
                        <PracticeBoard practice={practice} />
                      </View>
                    ) : photo ? (
                      // her page as a Polaroid taped on the notebook
                      <View style={[styles.photoFrame, compact && styles.photoFrameCompact]}>
                        <Washi color="#B9D7FF" width={compact ? 60 : 90} tilt={6} style={styles.photoTape} />
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={t('Agrandir la photo')}
                          onPress={() => setPhotoBig(true)}
                          style={styles.photoTap}
                        >
                          <AnnotatedPhoto
                            uri={photo.uri}
                            width={photo.width}
                            height={photo.height}
                            rotation={sessionRotation ?? 0}
                            annotations={shown}
                            scanning={scanning}
                          />
                        </Pressable>
                        <View style={styles.rotateSpot}>
                          <DeskButton glyph="↻" label={t('Tourner la page')} onPress={rotate} />
                        </View>
                        {result && !choices.length ? (
                          <View style={styles.flipSpot}>
                            <ChunkyButton label={`${t('Correction')} ›`} color="white" size="sm" onPress={() => setCorrectionView(true)} />
                          </View>
                        ) : null}
                      </View>
                    ) : (
                      <View style={styles.emptyPhoto}>
                        <Icon name="camera" size={compact ? 32 : 48} color={paper.inkFaint} />
                      </View>
                    )}
                    {practice ? (
                      <View style={styles.practiceTabs}>
                        <ChunkyButton
                          label={t(practiceView ? 'Voir la photo' : 'Exercice similaire')}
                          color="white"
                          size="sm"
                          onPress={() => setPracticeView((v) => !v)}
                        />
                        <ChunkyButton
                          label={t('Fermer')}
                          color="white"
                          size="sm"
                          onPress={() => {
                            setPractice(null);
                            setPracticeView(true);
                          }}
                        />
                      </View>
                    ) : null}
                  </View>
                </View>
              </View>
            </NotebookPage>

            {landscape ? <BinderRings compact={compact} /> : null}

            {/* RIGHT PAGE: Silia's zone, on graph paper */}
            <GraphPaper style={[styles.rightPage, compact && styles.pageCompact]}>
              <View style={[styles.rightInner, compact && styles.innerCompact]}>
                {/* what she says: a Post-it taped on the page */}
                <View style={[styles.speech, compact && styles.speechCompact]}>
                  <Washi color="#FFB4A2" width={compact ? 54 : 80} tilt={4} style={styles.speechTape} />
                  <ScrollView style={{ flexGrow: 0 }} showsVerticalScrollIndicator>
                    <Text style={[styles.speechText, speechSize, compact && styles.speechTextCompact, rtl && styles.rtlSpeech]}>{bubble}</Text>
                  </ScrollView>
                </View>

                <View style={styles.teacherRow}>
                  <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.teacherCol} keyboardShouldPersistTaps="handled">
                    {side ? headerEl : null}
                    {/* what to do next with this exercise */}
                    {focus && !choices.length ? (
                      <View style={styles.actions}>
                        {next && result ? (
                          <ChunkyButton
                            label={t('Exercice {ex} →', { ex: next.label ?? next.index })}
                            color="green"
                            size={compact ? 'sm' : 'md'}
                            onPress={() => help({ index: next.index, title: next.title, status: 'empty', label: next.label }, 'correct')}
                          />
                        ) : null}
                        {compact ? actionButtons : null}
                      </View>
                    ) : null}
                  </ScrollView>

                  {/* Silia herself, in a Polaroid clipped to her page (on a sideways phone, only while her page is empty:
                      the cards need the whole width) */}
                  {side && (choices.length || result || focus) ? null : (
                    <View style={styles.avatarSpot}>
                      <Polaroid caption={TUTOR_NAME} width={avatarWidth} tilt={3}>
                        <Avatar mood={mood} reaction={reaction} language={bubbleLang} />
                      </Polaroid>
                    </View>
                  )}
                </View>
              </View>
            </GraphPaper>
          </View>

          {/* binder index tabs sticking out of the right edge: the big actions */}
          {tv ? null : (
            <View style={[styles.tabs, shortTabs && styles.tabsShort, compact && styles.tabsCompact, !landscape && styles.tabsRow]}>
              {solo ? null : (
                <IndexTab
                  icon="eye"
                  label={t('{name}, regarde', { name: TUTOR_NAME })}
                  color={paper.yellow}
                  primary
                  compact={compact}
                  short={shortTabs}
                  onPress={lookNow}
                  loading={busy && scanning}
                  disabled={!active}
                />
              )}
              {(focus || result) && !choices.length ? (
                <IndexTab
                  icon="copy"
                  label={t('Exercice similaire')}
                  color="#FF9EB5"
                  compact={compact}
                  short={shortTabs}
                  onPress={() => help(undefined, 'similar')}
                  disabled={busy || !active}
                />
              ) : null}
              {solutionOn && (focus || result) && !choices.length ? (
                <IndexTab
                  icon="key"
                  label={t('Solution')}
                  color={paper.green}
                  compact={compact}
                  short={shortTabs}
                  onPress={() => help(undefined, 'solution')}
                  disabled={busy || !active}
                />
              ) : null}
              <IndexTab
                icon="speaker"
                label={t('Répéter')}
                color={paper.blue}
                compact={compact}
                short={shortTabs}
                onPress={() => speak(lastTextRef.current, lastVoiceRef.current)}
              />
            </View>
          )}
        </View>
      </Desk>

      {photo ? (
        <Modal visible={photoBig} transparent animationType="fade" onRequestClose={() => setPhotoBig(false)} supportedOrientations={['landscape', 'portrait']}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('Fermer')} onPress={() => setPhotoBig(false)} style={styles.bigBackdrop}>
            <View style={styles.bigFrame}>
              <AnnotatedPhoto
                uri={photo.uri}
                width={photo.width}
                height={photo.height}
                rotation={sessionRotation ?? 0}
                annotations={shown}
                scanning={scanning}
              />
            </View>
            <View style={styles.bigClose}>
              <ChunkyButton label={t('Fermer')} color="white" size="sm" onPress={() => setPhotoBig(false)} />
            </View>
          </Pressable>
        </Modal>
      ) : null}

      <Modal
        visible={pickOpen && choices.length > 0}
        transparent
        animationType="fade"
        onRequestClose={() => setPickOpen(false)}
        supportedOrientations={['landscape', 'portrait']}
      >
        <View style={styles.bigBackdrop}>
          <View style={[styles.pickCard, { width: Math.min(960, width - 24), maxHeight: height - 24 }, compact && styles.pickCardCompact]}>
            <Washi width={110} tilt={-3} style={styles.startTape} />
            <View style={styles.pickHead}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.pickTitle, compact && styles.exTitleCompact]}>{t('Je vois {n} exercices', { n: choices.length })}</Text>
                <Text style={[styles.instr, compact && styles.instrCompact]}>{t('Lequel on commence ?')}</Text>
              </View>
              <ChunkyButton label={t('Fermer')} color="white" size="sm" onPress={() => setPickOpen(false)} />
            </View>
            {choicesEl}
          </View>
        </View>
      </Modal>

      {!started ? (
        <View style={styles.startOverlay}>
          <View style={styles.startCard}>
            <Washi width={120} tilt={-3} style={styles.startTape} />
            <Polaroid caption={TUTOR_NAME} width={compact ? 110 : 170} tilt={-4}>
              <Avatar mood="idle" />
            </Polaroid>
            <View style={styles.startTexts}>
              <Text style={styles.startHint}>{t('Active {name}, ta maîtresse.', { name: TUTOR_NAME })}</Text>
              <ChunkyButton label={t('Commencer les devoirs')} icon="play" onPress={start} />
              <Text style={styles.startNote}>{t('{name} est une IA : elle peut mal lire une photo ou se tromper. Vérifie ses corrections : c’est une aide aux devoirs, elle ne remplace ni l’enseignant ni toi.', { name: TUTOR_NAME })}</Text>
            </View>
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const ARABIC = /[؀-ۿ]/;
const STICKIES = [paper.stickyYellow, paper.stickyPink, paper.stickyGreen, paper.stickyBlue];
const MARK: Record<ResultLine['status'], string> = { right: '✓', wrong: '✗', unsure: '?', open: '?', empty: '·' };
const MARK_COLOR: Record<ResultLine['status'], string> = {
  right: '#1E8E4E',
  wrong: '#D63B30',
  unsure: paper.blueInk,
  open: paper.blueInk,
  empty: paper.inkFaint,
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#EFE6DD' },
  deskPad: { padding: 18, paddingTop: 10, gap: 12 },
  deskPadCompact: { padding: 8, paddingTop: 4, gap: 6 },
  // desk top
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 50, zIndex: 2 },
  nameLabel: {
    backgroundColor: paper.card,
    borderWidth: 2,
    borderColor: paper.ink,
    borderRadius: 6,
    paddingHorizontal: 16,
    paddingVertical: 4,
    transform: [{ rotate: '-2deg' }],
    ...hardShadow(4),
  },
  nameTape: { position: 'absolute', top: -12, left: -14 },
  name: { ...font.bold, color: paper.ink, fontSize: 28 },
  nameCompact: { fontSize: 16 },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 2,
    borderColor: paper.ink,
    borderRadius: 3,
    borderBottomRightRadius: 12,
    paddingHorizontal: 12,
    height: 38,
    transform: [{ rotate: '1deg' }],
    ...hardShadow(3),
    flexShrink: 1,
  },
  statusDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 1.5, borderColor: paper.ink },
  statusText: { ...font.semi, color: paper.ink, fontSize: 15 },
  problem: { ...font.medium, color: '#C0392B', fontSize: 13, maxWidth: 260 },
  deskTools: { flexDirection: 'row', gap: 10 },
  // the binder
  binderRow: { flex: 1, flexDirection: 'row', minHeight: 0 },
  binder: {
    flex: 1,
    flexDirection: 'row',
    minWidth: 0,
    minHeight: 0,
    backgroundColor: '#3E5C9A', // the cover, seen around the pages
    borderWidth: 3,
    borderColor: paper.ink,
    borderRadius: 16,
    padding: 10,
    ...hardShadow(6),
    zIndex: 1,
  },
  binderCompact: { padding: 5, borderRadius: 10 },
  leftPage: { flex: 1.25, minWidth: 0, borderWidth: 2, borderColor: paper.ink, borderTopLeftRadius: 8, borderBottomLeftRadius: 8, overflow: 'hidden' },
  rightPage: { flex: 1, minWidth: 0, borderWidth: 2, borderColor: paper.ink, borderTopRightRadius: 8, borderBottomRightRadius: 8, overflow: 'hidden' },
  pageCompact: { borderRadius: 4 },
  leftInner: { flex: 1, paddingLeft: 52, paddingRight: 18, paddingVertical: 16, gap: 14, minHeight: 0 },
  rightInner: { flex: 1, padding: 18, gap: 14, minHeight: 0 },
  innerCompact: { paddingLeft: 40, paddingRight: 8, padding: 8, gap: 6 },
  // left page
  headerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: paper.card,
    borderWidth: 2,
    borderColor: paper.ink,
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 12,
    ...hardShadow(3),
  },
  headerCardCompact: { paddingVertical: 5, paddingHorizontal: 8, gap: 6 },
  headerTape: { position: 'absolute', top: -10, left: 16, height: 16 },
  headLine: { flex: 1, minWidth: 0, lineHeight: 22 },
  stateDot: { width: 20, height: 20, borderRadius: 10, borderWidth: 2.5, borderColor: paper.ink, ...hardShadow(2) },
  stateDotCompact: { width: 14, height: 14, borderRadius: 7, borderWidth: 2 },
  deskActions: { flexDirection: 'row', gap: 10 },
  deskDivider: { width: 2, height: 30, backgroundColor: '#C9B49A' },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  number: {
    ...font.bold,
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: paper.ink,
    backgroundColor: paper.yellow,
    color: paper.ink,
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 24,
    paddingHorizontal: 4,
    overflow: 'hidden',
  },
  numberCompact: { minWidth: 24, height: 24, borderRadius: 12, fontSize: 13, lineHeight: 20 },
  exTitle: { ...font.bold, color: paper.ink, fontSize: 18 },
  exTitleCompact: { fontSize: 15 },
  instr: { ...font.medium, color: paper.inkSoft, fontSize: 15 },
  instrCompact: { fontSize: 12 },
  workRow: { flex: 1, flexDirection: 'row', gap: 14, minHeight: 0 },
  photoArea: { flex: 1, minWidth: 0, minHeight: 0, alignItems: 'center', justifyContent: 'center' },
  photoFrame: {
    flex: 1,
    alignSelf: 'stretch',
    backgroundColor: paper.card,
    borderWidth: 2,
    borderStyle: 'solid',
    borderColor: paper.ink,
    borderRadius: 4,
    padding: 10,
    paddingBottom: 26,
    transform: [{ rotate: '-0.8deg' }],
    ...hardShadow(5),
  },
  photoFrameCompact: { padding: 3, paddingBottom: 8, transform: [{ rotate: '-0.4deg' }] },
  photoTap: { flex: 1 },
  leftPageCompact: { flex: 1.35 },
  leftInnerSide: { paddingLeft: 26, paddingRight: 8, paddingVertical: 8 },
  bigBackdrop: { flex: 1, backgroundColor: 'rgba(45,49,66,0.85)', padding: 12, alignItems: 'center', justifyContent: 'center' },
  bigFrame: {
    flex: 1,
    alignSelf: 'stretch',
    backgroundColor: paper.card,
    borderWidth: 3,
    borderColor: paper.ink,
    borderRadius: 6,
    padding: 8,
    ...hardShadow(6),
  },
  bigClose: { position: 'absolute', top: 18, right: 18 },
  photoTape: { position: 'absolute', top: -10, right: 30, zIndex: 3 },
  rotateSpot: { position: 'absolute', right: -10, bottom: -10, zIndex: 3 },
  emptyPhoto: {
    flex: 1,
    alignSelf: 'stretch',
    borderWidth: 2.5,
    borderStyle: 'dashed',
    borderColor: paper.inkFaint,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniBoard: { flex: 1, alignSelf: 'stretch', backgroundColor: paper.chalkboard, borderWidth: 8, borderColor: paper.wood, borderRadius: 10, ...hardShadow(5) },
  practiceTabs: { position: 'absolute', top: -6, right: 0, flexDirection: 'row', gap: 8, zIndex: 4 },
  pickCard: { backgroundColor: paper.page, borderWidth: 3, borderColor: paper.ink, borderRadius: 10, padding: 22, paddingTop: 26, gap: 16, ...hardShadow(8) },
  pickCardCompact: { padding: 12, paddingTop: 16, gap: 10 },
  pickHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  pickTitle: { ...font.bold, color: paper.ink, fontSize: 24 },
  pickScroll: { flexGrow: 0, flexShrink: 1 },
  pickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, padding: 6, paddingBottom: 12 },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 2,
    borderColor: paper.ink,
    borderRadius: 3,
    borderBottomRightRadius: 14,
    padding: 10,
    ...hardShadow(4),
  },
  choiceOn: { borderWidth: 3, ...hardShadow(6) },
  choiceNumber: {
    ...font.bold,
    minWidth: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: paper.ink,
    backgroundColor: paper.card,
    color: paper.ink,
    fontSize: 17,
    textAlign: 'center',
    lineHeight: 30,
    overflow: 'hidden',
  },
  choiceTitle: { ...font.semi, color: paper.ink, fontSize: 16, lineHeight: 20 },
  choiceStatus: { ...font.regular, color: paper.inkSoft, fontSize: 13 },
  // right page
  speech: {
    maxHeight: '50%',
    flexShrink: 1,
    backgroundColor: paper.stickyYellow,
    borderWidth: 2,
    borderColor: paper.ink,
    borderRadius: 3,
    borderBottomRightRadius: 22,
    padding: 18,
    paddingTop: 20,
    transform: [{ rotate: '-1deg' }],
    ...hardShadow(5),
  },
  speechCompact: { padding: 8, paddingTop: 10 },
  speechTape: { position: 'absolute', top: -12, alignSelf: 'center' },
  speechText: { ...font.semi, color: paper.ink, fontSize: 24, lineHeight: 32 },
  speechMedium: { fontSize: 20, lineHeight: 27 },
  speechSmall: { fontSize: 18, lineHeight: 24 },
  speechTextCompact: { fontSize: 14, lineHeight: 18 },
  rtlSpeech: { writingDirection: 'rtl', textAlign: 'right', fontSize: 27, lineHeight: 42 },
  teacherRow: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 12, minHeight: 0 },
  teacherCol: { gap: 14, padding: 4, paddingBottom: 10 },
  indexCard: { backgroundColor: paper.card, borderWidth: 2, borderColor: paper.ink, borderRadius: 6, padding: 14, paddingTop: 10, gap: 6, ...hardShadow(5) },
  indexRule: { position: 'absolute', left: 0, right: 0, top: 38, height: 2, backgroundColor: paper.margin },
  indexCardPage: { flex: 1, alignSelf: 'stretch', transform: [{ rotate: '-0.4deg' }] },
  correctionSpot: { flex: 1, alignSelf: 'stretch', minHeight: 0 },
  flipSpot: { position: 'absolute', top: -8, left: -6, zIndex: 4 },
  flipSpotCard: { position: 'absolute', bottom: -8, right: -6, zIndex: 4 },
  cardCompact: { padding: 8, gap: 3 },
  cardLabel: { ...font.hand, color: paper.blueInk, fontSize: 24, marginBottom: 4 },
  lineRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  mark: { ...font.bold, width: 22, fontSize: 22, lineHeight: 28 },
  lineText: { ...font.medium, color: paper.ink, fontSize: 19, lineHeight: 26, flexShrink: 1 },
  lineTextCompact: { fontSize: 13, lineHeight: 17 },
  lineAnswer: { ...font.bold, color: '#1E8E4E', fontSize: 20, lineHeight: 26, marginTop: 2 },
  lineMine: { ...font.medium, color: '#D63B30', fontSize: 15, lineHeight: 20, textDecorationLine: 'line-through' },
  lineWrong: { color: '#D63B30', textDecorationLine: 'underline', textDecorationStyle: 'dotted' },
  answerBar: { flex: 1, maxWidth: 420, flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 },
  answerBarGuide: {
    backgroundColor: paper.stickyGreen,
    borderWidth: 2,
    borderColor: paper.ink,
    borderRadius: 14,
    padding: 4,
    paddingRight: 8,
    ...hardShadow(3),
  },
  answerBarCompact: { gap: 6, maxWidth: 360 },
  answerTop: { flex: 1, minWidth: 0, minHeight: 46, fontSize: 18, paddingVertical: 6 },
  answerTopCompact: { minHeight: 36, fontSize: 15, paddingHorizontal: 10 },
  barButton: { width: 48, height: 46 },
  micButton: { width: 48, height: 48 },
  barButtonCompact: { width: 38, height: 36 },
  micTime: { ...font.bold, color: '#D63B30', fontSize: 15 },
  answerCard: { backgroundColor: paper.card, borderWidth: 2, borderColor: paper.ink, borderRadius: 6, padding: 12, gap: 8, ...hardShadow(5) },
  answerCardGuide: { backgroundColor: paper.stickyGreen, borderWidth: 3 },
  answerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  answerInput: { flex: 1, minWidth: 0 },
  hint: { ...font.regular, color: paper.inkSoft, fontSize: 14 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  avatarSpot: { paddingBottom: 6, paddingRight: 4 },
  rtl: { writingDirection: 'rtl', textAlign: 'right' },
  // index tabs
  tabs: { gap: 14, paddingTop: 34, marginLeft: -3, zIndex: 0 },
  tabsShort: { gap: 10, paddingTop: 18 },
  tabsCompact: { gap: 6, paddingTop: 12 },
  tabsRow: { flexDirection: 'row', paddingTop: 8, marginLeft: 0 },
  // start
  startOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(45,49,66,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  startCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 28,
    backgroundColor: paper.page,
    borderWidth: 3,
    borderColor: paper.ink,
    borderRadius: 10,
    paddingHorizontal: 36,
    paddingVertical: 30,
    ...hardShadow(8),
  },
  startTape: { position: 'absolute', top: -12, left: '40%' },
  startTexts: { gap: 18, maxWidth: 380 },
  startNote: { ...font.regular, color: paper.inkSoft, fontSize: 14, lineHeight: 19 },
  aiNote: { ...font.medium, color: paper.inkSoft, fontSize: 14, lineHeight: 19, borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: paper.inkFaint, paddingTop: 6 },
  aiNoteCompact: { fontSize: 11, lineHeight: 14, paddingTop: 3 },
  startHint: { ...font.semi, color: paper.ink, fontSize: 24, lineHeight: 30 },
});
