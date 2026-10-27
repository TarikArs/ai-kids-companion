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
export type TutorKind = 'hint' | 'praise' | 'question' | 'encourage' | 'parent_relay' | 'system';

export interface SessionEvents {
  'capture.tick': { next_capture_at: string };
  'snapshot.new': { snapshot_id: string; storage_path: string };
  'tutor.thinking': { snapshot_id?: string };
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
  };
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
