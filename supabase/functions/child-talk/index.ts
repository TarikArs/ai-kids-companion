// child-talk: one push-to-talk turn from the Camera (the child reads aloud, or talks to Silia).
//
// POST { session_id, audio_b64, mime }   Caller: a member of the household.
//
// 1. Speech-to-text and, in parallel, the page context of the latest good photo (exercises, instructions, the child's
//    visible answers, printed text): extracted ONCE per photo, then cached (snapshots.exercises).
// 2. Reading aloud? Compared word by word in code (no AI tokens): praise or 1-2 words to repeat.
// 3. Otherwise: what does she want? Clear commands ("explique l'exercice 2", "corrige-le") are understood in code,
//    the rest by a small text-only call. Then the shared executor (_shared/help.ts): explain / solve together / correct
//    the named or ACTIVE exercise, ask which exercise or what help when it is ambiguous, or answer a follow-up.
//    The active exercise stays the focus until she names another one or taps another choice.

import { broadcast } from '../_shared/broadcast.ts';
import { corsHeaders, json } from '../_shared/cors.ts';
import { gradeLabel, PHRASES, readingFix, tutorLang } from '../_shared/language.ts';
import { checkReading } from '../_shared/reading.ts';
import { makeLog } from '../_shared/log.ts';
import { decide, looksLikeCommand, quickIntent } from '../_shared/intent.ts';
import { classify, execute, loadFocus, type HelpCtx } from '../_shared/help.ts';
import { latestSnapshot, pageContext, type PageContext } from '../_shared/page.ts';
import { admin, getCaller, isHouseholdMember } from '../_shared/supabase.ts';
import { phrasePath, speechUrl } from '../_shared/tts.ts';
import { decodeBase64 } from 'jsr:@std/encoding@1/base64';

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;
const inBackground = (p: Promise<unknown>) => (typeof EdgeRuntime !== 'undefined' ? EdgeRuntime.waitUntil(p) : p);

const OPENAI = () => Deno.env.get('OPENAI_API_KEY')!;
const STT_MODEL = Deno.env.get('OPENAI_STT_MODEL') ?? 'gpt-4o-mini-transcribe';
const MAX_AUDIO_BYTES = 3_000_000; // ~45 s of compressed speech is far below this

const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

