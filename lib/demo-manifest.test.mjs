import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { audienceFor, pagesForSpec, readSpecs, writeManifest } from '../.claude/skills/verify/scripts/demo-manifest.mjs';
import { ROLES } from './permissions.ts';

test('sign-in demos serve all roles', () => {
  assert.deepEqual(audienceFor({ role: 'anon', demo: { group: 'sign-in', as: 'Any user' }, steps: [{ goto: '/login' }] }), [...ROLES]);
});
test('tours include pages reached by navigation links', () => {
  const spec = { name: 'manager-tour', role: 'anon', demo: { as: 'manager' }, steps: [{ goto: '/login' }, { expectUrl: '/staff' }] };
  assert.deepEqual(pagesForSpec(spec), ['/staff']);
  assert.deepEqual(audienceFor(spec), ['admin', 'manager']);
});
test('booking page excludes finance despite API read permission', () => {
  assert.deepEqual(audienceFor({ role: 'reception', steps: [{ goto: '/bookings' }] }), ['admin', 'manager', 'reception']);
});
test('narrowing rejects forbidden page roles and invalid actors', () => {
  assert.throws(() => audienceFor({ name: 'bad-staff', role: 'manager', demo: { audience: ['security'] }, steps: [{ goto: '/staff' }] }), /bad-staff/);
  assert.throws(() => audienceFor({ name: 'bad-actor', role: 'security', steps: [{ goto: '/staff' }] }), /bad-actor/);
});
test('root navigation uses the actual actor landing page', () => {
  const spec = { role: 'barista', steps: [{ goto: '/' }, { expectUrl: '/inventory' }] };
  assert.deepEqual(pagesForSpec(spec), ['/inventory']);
  assert.ok(!audienceFor(spec).includes('security'));
});
test('all shipped demo audiences honor the action-level restrictions', () => {
  const specs = readSpecs(fileURLToPath(new URL('../.claude/skills/verify/demos', import.meta.url)));
  assert.equal(specs.length, 42);
  const audiences = Object.fromEntries(specs.map((spec) => [spec.name, audienceFor(spec)]));
  for (const name of ['manager-add-room', 'manager-edit-room-price', 'manager-attendance-checkout', 'manager-attendance-edit', 'manager-laundry-delete']) assert.deepEqual(audiences[name], ['admin', 'manager']);
  assert.deepEqual(audiences['housekeeping-laundry-status'], ['admin', 'manager', 'housekeeping']);
  assert.deepEqual(audiences['reception-add-laundry'], ['admin', 'manager', 'reception']);
  assert.deepEqual(audiences['manager-laundry-refund'], ['admin', 'manager', 'reception']);
  for (const name of ['store-add-item', 'store-remove-item']) assert.ok(!audiences[name].includes('barista'));
  assert.ok(audiences['barista-inventory'].includes('barista'));
  assert.deepEqual(audiences['security-tour'], ['security']);
});

test('partial rebuild authenticates retained posters and preserves manifest on rejection', () => {
  const dir = mkdtempSync(join(tmpdir(), 'demo-manifest-'));
  try {
    const specsDir = join(dir, 'specs');
    const outDir = join(dir, 'media');
    mkdirSync(specsDir); mkdirSync(outDir);
    writeFileSync(join(specsDir, 'sample.json'), JSON.stringify({ name: 'sample', role: 'reception',
      demo: { title: 'Sample', summary: 'Sample' }, steps: [{ goto: '/bookings' }] }));
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=s=16x16:d=1', '-c:v', 'libx264', join(outDir, 'sample.mp4')]);
    writeFileSync(join(outDir, 'sample.jpg'), 'poster bytes');
    const options = { specsDir, outDir, sourceCommit: 'a'.repeat(40) };
    const first = writeManifest(options).tutorials[0];
    const previous = readFileSync(join(outDir, 'manifest.json'), 'utf8');
    assert.equal(first.durationSec, 1);
    assert.equal(JSON.stringify(writeManifest(options).tutorials[0]), JSON.stringify(first));
    unlinkSync(join(outDir, 'sample.mp4')); unlinkSync(join(outDir, 'sample.jpg'));
    writeManifest(options);
    assert.equal(readFileSync(join(outDir, 'manifest.json'), 'utf8'), previous);
    writeFileSync(join(outDir, first.poster), 'corrupt poster bytes');
    assert.throws(() => writeManifest(options), /sample: retained poster digest mismatch/);
    assert.equal(readFileSync(join(outDir, 'manifest.json'), 'utf8'), previous);
    writeFileSync(join(outDir, first.poster), 'poster bytes');
    copyFileSync(join(outDir, first.video), join(outDir, 'sample.mp4'));
    writeFileSync(join(outDir, 'sample.jpg'), 'poster bytes');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=s=16x16:d=2', '-c:v', 'libx264', join(outDir, 'sample.mp4')]);
    const changed = writeManifest({ ...options, sourceCommit: 'b'.repeat(40) }).tutorials[0];
    assert.equal(changed.durationSec, 2);
    assert.notEqual(changed.sha256, first.sha256);
    assert.equal(changed.sourceCommit, 'b'.repeat(40));
    const manifest = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8'));
    manifest.tutorials[0].durationSec = 999;
    writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest));
    assert.equal(writeManifest(options).tutorials[0].durationSec, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
