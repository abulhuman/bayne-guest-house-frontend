import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const { chromium } = createRequire(process.env.NODE_PATH + '/')('playwright-core');
const { WEB_URL, API_URL, CHROME, EVIDENCE_DIR, CONTROL, DEMO_OUT } = process.env;
const STEP_TIMEOUT = 10_000;
const RECORDING = Boolean(DEMO_OUT);

const arg = process.argv[2];
const spec = JSON.parse(arg.trim().startsWith('{') ? arg : readFileSync(arg, 'utf8'));
const name = spec.name ?? 'inline';
const seq = String(readdirSync(EVIDENCE_DIR).filter((d) => /^\d{3}-/.test(d)).length + 1).padStart(3, '0');
const dir = join(EVIDENCE_DIR, `${seq}-${name}`);
mkdirSync(dir, { recursive: true });

const vars = { ...process.env, RUN: Date.now().toString(36) };
const iso = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const text = (x) => (typeof x === 'string' ? x : JSON.stringify(x));
const sub = (v) =>
  typeof v === 'string'
    ? /^\$\{\w+\}$/.test(v) && v.slice(2, -1) in vars ? vars[v.slice(2, -1)]
    : v.replace(/\$\{DATE([+-]\d+)\}/g, (_, n) => iso(Number(n))).replace(/\$\{(\w+)\}/g, (m, k) => (k in vars ? text(vars[k]) : m))
    : Array.isArray(v) ? v.map(sub)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, sub(x)]))
    : v;
