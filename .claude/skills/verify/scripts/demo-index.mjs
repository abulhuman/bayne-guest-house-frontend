import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [out] = process.argv.slice(2);
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const { tutorials: specs } = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
const groups = Map.groupBy(specs, (s) => s.group);
const cards = [...groups].map(([group, list]) => `<h2>${esc(group)}</h2><div class="grid">${list.map((s) => `
  <figure><video src="${esc(s.video)}" poster="${esc(s.poster)}" controls muted preload="none"></video>
  <figcaption><b>${esc(s.title)}</b><span>${esc(s.summary)}</span><code>${esc(s.video)}</code></figcaption></figure>`).join('')}</div>`).join('');
writeFileSync(join(out, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Almis Hotel demos</title>
<style>body{font-family:system-ui,sans-serif;margin:32px;background:#f8fafc;color:#0f172a}h2{text-transform:capitalize;margin-top:36px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(380px,1fr));gap:20px}figure{margin:0;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px #0002}
video{width:100%;display:block;background:#000}figcaption{padding:12px 14px;display:grid;gap:4px}span{color:#475569}code{color:#94a3b8;font-size:12px}</style>
<h1>Almis Hotel admin, recorded demos</h1><p>${specs.length} silent screen recordings, one per role and task. Each one is also a passing test run against the real backend.</p>${cards}`);
