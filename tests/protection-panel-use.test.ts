// R4-60 gap: the protection panel counter had no interface hook. Opening the protection popup is one `protectionPanel` use,
// counted once per opening (the sheet mounts once per overlay id), and only that kind counts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { notePopupOpened } from '../src/features/metrics/noteUse';

test('opening the protection popup notes one protectionPanel use; other popups note nothing', async () => {
  const calls: unknown[] = [];
  const previous = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = { acira: { service: async (request: unknown) => { calls.push(request); return {}; } } };
  try {
    notePopupOpened('protection');
    for (const kind of ['menu', 'tabs', 'security', 'toString', '__proto__', 'constructor']) notePopupOpened(kind);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(calls, [{ type: 'metrics.note', name: 'protectionPanel' }]);
  } finally { (globalThis as { window?: unknown }).window = previous; }
});

test('outside the app it is a quiet no-op', () => {
  const previous = (globalThis as { window?: unknown }).window;
  delete (globalThis as { window?: unknown }).window;
  try { assert.doesNotThrow(() => notePopupOpened('protection')); } finally { (globalThis as { window?: unknown }).window = previous; }
});

test('the popup sheet notes its opening once, on mount, only while active, through the low-level helper', () => {
  const app = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'App.tsx'), 'utf8');
  assert.match(app, /import \{notePopupOpened\} from '\.\/features\/metrics\/noteUse';/);
  const popup = app.slice(app.indexOf('function Popup('), app.indexOf('function Popup(') + 4000);
  assert.match(popup, /useEffect\(\(\) => \{ if \(active\) notePopupOpened\(kind\); \}, \[\]\);/, 'mount-only effect: one note per opening, none for the inactive warm-up');
  assert.doesNotMatch(app, /from '\.\/features\/metrics\/useMetrics'/, 'App never imports useMetrics for this');
  // Both popup paths remount per opening: the native overlay keys the sheet by overlay id and kind, the local one by kind.
  assert.match(app, /<Popup active=\{!closing\} key=\{`\$\{overlay\.id\}:\$\{overlay\.kind\}`\}/);
  assert.match(app, /<Popup key=\{overlay\} kind=\{overlay\}/);
});
