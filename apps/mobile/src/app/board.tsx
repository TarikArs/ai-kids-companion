import type { Annotation, ExerciseChoice, ExerciseFocus, HelpAction, SessionEvents, SessionPlan, TurnRef } from '@hc/shared';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { useKeepAwake } from 'expo-keep-awake';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';

import { FocusPressable as Pressable } from '@/components/focus-pressable';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui';
import { AnnotatedPhoto } from '@/features/board/annotated-photo';
import { PracticeBoard, type PracticeView } from '@/features/board/practice-board';
import { Avatar, type AvatarMood, type AvatarReaction } from '@/features/board/avatar';
import { findOpenSession, newTurn, onEvent, sendEvent, sessionChannel, type HomeworkSession } from '@/lib/session';
import { useAppStore } from '@/lib/store';
import { functionError, supabase } from '@/lib/supabase';
import { colors, radius, space } from '@/lib/theme';
import { useUnpair } from '@/lib/use-unpair';
import { log } from '@/lib/log';
import { ACTION_LABEL, exerciseName, loadFocus, requestHelp, sendTyped } from '@/lib/exercise';
import { TUTOR_NAME } from '@/lib/tutor';
import { loadPhrases, pickPhrase } from '@/lib/phrases';
import { onVoiceIssue, playVoice, stopVoice } from '@/lib/voice';

interface Photo {
  id: string;
  uri: string;
  width: number;
  height: number;
  rotation: number;
}

const GREETING = `Bonjour ! Je suis ${TUTOR_NAME}. Montre-moi ton cahier.`;

const QUIET: Record<string, string> = {
  nothing_new: 'rien de nouveau',
  unsure: 'écriture difficile à lire',
  no_answers: 'pas encore de réponse',
  not_checkable: 'je regarde, pas de calcul à vérifier',
  cooldown: 'tout va bien',
  no_page: 'pas de page visible',
  hand_blocking: 'une main cache la page',
};

/** After the break: back to work, with the next subject of the plan. */
const BACK_TO_WORK: Record<string, (next?: string) => string> = {
  fr: (n) => `C’est reparti !${n ? ` Montre-moi : ${n}.` : ''}`,
  ar: (n) => `يالاه نكمّلو!${n ? ` ورّيني: ${n}.` : ''}`,
  fus: (n) => `هيا نكمل!${n ? ` أريني: ${n}.` : ''}`,
  en: (n) => `Let’s go again!${n ? ` Show me: ${n}.` : ''}`,
};

/** A child's request got no answer in time: say so, never go silent. */
const NO_ANSWER: Record<string, string> = {
  fr: 'Je n’ai pas réussi à lire. Montre-moi encore la page, s’il te plaît.',
  ar: 'ما قدرتش نقرا مزيان. ورّيني الصفحة مرة أخرى.',
  fus: 'لم أستطع القراءة جيدًا. أريني الصفحة مرة أخرى من فضلكِ.',
  en: 'I couldn’t read it. Please show me the page again.',
};

/** "Photo lue · 3 réponses · rien de nouveau" */
function seenText(p: SessionEvents['analysis.done']): string {
  if (p.reason === 'no_page' || p.reason === 'hand_blocking') return `Photo : ${QUIET[p.reason]}`;
  const parts = [`Photo lue · ${p.read} réponse${p.read > 1 ? 's' : ''}`];
  if (p.wrong) parts.push(`${p.wrong} à revoir`);
  else if (p.right) parts.push(`${p.right} juste${p.right > 1 ? 's' : ''}`);
  if (p.quiet && p.reason && QUIET[p.reason]) parts.push(QUIET[p.reason]);
  return parts.join(' · ');
}