const control = (...a) => execFileSync(CONTROL, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const responseBody = (out) => out.split('\n')[out.split('\n').findIndex((l) => l.startsWith('EVIDENCE ')) + 1];
const jq = (filter, input) => execFileSync('jq', ['-e', filter], { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();

const report = { spec: name, role: spec.role ?? 'admin', viewport: spec.viewport ?? 'desktop', setup: [], steps: [], visits: [], api: [], requests: [], console: [], pageErrors: [] };
let failed = null;
const events = [];
let capture = null;
let activeCaption = '';
const ev = (type, extra = {}) => {
  const event = { t: Date.now() - (capture?.excludedMs ?? 0), type, box: null, caption: activeCaption, ...extra };
  events.push(event);
  return event;
};

function finish(browserClose) {
  const result = failed ? (spec.knownBug ? 'XFAIL' : 'FAIL') : (spec.knownBug ? 'XPASS' : 'PASS');
  report.result = result;
  report.failure = failed;
  writeFileSync(join(dir, 'result.json'), JSON.stringify(report, null, 2));
  for (const a of report.api) console.log(`API ${a.method} ${a.path} ${a.status}`);
  console.log(`BYTES ${report.requests.reduce((t, r) => t + (r.bytes ?? 0), 0)} requests=${report.requests.length}`);
  console.log(`PAGEERRORS ${report.pageErrors.length}`);
  console.log(`EVIDENCE ${dir}`);
  if (result === 'XFAIL') console.log(`KNOWN_BUG ${spec.knownBug}`);
  if (result === 'XPASS') console.log(`NEXT the known bug is fixed; delete "knownBug" from ${name}.json so this spec guards the fix`);
  console.log(`RESULT ${result}`);
  return browserClose?.().then(() => process.exit(result === 'PASS' || result === 'XFAIL' ? 0 : 1));
}

for (const [i, raw] of (spec.setup ?? []).entries()) {
  const s = sub(raw);
  const label = `${s.as} ${s.method} ${s.path}`;
  try {
    const out = control('api', 'call', '--expect', String(s.expect), s.as, s.method, s.path, ...(s.body ? [JSON.stringify(s.body)] : []));
    if (s.save) vars[s.save] = JSON.parse(jq(`${s.pick ?? '.id'} | select(.)`, responseBody(out)));
    report.setup.push({ ...s, evidence: out.match(/^EVIDENCE (.+)$/m)?.[1] });
    console.log(`SETUP ${String(i + 1).padStart(2, '0')} OK ${label}${s.save ? ` ${s.save}=${text(vars[s.save])}` : ''}`);
  } catch (e) {
    failed = `setup ${label}: ${(e.stdout || e.message).split('\n').filter(Boolean).slice(-2).join(' | ')}`;
    console.log(`SETUP FAIL ${failed}`);
    await finish();
    process.exit(1);
  }
}

const role = report.role;
const token = role === 'anon' ? null : control('api', 'token', role);
const VIEWPORTS = { desktop: { width: 1280, height: 800 }, tablet: { width: 768, height: 1024 }, phone: { width: 390, height: 844 } };
if (!VIEWPORTS[report.viewport]) throw new Error(`viewport must be one of ${Object.keys(VIEWPORTS).join(', ')}`);
const browser = await chromium.launch({ executablePath: CHROME, ...(RECORDING && { args: ['--force-device-scale-factor=2'] }) });
const viewport = VIEWPORTS[report.viewport];
const ctx = await browser.newContext({ viewport, ...(RECORDING && { deviceScaleFactor: 2 }) });
if (RECORDING) {
  await ctx.exposeBinding('__demoDialog', (_, box) => {
    if (!capture) return;
    if (capture.paused) capture.pendingDialog = box;
    else ev('dialog', { box });
  });
  await ctx.addInitScript(demoOverlay);
}
await ctx.addInitScript((t) => {
  // Init scripts also run in subframes such as the PDF viewer, where sessionStorage is null.
  if (window !== window.top || sessionStorage.getItem('verify-seeded')) return;
  sessionStorage.setItem('verify-seeded', '1');
  if (t) localStorage.setItem('token', t); else localStorage.removeItem('token');
}, token);
const page = await ctx.newPage();
page.setDefaultTimeout(STEP_TIMEOUT);

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

function demoOverlay() {
  if (window !== window.top) return;
  let store;
  try { store = window.sessionStorage; } catch { return; }
  const draw = () => {
    if (!document.body || document.getElementById('demo-cursor')) return;
    const style = document.createElement('style');
    style.textContent = `nextjs-portal{display:none!important}
#demo-cursor{position:fixed;left:0;top:0;width:26px;height:26px;z-index:2147483647;pointer-events:none;will-change:transform;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))}
#demo-cursor svg{transition:transform .12s;transform-origin:3px 3px}
#demo-cursor.down svg{transform:scale(.82)}
.demo-ripple{position:fixed;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:3px solid rgba(13,148,136,.9);z-index:2147483645;pointer-events:none;animation:demo-ripple .5s ease-out forwards}
@keyframes demo-ripple{from{transform:scale(.2);opacity:1}to{transform:scale(1.2);opacity:0}}
#demo-key{position:fixed;padding:4px 10px;border-radius:7px;background:#fff;color:#0f172a;border:1px solid #cbd5e1;border-bottom-width:3px;font:600 14px system-ui,sans-serif;z-index:2147483646;pointer-events:none;transition:opacity .2s}`;
    document.head.appendChild(style);
    const cursor = document.createElement('div');
    cursor.id = 'demo-cursor';
    cursor.innerHTML = '<svg width="26" height="26" viewBox="0 0 26 26"><path d="M3 2 L3 21 L8 16.5 L11.5 24 L15 22.5 L11.6 15.2 L18.5 15.2 Z" fill="#111827" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.body.appendChild(cursor);
    let pos = JSON.parse(store.getItem('demo-pos') || `[${innerWidth * 0.78},${innerHeight * 0.76}]`);
    let gliding = false;
    const set = (x, y) => { pos = [x, y]; cursor.style.transform = `translate(${x - 3}px,${y - 3}px)`; store.setItem('demo-pos', JSON.stringify(pos)); };
    set(...pos);
    window.__demoGlide = (x, y, ms) => new Promise((done) => {
      const [sx, sy] = pos, t0 = performance.now(), d = Math.hypot(x - sx, y - sy);
      const nx = d ? -(y - sy) / d : 0, ny = d ? (x - sx) / d : 0, bow = Math.min(60, d * 0.08);
      const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
      gliding = true;
      const step = (now) => {
        const k = Math.min(1, (now - t0) / ms), e = ease(k), arc = Math.sin(Math.PI * e) * bow;
        set(sx + (x - sx) * e + nx * arc, sy + (y - sy) * e + ny * arc);
        if (k < 1) requestAnimationFrame(step); else { gliding = false; done(); }
      };
      requestAnimationFrame(step);
    });
    window.__demoKey = (label) => {
      const k = document.createElement('div');
      k.id = 'demo-key'; k.textContent = label;
      k.style.left = pos[0] + 18 + 'px'; k.style.top = pos[1] + 22 + 'px';
      document.body.appendChild(k);
      setTimeout(() => { k.style.opacity = '0'; setTimeout(() => k.remove(), 250); }, 700);
    };
    window.__demoCard = (html) => {
      const c = document.createElement('div');
      c.id = 'demo-card'; c.innerHTML = html;
      c.style.cssText = 'position:fixed;inset:0;z-index:2147483645;transition:opacity .5s ease';
      document.body.appendChild(c);
    };
    window.__demoCardOut = () => { const c = document.getElementById('demo-card'); if (!c) return; c.style.opacity = '0'; setTimeout(() => c.remove(), 600); };
    document.addEventListener('mousemove', (e) => { if (!gliding) set(e.clientX, e.clientY); }, true);
    document.addEventListener('mousedown', (e) => {
      cursor.classList.add('down');
      const r = document.createElement('div');
      r.className = 'demo-ripple'; r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px';
      document.body.appendChild(r); setTimeout(() => r.remove(), 600);
    }, true);
    document.addEventListener('mouseup', () => cursor.classList.remove('down'), true);
  };
  if (document.body) draw(); else document.addEventListener('DOMContentLoaded', draw);
  let last;
  const watchDialog = () => {
    const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter((el) => el.getClientRects().length);
    const rect = dialogs.at(-1)?.getBoundingClientRect();
    const box = rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
    const key = JSON.stringify(box && Object.values(box).map(Math.round));
    if (key !== last) { last = key; window.__demoDialog?.(box); }
  };
  document.addEventListener('DOMContentLoaded', () => {
    new MutationObserver(watchDialog).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
    new ResizeObserver(watchDialog).observe(document.body);
    watchDialog();
  });
}
const cardHtml = (d) => `<div style="height:100%;display:grid;place-items:center;background:linear-gradient(135deg,#0f172a,#1e3a5f);color:#fff;font-family:system-ui,sans-serif">
  <div style="text-align:center;max-width:80%">
    <div style="display:inline-block;padding:6px 16px;border-radius:999px;background:#38bdf8;color:#0f172a;font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:15px">${esc(report.role === 'anon' ? (d.as ?? 'Any user') : report.role)}</div>
    <h1 style="font-size:44px;margin:22px 0 14px;color:#fff">${esc(d.title)}</h1>
    <p style="font-size:21px;color:#cbd5e1;line-height:1.5;margin:0">${esc(d.summary ?? '')}</p>
  </div></div>`;

async function startCapture() {
  const cdp = await ctx.newCDPSession(page);
  const frameDir = join(dir, 'frames');
  mkdirSync(frameDir, { recursive: true });
  const initial = join(frameDir, 'initial.jpg');
  await page.screenshot({ path: initial, type: 'jpeg', quality: 90 });
  const frames = [{ f: initial, t: Date.now() }];
  capture = { cdp, frames, frameDir, excludedMs: 0, paused: false, startedAt: Date.now() };
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    if (capture.paused || metadata.timestamp * 1000 - capture.excludedMs <= frames.at(-1).t) return;
    const f = join(frameDir, `${String(frames.length).padStart(6, '0')}.jpg`);
    writeFileSync(f, Buffer.from(data, 'base64'));
    frames.push({ f, t: metadata.timestamp * 1000 - capture.excludedMs });
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: viewport.width * 2, maxHeight: viewport.height * 2 });
  const deadline = Date.now() + STEP_TIMEOUT;
  while (!frames.length) {
    if (Date.now() > deadline) throw new Error('CDP screencast produced no frame');
    await page.waitForTimeout(20);
  }
  ev('start');
}
async function stopCapture() {
  const end = Date.now() - capture.excludedMs;
  const encodeStart = Date.now();
  capture.cdp.removeAllListeners('Page.screencastFrame');
  await capture.cdp.send('Page.stopScreencast');
  const { frames, frameDir } = capture;
  const t0 = frames[0].t;
  const quote = (path) => path.replace(/'/g, "'\\''");
  const list = frames.map((fr, i) => `file '${quote(fr.f)}'\nduration ${Math.max(0.001, ((frames[i + 1]?.t ?? end) - fr.t) / 1000).toFixed(4)}`);
  writeFileSync(join(frameDir, 'list.txt'), `ffconcat version 1.0\n${list.join('\n')}\nfile '${quote(frames.at(-1).f)}'\n`);
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', join(frameDir, 'list.txt'),
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p', '-fps_mode', 'passthrough', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-f', 'matroska', DEMO_OUT]);
  writeFileSync(DEMO_OUT.replace(/\.src\.mkv$/, '.events.json'), JSON.stringify({ viewport, dsf: 2, fps: 30, frames: frames.length,
    events: events.map((e) => ({ ...e, t: Math.max(0, e.t - t0) })), end: end - t0, captureWallMs: Date.now() - capture.startedAt, sourceEncodeMs: Date.now() - encodeStart }, null, 2));
  rmSync(frameDir, { recursive: true });
  console.log(`CAPTURE wall=${((Date.now() - capture.startedAt) / 1000).toFixed(2)}s sourceEncode=${((Date.now() - encodeStart) / 1000).toFixed(2)}s frames=${frames.length}`);
  await capture.cdp.detach();
}
async function boxOf(el) {
  const box = await el.boundingBox().catch(() => null);
  if (box && box.width && box.height) return box;
  return el.evaluate((e) => { const r = (e.closest('label') || e.parentElement).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }).catch(() => null);
}
async function glideTo(el, verb, at) {
  const inView = await el.evaluate((e) => { const r = (e.offsetParent ? e : e.parentElement).getBoundingClientRect(); return r.top >= 64 && r.bottom <= innerHeight - 96; }).catch(() => true);
  if (!inView) {
    await el.evaluate((e) => (e.offsetParent ? e : e.parentElement).scrollIntoView({ behavior: 'smooth', block: 'center' })).catch(() => {});
    await page.waitForTimeout(550);
  }
  const box = await boxOf(el);
  if (!box) return;
  const to = at ? [box.x + at[0], box.y + at[1]] : [box.x + Math.min(box.width / 2, 120), box.y + box.height / 2];
  const ms = Math.round(Math.min(950, Math.max(380, 300 + Math.hypot(to[0] - mouse[0], to[1] - mouse[1]) * 0.7)));
  const step = events.findLast((e) => e.type === 'step');
  if (step) step.box = box;
  ev('glide', { verb, box, to, ms });
  await page.evaluate(([x, y, d]) => window.__demoGlide?.(x, y, d), [...to, ms]);
  await page.mouse.move(...to);
  mouse = to;
  await page.waitForTimeout(140);
}
const clearCaption = () => {
  if (activeCaption) { activeCaption = ''; ev('captionClear'); }
};
let mouse = [viewport.width * 0.78, viewport.height * 0.76];
const PACE = 300;
const deferred = [];
let posterMarked = false;
let secondPage = false;
if (RECORDING) ctx.on('page', () => { secondPage = true; });

