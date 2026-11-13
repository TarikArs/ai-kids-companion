// E2E helper for the Board page (dev only): acts as the Camera through the API, with the Board's own sign-in.
// Load in the Board tab: await import('/e2e/helper.js')  -> window.E2E
const AUTH_KEY = Object.keys(localStorage).find((k) => /^sb-.*-auth-token$/.test(k));
const ref = AUTH_KEY.slice(3, -11);

async function anonKey() {
  for (const src of [...document.scripts].map((s) => s.src).filter(Boolean)) {
    const txt = await fetch(src).then((r) => r.text());
    const m = txt.match(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g) ?? [];
    const k = m.find((x) => {
      try {
        return JSON.parse(atob(x.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role === 'anon';
      } catch {
        return false;
      }
    });
    if (k) return k;
  }
  return null;
}

const E = { url: `https://${ref}.supabase.co`, key: await anonKey() };
E.hh = JSON.parse(localStorage.getItem('kids-companion-app')).state.device.householdId;
E.h = (extra = {}) => ({ apikey: E.key, Authorization: 'Bearer ' + JSON.parse(localStorage.getItem(AUTH_KEY)).access_token, ...extra });
E.rest = async (path, opts = {}) => {
  const r = await fetch(E.url + '/rest/v1/' + path, { ...opts, headers: E.h({ 'Content-Type': 'application/json', Prefer: 'return=representation', ...(opts.headers || {}) }) });
  const t = await r.text();
  return { status: r.status, body: t ? JSON.parse(t) : null };
};
E.session = async () =>
  (await E.rest(`homework_sessions?select=id,status,started_at,focus,fresh_at&household_id=eq.${E.hh}&status=in.(active,paused)&order=started_at.desc&limit=1`)).body?.[0] ?? null;
E.fresh = async () => {
  const s = await E.session();
  return (await E.rest(`homework_sessions?id=eq.${s.id}`, { method: 'PATCH', body: JSON.stringify({ fresh_at: new Date().toISOString(), focus: null }) })).status;
};
E.send = async (imgPath) => {
  const s = await E.session();
  const blob = await fetch(imgPath).then((r) => r.blob());
  const b64 = await new Promise((res) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result.split(',')[1]);
    fr.readAsDataURL(blob);
  });
  const bmp = await createImageBitmap(blob);
  const path = `${E.hh}/${s.id}/${Date.now()}.jpg`;
  const ins = await E.rest('snapshots?select=id', {
    method: 'POST',
    body: JSON.stringify({ household_id: E.hh, session_id: s.id, storage_path: path, width: bmp.width, height: bmp.height }),
  });
  const snapId = ins.body[0].id;
  await fetch(`${E.url}/storage/v1/object/snapshots/${path}`, { method: 'POST', headers: E.h({ 'Content-Type': 'image/jpeg' }), body: blob });
  const t0 = Date.now();
  const fn = await fetch(`${E.url}/functions/v1/analyze-snapshot`, {
    method: 'POST',
    headers: E.h({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ snapshot_id: snapId, image_b64: b64, turn: { id: 'e2e-' + Date.now().toString(36) } }),
  });
  return { ms: Date.now() - t0, fn: fn.status, out: await fn.json().catch(() => null) };
};
const call = async (fn, body) => {
  const s = await E.session();
  const t0 = Date.now();
  const r = await fetch(`${E.url}/functions/v1/${fn}`, {
    method: 'POST',
    headers: E.h({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ session_id: s.id, turn: { id: 'e2e-' + Date.now().toString(36) }, ...body }),
  });
  const out = await r.json().catch(() => null);
  return { ms: Date.now() - t0, status: r.status, text: out?.text, act: out?.intent?.act, done: out?.done };
};
E.help = (body) => call('explain-exercise', body);
E.talk = (text) => call('child-talk', { text });
E.items = async () => {
  const s = await E.session();
  const snap = (await E.rest(`snapshots?select=exercises&session_id=eq.${s.id}&order=taken_at.desc&limit=1`)).body[0].exercises.exercises;
  return snap.map((e) => ({ n: e.n, t: e.title, s: e.s, z: !!e.z, items: e.items.map((i) => `${i.q} => ${i.a}`) }));
};
/** The last correction shown on the Board (from the lines the functions logged). */
E.lastLines = async () => {
  const s = await E.session();
  const r = await E.rest(`tutor_messages?select=text,exercise_index,action,created_at&session_id=eq.${s.id}&order=created_at.desc&limit=1`);
  return r.body?.[0] ?? null;
};
E.wait = (ms) => new Promise((res) => setTimeout(res, ms));
window.E2E = E;
export default E;

/**
 * One page, end to end: fresh start, photo, choice list, background zoom, then « correct » on every exercise.
 * Results in window.R[name]; window.R._log follows the progress.
 */
E.journey = async (name, opts = {}) => {
  const R = (window.R ??= { _log: [] });
  const out = (R[name] = { steps: [] });
  if (!opts.keep) await E.fresh();
  const sent = await E.send(`/e2e/${name}.jpg`);
  out.photo = { ms: sent.ms, fn: sent.fn, text: sent.out?.text, choices: sent.out?.choices?.map((c) => `${c.index}. ${c.title} [${c.status}]`) };
  await E.wait(opts.wait ?? 14000);
  out.read = await E.items();
  for (const e of out.read) {
    R._log.push(`${name}: correct ${e.n}`);
    out.steps.push({ ex: e.n, ...(await E.help({ exercise_index: e.n, action: 'correct' })) });
  }
  for (const [kind, arg] of opts.extra ?? []) {
    R._log.push(`${name}: ${kind} ${JSON.stringify(arg)}`);
    out.steps.push({ kind, arg, ...(kind === 'talk' ? await E.talk(arg) : await E.help(arg)) });
  }
  R._log.push(`${name}: done`);
  return out;
};
E.run = async (plan) => {
  for (const [name, opts] of plan) await E.journey(name, opts).catch((e) => ((window.R[name] ??= {}).error = String(e)));
  window.R._done = true;
};
