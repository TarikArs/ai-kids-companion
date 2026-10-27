#!/usr/bin/env node
// M0 handwriting test: can a vision model read a 6-year-old's homework correctly?
//
// Usage (Node 20.6+, no dependencies):
//   cp .env.example .env   # fill in the keys you have
//   node --env-file=.env run-test.mjs              # all providers with a key
//   node --env-file=.env run-test.mjs openai       # one provider
//   node run-test.mjs --rescore results/<dir>      # re-score saved outputs, no API calls
//
// Each photo is read RUNS times (default 2). When the runs disagree on an item,
// the tutor treats it as "not sure" and stays silent; that is what gets scored.

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const CONFIDENCE_THRESHOLD = 0.75; // below this the tutor stays silent
const RUNS = Math.max(1, Number(process.env.RUNS || 2));

// ---------- providers ----------
// Model names change often: set the newest ones in .env.
const PROVIDERS = {
  anthropic: {
    key: process.env.ANTHROPIC_API_KEY,
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5',
    async call(prompt, imageB64) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 2000,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageB64 } },
              { type: 'text', text: prompt },
            ],
          }],
        }),
      });
      const json = await mustOk(res);
      return { text: json.content.map((c) => c.text || '').join(''), usage: json.usage };
    },
  },
  openai: {
    key: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || 'gpt-6-luna',
    // Reasoning models only (gpt-5.x / gpt-6.x): none | low | medium | high
    effort: process.env.OPENAI_REASONING_EFFORT || '',
    async call(prompt, imageB64) {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.key}` },
        body: JSON.stringify({
          model: this.model,
          ...(this.effort ? { reasoning_effort: this.effort } : {}),
          response_format: { type: 'json_object' },
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageB64}`, detail: 'high' } },
            ],
          }],
        }),
      });
      const json = await mustOk(res);
      return { text: json.choices[0].message.content, usage: json.usage };
    },
  },
  gemini: {
    key: process.env.GEMINI_API_KEY,
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    async call(prompt, imageB64) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.key}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ inline_data: { mime_type: 'image/jpeg', data: imageB64 } }, { text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0 },
        }),
      });
      const json = await mustOk(res);
      return { text: json.candidates[0].content.parts.map((p) => p.text || '').join(''), usage: json.usageMetadata };
    },
  },
};

