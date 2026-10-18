import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pagesForSpec, readSpecs } from './demo-manifest.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const globalFiles = new Set(['lib/permissions.ts', 'components/Layout.tsx', 'components/RequireAuth.tsx', 'pages/_app.tsx', 'pages/_document.tsx', 'styles/globals.css']);

function glob(pattern, path) {
  const re = pattern.split('**').map((part) => part.split('*').map((text) => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*');
  return new RegExp(`^${re}$`).test(path);
}

export function affectedDemos({ changed, specs, sources }) {
  if (changed.some((file) => globalFiles.has(file) || file.startsWith('.claude/skills/verify/scripts/') || ['package.json', 'package-lock.json', 'next.config.ts', 'next.config.js', 'tsconfig.json'].includes(file))) return specs.map((s) => s.name).sort();
  const dependents = new Map();
  for (const [file, code] of Object.entries(sources)) {
    const imports = /(?:\b(?:import|export)\s+(?:[^;'"\n]*?\s+from\s*)?|\bimport\s*\()\s*['"]([^'"]+)['"]/g;
    for (const match of code.matchAll(imports)) {
      const name = match[1];
      const base = name.startsWith('@/') ? name.slice(2) : name.startsWith('.') ? posix.normalize(posix.join(posix.dirname(file), name)) : null;
      if (!base) continue;
      const target = [base, ...['.tsx', '.ts', '.jsx', '.js', '/index.tsx', '/index.ts', '/index.jsx', '/index.js'].map((suffix) => base + suffix)].find((candidate) => candidate in sources);
      if (target) dependents.set(target, [...(dependents.get(target) ?? []), file]);
    }
  }
  const visited = new Set(changed);
  const pending = [...changed];
  while (pending.length) for (const next of dependents.get(pending.pop()) ?? []) if (!visited.has(next)) { visited.add(next); pending.push(next); }
  const pages = [...visited].filter((file) => file.startsWith('pages/') && /\.[jt]sx?$/.test(file)).map((file) => '/' + file.slice(6).replace(/\.[jt]sx?$/, '').replace(/(?:^|\/)index$/, ''));
  return specs.filter((spec) => changed.includes(`.claude/skills/verify/demos/${spec.name}.json`) ||
    (spec.demo?.covers ?? []).some((pattern) => changed.some((file) => glob(pattern, file))) ||
    pagesForSpec(spec).some((page) => pages.some((route) => route === page || route.startsWith(page + '/')))).map((spec) => spec.name).sort();
}

function readSources(dir, prefix = '') {
  const sources = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = join(prefix, entry.name);
    if (entry.isDirectory()) Object.assign(sources, readSources(join(dir, entry.name), file));
    else if (/\.[jt]sx?$/.test(extname(file))) sources[file] = readFileSync(join(dir, entry.name), 'utf8');
  }
  return sources;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [base, head] = process.argv.slice(2);
    if (!base || !head) throw new Error('usage: demo-affected.mjs <base> <head>');
    const changed = execFileSync('git', ['diff', '--name-only', '-z', base, head, '--'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
    const sources = {};
    for (const dir of ['pages', 'components', 'lib', 'utils']) if (existsSync(join(root, dir))) Object.assign(sources, readSources(join(root, dir), dir));
    const names = affectedDemos({ changed, sources, specs: readSpecs(join(root, '.claude/skills/verify/demos')) });
    if (names.length) console.log(names.join('\n'));
  } catch (error) { console.error(`FAIL affected ${error.message}`); process.exitCode = 1; }
}
