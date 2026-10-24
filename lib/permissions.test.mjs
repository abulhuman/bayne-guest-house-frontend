import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHANGE_PASSWORD_PATH, PAGES, ROLES, canManageInventoryItems, canOpen, canSee, homeFor, landingFor } from './permissions.ts';

const expectedLanding = {
  admin: '/dashboard',
  manager: '/dashboard',
  reception: '/dashboard',
  finance: '/dashboard',
  housekeeping: '/laundry',
  store: '/inventory',
  barista: '/inventory',
  security: '/help',
};

test('landingFor covers all eight backend roles', () => {
  assert.deepEqual([...ROLES].sort(), Object.keys(expectedLanding).sort());
  for (const role of ROLES) {
    assert.equal(landingFor(role), expectedLanding[role], role);
  }
});

test('every role with a page can see its landing page', () => {
  for (const role of ROLES) {
    const landing = landingFor(role);
    if (landing) assert.ok(canSee(role, landing), `${role} can see ${landing}`);
  }
});

test('every role can open Help, including security', () => {
  for (const role of ROLES) assert.equal(canSee(role, '/help'), true, role);
});

test('the table resolves the old disagreements', () => {
  assert.ok(canSee('housekeeping', '/laundry'));
  assert.ok(canSee('reception', '/inventory'));
  assert.deepEqual(
    ROLES.filter((role) => canSee(role, '/attendance')),
    ['admin', 'manager', 'reception'],
  );
  assert.equal(canSee('store', '/bookings'), false);
});

test('a forced password change keeps every role on the change-password page', () => {
  for (const role of ROLES) {
    const forced = { role, forceChangePassword: true };
    assert.equal(homeFor(forced), CHANGE_PASSWORD_PATH, role);
    assert.ok(canOpen(forced, CHANGE_PASSWORD_PATH), role);
    for (const { path } of PAGES) assert.equal(canOpen(forced, path), false, `${role} ${path}`);
  }
});

test('without the flag, roles open the same pages as before, plus change-password', () => {
  for (const role of ROLES) {
    const account = { role, forceChangePassword: false };
    assert.equal(homeFor(account), landingFor(role), role);
    assert.ok(canOpen(account, CHANGE_PASSWORD_PATH), role);
    for (const { path } of PAGES) assert.equal(canOpen(account, path), canSee(role, path), `${role} ${path}`);
  }
});

test('inventory item create and delete follows the backend guard', () => {
  assert.deepEqual(
    ROLES.filter((role) => canManageInventoryItems(role)),
    ['admin', 'manager', 'reception', 'store'],
  );
});
