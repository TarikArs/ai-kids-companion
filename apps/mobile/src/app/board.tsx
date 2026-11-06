import type { Annotation, ExerciseChoice, ExerciseFocus, HelpAction, SessionEvents, TurnRef } from '@hc/shared';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { useKeepAwake } from 'expo-keep-awake';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FocusPressable as Pressable } from '@/components/focus-pressable';
import { Button } from '@/components/ui';
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

/** Wrong answers in red: on the list and circled on the photo (same red). */
const WRONG_RED = '#FF5A5A';

const LINE_COLOR: Record<ResultLine['status'], string> = {
  right: colors.success,
  wrong: WRONG_RED,
  unsure: '#7FD3FF',
  open: '#7FD3FF',
  empty: 'transparent',
};

/** "532 − 178 = 354", "604 − 259 · à revoir", "700 − 465 · pas encore fait". */
function lineText(l: ResultLine): string {
  const calc = /\d/.test(l.q) && /[-+−×x÷:*/]/.test(l.q);
  switch (l.status) {
    case 'right':
      return `${l.q}${calc ? ' = ' : ' : '}${l.a ?? ''}`;
    case 'wrong':
      return `${l.q} : ${l.a ?? ''} · à revoir`;
    case 'unsure':
      return `${l.q} · je lis « ${l.a ?? ''} » ?`;
    case 'open':
      return `${l.q} · dis-moi ta réponse`;
    default:
      return `${l.q} · pas encore fait`;
  }
}

