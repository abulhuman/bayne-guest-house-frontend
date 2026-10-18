import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROLES, canOpen, landingFor } from '../../../../lib/permissions.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const publicPages = new Set(['/login', '/change-password']);
const safeName = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export function pagesForSpec(spec) {
  const actor = spec.demo?.as ?? spec.role;
  return [...new Set((spec.steps ?? []).flatMap((step) => {
    const path = step.goto ?? step.expectUrl;
    if (typeof path !== 'string') return [];
    const page = path.split(/[?#]/)[0];
    if (publicPages.has(page)) return [];
    if (page === '/' && actor === 'security' && spec.demo?.group === 'security') return [];
    if (page === '/') return ROLES.includes(actor) && landingFor(actor) ? [landingFor(actor)] : [];
    return [page];
  }))].sort();
}

export function audienceFor(spec) {
  const pages = pagesForSpec(spec);
  const signIn = spec.demo?.group === 'sign-in';
  const primary = spec.demo?.as ?? spec.role;
  if (!signIn && !ROLES.includes(primary)) throw new Error(`${spec.name}: invalid primary role ${primary}`);
  const allowed = signIn ? [...ROLES] : pages.length === 0 ? [primary] : ROLES.filter((role) => pages.every((path) => canOpen({ role, forceChangePassword: false }, path)));
  if (!signIn && !allowed.includes(primary)) throw new Error(`${spec.name}: primary role cannot open demonstrated pages`);
  const override = spec.demo?.audience;
  if (override !== undefined && (!Array.isArray(override) || !override.length || override.some((role) => !allowed.includes(role)))) {
    throw new Error(`${spec.name}: demo.audience must narrow roles that can open every page`);
  }
  if (override && !signIn && !override.includes(primary)) throw new Error(`${spec.name}: audience excludes primary role`);
  return allowed.filter((role) => !override || override.includes(role));
}

export function readSpecs(dir) {
  return readdirSync(dir).filter((file) => file.endsWith('.json')).sort().map((file) => {
    const spec = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    if (spec.name !== file.slice(0, -5) || !safeName.test(spec.name)) throw new Error(`${file}: name must match filename`);
    return spec;
  });
}

function digest(file) {
  if (!lstatSync(file).isFile()) throw new Error(`${file}: expected regular media file`);
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

export function writeManifest({ specsDir, outDir, sourceCommit }) {
  mkdirSync(outDir, { recursive: true });
  const previous = existsSync(join(outDir, 'manifest.json')) ? JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8')) : { tutorials: [] };
  const prior = new Map(previous.tutorials.map((tutorial) => [tutorial.name, tutorial]));
  const tutorials = [];
  for (const spec of readSpecs(specsDir)) {
    const audience = audienceFor(spec);
    const videoPath = join(outDir, `${spec.name}.mp4`);
    const posterPath = join(outDir, `${spec.name}.jpg`);
    if (!existsSync(videoPath) && !existsSync(posterPath)) {
      const old = prior.get(spec.name);
      if (old) {
        if (digest(join(outDir, old.video)) !== old.sha256) throw new Error(`${spec.name}: retained video digest mismatch`);
        digest(join(outDir, old.poster));
        tutorials.push({ ...old, audience, pages: pagesForSpec(spec) });
      }
      continue;
    }
    if (!existsSync(videoPath) || !existsSync(posterPath)) throw new Error(`${spec.name}: video and poster must be published together`);
    const sha256 = digest(videoPath);
    const posterHash = digest(posterPath);
    const video = `${spec.name}.${sha256.slice(0, 16)}.mp4`;
    const poster = `${spec.name}.${posterHash.slice(0, 16)}.jpg`;
    const durationSec = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', videoPath], { encoding: 'utf8' }).trim());
    if (!Number.isFinite(durationSec) || durationSec <= 0) throw new Error(`${spec.name}: invalid media duration`);
    const old = prior.get(spec.name);
    const unchanged = old?.sha256 === sha256 && old?.poster === poster;
    const recordedAt = unchanged ? old.recordedAt : lstatSync(videoPath).mtime.toISOString();
    const commit = unchanged ? old.sourceCommit : sourceCommit;
    if (!/^[a-f0-9]{7,40}$/.test(commit ?? '')) throw new Error(`${spec.name}: invalid source commit`);
    for (const [src, name] of [[videoPath, video], [posterPath, poster]]) {
      const target = join(outDir, name);
      if (existsSync(target)) {
        if (digest(target) !== digest(src)) throw new Error(`${spec.name}: content-address collision`);
      } else copyFileSync(src, target);
    }
    tutorials.push({ name: spec.name, title: spec.demo.title, summary: spec.demo.summary, group: spec.demo.group ?? spec.role,
      primaryRole: spec.demo.as ?? spec.role, audience, pages: pagesForSpec(spec), durationSec, video, poster, sha256, recordedAt, sourceCommit: commit });
  }
  const manifest = { version: 1, tutorials };
  const temporary = join(outDir, `.manifest-${process.pid}.tmp`);
  try {
    writeFileSync(temporary, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
    renameSync(temporary, join(outDir, 'manifest.json'));
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const outDir = resolve(process.argv[2] ?? join(root, '.verify/demos'));
    const manifest = writeManifest({ specsDir: join(root, '.claude/skills/verify/demos'), outDir,
      sourceCommit: process.env.SOURCE_COMMIT ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() });
    console.log(`MANIFEST ${manifest.tutorials.length} tutorials ${new Set(manifest.tutorials.flatMap((t) => t.audience)).size} roles`);
  } catch (error) { console.error(`FAIL manifest ${error.message}`); process.exitCode = 1; }
}