async function transcribe(audio: Uint8Array, mime: string, lang?: string): Promise<string> {
  const form = new FormData();
  const ext = mime.includes('webm') ? 'webm' : mime.includes('wav') ? 'wav' : mime.includes('mpeg') ? 'mp3' : 'm4a';
  form.append('file', new Blob([audio], { type: mime }), `speech.${ext}`);
  form.append('model', STT_MODEL);
  if (lang) form.append('language', lang);
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI()}` },
    body: form,
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`STT ${res.status}: ${body.slice(0, 200)}`);
  return String(JSON.parse(body).text ?? '').trim();
}

/** Arabic script in what she said: answer in Arabic even before any photo. */
const spokenLang = (t: string) => (/[\u0600-\u06FF]/.test(t) ? 'ar' : /\b(the|what|how|explain|exercise)\b/i.test(t) ? 'en' : 'fr');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const { session_id, audio_b64, mime } = (await req.json().catch(() => ({}))) as {
    session_id?: unknown;
    audio_b64?: unknown;
    mime?: unknown;
  };
  if (typeof session_id !== 'string' || typeof audio_b64 !== 'string') {
    return json({ error: 'session_id and audio_b64 are required' }, 400);
  }
  const log = makeLog('child-talk');
  const audio = decodeBase64(audio_b64.includes(',') ? audio_b64.slice(audio_b64.indexOf(',') + 1) : audio_b64);
  if (audio.byteLength < 1500) return json({ mode: 'empty', note: `audio trop court (${audio.byteLength} octets reçus)` });
  if (audio.byteLength > MAX_AUDIO_BYTES) return json({ error: 'Recording too long' }, 413);

  const [user, { data: session }] = await Promise.all([
    getCaller(req),
    admin.from('homework_sessions').select('id, household_id, children(tutor_language, grade)').eq('id', session_id).maybeSingle(),
  ]);
  if (!user) return json({ error: 'Sign in first' }, 401);
  if (!session) return json({ error: 'Session not found' }, 404);
  if (!(await isHouseholdMember(user.id, session.household_id))) return json({ error: 'Not allowed' }, 403);

  const child = session.children as { tutor_language?: string; grade?: number } | null;
  const grade = gradeLabel(child?.grade);
  log('start', { session: session.id, audio_bytes: audio.byteLength, mime, grade });
  const topic = `session:${session.id}`;
  const started = Date.now();
  const t: Record<string, number> = {};
  broadcast(topic, 'tutor.thinking', {});

  try {
    const [snap, { focus, pending }] = await Promise.all([latestSnapshot(session.id), loadFocus(session.id)]);

    // Speech-to-text and page context in parallel (the page context is cached after the first turn on a photo).
    // No language hint: the child may read French but ask in Darija; a wrong hint can return an empty text.
    const [transcript, page] = await Promise.all([
      transcribe(audio, typeof mime === 'string' ? mime : 'audio/mp4'),
      snap
        ? pageContext(snap, grade, inBackground).catch((e) => {
            log('page context failed', (e as Error).message);
            return null;
          })
        : Promise.resolve(null as PageContext | null),
    ]);
    t.stt_and_page_ms = Date.now() - started;
    log('heard', {
      transcript,
      photo: snap?.id ?? null,
      page: snap?.exercises ? 'cached' : page ? 'extracted now' : 'none',
      page_lang: page?.lang,
      exercises: page?.exercises.map((e) => `${e.n}${e.label ? `(${e.label})` : ''}. ${e.title}`),
      focus: focus ? `${focus.index} ${focus.title} (${focus.action ?? '-'})` : null,
      pending,
      ms: t.stt_and_page_ms,
    });

    const language = tutorLang(child?.tutor_language, page?.lang ?? spokenLang(transcript));
    inBackground(
      Promise.resolve(
        admin.from('child_utterances').insert({
          household_id: session.household_id,
          session_id: session.id,
          transcript,
          language: page?.lang ?? null,
        }),
      ),
    );
    broadcast(topic, 'child.transcript', { utterance_id: crypto.randomUUID(), text: transcript });

    if (!transcript) {
      broadcast(topic, 'tutor.say', { message_id: crypto.randomUUID(), kind: 'system', text: '', language, annotations: [] });
      return json({ mode: 'empty', transcript, note: `transcription vide (${audio.byteLength} octets reçus)`, ms: Date.now() - started });
    }

    // A command to Silia ("explique l'exercice 2") is never treated as reading, even if its words are on the page.
    const command = looksLikeCommand(transcript);
    const reading = !command && page?.text ? checkReading(page.text, transcript) : null;

    if (!reading?.isReading) {
      const c: HelpCtx = {
        session: { id: session.id, household_id: session.household_id },
        topic,
        grade,
        advanced: Number(child?.grade ?? 1) >= 4,
        setting: child?.tutor_language,
        snap,
        page,
        focus,
        pending,
        log,
      };
      const quick = quickIntent(transcript);
      const intent = quick ?? (await classify(c, transcript, language));
      t.intent_ms = Date.now() - started - t.stt_and_page_ms;
      log('intent', { ...intent, by: quick ? 'rules' : 'model' });
      const outcome = await execute(c, decide(intent, page, focus, pending), 'voice', { transcript, lang: language });
      return json({ mode: 'talk', transcript, intent, ...outcome, ms: Date.now() - started, timings: t });
    }

    let kind: 'praise' | 'hint';
    let text: string;
    let familiar = false;
    const mode = 'reading';
    {
      const toFix = [
        ...reading.substituted.map((s) => s.expected),
        ...reading.skipped.filter((w) => w.length > 2),
      ]
        .filter((w, i, all) => w && all.indexOf(w) === i)
        .slice(0, 2);
      if (!toFix.length || reading.accuracy >= 0.97) {
        kind = 'praise';
        text = pick(PHRASES[language].read_good);
        familiar = true;
      } else {
        kind = 'hint';
        text = readingFix(language, toFix);
      }
    }

    log('decision', {
      mode,
      kind,
      text,
      reading: { accuracy: reading.accuracy, misread: reading.substituted, skipped: reading.skipped },
    });
    const phrase = familiar ? await phrasePath(text, language) : null;
    const audioUrl = familiar ? null : await speechUrl(text, language);
    const messageId = crypto.randomUUID();
    await broadcast(topic, 'tutor.say', {
      message_id: messageId,
      kind,
      text,
      language,
      ...(phrase ? { phrase } : {}),
      ...(audioUrl ? { audio_url: audioUrl } : {}),
      annotations: [],
    });
    inBackground(
      Promise.resolve(
        admin.from('tutor_messages').insert({
          id: messageId,
          household_id: session.household_id,
          session_id: session.id,
          kind,
          text,
          language,
        }),
      ),
    );

    return json({
      mode,
      transcript,
      text,
      accuracy: reading.accuracy,
      misread: reading.substituted,
      skipped: reading.skipped,
      ms: Date.now() - started,
      timings: t,
    });
  } catch (e) {
    console.error(e);
    broadcast(topic, 'tutor.say', { message_id: crypto.randomUUID(), kind: 'system', text: '', language: 'fr', annotations: [] });
    return json({ error: (e as Error).message }, 500);
  }
});
