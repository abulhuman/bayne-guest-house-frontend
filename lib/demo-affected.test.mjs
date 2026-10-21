import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSpecs } from '../.claude/skills/verify/scripts/demo-manifest.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { affectedDemos } from '../.claude/skills/verify/scripts/demo-affected.mjs';

const specs = [
  { name: 'booking', role: 'reception', steps: [{ goto: '/bookings' }] },
  { name: 'laundry', role: 'housekeeping', steps: [{ goto: '/laundry' }] },
  { name: 'inventory', role: 'store', demo: { covers: ['utils/stock*.ts'] }, steps: [{ goto: '/inventory' }] },
];
const sources = {
  'pages/bookings/index.tsx': "import BookingFlow from '@/components/BookingFlow';",
  'components/BookingFlow.tsx': "import { state } from '@/lib/bookingFlow';",
  'lib/bookingFlow.ts': '',
  'pages/laundry/index.tsx': '',
};
const affected = (...changed) => affectedDemos({ changed, specs, sources });
test('page edit maps to its demos', () => assert.deepEqual(affected('pages/laundry/index.tsx'), ['laundry']));
test('imports propagate transitively without touching unrelated demos', () => assert.deepEqual(affected('lib/bookingFlow.ts'), ['booking']));
test('shell edits map to every demo', () => assert.deepEqual(affected('lib/permissions.ts'), ['booking', 'inventory', 'laundry']));
test('spec edit maps to itself', () => assert.deepEqual(affected('.claude/skills/verify/demos/booking.json'), ['booking']));
test('README edit records nothing', () => assert.deepEqual(affected('README.md'), []));
test('explicit coverage adds files outside the graph', () => assert.deepEqual(affected('utils/stockCount.ts'), ['inventory']));
test('import cycles terminate', () => assert.deepEqual(affectedDemos({ changed: ['lib/a.ts'], specs, sources: { ...sources,
  'pages/bookings/index.tsx': "import '@/lib/a';", 'lib/a.ts': "export { b } from './b';", 'lib/b.ts': "import './a';" } }), ['booking']));

test('real multiline BookingFlow import reaches all booking and dashboard demos', () => {
  const sources = {};
  for (const dir of ['pages', 'components', 'lib', 'utils']) {
    for (const entry of readdirSync(new URL(`../${dir}/`, import.meta.url), { recursive: true, withFileTypes: true })) {
      if (entry.isFile() && /\.[jt]sx?$/.test(entry.name)) {
        const path = join(entry.parentPath, entry.name);
        sources[relative(fileURLToPath(new URL('..', import.meta.url)), path)] = readFileSync(path, 'utf8');
      }
    }
  }
  assert.match(sources['components/BookingFlow.tsx'], /import \{[^}]*\n[^}]*\} from '@\/lib\/bookingFlow'/);
  assert.deepEqual(affectedDemos({ changed: ['lib/bookingFlow.ts'], sources,
    specs: readSpecs(fileURLToPath(new URL('../.claude/skills/verify/demos', import.meta.url))) }), [
    'admin-tour', 'anyone-login-wrong-password', 'finance-dashboard', 'finance-tour', 'manager-dashboard', 'manager-tour',
    'newstaff-force-change-password', 'reception-add-guest', 'reception-booking-new-guest', 'reception-create-booking', 'reception-edit-booking',
    'reception-search-bookings', 'reception-tour',
  ]);
});
