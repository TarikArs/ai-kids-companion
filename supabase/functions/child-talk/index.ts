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

import { broadcast, parseTurn, turnSender } from '../_shared/broadcast.ts';
import { corsHeaders, json } from '../_shared/cors.ts';
import { gradeLabel, PHRASES, readingFix, tutorLang, type Lang } from '../_shared/language.ts';
import { checkReading, normalizeWord, similar, words } from '../_shared/reading.ts';
import { logTurn, makeLog } from '../_shared/log.ts';
import { decide, looksLikeCommand, quickIntent } from '../_shared/intent.ts';
import { classify, execute, loadFocus, type HelpCtx } from '../_shared/help.ts';
import { latestSnapshot, pageContext, pageText, type PageContext } from '../_shared/page.ts';
import { admin, getCaller, isHouseholdMember } from '../_shared/supabase.ts';
import { phrasePath, speechUrl, lastTtsError } from '../_shared/tts.ts';
import { decodeBase64 } from 'jsr:@std/encoding@1/base64';

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;
const inBackground = (p: Promise<unknown>) => (typeof EdgeRuntime !== 'undefined' ? EdgeRuntime.waitUntil(p) : p);

const OPENAI = () => Deno.env.get('OPENAI_API_KEY')!;
const STT_MODEL = Deno.env.get('OPENAI_STT_MODEL') ?? 'gpt-4o-mini-transcribe';
const MAX_AUDIO_BYTES = 3_000_000; // ~45 s of compressed speech is far below this

const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