const apiPath = (url) => url.slice(API_URL.length) || '/';
const failing = new Set(sub(spec.failApi ?? []));
const routeMatches = (rule, method, path) => {
  const [m, prefix] = rule.split(' ');
  const rest = path.slice(prefix.length);
  return method === m && path.startsWith(prefix) && (rest === '' || prefix.endsWith('/') || /^[/?]/.test(rest));
};
const fails = (req) => [...failing].some((f) => routeMatches(f, req.method(), apiPath(req.url())));
await page.route((u) => u.href.startsWith(API_URL), (r) =>
  fails(r.request())
    ? r.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"verify-injected failure"}' })
    : r.fallback());
const sent = new Map();
page.on('request', (r) => {
  if (!r.url().startsWith(API_URL) || r.method() === 'OPTIONS') return;
  const entry = { method: r.method(), path: apiPath(r.url()), status: 'pending', body: r.postData() ?? undefined };
  sent.set(r, entry);
  report.api.push(entry);
});
page.on('response', (r) => { const entry = sent.get(r.request()); if (entry) entry.status = r.status(); });
page.on('requestfailed', (r) => { const entry = sent.get(r); if (entry) entry.status = 'failed'; });
page.on('framenavigated', (f) => f === page.mainFrame() && report.visits.push(new URL(f.url()).pathname));
const sizing = [];
page.on('request', (q) => report.requests.push({ url: q.url().slice(0, 200), q }));
page.on('requestfinished', (q) => sizing.push(q.sizes().then((z) => { report.requests.find((r) => r.q === q).bytes = z.responseHeadersSize + z.responseBodySize; }).catch(() => {})));
page.on('console', (m) => m.type() === 'error' && report.console.push(m.text().slice(0, 300)));
page.on('pageerror', (e) => report.pageErrors.push(e.message.slice(0, 300)));

