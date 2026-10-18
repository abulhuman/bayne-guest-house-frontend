import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { pagesFor, ROLES } from './permissions.ts';

registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier === './permissions' && context.parentURL?.endsWith('/tutorials.ts') ? './permissions.ts' : specifier, context);
} });
const { fetchTutorials, filterTutorials, groupTutorials, newTutorials, resolveMediaUrl, tourFor, tutorialForPlayback } = await import('./tutorials.ts');

const item = (name, group, pages, title = name, recordedAt = '2026-10-01T00:00:00.000Z') => ({
  name, title, summary: `${title} summary`, group, primaryRole: 'reception', audience: ['reception'], pages,
  durationSec: 2, video: `${name}.mp4`, poster: `${name}.jpg`, videoUrl: '', posterUrl: '', sha256: 'a'.repeat(64), recordedAt, sourceCommit: 'a'.repeat(40),
});

test('groups role-named manifest entries under page labels in canonical role order', () => {
  for (const role of ROLES) {
    const pages = pagesFor(role).filter((page) => page.path !== '/help');
    const rows = pages.toReversed().map((page) => item(page.path, 'reception', [page.path]));
    assert.deepEqual(groupTutorials(rows, role).map((group) => group.name), pages.map((page) => page.label), role);
  }
  const groups = groupTutorials([item('inventory', 'barista', ['/inventory']), item('booking', 'reception', ['/bookings']), item('reception-tour', 'reception', ['/bookings', '/inventory'])], 'reception');
  assert.deepEqual(groups.map((group) => group.name), ['Sign in', 'Bookings', 'Inventory']);
});

test('Start here selects the role tour even when a task comes first', () => {
  const task = item('reception-create-booking', 'reception', ['/bookings']);
  const tour = item('reception-tour', 'reception', ['/bookings']);
  assert.equal(tourFor([task, tour], 'reception'), tour);
  assert.equal(tourFor([task], 'reception'), undefined);
  assert.equal(tourFor([tour], 'store'), undefined);
});

test('GET /tutorials consumes the backend bare-array contract and keeps signed media URLs', async () => {
  const previous = process.env.NEXT_PUBLIC_API_BASE;
  process.env.NEXT_PUBLIC_API_BASE = 'https://preview.example/api';
  try {
    const row = { ...item('reception-create-booking', 'reception', ['/bookings']), videoUrl: '/tutorials/media/booking.mp4?expires=123&signature=abc', posterUrl: '/tutorials/media/booking.jpg?expires=123&signature=def' };
    const calls = [];
    const client = { get: async (path) => { calls.push(path); return { data: [row] }; } };
    assert.deepEqual(await fetchTutorials(client), [{ ...row, videoUrl: `https://preview.example/api${row.videoUrl}`, posterUrl: `https://preview.example/api${row.posterUrl}` }]);
    assert.deepEqual(calls, ['/tutorials']);
    assert.deepEqual(await fetchTutorials({ get: async () => ({ data: [] }) }), []);
    await assert.rejects(fetchTutorials({ get: async () => { throw new Error('offline'); } }), /offline/);
    await assert.rejects(fetchTutorials({ get: async () => ({ data: { tutorials: [row] } }) }), TypeError);
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_API_BASE;
    else process.env.NEXT_PUBLIC_API_BASE = previous;
  }
});

test('search matches title and summary and trims case', () => {
  const tutorials = [item('one', 'g', ['/bookings'], 'Room search'), item('two', 'g', ['/bookings'], 'Laundry status')];
  assert.deepEqual(filterTutorials(tutorials, '  ROOM '), [tutorials[0]]);
  assert.deepEqual(filterTutorials(tutorials, 'status'), [tutorials[1]]);
  assert.equal(filterTutorials(tutorials, 'zzz').length, 0);
});

test('playback refreshes expired signatures and respects the current server audience', async () => {
  const row = { ...item('reception-tour', 'reception', ['/bookings']), videoUrl: 'https://api.example/tutorials/media/tour.mp4?exp=1000&sig=old', posterUrl: 'https://api.example/tutorials/media/tour.jpg?exp=1000&sig=old' };
  const refreshed = { ...row, videoUrl: row.videoUrl.replace('1000&sig=old', '5000&sig=new') };
  let calls = 0;
  const client = { get: async () => { calls++; return { data: [refreshed] }; } };
  assert.equal(await tutorialForPlayback(client, row, 900), row);
  assert.equal(calls, 0);
  assert.deepEqual(await tutorialForPlayback(client, row, 1100), refreshed);
  assert.equal(calls, 1);
  await assert.rejects(tutorialForPlayback({ get: async () => ({ data: [] }) }, row, 1100), /no longer available/);
  await assert.rejects(tutorialForPlayback({ get: async () => { throw new Error('offline'); } }, row, 1100), /offline/);
});

test('new tutorials compare recordedAt to last seen', () => {
  const old = item('old', 'g', ['/bookings'], 'Old', '2026-10-01T00:00:00.000Z');
  const fresh = item('fresh', 'g', ['/bookings'], 'Fresh', '2026-10-03T00:00:00.000Z');
  assert.deepEqual(newTutorials([old, fresh], '2026-10-02T00:00:00.000Z'), [fresh]);
  assert.deepEqual(newTutorials([old], null), [old]);
});

test('media paths keep the API prefix in previews', () => {
  const previous = process.env.NEXT_PUBLIC_API_BASE;
  process.env.NEXT_PUBLIC_API_BASE = 'https://preview.example/api';
  assert.equal(resolveMediaUrl('/tutorials/media/demo.mp4'), 'https://preview.example/api/tutorials/media/demo.mp4');
  if (previous === undefined) delete process.env.NEXT_PUBLIC_API_BASE;
  else process.env.NEXT_PUBLIC_API_BASE = previous;
});