export default function Board() {
  useKeepAwake();
  const device = useAppStore((s) => s.device);
  /** Parent setting (Espace parent → Voix de Silia). Off = text only, and the server sends no audio at all. */
  const [voiceOn, setVoiceOn] = useState(true);
  const mutedRef = useRef(false);
  mutedRef.current = !voiceOn;
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
  /** What Silia saw on the last photo, even when she stays quiet ("Photo lue · 3 réponses · rien de nouveau"). */
  const [seen, setSeen] = useState('');
  const reload = useAppStore((s) => s.reload);
  /** Tutor messages already shown (live or by the fallback poll). */
  const shownRef = useRef<Set<string>>(new Set());
  const pollBaselineRef = useRef<string | null>(null);
  const showMessageRef = useRef<(p: SessionEvents['tutor.say']) => void>(() => undefined);
  /** Parent changed a setting (language, level): refresh what depends on it. Set once loadLanguage exists. */
  const settingsChangedRef = useRef<() => void>(() => undefined);
  /** The bubble still shows the greeting (nothing said yet). */
  const greetingShownRef = useRef(true);

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

  // ---------- turns: one at a time; the child may interrupt, an automatic photo never does ----------
  const moodRef = useRef(mood);
  moodRef.current = mood;
  /** The turn Silia is working on (who asked: the child, or an automatic photo). */
  const turnRef = useRef<TurnRef | null>(null);
  /** An automatic message that arrived while Silia was busy: played when she is free, if still fresh (20 s). */
  const queuedRef = useRef<{ p: SessionEvents['tutor.say']; at: number } | null>(null);
  /** Photo lock: a new photo waits while Silia looks, talks or listens about the current one. */
  const pendingPhotoRef = useRef<string | null>(null);
  const afterTurnRef = useRef<() => void>(() => undefined);
  /** Orientation of the whole session (the Camera stays on its stand). null = not decided yet. */
  const [sessionRotation, setSessionRotation] = useState<number | null>(null);

  // The evening's plan (from the homework diary) and the break between subjects.
  const [plan, setPlan] = useState<SessionPlan | null>(null);
  /** "Exercice similaire": the practice exercise shown on the Board (questions only; answers stay on the server). */
  const [practice, setPractice] = useState<PracticeView | null>(null);
  /** The chalkboard shows the practice exercise (true) or the notebook photo (false). */
  const [practiceView, setPracticeView] = useState(true);
  const [breakLeft, setBreakLeft] = useState(0);
  const breakRef = useRef<{ seconds: number; next?: string; language: string } | null>(null);
  const breakNextRef = useRef<{ next?: string; language: string } | null>(null);

  // Tell the Camera when Silia is busy or on a break (no automatic photo then), and finish the turn when she is free.
  useEffect(() => {
    const busy = mood !== 'idle' || breakLeft > 0;
    if (channelRef.current) sendEvent(channelRef.current, 'board.state', { state: busy ? 'busy' : 'watching' });
    if (mood === 'idle' && breakLeft === 0) afterTurnRef.current();
  }, [mood, breakLeft]);

  // Break countdown: one second at a time; at 0 (or "Reprendre"), Silia calls her back to work.
  useEffect(() => {
    if (breakLeft <= 0) return;
    const id = setTimeout(() => setBreakLeft((s) => s - 1), 1000);
    if (breakLeft === 1) {
      const back = breakNextRef.current;
      breakNextRef.current = null;
      const lang = back?.language ?? forcedLangRef.current ?? 'fr';
      const text = (BACK_TO_WORK[lang] ?? BACK_TO_WORK.fr)(back?.next);
      setTimeout(() => {
        setBubble(text);
        setBubbleLang(lang);
        speakRef.current(text, { language: lang });
      }, 1000);
    }
    return () => clearTimeout(id);
  }, [breakLeft]);

  // Safety net: never stay "thinking" forever. The child asked (Corriger, Parler, a button): after 25 s Silia says
  // she could not read it. An automatic photo: back to Watching silently after 45 s.
  useEffect(() => {
    if (mood !== 'thinking') return;
    const childTurn = turnRef.current?.priority === 'child';
    const timer = setTimeout(
      () => {
        log('board', `no reply after ${childTurn ? 25 : 45} s (${childTurn ? 'child' : 'automatic'} turn)`);
        setExplaining(false);
        turnRef.current = null;
        if (childTurn && startedRef.current) {
          const lang = forcedLangRef.current ?? lastVoiceRef.current.language ?? 'fr';
          const text = NO_ANSWER[lang] ?? NO_ANSWER.fr;
          setBubble(text);
          setBubbleLang(lang);
          speakRef.current(text, { language: lang });
        } else setMood('idle');
      },
      childTurn ? 25_000 : 45_000,
    );
    return () => clearTimeout(timer);
  }, [mood]);
  const speakRef = useRef<(text: string, opts?: { language?: string }) => void>(() => undefined);
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

  speakRef.current = speak;

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
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'children', filter: `household_id=eq.${device.householdId}` },
          () => settingsChangedRef.current(),
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'households', filter: `id=eq.${device.householdId}` },
          () => settingsChangedRef.current(),
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

        // Missed reply (TV asleep, live connection dropped): show the newest message if it is recent and not shown yet.
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
      const { data: latest } = await supabase
        .from('snapshots')
        .select('id')
        .eq('session_id', sessionId)
        .not('status', 'in', '(skipped,failed)')
        .order('taken_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latest && !cancelled) loadPhoto(latest.id);
      loadFocus(sessionId).then((f) => {
        if (cancelled) return;
        setFocus(f);
        if (f?.practice) {
          setPractice({
            index: f.index,
            title: f.practice.title,
            instr: f.practice.instr,
            kind: f.practice.kind,
            items: f.practice.items.map((i) => ({ q: i.q, m: i.m, slots: i.slots })),
            language: lastVoiceRef.current.language ?? 'fr',
          });
          setPracticeView(false); // after a reload: the photo first, the exercise one tap away
        }
      });
      supabase
        .from('homework_sessions')
        .select('rotation')
        .eq('id', sessionId)
        .maybeSingle()
        .then(({ data, error }) => {
          if (!cancelled && !error) setSessionRotation((data as { rotation?: number | null } | null)?.rotation ?? null);
        });
      supabase
        .from('homework_sessions')
        .select('plan')
        .eq('id', sessionId)
        .maybeSingle()
        .then(({ data, error }) => {
          if (!cancelled && !error) setPlan(((data as { plan?: SessionPlan | null } | null)?.plan as SessionPlan | null) ?? null);
        });

      const ch = await sessionChannel(sessionId);
      if (cancelled) return;
      channel = ch;
      const busyNow = () => moodRef.current !== 'idle';
      /** An automatic message must not cut Silia, nor overtake the child's pending request. */
      const mustWait = (t?: TurnRef) =>
        t?.priority === 'auto' &&
        (speakingRef.current || listeningRef.current || (turnRef.current?.priority === 'child' && turnRef.current.id !== t.id));
      const sameTurn = (t?: TurnRef) => !t || !turnRef.current || t.id === turnRef.current.id;

      onEvent(ch, 'snapshot.new', (p) => {
        // Locked while she talks, listens, or works on the child's own request; an automatic look shows it at once.
        if (speakingRef.current || listeningRef.current || (busyNow() && turnRef.current?.priority === 'child')) {
          pendingPhotoRef.current = p.snapshot_id; // photo lock: shown when this turn ends
          log('board', 'new photo waits: Silia is busy with the current page');
          return;
        }
        setAnnotations([]);
        setChoices([]);
        loadPhoto(p.snapshot_id);
      });
      onEvent(ch, 'session.rotation', (p) => setSessionRotation(p.rotation));
      onEvent(ch, 'plan.changed', (p) => setPlan(p.plan));
      onEvent(ch, 'practice.show', (p) => {
        setPractice({ index: p.exercise_index, title: p.title, instr: p.instr, kind: p.kind, items: p.items, language: p.language });
        setPracticeView(true); // written on the chalkboard, in place of the photo
      });
      onEvent(ch, 'session.break', (p) => {
        breakRef.current = p; // starts when Silia has finished her sentence
        if (moodRef.current === 'idle' && !speakingRef.current) afterTurnRef.current();
      });
      onEvent(ch, 'focus.changed', (p) => {
        log('board', `active exercise: ${p.focus ? `${exerciseName(p.focus)} ${p.focus.title}` : 'none'} (${p.by})`);
        setFocus(p.focus);
        // Another exercise: its practice exercise is no longer relevant.
        setPractice((cur) => (cur && cur.index !== p.focus?.index ? null : cur));
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
        queuedRef.current = null; // she talks: older automatic messages are dropped
        turnRef.current = newTurn('child');
        speakingRef.current = false;
        listeningRef.current = true;
        setChoices([]);
        setMood('listening');
      });
      onEvent(ch, 'child.talk.end', () => {
        listeningRef.current = false;
        setMood('thinking');
      });
      onEvent(ch, 'tutor.thinking', (p) => {
        // An automatic photo while Silia is busy: she keeps going, the result will wait in the queue.
        if (p.turn?.priority === 'auto' && busyNow()) return;
        if (p.turn?.priority === 'child' && speakingRef.current) {
          stopVoice(); // the child asked something: stop and look
          speakingRef.current = false;
        }
        if (p.turn) turnRef.current = p.turn;
        // A short "Hmm…" while she looks, unless she is already talking or listening.
        if (!speakingRef.current && !listeningRef.current && Math.random() < 0.6) sayFamiliar('filler', 'Hmm…', false);
        setMood('thinking');
      });
      onEvent(ch, 'analysis.done', (p) => {
        setSeen(seenText(p));
        if (p.quiet && sameTurn(p.turn)) setMood((m) => (m === 'thinking' ? 'idle' : m));
      });
      const playSay = async (p: SessionEvents['tutor.say']) => {
        if (shownRef.current.has(p.message_id)) return;
        shownRef.current.add(p.message_id);
        greetingShownRef.current = false;
        if (p.snapshot_id && p.snapshot_id !== photoIdRef.current) await loadPhoto(p.snapshot_id);
        // Silia marks her sheet (ticks, circles): show the photo, the exercise stays one tap away.
        if (p.annotations.length) setPracticeView(false);
        setAnnotations(p.annotations);
        setChoices([]);
        if (p.kind === 'praise' || p.kind === 'hint' || p.kind === 'explain') setReaction({ type: p.kind, at: Date.now() });
        setBubble(p.text);
        setBubbleLang(p.language);
        setExplaining(false);
        speak(p.text, { messageId: p.message_id, language: p.language, audioUrl: p.audio_url, phrase: p.phrase });
      };
      onEvent(ch, 'tutor.say', async (p) => {
        if (!p.text) {
          // "stop thinking" of an older turn must not stop the current one
          if (sameTurn(p.turn) && !speakingRef.current) setMood('idle');
          return;
        }
        if (shownRef.current.has(p.message_id)) return;
        if (mustWait(p.turn)) {
          queuedRef.current = { p, at: Date.now() };
          log('board', 'automatic message waits: Silia is busy', p.text);
          return;
        }
        if (p.turn) turnRef.current = p.turn;
        await playSay(p);
      });
      // Silia is free again: a waiting automatic message (if still fresh), else the newest photo.
      afterTurnRef.current = () => {
        // "Bravo, c'est fini… pause d'une minute" has been said: the break starts now.
        const pendingBreak = breakRef.current;
        if (pendingBreak) {
          breakRef.current = null;
          breakNextRef.current = { next: pendingBreak.next, language: pendingBreak.language };
          queuedRef.current = null;
          setBreakLeft(pendingBreak.seconds);
          return;
        }
        const queued = queuedRef.current;
        queuedRef.current = null;
        if (queued && Date.now() - queued.at < 20_000) {
          log('board', 'playing the message that waited');
          turnRef.current = queued.p.turn ?? null;
          void playSay(queued.p);
          return;
        }
        turnRef.current = null;
        const pending = pendingPhotoRef.current;
        pendingPhotoRef.current = null;
        if (pending && pending !== photoIdRef.current) {
          setAnnotations([]);
          loadPhoto(pending);
        }
      };
      showMessageRef.current = (p) => {
        if (shownRef.current.has(p.message_id)) return;
        shownRef.current.add(p.message_id);
        greetingShownRef.current = false;
        setAnnotations(p.annotations);
        setChoices([]);
        setBubble(p.text);
        setBubbleLang(p.language);
        setExplaining(false);
        speak(p.text, { messageId: p.message_id, language: p.language });
      };
      onEvent(ch, 'tutor.ask_exercise', async (p) => {
        greetingShownRef.current = false;
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
      onEvent(ch, 'board.annotate', async (p) => {
        if (p.keep_mood) {
          // Marks ahead of the sentence: shown now on that photo, Silia keeps "thinking" until she speaks.
          if (mustWait(p.turn)) return;
          if (p.snapshot_id !== photoIdRef.current) await loadPhoto(p.snapshot_id);
          setPracticeView(false);
          setAnnotations(p.annotations);
          return;
        }
        if (sameTurn(p.turn) && !speakingRef.current) setMood('idle');
        setAnnotations((cur) => (p.clear ? p.annotations : [...cur, ...p.annotations]));
      });
      onEvent(ch, 'session.state', (p) => {
        // Finished: the recap (session-summary) is already being said; never cut it with the short goodbye.
        if (p.status === 'finished') {
          if (!speakingRef.current) sayFamiliar('end', 'Bravo ! Les devoirs sont finis.');
        }
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
    // Voice setting of the household (checked with the language: live on change, and every 10 s).
    const { data: home, error: homeErr } = await supabase.from('households').select('voice_enabled').eq('id', device.householdId).maybeSingle();
    if (!homeErr && home) {
      const on = (home as { voice_enabled?: boolean }).voice_enabled !== false;
      setVoiceOn((cur) => {
        if (cur !== on) {
          log('board', `voice ${on ? 'on' : 'off'} (parent setting)`);
          if (!on) stopVoice();
        }
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

  settingsChangedRef.current = () => {
    log('board', 'parent changed a setting: refreshing');
    loadLanguage()
      .then((lang) => {
        if (!greetingShownRef.current) return; // Silia is in the middle of something: the next message uses the new setting
        const greeting = pickPhrase('greeting', lang);
        if (greeting) {
          setBubble(greeting.text);
          setBubbleLang(greeting.lang);
          lastTextRef.current = greeting.text;
          lastVoiceRef.current = { language: greeting.lang, phrase: greeting.audio_path };
        }
      })
      .catch(() => undefined);
  };

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

  /** Corriger: ask the Camera for a fresh photo; no answer within 2 s (or it fails): check the photo on the Board. */
  /** The child pressed a button on the Board: her turn, Silia stops talking and looks. */
  function childTurn() {
    const turn = newTurn('child');
    turnRef.current = turn;
    queuedRef.current = null;
    if (speakingRef.current) {
      stopVoice();
      speakingRef.current = false;
    }
    return turn;
  }

  function correct() {
    childTurn();
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
    const { error } = await supabase.functions.invoke('analyze-snapshot', {
      body: { snapshot_id: snapshotId, mode: 'check', turn: turnRef.current ?? newTurn('child') },
    });
    if (error) {
      setMood('idle');
      setLink(`corriger : ${await functionError(error)}`);
    }
  }
  checkBoardPhotoRef.current = (why) => void checkBoardPhoto(why);

  /** Typed answer on the Board ("8"): same path as speaking to Silia. */
  const [typed, setTyped] = useState('');
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

  /** Exercise help (buttons and choice taps): same server logic as the child's voice requests. */
  async function explainExercise(choice?: ExerciseChoice, action?: HelpAction | 'choose') {
    if (!session) return;
    const turn = childTurn();
    setExplaining(true);
    setChoices([]);
    setMood('thinking');
    const { error } = await requestHelp(session.id, { choice, action, turn });
    setExplaining(false);
    if (error) {
      setMood('idle');
      setLink(`exercice : ${error}`);
    }
  }

  /** The page shows sideways: turn it a quarter, for the whole session (saved, shared with every screen). */
  async function rotate() {
    if (!session || !photo) return;
    const next = (((sessionRotation ?? photo.rotation ?? 0) + 90) % 360) as 0 | 90 | 180 | 270;
    setSessionRotation(next);
    if (channelRef.current) sendEvent(channelRef.current, 'session.rotation', { rotation: next });
    const { error } = await supabase.from('homework_sessions').update({ rotation: next }).eq('id', session.id);
    if (error) log('board', 'rotation not saved (migration?)', error.message);
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
          {session && seen ? <Text style={[styles.chip, { color: colors.muted }]} numberOfLines={1}>{seen}</Text> : null}
          {session ? <Text style={[styles.chip, { color: colors.muted }]}>{link}</Text> : null}
        </View>
      </View>

      <View style={[styles.main, { flexDirection: landscape ? 'row' : 'column' }]}>
        <View style={[styles.wood, { flex: landscape ? 3 : 2 }]}>
          <View style={styles.chalkboard}>
            {practice && practiceView ? (
              <PracticeBoard practice={practice} />
            ) : photo ? (
              <>
                <AnnotatedPhoto
                  uri={photo.uri}
                  width={photo.width}
                  height={photo.height}
                  rotation={sessionRotation ?? photo.rotation}
                  annotations={shown}
                />
                <Pressable accessibilityRole="button" accessibilityLabel="Tourner la page" onPress={rotate} style={[styles.rotate, practice ? { top: 64 } : null]}>
                  <Text style={styles.rotateText}>↻</Text>
                </Pressable>
              </>
            ) : (
              <Text style={styles.chalkText}>J’attends la première photo du cahier…</Text>
            )}
            {practice ? (
              <View style={styles.boardTabs}>
                <Pressable accessibilityRole="button" onPress={() => setPracticeView((v) => !v)} style={styles.boardTab}>
                  <Text style={styles.boardTabText}>{practiceView ? 'Voir la photo' : 'Voir l’exercice'}</Text>
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

        <View style={[styles.side, { flex: landscape ? 2 : 1, flexDirection: landscape ? 'column' : 'row' }]}>
          {plan?.items.length ? (
            <View style={styles.plan}>
              {plan.items.map((i) => (
                <Text
                  key={i.id}
                  numberOfLines={1}
                  style={[styles.planItem, i.status === 'active' && styles.planActive, i.status === 'done' && styles.planDone]}
                >
                  {i.status === 'done' ? '✓ ' : ''}
                  {i.label}
                </Text>
              ))}
            </View>
          ) : null}
          {breakLeft > 0 ? (
            <View style={styles.breakCard}>
              <Text style={styles.breakTitle}>Pause</Text>
              <Text style={styles.breakCount}>{breakLeft}</Text>
              <Pressable accessibilityRole="button" onPress={() => setBreakLeft(1)} style={styles.focusChange} preferFocus>
                <Text style={styles.focusChangeText}>Reprendre</Text>
              </Pressable>
            </View>
          ) : null}
          {focus && !choices.length && breakLeft === 0 ? (
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
                {(['explain', 'solve', 'correct', 'similar'] as const).map((a) => (
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
          {session ? (
            <View style={styles.answerRow}>
              <TextInput
                value={typed}
                onChangeText={setTyped}
                placeholder="Écris ta réponse…"
                placeholderTextColor={colors.muted}
                returnKeyType="send"
                onSubmitEditing={sendAnswer}
                style={styles.answerInput}
                maxLength={200}
              />
              <Pressable accessibilityRole="button" accessibilityLabel="Envoyer ma réponse" onPress={sendAnswer} disabled={!typed.trim()} style={[styles.answerSend, !typed.trim() && { opacity: 0.5 }]}>
                <Text style={styles.answerSendText}>Envoyer</Text>
              </Pressable>
            </View>
          ) : null}
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
        {Platform.OS === 'web' ? <Button label="Plein écran" variant="secondary" onPress={fullscreen} /> : null}
        <Button label="Recharger" variant="secondary" onPress={reload} />
        <Button label="Délier" variant="ghost" onPress={unpair} />
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
  plan: { alignSelf: 'stretch', flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  planItem: {
    color: colors.muted,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: 6,
    fontSize: 15,
    fontWeight: '800',
    overflow: 'hidden',
    maxWidth: 220,
  },
  planActive: { color: colors.text, borderWidth: 2, borderColor: colors.accent },
  planDone: { color: colors.success },
  breakCard: { alignSelf: 'stretch', alignItems: 'center', gap: space.sm, backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg },
  breakTitle: { color: colors.accent, fontSize: 22, fontWeight: '900', letterSpacing: 2, textTransform: 'uppercase' },
  breakCount: { color: colors.text, fontSize: 56, fontWeight: '900' },
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
  answerRow: { alignSelf: 'stretch', flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  answerInput: {
    flex: 1,
    minHeight: 52,
    backgroundColor: colors.surface,
    color: colors.text,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    fontSize: 22,
    fontWeight: '800',
  },
  answerSend: { backgroundColor: colors.accent, borderRadius: radius.pill, paddingHorizontal: space.lg, minHeight: 52, justifyContent: 'center' },
  answerSendText: { color: colors.onAccent, fontSize: 18, fontWeight: '900' },
  boardTabs: { position: 'absolute', top: 10, right: 10, flexDirection: 'row', gap: 8 },
  boardTab: { backgroundColor: 'rgba(27,35,64,0.8)', borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.sm },
  boardTabText: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },
  rtl: { writingDirection: 'rtl', textAlign: 'right' },
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
