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

export interface SessionEvents {
  'capture.tick': { next_capture_at: string };
  /** Board "Corriger": ask the Camera to take a photo now and check every answer. */
  'capture.request': { mode: 'check'; request_id?: string };
  /** Camera: "I am taking the photo" for this request. No ack within 2 s: the Board checks its current photo itself. */
  'capture.ack': { request_id: string };
  /** Camera: the requested photo could not be taken or sent (too dark, error). The Board checks its current photo. */
  'capture.failed': { request_id: string; reason: string };
  'snapshot.new': { snapshot_id: string; storage_path: string };
  'tutor.thinking': { snapshot_id?: string };
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
    /** The help waiting for the choice ("explain it" with several exercises on the page). */
    action?: HelpAction;
  };
  /** Active exercise changed (voice, tap or the only exercise on the page). null = no focus. */
  'focus.changed': { focus: ExerciseFocus | null; by: 'voice' | 'tap' | 'auto' };
  'board.annotate': { snapshot_id: string; annotations: Annotation[]; clear?: boolean };
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