export default function Board() {
  useKeepAwake();
  const device = useAppStore((s) => s.device);
  const reload = useAppStore((s) => s.reload);
  const unpair = useUnpair();
  const { width, height } = useWindowDimensions();
  const landscape = width >= height;

  /** Parent setting (Espace parent → Voix de Silia). Off = text only, and the server sends no audio at all. */
  const [voiceOn, setVoiceOn] = useState(true);
  const mutedRef = useRef(false);
  mutedRef.current = !voiceOn;

  const [started, setStarted] = useState(false);
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
  const pollBaselineRef = useRef<string | null>(null);
  const showMessageRef = useRef<(p: SessionEvents['tutor.say']) => void>(() => undefined);
  /** Parent changed a setting (language, voice): refresh what depends on it. */
  const settingsChangedRef = useRef<() => void>(() => undefined);
  /** The bubble still shows the greeting (nothing said yet). */
  const greetingShownRef = useRef(true);
  const startedRef = useRef(false);
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
      // A refresh starts empty: no old photo, exercise or practice; only what Lina asks from now on.
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
    const { data: home } = await supabase.from('households').select('voice_enabled').eq('id', device.householdId).maybeSingle();
    if (home) {
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
  const statusLabel = !session ? 'En attente de la caméra' : session.status === 'paused' ? 'En pause' : scanning ? 'Je regarde ta page…' : 'Devoirs en cours';
  const statusColor = !session ? colors.muted : session.status === 'paused' || scanning ? colors.accent : colors.success;
  const next = result?.next;

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>{TUTOR_NAME}</Text>
        <View style={styles.headerRight}>
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
          {Platform.OS === 'web' ? (
            <Button label="Plein écran" variant="ghost" onPress={() => (globalThis as any).document?.documentElement?.requestFullscreen?.()} />
          ) : null}
          <Button label="Recharger" variant="ghost" onPress={reload} />
          <Button label="Délier" variant="ghost" onPress={unpair} />
        </View>
      </View>

      <View style={[styles.main, { flexDirection: landscape ? 'row' : 'column' }]}>
        <View style={[styles.wood, { flex: landscape ? 3 : 2 }]}>
          <View style={styles.chalkboard}>
            {practice && practiceView ? (
              <PracticeBoard practice={practice} />
            ) : photo ? (
              <>
                <AnnotatedPhoto uri={photo.uri} width={photo.width} height={photo.height} rotation={sessionRotation ?? 0} annotations={shown} scanning={scanning} />
                <Pressable accessibilityRole="button" accessibilityLabel="Tourner la page" onPress={rotate} style={[styles.rotate, practice ? { top: 64 } : null]}>
                  <Text style={styles.rotateText}>↻</Text>
                </Pressable>
              </>
            ) : (
              <Text style={styles.chalkText}>
                Quand tu as fini, appuie sur{'\n'}« {TUTOR_NAME}, regarde »
              </Text>
            )}
            {practice ? (
              <View style={styles.boardTabs}>
                <Pressable accessibilityRole="button" onPress={() => setPracticeView((v) => !v)} style={styles.boardTab}>
                  <Text style={styles.boardTabText}>{practiceView ? 'Voir la photo' : 'Exercice similaire'}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Fermer l’exercice similaire"
                  onPress={() => {
                    setPractice(null);
                    setPracticeView(true);
                  }}
                  style={styles.boardTab}
                >
                  <Text style={styles.boardTabText}>Fermer</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        </View>

        <View style={[styles.side, { flex: landscape ? 2 : 1 }]}>
          <View style={styles.bubble}>
            <Text style={[styles.bubbleText, rtl && styles.rtlText]}>{bubble}</Text>
          </View>

          {choices.length ? (
            <View style={styles.list}>
              {choices.map((c) => {
                const on = c.index === suggestedChoice?.index;
                return (
                  <Pressable
                    key={c.index}
                    accessibilityRole="button"
                    accessibilityLabel={`Exercice ${exerciseName(c)} : ${c.title}`}
                    onPress={() => help(c)}
                    style={({ pressed }) => [styles.choice, on && styles.choiceOn, pressed && { opacity: 0.8 }]}
                  >
                    <Text style={[styles.number, on && styles.numberOn]}>{exerciseName(c)}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.choiceTitle} numberOfLines={1}>
                        {c.title}
                      </Text>
                      <Text style={styles.choiceStatus}>{CHOICE_STATUS[c.status]}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ) : result ? (
            <View style={styles.card}>
              <Text style={styles.cardCaption} numberOfLines={1}>
                Exercice {result.label ?? result.exercise_index} · {result.title}
              </Text>
              {result.lines.slice(0, 6).map((l, i) => (
                <View key={i} style={[styles.line, l.status === 'wrong' && styles.lineWrong]}>
                  <View style={[styles.dot, { backgroundColor: LINE_COLOR[l.status] }, l.status === 'empty' && styles.dotEmpty]} />
                  <Text
                    style={[styles.lineText, l.status === 'empty' && { color: colors.muted }, l.status === 'wrong' && { color: WRONG_RED }]}
                    numberOfLines={1}
                  >
                    {lineText(l)}
                  </Text>
                </View>
              ))}
              {next ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => help({ index: next.index, title: next.title, status: 'empty', label: next.label }, 'correct')}
                  style={styles.pill}
                >
                  <Text style={styles.pillText}>Exercice {next.label ?? next.index} →</Text>
                </Pressable>
              ) : null}
            </View>
          ) : focus ? (
            <View style={[styles.card, styles.focusCard]}>
              <View style={styles.line}>
                <Text style={styles.number}>{exerciseName(focus)}</Text>
                <Text style={styles.choiceTitle} numberOfLines={1}>
                  {focus.title}
                </Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Changer d’exercice" onPress={() => help(undefined, 'choose')} style={styles.pill}>
                  <Text style={styles.pillText}>Changer</Text>
                </Pressable>
              </View>
              <View style={styles.actions}>
                {(['explain', 'solve'] as const).map((a) => (
                  <Pressable
                    key={a}
                    accessibilityRole="button"
                    disabled={busy}
                    onPress={() => help(undefined, a)}
                    style={[styles.pill, focus.action === a && styles.pillOn]}
                  >
                    <Text style={styles.pillText}>{ACTION_LABEL[a]}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          {session && (focus || guide) && !choices.length ? (
            <View style={[styles.answer, guide && styles.answerGuide]}>
              {guide ? <Text style={styles.cardCaption}>Ta réponse</Text> : null}
              <View style={styles.answerRow}>
                <TextInput
                  value={typed}
                  onChangeText={setTyped}
                  placeholder="Écris ta réponse…"
                  placeholderTextColor={colors.muted}
                  returnKeyType="send"
                  onSubmitEditing={sendAnswer}
                  style={[styles.answerInput, guide && styles.answerInputGuide]}
                  maxLength={200}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Envoyer ma réponse"
                  onPress={sendAnswer}
                  disabled={!typed.trim()}
                  style={[styles.answerSend, !typed.trim() && { opacity: 0.5 }]}
                >
                  <Text style={styles.answerSendText}>Envoyer</Text>
                </Pressable>
              </View>
              {guide ? <Text style={styles.hint}>ou dis-la à voix haute avec « Parler »</Text> : null}
            </View>
          ) : null}

          <View style={styles.avatarBox}>
            <Avatar mood={mood} reaction={reaction} language={bubbleLang} />
            <Text style={styles.nameTag}>{TUTOR_NAME}</Text>
          </View>
        </View>
      </View>

      <View style={styles.footer}>
        {/* Always there once an exercise is known (checked, or active). */}
        {(focus || result) && !choices.length ? (
          <Button label="Exercice similaire" variant="secondary" onPress={() => help(undefined, 'similar')} disabled={busy || !active} />
        ) : null}
        <Button label="Répéter" variant="secondary" onPress={() => speak(lastTextRef.current, lastVoiceRef.current)} />
        {choices.length ? (
          <>
            <Button label={`${TUTOR_NAME}, regarde`} variant="secondary" onPress={lookNow} disabled={!active} />
            {suggestedChoice ? <Button label={`Oui, le ${exerciseName(suggestedChoice)}`} onPress={() => help(suggestedChoice)} /> : null}
          </>
        ) : (
          <Button label={`${TUTOR_NAME}, regarde`} onPress={lookNow} loading={busy && scanning} disabled={!active} />
        )}
      </View>

      {!started ? (
        <View style={styles.startOverlay}>
          <Pressable accessibilityRole="button" onPress={start} style={styles.startButton} preferFocus>
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
  headerRight: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', flexShrink: 1 },
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
  chipMuted: { color: colors.muted, maxWidth: 260 },
  main: { flex: 1, gap: space.md, minHeight: 0, minWidth: 0 },
  wood: { backgroundColor: '#A06A3F', borderRadius: radius.lg, padding: 12, minHeight: 0, minWidth: 0 },
  chalkboard: { flex: 1, backgroundColor: '#1F4A3D', borderRadius: 14, padding: space.md, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  chalkText: { color: '#F4F1E8', fontSize: 32, fontWeight: '700', textAlign: 'center', lineHeight: 44 },
  rotate: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(27,35,64,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rotateText: { color: '#FFFFFF', fontSize: 24, fontWeight: '900' },
  boardTabs: { position: 'absolute', top: 10, right: 10, flexDirection: 'row', gap: 8 },
  boardTab: { backgroundColor: 'rgba(27,35,64,0.8)', borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.sm },
  boardTabText: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },
  side: { gap: space.md, minHeight: 0, minWidth: 0 },
  bubble: { backgroundColor: '#FFFFFF', borderRadius: 28, padding: space.lg, alignSelf: 'stretch' },
  bubbleText: { color: colors.bg, fontSize: 24, fontWeight: '800', lineHeight: 32 },
  rtlText: { writingDirection: 'rtl', textAlign: 'right', fontSize: 28, lineHeight: 42 },
  list: { gap: space.sm },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 3,
    borderColor: 'transparent',
    paddingHorizontal: space.md,
    paddingVertical: 10,
  },
  choiceOn: { borderColor: colors.accent },
  number: {
    minWidth: 38,
    height: 38,
    borderRadius: 19,
    overflow: 'hidden',
    backgroundColor: colors.bg,
    color: colors.text,
    fontSize: 20,
    fontWeight: '900',
    textAlign: 'center',
    lineHeight: 38,
    paddingHorizontal: 4,
  },
  numberOn: { backgroundColor: '#7FD3FF', color: colors.bg },
  choiceTitle: { color: colors.text, fontSize: 19, fontWeight: '900', flexShrink: 1, flexGrow: 1 },
  choiceStatus: { color: colors.muted, fontSize: 14, fontWeight: '700' },
  card: { backgroundColor: colors.surface, borderRadius: 20, padding: space.md, gap: space.sm },
  focusCard: { borderWidth: 3, borderColor: '#7FD3FF' },
  cardCaption: { color: colors.muted, fontSize: 15, fontWeight: '800' },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  dot: { width: 14, height: 14, borderRadius: 7 },
  lineWrong: { backgroundColor: 'rgba(255,90,90,0.14)', borderRadius: 10, marginHorizontal: -8, paddingHorizontal: 8, paddingVertical: 4 },
  dotEmpty: { borderWidth: 2, borderColor: colors.muted },
  lineText: { color: colors.text, fontSize: 18, fontWeight: '800', flexShrink: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  pill: { alignSelf: 'flex-start', paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.12)' },
  pillOn: { backgroundColor: '#7FD3FF33', borderWidth: 2, borderColor: '#7FD3FF' },
  pillText: { color: colors.text, fontWeight: '800', fontSize: 15 },
  answer: { gap: space.sm },
  answerGuide: { backgroundColor: colors.surface, borderRadius: 22, padding: space.md },
  answerRow: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  answerInput: {
    flex: 1,
    minHeight: 52,
    backgroundColor: colors.surface,
    color: colors.text,
    borderRadius: 16,
    paddingHorizontal: space.lg,
    fontSize: 22,
    fontWeight: '800',
  },
  answerInputGuide: { backgroundColor: '#FFFFFF', color: colors.bg, borderWidth: 3, borderColor: colors.accent, fontSize: 30, fontWeight: '900' },
  answerSend: { backgroundColor: colors.accent, borderRadius: 16, paddingHorizontal: space.lg, minHeight: 52, justifyContent: 'center' },
  answerSendText: { color: colors.onAccent, fontSize: 18, fontWeight: '900' },
  hint: { color: colors.muted, fontSize: 15, fontWeight: '700' },
  avatarBox: { flex: 1, minHeight: 120, alignItems: 'center', justifyContent: 'flex-end', gap: space.xs },
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
  footer: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm, flexWrap: 'wrap' },
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
});
