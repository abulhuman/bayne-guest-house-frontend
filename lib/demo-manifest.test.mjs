import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { audienceFor, pagesForSpec, readSpecs } from '../.claude/skills/verify/scripts/demo-manifest.mjs';
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