const scope = () => (page.locator('[role="dialog"]').count().then((n) => (n ? page.locator('[role="dialog"]').last().locator('xpath=..') : page)));
async function target(t) {
  if (typeof t === 'string') return page.locator(t).first();
  const root = await scope();
  if (t.label) {
    const byLabel = root.getByLabel(t.label, { exact: true });
    if (await byLabel.count()) return byLabel.first();
    const exact = root.locator(`div:has(> label:text-is("${t.label}")) > :is(input,select,textarea), div:has(> label:text-is("${t.label}")) :is(input,select,textarea)`);
    if (await exact.count()) return exact.first();
    return root.locator(`div:has(> label:has-text("${t.label}")) > :is(input,select,textarea)`).first();
  }
  if (t.role) return root.getByRole(t.role, { name: t.name, exact: true }).first();
  if (t.placeholder) return root.getByPlaceholder(t.placeholder, { exact: true }).first();
  if (t.text) return root.getByText(t.text, { exact: true }).first();
  throw new Error(`unknown target ${JSON.stringify(t)}`);
}
const networkIdle = () => page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
// Once an iframe commits, Playwright can leave networkidle unset until another request ends, so a recorded action also stops at apiQuiet.
const settle = () => (RECORDING ? Promise.race([networkIdle(), apiQuiet()]) : networkIdle());
// networkidle resolves at once after the first load, so track our own pending requests instead.
async function apiQuiet() {
  const end = Date.now() + 5_000;
  let quietSince = Date.now();
  while (Date.now() < end) {
    if (report.api.some((a) => a.status === 'pending')) quietSince = Date.now();
    else if (Date.now() - quietSince >= 500) return;
    await page.waitForTimeout(50);
  }
}
async function poll(check, what) {
  const end = Date.now() + STEP_TIMEOUT;
  let last;
  while (Date.now() < end) {
    last = await check();
    if (last === true) return;
    await page.waitForTimeout(200);
  }
  throw new Error(`${what}${typeof last === 'string' ? ` (got: ${last})` : ''}`);
}
const bodyText = () => page.innerText('body').catch(() => '');
const apiMatch = (want) => {
  const [method, path, status] = want.split(' ');
  return report.api.some((a) => a.method === method && a.path.split('?')[0] === path.split('?')[0] && (!status || String(a.status) === status));
};

