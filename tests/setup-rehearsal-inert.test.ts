import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The welcome rehearses the first card (and a still copy of itself) invisibly, to build GPU programs before the click.
// That copy duplicated the real controls ([data-onboarding-next], .fr-w-lang-button, ids, radio names): automation hit it
// and assistive tech could too. It is inert, hidden, marked data-rehearsal, hook-free, and gone when the sweep ends.
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const onboarding = fs.readFileSync(path.join(root, 'src/features/onboarding/Onboarding.tsx'), 'utf8');

test('the rehearsal root is inert, hidden from assistive tech and marked data-rehearsal', () => {
  assert.match(onboarding, /<div ref=\{rehearsal\} className="fr-rehearsal" aria-hidden="true" inert data-rehearsal="">/);
});

test('no id, form name, label target or data-onboarding-* hook survives inside it, before its first paint', () => {
  const unhook = /function unhook\(root: Element\) \{([\s\S]*?)\n\}/.exec(onboarding);
  assert.ok(unhook, 'unhook helper');
  for (const hook of ['name === "id"', 'name === "name"', 'name === "for"', 'name.startsWith("data-onboarding")']) assert.ok(unhook[1].includes(hook), hook);
  // The card (rendered by React) is stripped in a layout effect, so the hooks never reach a frame; anything mounted later
  // is caught by an observer; the cloned welcome is stripped before it is appended.
  assert.match(onboarding, /useLayoutEffect\(\(\) => \{\s*const host = rehearsal\.current;\s*if \(!rehearse \|\| !host\) return;\s*unhook\(host\);\s*const watch = new MutationObserver/);
  assert.match(onboarding, /copy = source\.cloneNode\(true\) as HTMLElement;\s*unhook\(copy\);[\s\S]*?host\.appendChild\(copy\)/);
});

test('it is removed as soon as the sweep has drawn its last frame', () => {
  const removal = /setTimeout\(\(\) => setRehearse\(false\), REHEARSAL_MS \+ (\d+)\)/.exec(onboarding);
  assert.ok(removal);
  assert.ok(Number(removal[1]) <= 100, `lingers ${removal[1]} ms after the sweep`);
});