/** After a long reading, like a teacher: check she understood. */
const RETELL: Record<Lang, string> = {
  fr: 'Maintenant, dis-moi avec tes mots : qu’est-ce qui se passe dans le texte ?',
  ar: 'دابا عاودي ليا بكلامك: شنو وقع فالنص؟',
  fus: 'والآن، أخبريني بكلماتكِ: ماذا يحدث في النص؟',
  en: 'Now tell me in your own words: what happens in the text?',
};
/** She repeated the word Silia asked for. */
const REPEAT_OK: Record<Lang, string> = {
  fr: 'Voilà, c’est parfait !',
  ar: 'هي هاديك، مزيان!',
  fus: 'أحسنتِ، هكذا تمامًا!',
  en: 'That’s it, perfect!',
};
/** Words read in one go before Silia asks her to retell the text. */
const RETELL_AFTER_WORDS = 15;

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

  const reqBody = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const { session_id, audio_b64, mime, text: typedRaw } = reqBody as {
    session_id?: unknown;
    audio_b64?: unknown;
    mime?: unknown;
    /** Typed answer (keyboard on the phone or the Board): same path as speech, without speech-to-text. */
    text?: unknown;
  };
  const typed = typeof typedRaw === 'string' ? typedRaw.trim().slice(0, 500) : '';
  if (typeof session_id !== 'string' || (typeof audio_b64 !== 'string' && !typed)) {
    return json({ error: 'session_id and audio_b64 (or text) are required' }, 400);
  }
  const log = makeLog('child-talk');
  const audio = typed ? new Uint8Array(0) : decodeBase64((audio_b64 as string).includes(',') ? (audio_b64 as string).slice((audio_b64 as string).indexOf(',') + 1) : (audio_b64 as string));
  if (!typed && audio.byteLength < 1500) return json({ mode: 'empty', note: `audio trop court (${audio.byteLength} octets reçus)` });
  if (audio.byteLength > MAX_AUDIO_BYTES) return json({ error: 'Recording too long' }, 413);

  const [user, { data: session }] = await Promise.all([
    getCaller(req),
    admin.from('homework_sessions').select('id, household_id, children(name, tutor_language, grade)').eq('id', session_id).maybeSingle(),
  ]);
  if (!user) return json({ error: 'Sign in first' }, 401);
  if (!session) return json({ error: 'Session not found' }, 404);
  if (!(await isHouseholdMember(user.id, session.household_id))) return json({ error: 'Not allowed' }, 403);

  const child = session.children as { name?: string; tutor_language?: string; grade?: number } | null;
  const grade = gradeLabel(child?.grade);
  log('start', { session: session.id, ...(typed ? { typed } : { audio_bytes: audio.byteLength, mime }), grade });
  const topic = `session:${session.id}`;
  const turn = parseTurn(reqBody.turn);
  const send = turnSender(topic, turn);
  const started = Date.now();
  const t: Record<string, number> = {};
  send('tutor.thinking', {});

  try {
    const [snap, { focus, pending }] = await Promise.all([latestSnapshot(session.id), loadFocus(session.id)]);

    // Speech-to-text and page context in parallel (the page context is cached after the first turn on a photo).
    // No language hint: the child may read French but ask in Darija; a wrong hint can return an empty text.
    const [transcript, page] = await Promise.all([
      typed ? Promise.resolve(typed) : transcribe(audio, typeof mime === 'string' ? mime : 'audio/mp4'),
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
    send('child.transcript', { utterance_id: crypto.randomUUID(), text: transcript });

    if (!transcript) {
      send('tutor.say', { message_id: crypto.randomUUID(), kind: 'system', text: '', language, annotations: [] });
      return json({ mode: 'empty', transcript, note: `transcription vide (${audio.byteLength} octets reçus)`, ms: Date.now() - started });
    }

    // "Répète avec moi : dormait" -> she says the word: confirmed in code, no AI.
    const spoken = words(transcript);
    if (spoken.length <= 4) {
      const { data: lastFix } = await admin
        .from('tutor_messages')
        .select('action, created_at')
        .eq('session_id', session.id)
        .like('action', 'reading_fix:%')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const word = lastFix && Date.now() - Date.parse(lastFix.created_at) < 3 * 60_000 ? String(lastFix.action).slice('reading_fix:'.length) : '';
      if (word && spoken.some((w) => similar(w.norm, normalizeWord(word)))) {
        const text = REPEAT_OK[language];
        const audioUrl = await speechUrl(text, language, session.household_id);
        await send('tutor.say', { message_id: crypto.randomUUID(), kind: 'praise', text, language, ...(audioUrl ? { audio_url: audioUrl } : { tts_error: lastTtsError || 'unknown' }), annotations: [] });
        log('decision', { mode: 'repeat', word, ok: true });
        return json({ mode: 'repeat', transcript, text, ms: Date.now() - started });
      }
    }

    // A command to Silia ("explique l'exercice 2") is never treated as reading, even if its words are on the page.
    const command = !!typed || looksLikeCommand(transcript);
    // The printed text is read only the first time she talks about this page (not on every photo).
    if (!command && page && !page.text && snap) {
      page.text = await pageText(snap, inBackground).catch(() => '');
      t.page_text_ms = Date.now() - started - t.stt_and_page_ms;
    }
    const reading = !command && page?.text ? checkReading(page.text, transcript) : null;

    if (!reading?.isReading) {
      const c: HelpCtx = {
        session: { id: session.id, household_id: session.household_id },
        topic,
        turn,
        grade,
      childName: child?.name?.trim() || null,
        advanced: Number(child?.grade ?? 1) >= 4,
        setting: child?.tutor_language,
        snap,
        page,
        focus,
        pending,
        log,
      };
      // A bare number while an exercise is active ("8", "٨"): her answer, not "exercise 8".
      const bareNumber = /^\s*[\d\u0660-\u0669]+([.,][\d\u0660-\u0669]+)?\s*$/.test(transcript) && !!focus;
      const quick = bareNumber ? ({ act: 'question', ex: null } as const) : quickIntent(transcript);
      const intent = quick ?? (await classify(c, transcript, language));
      t.intent_ms = Date.now() - started - t.stt_and_page_ms;
      log('intent', { ...intent, by: quick ? 'rules' : 'model' });
      const outcome = await execute(c, decide(intent, page, focus, pending), 'voice', { transcript, lang: language });
      logTurn({
        fn: 'child-talk',
        session_id: session.id,
        household_id: session.household_id,
        turn_id: turn?.id ?? null,
        ms: Date.now() - started,
        timings: t,
        outcome: `${intent.act}:${outcome.done}`,
        extra: { intent_by: quick ? 'rules' : 'model' },
      });
      return json({ mode: 'talk', transcript, intent, ...outcome, ms: Date.now() - started, timings: t });
    }

    let kind: 'praise' | 'hint';
    let text: string;
    let familiar = false;
    let fixWord = '';
    const mode = 'reading';
    {
      const toFix = [
        ...reading.substituted.map((s) => s.expected),
        ...reading.skipped.filter((w) => w.length > 2),
      ]
        .filter((w, i, all) => w && all.indexOf(w) === i)
        .slice(0, 1); // one word to work on, never a list of mistakes
      if (!toFix.length || reading.accuracy >= 0.97) {
        kind = 'praise';
        text = pick(PHRASES[language].read_good);
        familiar = true;
      } else {
        kind = 'hint';
        text = readingFix(language, toFix);
      }
      fixWord = toFix[0] ?? '';
      // A real passage read in one go: ask her to retell it (the next turn checks her understanding).
      if (reading.matched >= RETELL_AFTER_WORDS) {
        text = `${text} ${RETELL[language]}`;
        familiar = false;
      }
    }

    log('decision', {
      mode,
      kind,
      text,
      reading: { accuracy: reading.accuracy, misread: reading.substituted, skipped: reading.skipped },
    });
    const phrase = familiar ? await phrasePath(text, language) : null;
    const audioUrl = familiar ? null : await speechUrl(text, language, session.household_id);
    const messageId = crypto.randomUUID();
    await send('tutor.say', {
      message_id: messageId,
      kind,
      text,
      language,
      ...(phrase ? { phrase } : {}),
      ...(audioUrl ? { audio_url: audioUrl } : phrase ? {} : { tts_error: lastTtsError || 'unknown' }),
      annotations: [],
    });
    inBackground(
      (async () => {
        const row = { id: messageId, household_id: session.household_id, session_id: session.id, kind, text, language };
        // The word to repeat is remembered: her next turn ("dormait") is checked against it.
        const res = await admin.from('tutor_messages').insert({ ...row, ...(fixWord && kind === 'hint' ? { action: `reading_fix:${fixWord}` } : {}) });
        if (res.error && fixWord) await admin.from('tutor_messages').insert(row);
      })(),
    );

    logTurn({
      fn: 'child-talk',
      session_id: session.id,
      household_id: session.household_id,
      turn_id: turn?.id ?? null,
      ms: Date.now() - started,
      timings: t,
      outcome: `reading:${kind}`,
      extra: { accuracy: reading.accuracy, words: reading.matched },
    });
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
    send('tutor.say', { message_id: crypto.randomUUID(), kind: 'system', text: '', language: 'fr', annotations: [] });
    return json({ error: (e as Error).message }, 500);
  }
});
