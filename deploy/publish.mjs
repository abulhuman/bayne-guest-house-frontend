import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [mode, sourceArg, targetArg] = process.argv.slice(2);
const target = resolve(targetArg);
const current = join(target, 'manifest.json');
const previous = join(target, 'manifest.previous.json');
// demo-manifest.mjs names media <name>.<first 16 hex of its sha256>.<ext>.
const contentName = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.([0-9a-f]{16})\.(?:mp4|jpg|jpeg|png|webp)$/;
const digest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const read = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null);
const mediaOf = (text) => (text ? JSON.parse(text).tutorials.flatMap((tutorial) => [tutorial.video, tutorial.poster]) : []);
const intact = (path, file) => existsSync(path) && lstatSync(path).isFile() && digest(path).startsWith(contentName.exec(file)[1]);
const replace = (path, text) => {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, text, { flag: 'wx' });
  renameSync(temporary, path);
};

if (mode === 'rollback') {
  const restored = read(previous);
  if (!restored) throw new Error(`no previous manifest: ${previous}`);
  for (const file of mediaOf(restored)) if (!intact(join(target, file), file)) throw new Error(`previous media is missing or corrupt: ${file}`);
  const replaced = read(current);
  replace(current, restored);
  replace(previous, replaced);
  console.log(`ROLLBACK ${JSON.parse(restored).tutorials.length} tutorials target=${target}`);
  process.exit(0);
}

const source = resolve(sourceArg);
const incomingText = read(join(source, 'manifest.json'));
if (!incomingText) throw new Error(`missing manifest: ${join(source, 'manifest.json')}`);
const incoming = JSON.parse(incomingText);
if (incoming.version !== 1 || !Array.isArray(incoming.tutorials)) throw new Error('invalid manifest');
for (const tutorial of incoming.tutorials) {
  for (const file of [tutorial.video, tutorial.poster]) {
    if (typeof file !== 'string' || !contentName.test(file)) throw new Error(`unsafe media name: ${file}`);
    const from = join(source, file);
    if (!existsSync(from) || !lstatSync(from).isFile()) throw new Error(`missing media: ${file}`);
    if (!intact(from, file) || (file === tutorial.video && digest(from) !== tutorial.sha256)) throw new Error(`digest mismatch: ${file}`);
  }
}

mkdirSync(target, { recursive: true, mode: 0o700 });
for (const file of mediaOf(incomingText)) {
  const to = join(target, file);
  if (intact(to, file)) continue;
  copyFileSync(join(source, file), `${to}.${process.pid}.tmp`);
  renameSync(`${to}.${process.pid}.tmp`, to);
}
const published = read(current);
const merged = new Map((published ? JSON.parse(published).tutorials : []).map((tutorial) => [tutorial.name, tutorial]));
for (const tutorial of incoming.tutorials) merged.set(tutorial.name, tutorial);
const output = JSON.stringify({ version: 1, tutorials: [...merged.values()].sort((a, b) => a.name.localeCompare(b.name)) }, null, 2) + '\n';
if (output !== published) {
  if (published) replace(previous, published);
  replace(current, output);
}
const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
const referenced = new Set([...mediaOf(output), ...mediaOf(read(previous))]);
for (const file of readdirSync(target)) {
  if (!/\.(?:mp4|jpg|jpeg|png|webp)$/.test(file) || referenced.has(file)) continue;
  const path = join(target, file);
  if (statSync(path).mtimeMs < cutoff) unlinkSync(path);
}
console.log(`PUBLISH ${JSON.parse(output).tutorials.length} tutorials target=${target}`);
