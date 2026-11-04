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
export type HelpAction = 'explain' | 'solve' | 'correct';

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
  at: string;
}

/** A turn of the conversation. The child's turns may interrupt Silia; automatic ones (a photo) never do. */
export interface TurnRef {
  id: string;
  priority: 'child' | 'auto';
}

/** Subjects of the evening, read from the homework diary. */
export type Subject = 'math' | 'french' | 'arabic' | 'english' | 'science' | 'islamic' | 'social' | 'other';

export interface PlanItem {
  id: string;
  subject: Subject;
  /** As written in the diary ("Maths p. 42"). */
  label: string;
  status: 'todo' | 'active' | 'done';
}

export interface SessionPlan {
  items: PlanItem[];
  snapshot_id?: string;
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

/** What the Board is doing: the Camera takes automatic photos only while it is "watching". */
export type BoardState = 'watching' | 'busy';

export interface SessionEvents {
  'capture.tick': { next_capture_at: string };
  /** Board "Corriger": ask the Camera to take a photo now and check every answer. */
  'capture.request': { mode: 'check'; request_id?: string };
  /** Camera: "I am taking the photo" for this request. No ack within 2 s: the Board checks its current photo itself. */
  'capture.ack': { request_id: string };
  /** Camera: the requested photo could not be taken or sent (too dark, error). The Board checks its current photo. */
  'capture.failed': { request_id: string; reason: string };
  'snapshot.new': { snapshot_id: string; storage_path: string };
  'tutor.thinking': { snapshot_id?: string; turn?: TurnRef };
  /** Board state, sent on every change: Watching or busy (looking, speaking, listening). */
  'board.state': { state: BoardState };
  /** The page orientation of this session (set by the first photo, or the Board's rotate button). */
  'session.rotation': { rotation: 0 | 90 | 180 | 270 };
  /** The server found no readable page on this photo: the Board goes back to the last good one. */
  'snapshot.rejected': { snapshot_id: string; reason: string };
  /** The photo is sideways/upside down: the Board turns it clockwise by this angle. */
  'snapshot.rotation': { snapshot_id: string; rotation: 0 | 90 | 180 | 270 };
  'observation.created': {
    snapshot_id: string;
    item_id: string;
    observed: string | null;
    is_correct: boolean | null;
    confidence: number;
  };
  'tutor.say': {
    message_id: string;
    kind: TutorKind;
    text: string;
    language: string;
    audio_url?: string;
    /** Name of a bundled pre-recorded phrase, played instead of audio_url. */
    phrase?: string;
    snapshot_id?: string;
    annotations: Annotation[];
    turn?: TurnRef;
    /** The exercise this message is about. */
    exercise_index?: number;
  };
  'tutor.ask_exercise': {
    snapshot_id: string;
    language: string;
    text: string;
    phrase?: string;
    audio_url?: string;
    choices: ExerciseChoice[];
    turn?: TurnRef;
    /** The help waiting for the choice ("explain it" with several exercises on the page). */
    action?: HelpAction;
  };
  /** What the server saw on a photo, also when Silia stays quiet (so the screens never look frozen). */
  'analysis.done': {
    snapshot_id: string;
    /** Answers read on the page. */
    read: number;
    new: number;
    right: number;
    wrong: number;
    /** true: Silia says nothing about this photo. */
    quiet: boolean;
    reason?: 'nothing_new' | 'unsure' | 'no_answers' | 'not_checkable' | 'cooldown' | 'no_page' | 'hand_blocking';
    turn?: TurnRef;
  };
  /** The evening's plan changed (diary read, a subject started or finished). */
  'plan.changed': { plan: SessionPlan };
  /** A subject is finished: a short break before the next one (the Camera waits, the Board counts down). */
  'session.break': { seconds: number; next?: string; language: string };
  /** Active exercise changed (voice, tap or the only exercise on the page). null = no focus. */
  'focus.changed': { focus: ExerciseFocus | null; by: 'voice' | 'tap' | 'auto' };
  'board.annotate': { snapshot_id: string; annotations: Annotation[]; clear?: boolean; turn?: TurnRef };
  'tutor.speaking.end': { message_id: string };
  'child.talk.start': Record<string, never>;
  'child.talk.end': Record<string, never>;
  'child.transcript': { utterance_id: string; text: string };
  'parent.message': { message_id: string; from_name: string; text?: string; voice_url?: string };
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