const actions = {
  goto: async (p) => { await page.goto(WEB_URL + p, { waitUntil: 'networkidle', timeout: 60_000 }); },
  click: async (t, s) => {
    const el = await target(t);
    if (RECORDING) await glideTo(el, 'click', s.at);
    await el.click(s.at ? { position: { x: s.at[0], y: s.at[1] } } : {});
    await settle();
  },
  fill: async (t, s) => {
    const el = await target(t);
    if (!RECORDING) return el.fill(String(s.value));
    await glideTo(el, 'fill');
    await el.click();
    if (/^(date|datetime-local|time|month)$/.test(await el.getAttribute('type') ?? '')) return el.fill(String(s.value));
    ev('type', { chars: String(s.value).length });
    await el.fill('');
    await el.pressSequentially(String(s.value), { delay: 70 });
  },
  caption: async (text) => {
    if (!RECORDING) return;
    activeCaption = text;
    ev('caption', { text });
    await page.waitForTimeout(Math.min(2_800, 650 + text.length * 28));
    clearCaption();
  },
  upload: async (t, s) => {
    const el = await target(t);
    if (RECORDING) await glideTo(el, 'upload');
    await el.setInputFiles(String(s.value));
    await settle();
  },
  select: async (t, s) => {
    const el = await target(t);
    if (RECORDING) await glideTo(el, 'select');
    await poll(async () => (await el.locator('option').evaluateAll((os, v) => os.some((o) => o.value === v || o.textContent.trim() === v), String(s.value))) || 'option missing', `option ${s.value}`);
    await el.selectOption(String(s.value)).catch(() => el.selectOption({ label: String(s.value) }));
    await settle();
  },
  press: async (k) => {
    if (RECORDING) {
      const focused = page.locator(':focus');
      if (await focused.count()) await glideTo(focused.first(), 'press');
      await page.evaluate((label) => window.__demoKey?.(label), k);
    }
    await page.keyboard.press(k);
    await settle();
  },
  poster: async () => {
    if (!RECORDING) return;
    await page.screenshot({ path: DEMO_OUT.replace(/\.src\.mkv$/, '.poster.png') });
    posterMarked = true;
  },
  wait: async (ms) => { await page.waitForTimeout(ms); },
  failApi: async (fs) => { for (const f of fs) failing.add(f); },
  unfailApi: async (fs) => { for (const f of fs) failing.delete(f); },
  screenshot: async (n) => { await page.screenshot({ path: join(dir, `${n}.png`) }); },
  expectText: (s) => poll(async () => (await bodyText()).includes(s), `text "${s}" not on page`),
  expectNoText: (s) => poll(async () => !(await bodyText()).includes(s), `text "${s}" still on page`),
  expectVisible: async (t) => { await (await target(t)).waitFor({ state: 'visible' }); },
  expectHidden: async (t) => { await (await target(t)).waitFor({ state: 'hidden' }); },
  expectValue: async (t, s) => { const el = await target(t); await poll(async () => (await el.inputValue()) === String(s.value) || await el.inputValue(), `value "${s.value}"`); },
  expectUrl: (p) => poll(async () => new URL(page.url()).pathname === p || new URL(page.url()).pathname, `url ${p}`),
  expectTitle: (s) => poll(async () => (await page.title()) === s || await page.title(), `title "${s}"`),
  expectApi: (w) => poll(async () => apiMatch(w) || JSON.stringify(report.api.map((a) => `${a.method} ${a.path} ${a.status}`).slice(-4)), `api ${w}`),
  expectNoApi: async (w) => {
    await apiQuiet();
    const hit = report.api.find((a) => routeMatches(w, a.method, a.path));
    if (hit) throw new Error(`api ${w} was called (${hit.method} ${hit.path} ${hit.status})`);
  },
  expectNoVisit: async (p) => { await settle(); if (report.visits.includes(p)) throw new Error(`visited ${p} (visits: ${report.visits.join(' ')})`); },
  expectRequest: (s) => poll(async () => report.requests.some((r) => r.url.includes(s)) || report.requests.map((r) => r.url).filter((u) => u.startsWith(API_URL)).slice(-3).join(' '), `request containing ${s}`),
  expectNoRequest: async (s) => { await settle(); const hit = report.requests.find((r) => r.url.includes(s)); if (hit) throw new Error(`request to ${hit.url}`); },
  expectNoPageErrors: async () => { if (report.pageErrors.length) throw new Error(report.pageErrors[0]); },
  expectFits: async () => {
    const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    if (w[0] > w[1]) throw new Error(`page is ${w[0]}px wide in a ${w[1]}px viewport`);
    const off = await page.evaluate(() => [...document.querySelectorAll('button, a[href], input, select, textarea')]
      .filter((el) => !el.closest('table'))
      .map((el) => [el, el.getBoundingClientRect()])
      .filter(([, r]) => r.width > 0 && (r.left < 0 || r.right > window.innerWidth))
      .map(([el, r]) => `${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute('placeholder') || '').trim().slice(0, 30)}" spans ${Math.round(r.left)}..${Math.round(r.right)}px`));
    if (off.length) throw new Error(`${off[0]} in a ${w[1]}px viewport`);
  },
  apiCheck: async (c) => {
    if (RECORDING && capture) { deferred.push({ check: c, stepIndex: report.steps.length }); return; }
    try {
      const out = control('api', 'call', '--expect', String(c.expect ?? 200), c.as, 'GET', c.path);
      if (c.jq) jq(c.jq, responseBody(out));
    } catch (e) { throw new Error(`apiCheck ${c.path} ${c.jq ?? ''}: ${(e.stdout || e.message).trim().split('\n').pop()}`); }
  },
};

