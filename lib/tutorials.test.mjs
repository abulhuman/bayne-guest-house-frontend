import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterTutorials, groupTutorials, newTutorials } from './tutorials.ts';

const item = (name, group, pages, title = name, recordedAt = '2026-10-01T00:00:00.000Z') => ({
  name, title, summary: `${title} summary`, group, primaryRole: 'reception', audience: ['reception'], pages,
  durationSec: 2, video: `${name}.mp4`, poster: `${name}.jpg`, videoUrl: '', posterUrl: '', sha256: 'a'.repeat(64), recordedAt, sourceCommit: 'a'.repeat(40),
});

test('groups tutorials in the role page order', () => {
  const groups = groupTutorials([item('inventory', 'inventory', ['/inventory']), item('booking', 'bookings', ['/bookings']), item('tour', 'reception', [])], 'reception');
  assert.deepEqual(groups.map((group) => group.name), ['reception', 'bookings', 'inventory']);
});

test('search matches title and summary and trims case', () => {
  const tutorials = [item('one', 'g', ['/bookings'], 'Room search'), item('two', 'g', ['/bookings'], 'Laundry status')];
  assert.deepEqual(filterTutorials(tutorials, '  ROOM '), [tutorials[0]]);
  assert.deepEqual(filterTutorials(tutorials, 'status'), [tutorials[1]]);
  assert.equal(filterTutorials(tutorials, 'zzz').length, 0);
});

test('new tutorials compare recordedAt to last seen', () => {
  const old = item('old', 'g', ['/bookings'], 'Old', '2026-10-01T00:00:00.000Z');
  const fresh = item('fresh', 'g', ['/bookings'], 'Fresh', '2026-10-03T00:00:00.000Z');
  assert.deepEqual(newTutorials([old, fresh], '2026-10-02T00:00:00.000Z'), [fresh]);
  assert.deepEqual(newTutorials([old], null), [old]);
});
