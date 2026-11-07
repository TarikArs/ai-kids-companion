import type { Annotation, ExerciseChoice, ExerciseFocus, HelpAction, SessionEvents, TurnRef } from '@hc/shared';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { Caveat_600SemiBold, Caveat_700Bold, useFonts } from '@expo-google-fonts/caveat';
import { useKeepAwake } from 'expo-keep-awake';
import { router, useLocalSearchParams } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FocusPressable as Pressable } from '@/components/focus-pressable';
import { TopButton } from '@/components/top-button';
import { AnnotatedPhoto } from '@/features/board/annotated-photo';
import { Avatar, type AvatarMood, type AvatarReaction } from '@/features/board/avatar';
import { PracticeBoard, type PracticeView } from '@/features/board/practice-board';
import { ACTION_LABEL, exerciseName, requestHelp, sendTyped } from '@/lib/exercise';
import { log } from '@/lib/log';
import { loadPhrases, pickPhrase } from '@/lib/phrases';
import { findOpenSession, newTurn, onEvent, sendEvent, sessionChannel, type HomeworkSession } from '@/lib/session';
import { useAppStore } from '@/lib/store';
import { functionError, supabase } from '@/lib/supabase';
import { colors, radius, space } from '@/lib/theme';
import { TUTOR_NAME } from '@/lib/tutor';
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
  const { width, height } = useWindowDimensions();
  const landscape = width >= height;
  /** A phone (one-phone mode, or a phone used as Board): smaller text and spacing so everything fits. */
  const compact = Math.min(width, height) < 500;
  /** Board width in landscape, in pixels (a percentage basis collapsed on Android). */
  const boardWidth = landscape ? Math.round(width * (compact ? 0.62 : 0.68)) : undefined;
  /** Chalk handwriting for the board. */
  const [fontsLoaded] = useFonts({ Caveat_600SemiBold, Caveat_700Bold });

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

  // Safety net: never stay "thinking" forever. After 25 s Silia says she could not read it.
  useEffect(() => {
    if (mood !== 'thinking') return;
    const timer = setTimeout(() => {
      log('board', 'no reply after 25 s');
      setScanning(false);
      setBusy(false);
      turnRef.current = null;
      if (!startedRef.current) return setMood('idle');
      const l = lang();
      const text = NO_ANSWER[l] ?? NO_ANSWER.fr;
      setBubble(text);
      setBubbleLang(l);
      speakRef.current(text, { language: l });
    }, 25_000);
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
    (kind: 'greeting' | 'pause' | 'resume' | 'end', fallback: string) => {
      const p = pickPhrase(kind, forcedLangRef.current ?? lastVoiceRef.current.language);
      const text = p?.text ?? fallback;
      setBubble(text);
      setBubbleLang(p?.lang ?? 'fr');
      speak(text, { language: p?.lang ?? 'fr', phrase: p?.audio_path });
    },
    [speak],
  );

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
        if (msg && pollBaselineRef.current === null) pollBaselineRef.current = msg.id; // older than this Board: never replay
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
        if (p.kind === 'praise' || p.kind === 'hint' || p.kind === 'explain') setReaction({ type: p.kind, at: Date.now() });
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
    if (!session) return;
    const turn = childTurn();
    setBusy(true);
    setChoices([]);
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
  const statusLabel = t(!session ? 'En attente de la caméra' : session.status === 'paused' ? 'En pause' : scanning ? 'Je regarde ta page…' : 'Devoirs en cours');
  const statusColor = !session ? colors.muted : session.status === 'paused' || scanning ? colors.accent : colors.success;
  const next = result?.next;
  /** Handwriting on the chalkboard (Caveat). Arabic text uses the system font: Caveat has no Arabic letters. */
  const chalk = (text: string | undefined, bold = false) =>
    text && ARABIC.test(text)
      ? styles.chalkRtl
      : fontsLoaded
        ? { fontFamily: bold ? 'Caveat_700Bold' : 'Caveat_600SemiBold' }
        : null;
  // What the chalk column shows: the exercises to choose from, the checked exercise, the active one, or the invitation.
  const chalkNumber = choices.length ? null : result ? (result.label ?? String(result.exercise_index)) : focus ? exerciseName(focus) : null;
  const chalkTitle = choices.length
    ? t('Je vois {n} exercices', { n: choices.length })
    : (result?.title ?? focus?.title ?? t('Quand tu as fini, appuie sur « {name}, regarde »', { name: TUTOR_NAME }));
  const chalkInstr = choices.length ? t('Lequel on commence ?') : result?.instr;

  return (
    <SafeAreaView style={[styles.root, compact && styles.rootCompact]}>
      {/* top bar: every button is an icon; the one focused with the remote opens with its label */}
      <View style={styles.header}>
        <Text style={styles.title}>{TUTOR_NAME}</Text>
        <Text style={styles.chip}>
          <Text style={{ color: statusColor }}>● </Text>
          {statusLabel}
        </Text>
        {/* Only problems are shown (connection lost, voice or photo error); nothing while all is fine. */}
        {session && link !== 'en direct' && link !== 'connexion…' ? (
          <Text style={[styles.chip, styles.chipMuted]} numberOfLines={1}>
            {link}
          </Text>
        ) : null}
        <View style={{ flex: 1 }} />
        {(focus || result) && !choices.length ? (
          <TopButton icon="copy" label={t('Exercice similaire')} onPress={() => help(undefined, 'similar')} disabled={busy || !active} />
        ) : null}
        {solutionOn && (focus || result) && !choices.length ? (
          <TopButton icon="key" label={t('Solution')} onPress={() => help(undefined, 'solution')} disabled={busy || !active} />
        ) : null}
        <TopButton icon="speaker" label={t('Répéter')} onPress={() => speak(lastTextRef.current, lastVoiceRef.current)} />
        {solo ? (
          <TopButton icon="camera" label={t('Retour à la caméra')} tone="primary" showLabel onPress={backToCamera} />
        ) : (
        <>
        <TopButton
          icon="eye"
          label={t('{name}, regarde', { name: TUTOR_NAME })}
          tone={choices.length ? 'normal' : 'primary'}
          onPress={lookNow}
          loading={busy && scanning}
          disabled={!active}
        />
        {choices.length && suggestedChoice ? (
          <TopButton icon="check" label={t('Oui, le {ex}', { ex: exerciseName(suggestedChoice) })} tone="primary" showLabel onPress={() => help(suggestedChoice)} />
        ) : null}
        <View style={styles.separator} />
        {Platform.OS === 'web' ? (
          <TopButton icon="expand" label={t('Plein écran')} tone="quiet" onPress={() => (globalThis as any).document?.documentElement?.requestFullscreen?.()} />
        ) : null}
        <TopButton icon="refresh" label={t('Recharger')} tone="quiet" onPress={reload} />
        <TopButton icon="unlink" label={t('Délier')} tone="quiet" onPress={unpair} />
        </>
        )}
      </View>

      <View style={[styles.main, compact && { gap: space.sm }, { flexDirection: landscape ? 'row' : 'column' }]}>
        {/* the board: the exercise in chalk on the left, the photo (or the practice exercise) on the right */}
        <View style={[styles.wood, compact && styles.woodCompact, landscape ? { width: boardWidth } : { flex: 2 }]}>
          <View style={[styles.chalkboard, compact && styles.chalkboardCompact, { flexDirection: landscape ? 'row' : 'column' }]}>
            <View style={[styles.chalkCol, landscape && boardWidth ? { width: Math.round(boardWidth * 0.36) } : null]}>
              <View style={styles.chalkHead}>
                {chalkNumber ? <Text style={[styles.chalkNumber, chalk(chalkNumber, true)]}>{chalkNumber}</Text> : null}
                <Text style={[styles.chalkTitle, compact && styles.chalkTitleCompact, chalk(chalkTitle, true)]} numberOfLines={3}>
                  {chalkTitle}
                </Text>
              </View>
              {chalkInstr ? (
                <>
                  <View style={styles.chalkLine} />
                  <Text style={[styles.chalkInstr, compact && styles.chalkInstrCompact, chalk(chalkInstr)]} numberOfLines={4}>
                    {chalkInstr}
                  </Text>
                </>
              ) : null}

              {choices.length ? (
                <View style={styles.chalkList}>
                  {choices.map((c) => {
                    const on = c.index === suggestedChoice?.index;
                    return (
                      <Pressable
                        key={c.index}
                        accessibilityRole="button"
                        accessibilityLabel={t('Exercice {ex} : {title}', { ex: exerciseName(c), title: c.title })}
                        onPress={() => help(c)}
                        style={[styles.chalkChoice, on && styles.chalkChoiceOn]}
                      >
                        <Text style={[styles.chalkItem, chalk(c.title, true), on && { color: '#7FD3FF' }]} numberOfLines={1}>
                          {exerciseName(c)} · {c.title}
                        </Text>
                        <Text style={[styles.chalkSmall, chalk(t(CHOICE_STATUS[c.status]))]}>{t(CHOICE_STATUS[c.status])}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : result ? (
                <View style={styles.chalkList}>
                  {result.lines.slice(0, 7).map((l, i) => (
                    <View key={i} style={styles.chalkRow}>
                      <Text style={[styles.chalkMark, { color: MARK_COLOR[l.status] }]}>{MARK[l.status]}</Text>
                      <Text
                        style={[styles.chalkItem, compact && styles.chalkItemCompact, chalk(l.q), l.status === 'wrong' && { color: WRONG_CHALK }, l.status === 'empty' && { opacity: 0.6 }]}
                        numberOfLines={2}
                      >
                        {lineText(l)}
                      </Text>
                    </View>
                  ))}
                  {next ? (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => help({ index: next.index, title: next.title, status: 'empty', label: next.label }, 'correct')}
                      style={styles.chalkPill}
                    >
                      <Text style={[styles.chalkItem, chalk(t('Exercice {ex} →'), true)]}>{t('Exercice {ex} →', { ex: next.label ?? next.index })}</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}

              <View style={{ flex: 1 }} />
              {focus && !choices.length ? (
                <View style={styles.chalkActions}>
                  {(['explain', 'solve'] as const).map((a) => (
                    <Pressable key={a} accessibilityRole="button" disabled={busy} onPress={() => help(undefined, a)} style={[styles.chalkPill, focus.action === a && styles.chalkPillOn]}>
                      <Text style={[styles.chalkSmall, chalk(t(ACTION_LABEL[a]), true)]}>{t(ACTION_LABEL[a])}</Text>
                    </Pressable>
                  ))}
                  <Pressable accessibilityRole="button" accessibilityLabel={t('Choisir un autre exercice')} onPress={() => help(undefined, 'choose')} style={styles.chalkPill}>
                    <Text style={[styles.chalkSmall, chalk(t('Autre exercice'), true)]}>{t('Autre exercice')}</Text>
                  </Pressable>
                </View>
              ) : null}
              {/* chalk on the ledge */}
              <View style={styles.chalkStick} />
            </View>

            <View style={styles.photoArea}>
              {practice && practiceView ? (
                <PracticeBoard practice={practice} />
              ) : photo ? (
                <>
                  <AnnotatedPhoto uri={photo.uri} width={photo.width} height={photo.height} rotation={sessionRotation ?? 0} annotations={shown} scanning={scanning} />
                  <Pressable accessibilityRole="button" accessibilityLabel={t('Tourner la page')} onPress={rotate} style={[styles.rotate, practice ? { top: 56 } : null]}>
                    <Text style={styles.rotateText}>↻</Text>
                  </Pressable>
                </>
              ) : null}
              {practice ? (
                <View style={styles.boardTabs}>
                  <Pressable accessibilityRole="button" onPress={() => setPracticeView((v) => !v)} style={styles.boardTab}>
                    <Text style={styles.boardTabText}>{t(practiceView ? 'Voir la photo' : 'Exercice similaire')}</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('Fermer l’exercice similaire')}
                    onPress={() => {
                      setPractice(null);
                      setPracticeView(true);
                    }}
                    style={styles.boardTab}
                  >
                    <Text style={styles.boardTabText}>{t('Fermer')}</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          </View>
        </View>

        {/* right: the answer field, then Silia with her speech bubble */}
        <View style={[styles.side, compact && { gap: space.sm }, { flex: 1 }]}>
          {session && (focus || guide) && !choices.length ? (
            <View style={[styles.answer, guide && styles.answerGuide]}>
              {guide ? <Text style={styles.cardCaption}>{t('Ta réponse')}</Text> : null}
              <View style={styles.answerRow}>
                <TextInput
                  value={typed}
                  onChangeText={setTyped}
                  placeholder={t('Écris ta réponse…')}
                  placeholderTextColor={colors.muted}
                  returnKeyType="send"
                  onSubmitEditing={sendAnswer}
                  style={[styles.answerInput, guide && styles.answerInputGuide]}
                  maxLength={200}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('Envoyer ma réponse')}
                  onPress={sendAnswer}
                  disabled={!typed.trim()}
                  style={[styles.answerSend, !typed.trim() && { opacity: 0.5 }]}
                >
                  <Text style={styles.answerSendText}>{t('Envoyer')}</Text>
                </Pressable>
              </View>
              {guide ? <Text style={styles.hint}>{t('ou dis-la à voix haute avec « Parler »')}</Text> : null}
            </View>
          ) : null}

          <View style={styles.avatarBox}>
            {/* what Silia says: a speech bubble coming out of her */}
            <View style={[styles.bubble, compact && styles.bubbleCompact]}>
              <Text style={[styles.bubbleText, rtl && styles.rtlText, compact && styles.bubbleTextCompact]}>{bubble}</Text>
              <View style={styles.bubbleTail} />
            </View>
            <View style={styles.avatarFit}>
              <Avatar mood={mood} reaction={reaction} language={bubbleLang} />
            </View>
            <Text style={styles.nameTag}>{TUTOR_NAME}</Text>
          </View>
        </View>
      </View>

      {!started ? (
        <View style={styles.startOverlay}>
          <Pressable accessibilityRole="button" onPress={start} style={styles.startButton} preferFocus>
            <Text style={styles.startText}>{t('Commencer les devoirs')}</Text>
          </Pressable>
          <Text style={styles.startHint}>Active {TUTOR_NAME}, ta maîtresse.</Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const CHALK = '#F4F1E8';
const WRONG_CHALK = '#FF7A7A';
const ARABIC = /[؀-ۿ]/;
const MARK: Record<ResultLine['status'], string> = { right: '✓', wrong: '✗', unsure: '?', open: '?', empty: '·' };
const MARK_COLOR: Record<ResultLine['status'], string> = { right: colors.success, wrong: WRONG_CHALK, unsure: '#7FD3FF', open: '#7FD3FF', empty: CHALK };

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, padding: space.md, paddingTop: space.sm, gap: space.sm, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minWidth: 0, minHeight: 56 },
  title: { color: colors.text, fontSize: 26, fontWeight: '900', marginRight: space.xs },
  chip: {
    color: colors.text,
    backgroundColor: colors.surface,
    paddingHorizontal: space.md,
    paddingVertical: 7,
    borderRadius: radius.pill,
    fontWeight: '800',
    fontSize: 14,
    overflow: 'hidden',
  },
  chipMuted: { color: colors.muted, maxWidth: 260 },
  separator: { width: 2, height: 30, backgroundColor: colors.surface, marginHorizontal: space.xs },
  main: { flex: 1, gap: space.md, minHeight: 0, minWidth: 0 },
  wood: { backgroundColor: '#A06A3F', borderRadius: radius.lg, padding: 12, minHeight: 0, minWidth: 0 },
  chalkboard: { flex: 1, backgroundColor: '#1F4A3D', borderRadius: 14, padding: space.md, paddingLeft: space.lg, gap: space.md, overflow: 'hidden' },
  chalkCol: { gap: 8, minHeight: 0, overflow: 'hidden' },
  chalkHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  chalkNumber: {
    minWidth: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 3,
    borderColor: '#7FD3FF',
    color: '#7FD3FF',
    fontSize: 26,
    textAlign: 'center',
    lineHeight: 36,
    paddingHorizontal: 4,
  },
  chalkTitle: { color: CHALK, fontSize: 38, lineHeight: 40, flexShrink: 1 },
  chalkLine: { height: 3, width: '70%', backgroundColor: 'rgba(244,241,232,0.5)', borderRadius: 2, transform: [{ rotate: '-1deg' }] },
  chalkInstr: { color: CHALK, fontSize: 30, lineHeight: 34 },
  chalkList: { gap: 4, marginTop: 6, paddingTop: 8, borderTopWidth: 2, borderTopColor: 'rgba(244,241,232,0.3)' },
  chalkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  chalkMark: { width: 22, fontSize: 24, fontWeight: '900', lineHeight: 30 },
  chalkItem: { color: CHALK, fontSize: 26, lineHeight: 30, flexShrink: 1 },
  chalkSmall: { color: 'rgba(244,241,232,0.8)', fontSize: 20, lineHeight: 24 },
  chalkChoice: { paddingVertical: 4, paddingHorizontal: 8, marginHorizontal: -8, borderRadius: 10, borderWidth: 2, borderColor: 'transparent' },
  chalkChoiceOn: { borderColor: '#7FD3FF', borderStyle: 'dashed' },
  chalkActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chalkPill: { alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 14, borderWidth: 2, borderColor: 'rgba(244,241,232,0.6)' },
  chalkPillOn: { borderColor: '#7FD3FF' },
  chalkStick: { width: 56, height: 10, backgroundColor: CHALK, opacity: 0.85, borderRadius: 3, transform: [{ rotate: '-8deg' }] },
  chalkRtl: { writingDirection: 'rtl', textAlign: 'right', fontFamily: undefined },
  photoArea: { flex: 1, minWidth: 0, minHeight: 0, alignItems: 'center', justifyContent: 'center' },
  rotate: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(27,35,64,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rotateText: { color: '#FFFFFF', fontSize: 24, fontWeight: '900' },
  boardTabs: { position: 'absolute', top: 0, right: 0, flexDirection: 'row', gap: 8 },
  boardTab: { backgroundColor: 'rgba(27,35,64,0.8)', borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.sm },
  boardTabText: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },
  side: { gap: space.md, minHeight: 0, minWidth: 0 },
  cardCaption: { color: colors.muted, fontSize: 15, fontWeight: '800' },
  answer: { gap: space.sm },
  answerGuide: { backgroundColor: colors.surface, borderRadius: 22, padding: space.md },
  answerRow: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  answerInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    backgroundColor: colors.surface,
    color: colors.text,
    borderRadius: 14,
    paddingHorizontal: space.md,
    fontSize: 20,
    fontWeight: '800',
  },
  answerInputGuide: { backgroundColor: '#FFFFFF', color: colors.bg, borderWidth: 3, borderColor: colors.accent, fontSize: 28, fontWeight: '900' },
  answerSend: { backgroundColor: colors.accent, borderRadius: 14, paddingHorizontal: space.md, minHeight: 48, justifyContent: 'center' },
  answerSendText: { color: colors.onAccent, fontSize: 17, fontWeight: '900' },
  hint: { color: colors.muted, fontSize: 15, fontWeight: '700' },
  // Takes the space left under the answer field: the bubble on top, Silia below; she shrinks, never covers them.
  avatarBox: { flex: 1, minHeight: 0, alignItems: 'center', justifyContent: 'flex-end', gap: space.xs, overflow: 'hidden' },
  bubble: {
    alignSelf: 'stretch',
    backgroundColor: '#FFFFFF',
    borderRadius: 26,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    marginBottom: 18,
  },
  bubbleTail: {
    position: 'absolute',
    bottom: -18,
    left: '50%',
    marginLeft: -16,
    width: 0,
    height: 0,
    borderLeftWidth: 16,
    borderRightWidth: 16,
    borderTopWidth: 20,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#FFFFFF',
  },
  bubbleText: { color: colors.bg, fontSize: 22, fontWeight: '800', lineHeight: 29 },
  rtlText: { writingDirection: 'rtl', textAlign: 'right', fontSize: 26, lineHeight: 40 },
  avatarFit: { flex: 1, minHeight: 0, width: '100%', alignItems: 'center', justifyContent: 'flex-end' },
  nameTag: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 2,
    backgroundColor: colors.surface,
    paddingHorizontal: space.lg,
    paddingVertical: 2,
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
  startButton: { backgroundColor: colors.accent, borderRadius: radius.pill, paddingHorizontal: 48, paddingVertical: 28 },
  startText: { color: colors.onAccent, fontSize: 30, fontWeight: '900' },
  startHint: { color: colors.muted, fontSize: 18 },
  // compact (phone)
  rootCompact: { padding: space.sm, paddingTop: 4, gap: 6 },
  woodCompact: { padding: 6, borderRadius: 16 },
  chalkboardCompact: { padding: space.sm, paddingLeft: space.md, gap: space.sm },
  chalkTitleCompact: { fontSize: 26, lineHeight: 28 },
  chalkInstrCompact: { fontSize: 20, lineHeight: 23 },
  chalkItemCompact: { fontSize: 19, lineHeight: 22 },
  bubbleCompact: { borderRadius: 18, paddingHorizontal: space.md, paddingVertical: 10, marginBottom: 14 },
  bubbleTextCompact: { fontSize: 15, lineHeight: 20 },
});
