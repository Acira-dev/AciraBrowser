import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { rememberDismissed, toastSpentAtLoad } from '../src/ui/toastQueue';

// Main keeps its last toast in the snapshot, so a view that reloads (Settings › Languages, a crashed view brought back) finds it
// again. It showed it however old (a "Seamless is on" tip in Full view ten minutes later); then, after a first fix, it skipped it
// however recent, so a "Tab closed · Undo" vanished if the language changed within its 8 s, and a standing error was lost for good.
// Now a toast found at load is shown unless it is spent: dismissed in this view before the reload, or older than its display time.
// An error has no display time: it stays until dismissed. Ids are the clock time main raised the toast.
const memory = () => { const items = new Map<string, string>(); return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, value); } }; };
const undo = { label: 'Undo', command: { type: 'tab.restore.batch' as const, id: 'b1' } };

test('a recent toast comes back after the reload, an old one does not', () => {
  const session = memory(), now = 1_000_000;
  assert.equal(toastSpentAtLoad({ id: now - 3000, action: undo }, 8000, now, session), false, 'Undo raised 3 s ago: shown again');
  assert.equal(toastSpentAtLoad({ id: now - 9000, action: undo }, 8000, now, session), true, '9 s ago, past its 8 s: not shown');
  assert.equal(toastSpentAtLoad({ id: now - 600_000, tone: 'info' }, 12000, now, session), true, 'a tip from ten minutes ago: not shown');
});

test('an error stays until dismissed, also across a reload', () => {
  const session = memory(), now = 5_000_000;
  assert.equal(toastSpentAtLoad({ id: now - 600_000, tone: 'error' }, 4000, now, session), false, 'still standing: shown again');
  rememberDismissed([now - 600_000], session);
  assert.equal(toastSpentAtLoad({ id: now - 600_000, tone: 'error' }, 4000, now, session), true, 'dismissed in this view: not again');
});

test('a toast dismissed before the reload stays dismissed, however recent', () => {
  const session = memory(), now = 9_000_000;
  rememberDismissed([now - 1000], session);
  assert.equal(toastSpentAtLoad({ id: now - 1000, action: undo }, 8000, now, session), true);
  assert.equal(toastSpentAtLoad({ id: now - 500, action: undo }, 8000, now, session), false, 'another toast is not');
});

test('without session storage nothing is lost: a recent toast and an error still show', () => {
  const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  rememberDismissed([1], broken);
  assert.equal(toastSpentAtLoad({ id: 100, tone: 'error' }, 4000, 200_000, broken), false);
  assert.equal(toastSpentAtLoad({ id: 199_000 }, 4000, 200_000, broken), false);
});

test('the interface toast host checks the toast it finds at load, keeps its remaining time and remembers dismissals', () => {
  const source = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('function useToasts(');
  const hook = source.slice(start, source.indexOf('}, [toast?.id]);', start));
  assert.match(hook, /const onLoad = loaded\.current; loaded\.current = false;/, 'only the toast found at load is checked');
  assert.match(hook, /if \(!toast \|\| \(onLoad && toastSpentAtLoad\(toast, toastDuration\(toast\)\)\)\) return;/);
  assert.match(hook, /arm\(next\.key, onLoad \? Math\.min\(toastDuration\(toast\), toastDuration\(toast\) - \(Date\.now\(\) - toast\.id\)\) : toastDuration\(toast\)\)/, 'a toast shown again keeps only its remaining time');
  assert.match(hook, /const dismiss = \(\.\.\.keys: number\[\]\) => \{ if \(!keys\.length\) return; rememberDismissed\(/);
});

test('on an Acira page the toast stack stays inside the page, which clips it', () => {
  const css = fs.readFileSync(new URL('../src/styles/transient.css', import.meta.url), 'utf8');
  assert.match(css, /\.page-area > \.page-toast-slot > \.t-stack \{\s*max-width: calc\(100% - 32px\);/);
});