async function mustOk(res) {
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

// ---------- prompt ----------
function buildPrompt(photo) {
  const items = photo.items.map(({ id, prompt }) => ({ id, prompt }));
  return [
    'You are looking at a photo of homework done by a 6-year-old child (French school, grade 1).',
    'Your job is to READ what the child wrote. Do not correct the child: report exactly what is written, even if it is wrong.',
    `Page: ${photo.title}`,
    `Task: ${photo.instructions}`,
    'If an answer is not visible (page cut off, covered, too blurry), use null. Never guess.',
    'For each item give a confidence between 0 and 1 that your reading is right.',
    '',
    'Items:',
    JSON.stringify(items, null, 2),
    '',
    'Reply with JSON only, no markdown fence:',
    '{"items":[{"id":"...","child_answer":"..." or null,"confidence":0.0}],"page_notes":"one short sentence about photo quality"}',
  ].join('\n');
}

// ---------- scoring ----------
const norm = (v) => (v === null || v === undefined ? null : String(v).toLowerCase().replace(/\s+/g, '').replace(/[’']/g, "'"));
const same = (a, b) => norm(a) === norm(b);

function parseJson(text) {
  const cleaned = text.replace(/^```(json)?/m, '').replace(/```\s*$/m, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  return JSON.parse(cleaned.slice(start, end + 1));
}

// Combine several runs into what the tutor would act on.
// All runs agree -> that reading, lowest confidence. Any disagreement -> null (tutor stays silent).
function consensus(runOutputs, id) {
  const reads = runOutputs.map((o) => (o.items || []).find((i) => i.id === id)).map((i) => i || { child_answer: undefined, confidence: 0 });
  const values = reads.map((r) => r.child_answer);
  const agree = values.every((v) => v !== undefined && same(v, values[0]));
  if (!agree) return { child_answer: null, confidence: 0, disagreed: reads.length > 1, runs: values };
  return { child_answer: values[0], confidence: Math.min(...reads.map((r) => r.confidence ?? 0)), disagreed: false, runs: values };
}

// outcome per item:
//   correct      reading matches
//   abstain      model said "not sure / not visible" but there was an answer (safe: tutor silent)
//   invented     model gave an answer where none is visible (unsafe)
//   misread      model read something else
// For child-answer tasks, a misread is a FALSE CORRECTION when the child was right and the model's
// reading is wrong; HARMFUL when confidence >= threshold (the tutor would actually say "wrong").
// Teacher-mark items (task teacher_marks) are scored apart: they do not judge the child.
function scorePhoto(photo, runOutputs) {
  const childTask = photo.task !== 'teacher_marks';
  return photo.items.map((item) => {
    const c = consensus(runOutputs, item.id);
    const got = c.child_answer;
    let outcome;
    if (got !== null && got !== undefined && same(got, item.child_answer)) outcome = 'correct';
    else if (got === null && item.child_answer === null) outcome = 'correct';
    else if (got === null || got === undefined) outcome = 'abstain';
    else if (item.child_answer === null) outcome = 'invented';
    else outcome = 'misread';

    const truthCorrect = item.child_answer === null ? null : same(item.child_answer, item.correct_answer);
    const modelCorrect = got === null || got === undefined ? null : same(got, item.correct_answer);
    const confident = (c.confidence ?? 0) >= CONFIDENCE_THRESHOLD;
    const falseCorrection = childTask && truthCorrect === true && modelCorrect === false;
    return {
      id: item.id,
      task: photo.task,
      stretch: !!item.stretch,
      childTask,
      expected: item.child_answer,
      got: got ?? null,
      runs: c.runs,
      disagreed: c.disagreed,
      confidence: c.confidence ?? null,
      outcome,
      falseCorrection,
      harmful: falseCorrection && confident,
      missedError: childTask && truthCorrect === false && modelCorrect === true,
    };
  });
}

function summarize(name, model, rows) {
  const all = rows.flatMap((r) => r.scored);
  const core = all.filter((s) => s.childTask && !s.stretch);
  const count = (xs, o) => xs.filter((s) => s.outcome === o).length;
  const rate = (xs, f) => (xs.length ? xs.filter(f).length / xs.length : null);
  const byTask = {};
  for (const s of all) {
    const k = s.stretch ? `${s.task} (stretch)` : s.task;
    (byTask[k] ||= []).push(s);
  }
  const ms = rows.flatMap((r) => r.ms);
  return {
    name,
    model,
    coreN: core.length,
    coreAcc: rate(core, (s) => s.outcome === 'correct'),
    safeRate: rate(core, (s) => s.outcome === 'correct' || s.outcome === 'abstain'),
    abstain: count(core, 'abstain'),
    invented: count(all.filter((s) => s.childTask), 'invented'),
    disagreed: all.filter((s) => s.disagreed).length,
    falseCorrections: all.filter((s) => s.falseCorrection).length,
    harmful: all.filter((s) => s.harmful).length,
    missedErrors: all.filter((s) => s.missedError).length,
    avgMs: ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) : null,
    byTask,
    rows,
  };
}

// ---------- main ----------
async function loadLabels() {
  const labels = JSON.parse(await readFile(path.join(DIR, 'labels.json'), 'utf8'));
  const unverified = labels.photos.filter((p) => !p.verified).map((p) => p.file);
  return { labels, unverified };
}

async function runLive(only) {
  const { labels, unverified } = await loadLabels();
  if (unverified.length) console.warn(`! Labels not fully verified yet: ${unverified.join(', ')}\n`);

  const active = Object.entries(PROVIDERS).filter(([name, p]) => p.key && (!only || only === name));
  if (!active.length) {
    console.error('No provider key found. Set ANTHROPIC_API_KEY, OPENAI_API_KEY or GEMINI_API_KEY in .env');
    process.exit(1);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = path.join(DIR, 'results', stamp);
  await mkdir(outDir, { recursive: true });

  const report = [];
  for (const [name, provider] of active) {
    console.log(`== ${name} (${provider.model}${provider.effort ? `, effort ${provider.effort}` : ''}) x${RUNS} runs`);
    const rows = [];
    const raw = { provider: name, model: provider.model, effort: provider.effort || null, runs: RUNS, photos: [] };
    for (const photo of labels.photos) {
      const b64 = (await readFile(path.join(DIR, 'photos', photo.file))).toString('base64');
      const outputs = [];
      const times = [];
      const errors = [];
      const usages = [];
      for (let r = 0; r < RUNS; r++) {
        const t0 = Date.now();
        try {
          const { text, usage } = await provider.call(buildPrompt(photo), b64);
          outputs.push(parseJson(text));
          usages.push(usage);
        } catch (e) {
          errors.push(e.message);
          outputs.push({ items: [] });
        }
        times.push(Date.now() - t0);
      }
      const scored = scorePhoto(photo, outputs);
      rows.push({ photo: photo.file, ms: times, errors, notes: outputs[0]?.page_notes, scored });
      raw.photos.push({ photo: photo.file, ms: times, errors, usages, outputs });
      const core = scored.filter((s) => s.childTask && !s.stretch);
      const okN = core.filter((s) => s.outcome === 'correct').length;
      console.log(`  ${photo.file}: ${okN}/${core.length} correct, ${times.join('/')} ms${errors.length ? ` ERROR ${errors[0]}` : ''}`);
    }
    await writeFile(path.join(outDir, `raw-${name}.json`), JSON.stringify(raw, null, 2));
    report.push(summarize(name, provider.model + (provider.effort ? ` (${provider.effort})` : ''), rows));
  }
  await finish(report, unverified, outDir);
}

// Re-score saved raw outputs against the current labels.json (no API calls).
async function rescore(dir) {
  const { labels, unverified } = await loadLabels();
  const outDir = path.resolve(DIR, dir);
  const files = (await readdir(outDir)).filter((f) => /^raw-.+\.json$/.test(f));
  const report = [];
  for (const f of files) {
    const raw = JSON.parse(await readFile(path.join(outDir, f), 'utf8'));
    const name = f.replace(/^raw-|\.json$/g, '');
    // Old format: array of { photo, ms, output }. New format: { model, photos: [{ photo, ms[], outputs[] }] }.
    const photos = Array.isArray(raw)
      ? raw.map((p) => ({ photo: p.photo, ms: [p.ms], errors: p.error ? [p.error] : [], outputs: [p.output] }))
      : raw.photos;
    let model = raw.model || '?';
    if (model === '?') {
      try {
        const sum = await readFile(path.join(outDir, 'summary.md'), 'utf8');
        model = sum.match(new RegExp(`\\| ${name} \\| ([^|]+) \\|`))?.[1]?.trim() || '?';
      } catch {}
    }
    const rows = labels.photos.map((photo) => {
      const p = photos.find((x) => x.photo === photo.file) || { ms: [], errors: ['missing'], outputs: [{ items: [] }] };
      return { photo: photo.file, ms: p.ms, errors: p.errors || [], notes: p.outputs[0]?.page_notes, scored: scorePhoto(photo, p.outputs) };
    });
    report.push(summarize(name, model, rows));
  }
  await finish(report, unverified, outDir, 'summary-rescored.md');
}

async function finish(report, unverified, outDir, fileName = 'summary.md') {
  const md = renderSummary(report, unverified);
  await writeFile(path.join(outDir, fileName), md);
  console.log(`\n${md}\nSaved to ${path.relative(DIR, path.join(outDir, fileName))}`);
}

function renderSummary(report, unverified) {
  const pct = (x) => (x === null ? '-' : `${Math.round(x * 100)}%`);
  const lines = [
    '# M0 handwriting test results',
    '',
    `Scored: ${new Date().toISOString()} · confidence threshold ${CONFIDENCE_THRESHOLD}`,
    unverified.length ? `\n> Labels not fully verified for: ${unverified.join(', ')}.` : '',
    '',
    '## Overview',
    '',
    '"Core" = items where the child wrote an answer (no teacher marks, no stretch counting).',
    '',
    '| Provider | Model | Core correct | Core safe (correct or abstained) | Abstained | Invented | Runs disagreed | False corrections | Harmful | Missed errors | Avg time / call |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...report.map((r) => `| ${r.name} | ${r.model} | ${pct(r.coreAcc)} (${r.coreN}) | ${pct(r.safeRate)} | ${r.abstain} | ${r.invented} | ${r.disagreed} | ${r.falseCorrections} | ${r.harmful} | ${r.missedErrors} | ${r.avgMs ?? '-'} ms |`),
    '',
    'Gate to pass M0: core correct >= 90%, 0 harmful, 0 invented.',
    '',
  ];
  for (const r of report) {
    lines.push(`## ${r.name} · by task`, '', '| Task | Items | Correct | Abstained | Invented | Misread |', '| --- | --- | --- | --- | --- | --- |');
    for (const [task, xs] of Object.entries(r.byTask)) {
      const c = (o) => xs.filter((s) => s.outcome === o).length;
      lines.push(`| ${task} | ${xs.length} | ${c('correct')} | ${c('abstain')} | ${c('invented')} | ${c('misread')} |`);
    }
    lines.push('', `## ${r.name} · not correct`, '');
    const wrong = r.rows.flatMap((row) => row.scored.filter((s) => s.outcome !== 'correct'));
    if (!wrong.length) lines.push('None.', '');
    else {
      lines.push('| Item | Expected | Tutor sees | Each run | Confidence | Outcome |', '| --- | --- | --- | --- | --- | --- |');
      for (const w of wrong) {
        const tags = [w.outcome, w.harmful ? 'HARMFUL' : w.falseCorrection ? 'false correction' : '', w.disagreed ? 'runs disagree' : '', w.stretch ? 'stretch' : '', w.childTask ? '' : 'teacher marks'].filter(Boolean).join(', ');
        const runs = (w.runs || []).map((v) => (v === null || v === undefined ? 'null' : v)).join(' / ');
        lines.push(`| ${w.id} | ${w.expected ?? 'null'} | ${w.got ?? 'null'} | ${runs} | ${w.confidence ?? '-'} | ${tags} |`);
      }
      lines.push('');
    }
    const notes = r.rows.filter((row) => row.notes || row.errors?.length).map((row) => `- ${row.photo}: ${row.errors?.length ? `ERROR ${row.errors[0]}` : row.notes}`);
    if (notes.length) lines.push('Photo notes from the model:', '', ...notes, '');
  }
  return lines.join('\n');
}

const args = process.argv.slice(2);
const job = args[0] === '--rescore' ? rescore(args[1]) : runLive(args[0]);
job.catch((e) => {
  console.error(e);
  process.exit(1);
});
