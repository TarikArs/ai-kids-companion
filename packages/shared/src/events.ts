// Realtime Broadcast events on the private channel `session:<homework_session_id>`.
// One source of truth for the app and the Edge Functions.

export const sessionTopic = (sessionId: string) => `session:${sessionId}`;

/** A region on the photo, as fractions (0..1) of the image width and height. */
export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type AnnotationShape = 'circle' | 'tick' | 'cross' | 'arrow' | 'text' | 'star';

export interface Annotation {
  shape: AnnotationShape;
  region: Region;
  color?: string;
  text?: string;
  /** Milliseconds after the audio starts, to sync chalk with speech. */
  at_ms?: number;
}

export type SessionStatus = 'active' | 'paused' | 'finished';
export type TutorKind = 'hint' | 'praise' | 'question' | 'encourage' | 'explain' | 'parent_relay' | 'system';

/** One exercise on the page, offered when the tutor asks which one to work on. index = position on the page (1, 2, 3…). */
export interface ExerciseChoice {
  index: number;
  title: string;
  status: 'empty' | 'partial' | 'done';
  region?: Region;
  /** Number printed on the page ("10"), when it differs from the position. */
  label?: string;
}

/** What the child wants for an exercise. */
export type HelpAction = 'explain' | 'solve' | 'correct' | 'similar';

/** The active exercise: stays the focus of follow-up requests until the child switches (voice or tap). */
export interface ExerciseFocus {
  index: number;
  title: string;
  label?: string;
  /** Box on the photo `snapshot_id` (another photo: no box, only the chip). */
  region?: Region;
  snapshot_id?: string;
  /** Last help given on it (follow-ups continue in this mode). */
  action?: HelpAction;
  /** Practice exercise generated for it (shown on the Board; the answers stay on the server side for checking). */
  practice?: { title: string; instr?: string; kind?: 'copy' | 'fill' | 'other'; items: { q: string; a?: string; m?: string; slots?: number }[] };
  at: string;
}

/** One request of the child (a button, her voice): the Board drops messages of older requests. */
export interface TurnRef {
  id: string;
}

/** End of session: what Silia says to the child, and the report for the parent. */
export interface SessionSummary {
  child_text: string;
  parent_text: string;
  language: string;
  minutes: number;
  answers: number;
  right: number;
  wrong: number;
  at: string;
}

/** One line of the checked exercise. right / wrong: checked in code; unsure: hard to read; open: Silia asks Lina. */
export interface ResultLine {
  q: string;
  a: string | null;
  status: 'right' | 'wrong' | 'unsure' | 'empty' | 'open';
}

export interface SessionEvents {
  /** Board « Silia, regarde »: ask the Camera to take a photo now. */
  'capture.request': { request_id: string };
  /** Camera: "I am taking the photo" for this request. No ack within 2 s: the Board checks its current photo itself. */
  'capture.ack': { request_id: string };
  /** Camera: the requested photo could not be taken or sent (too dark, error). The Board checks its current photo. */
  'capture.failed': { request_id: string; reason: string };
  'snapshot.new': { snapshot_id: string; storage_path: string };
  /** Silia is working on a request. snapshot_id: she is reading this photo (the Board shows the scan). */
  'tutor.thinking': { snapshot_id?: string; turn?: TurnRef };
  /** The page orientation of this session (set by the first photo, or the Board's rotate button). */
  'session.rotation': { rotation: 0 | 90 | 180 | 270 };
  /** The server found no readable page on this photo. */
  'snapshot.rejected': { snapshot_id: string; reason: string };
  'tutor.say': {
    message_id: string;
    kind: TutorKind;
    text: string;
    language: string;
    audio_url?: string;
    /** Storage path of a cached familiar phrase, played instead of audio_url. */
    phrase?: string;
    snapshot_id?: string;
    annotations: Annotation[];
    turn?: TurnRef;
    /** The exercise this message is about. */
    exercise_index?: number;
  };
  /** Several exercises on the page (or "which one?"): the choices, and the one Silia suggests. */
  'tutor.ask_exercise': {
    snapshot_id: string;
    language: string;
    text: string;
    phrase?: string;
    audio_url?: string;
    choices: ExerciseChoice[];
    suggested?: number;
    turn?: TurnRef;
    /** The help waiting for the choice. */
    action?: HelpAction;
  };
  /** The exercise was checked: one line per item (verdict), or Silia asks for Lina's answer (guide), or it is not started. */
  'exercise.result': {
    snapshot_id?: string;
    exercise_index: number;
    title: string;
    /** Printed instruction (written in chalk on the Board). */
    instr?: string;
    label?: string;
    mode: 'verdict' | 'guide' | 'start';
    lines: ResultLine[];
    /** Her work on the practice exercise (« Exercice similaire »), not on her page. */
    practice?: boolean;
    /** All right: the next exercise on the page, one tap away. */
    next?: { index: number; title: string; label?: string };
    turn?: TurnRef;
  };
  /** A similar exercise to practise, shown on the Board (questions only). */
  'practice.show': {
    exercise_index: number;
    title: string;
    /** Printed instruction, drawn at the top of the chalkboard. */
    instr?: string;
    /** copy = model + dotted slots (like the notebook); fill = item with a dotted blank; other = text. */
    kind?: 'copy' | 'fill' | 'other';
    items: { q: string; m?: string; slots?: number }[];
    language: string;
    turn?: TurnRef;
  };
  /** Active exercise changed (voice, tap or the only exercise on the page). null = no focus. */
  'focus.changed': { focus: ExerciseFocus | null; by: 'voice' | 'tap' | 'auto' };
  'board.annotate': { snapshot_id: string; annotations: Annotation[]; clear?: boolean; turn?: TurnRef };
  'tutor.speaking.end': { message_id: string };
  'child.talk.start': Record<string, never>;
  'child.talk.end': Record<string, never>;
  'child.transcript': { utterance_id: string; text: string };
  'session.state': { status: SessionStatus };
}

export type SessionEventName = keyof SessionEvents;

/** Presence payload each device tracks on the session channel. */
export interface PresenceState {
  role: 'board' | 'camera' | 'parent';
  device_id?: string;
  user_name?: string;
  joined_at: string;
}