let steps = spec.steps;
if (RECORDING) {
  try {
    if (!spec.demo?.title || !steps[0]?.goto) throw new Error('a demo needs demo.title and a first goto step');
    await actions.goto(sub(steps[0]).goto);
    report.steps.push({ n: '01', desc: `goto ${JSON.stringify(sub(steps[0]).goto)}`, ok: true });
    console.log('STEP 01 OK goto (before capture)');
    steps = steps.slice(1);
    await page.evaluate((h) => window.__demoCard?.(h), cardHtml(spec.demo));
    await page.mouse.move(...mouse);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await startCapture();
    ev('card');
    await page.waitForTimeout(Math.min(2_400, 1_200 + (spec.demo.title.length + (spec.demo.summary ?? '').length) * 8));
    await page.evaluate(() => window.__demoCardOut?.());
    await page.waitForTimeout(500);
    ev('cardOut');
  } catch (error) {
    failed = `recording setup: ${error.message.split('\n')[0]}`;
    const first = report.steps[0] ?? { n: '01', desc: `goto ${JSON.stringify(sub(spec.steps[0]?.goto))}` };
    first.ok = false;
    first.error = failed;
    if (!report.steps.length) report.steps.push(first);
    console.log(`STEP 01 FAIL ${first.desc} :: ${failed}`);
    await page.screenshot({ path: join(dir, 'failure.png') }).catch(() => {});
    await finish(async () => { await ctx.close(); await browser.close(); });
  }
}
const PACED = new Set(['goto', 'click', 'fill', 'select', 'press', 'upload']);
for (const [i, raw] of steps.entries()) {
  const s = sub(raw);
  const verb = Object.keys(actions).find((k) => k in s);
  const n = String(i + 1 + spec.steps.length - steps.length).padStart(2, '0');
  const desc = `${verb} ${JSON.stringify(s[verb])}${'value' in s ? ` = ${JSON.stringify(s.value)}` : ''}`;
  try {
    if (!verb) throw new Error(`unknown step ${JSON.stringify(s)}`);
    if (RECORDING) ev('step', { verb, n, ...(verb === 'caption' && { caption: s.caption }), header: await page.evaluate(() => document.querySelector('header')?.innerText ?? '') });
    const assertion = verb.startsWith('expect') || verb === 'apiCheck' || verb === 'screenshot' || verb === 'poster';
    const pauseStart = Date.now();
    if (capture && assertion) capture.paused = true;
    try { await actions[verb](s[verb], s); }
    finally {
      if (capture && assertion) {
        capture.excludedMs += Date.now() - pauseStart;
        capture.paused = false;
        if ('pendingDialog' in capture) { ev('dialog', { box: capture.pendingDialog }); delete capture.pendingDialog; }
      }
    }
    if (secondPage) throw new Error('demo opened a second page; only one page can be recorded');
    if (DEMO_OUT && PACED.has(verb)) await page.waitForTimeout(PACE);
    const pending = RECORDING && capture && verb === 'apiCheck';
    report.steps.push({ n, desc, ok: pending ? null : true });
    if (!pending) console.log(`STEP ${n} OK ${desc}`);
  } catch (e) {
    failed = `step ${n} ${desc}: ${e.message.split('\n')[0]}`;
    report.steps.push({ n, desc, ok: false, error: e.message.split('\n')[0] });
    console.log(`STEP ${n} FAIL ${desc} :: ${e.message.split('\n')[0]}`);
    break;
  }
}
if (RECORDING) {
  clearCaption();
  if (!posterMarked) await actions.poster();
  await page.waitForTimeout(650);
  ev('end');
}
if (RECORDING && capture) {
  await stopCapture();
  capture = null;
  for (const { check, stepIndex } of failed ? [] : deferred) {
    const step = report.steps[stepIndex];
    try {
      await actions.apiCheck(check);
      step.ok = true;
      console.log(`STEP ${step.n} OK ${step.desc} (after capture)`);
    } catch (error) {
      failed = `step ${step.n} ${step.desc}: ${error.message}`;
      step.ok = false;
      step.error = error.message;
      console.log(`STEP ${step.n} FAIL ${step.desc} :: ${error.message}`);
    }
  }
}
await page.screenshot({ path: join(dir, failed ? 'failure.png' : 'final.png') }).catch(() => {});
report.finalUrl = page.url();
report.title = await page.title().catch(() => '');
await Promise.all(sizing);
for (const r of report.requests) delete r.q;
await finish(async () => {
  await ctx.close();
  await browser.close();
});
