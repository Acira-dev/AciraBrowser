import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// R4-50 (after R4-04): a view transition captures every element that has a view-transition-name on its own and draws it
// ABOVE the whole old and new frames. Setup's theme crossfade (and an Auto flip, and the finale) is a view transition, so
// any browser element named while setup is on screen is lifted over the setup scene: the toolbar's controls (view-morph.css,
// R4-21) flashed there without their toolbar. The rule: no element outside the setup surface carries a name while setup is
// on screen or leaving. Every name outside setup is written under this guard.
const GUARD = /^:root(?:\[[^\]]+\])*:not\(\[data-fr-finale\]\)(?:\[[^\]]+\])*\s+\.app(?:\.[\w-]+)*:not\(:has\(>\s*\.setup-dialog\)\)(?=[\s>])/;

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const walk = (dir: string): string[] =>
  fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = path.posix.join(dir, entry.name);
    return entry.isDirectory() ? walk(rel) : [rel];
  });
const sources = walk('src');
const setupSurface = (file: string) => file.startsWith('src/features/onboarding/');
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every style rule (selector list + body), including those nested in @media / @supports blocks. */
function rules(css: string): { selectors: string[]; body: string }[] {
  const out: { selectors: string[]; body: string }[] = [];
  const text = stripComments(css);
  const stack: { prelude: string; open: number }[] = [];
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '{') {
      stack.push({ prelude: text.slice(from, i).trim(), open: i });
      from = i + 1;
    } else if (c === '}') {
      const top = stack.pop();
      if (top && !top.prelude.startsWith('@')) out.push({ selectors: splitList(top.prelude), body: text.slice(top.open + 1, i) });
      from = i + 1;
    } else if (c === ';') from = i + 1;
  }
  return out;
}
/** A selector list split on its top-level commas (not the ones inside :is(), :not(), :has()). */
function splitList(list: string): string[] {
  const parts: string[] = [];
  let depth = 0, from = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i] === '(') depth++;
    else if (list[i] === ')') depth--;
    else if (list[i] === ',' && depth === 0) {
      parts.push(list.slice(from, i).trim());
      from = i + 1;
    }
  }
  parts.push(list.slice(from).trim());
  return parts.filter(Boolean);
}
/** The names a rule body gives (its own declarations only, not those of nested rules). */
const namesIn = (body: string) =>
  [...body.replace(/\{[^{}]*\}/g, '').matchAll(/view-transition-name\s*:\s*([^;}!]+)/g)].map((match) => match[1].trim());

test('no browser element outside setup is named unless the setup guard is in its selector (R4-50)', () => {
  let named = 0;
  for (const file of sources.filter((name) => name.endsWith('.css') && !setupSurface(name))) {
    for (const rule of rules(fs.readFileSync(path.join(root, file), 'utf8'))) {
      const names = namesIn(rule.body).filter((name) => name !== 'none');
      if (!names.length) continue;
      for (const selector of rule.selectors) {
        named++;
        assert.match(selector, GUARD, `${file}: "${selector}" names ${names.join(', ')} without the setup guard`);
      }
    }
  }
  // The toolbar's controls (view-morph.css), the toolbar and tab, bookmarks and focus rows, and the sidebar.
  assert.ok(named >= 20, `found ${named} named selectors`);
});

test('the view morph names every toolbar control behind the guard, with a cheap rightmost compound', () => {
  const css = fs.readFileSync(path.join(root, 'src/styles/view-morph.css'), 'utf8');
  const named = rules(css).filter((rule) => namesIn(rule.body).some((name) => name !== 'none'));
  assert.ok(named.length >= 19);
  for (const rule of named)
    for (const selector of rule.selectors) {
      assert.match(selector, GUARD);
      // The guard's attribute toggles at the finale's click: a rightmost compound with no class or attribute would make
      // that toggle restyle the whole document (style invalidation falls back to the whole subtree).
      const rightmost = selector.split(/[\s>]+/).pop()!;
      assert.match(rightmost, /[.[]/, selector);
    }
});

test('no script names a browser element: only setup names its own images (finale.ts)', () => {
  for (const file of sources.filter((name) => /\.(ts|tsx)$/.test(name) && !setupSurface(name))) {
    const code = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(code, /viewTransitionName\s*[:=]|setProperty\(\s*['"]view-transition-name/, file);
  }
});

test('setup opens with focus on the dialog itself: no ring on Skip setup, Enter begins, Tab still reaches every control', () => {
  const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
  assert.match(app, /setupVisible&&<div className="setup-dialog" tabIndex=\{-1\} role="dialog" aria-modal="true"/);
  assert.match(app, /if\(setupVisible&&setupReady\)setupRef\.current\?\.focus\(\{preventScroll:true\}\);/);
  assert.doesNotMatch(app, /setupRef\.current\?\.querySelector<HTMLButtonElement>\('button'\)\?\.focus\(\)/, 'a script focus on the first button draws its ring before any input');
  // window activation's tab traversal (no key, no script) lands on Skip setup: before any input, that one move goes back to the dialog
  assert.match(app, /window\.addEventListener\('keydown',mark,true\);window\.addEventListener\('pointerdown',mark,true\);dialog\.addEventListener\('focusin',back\);return stop;/);
  assert.match(app, /if\(!input&&performance\.now\(\)<until&&\(event\.target as HTMLElement\)\.matches\?\.\(':focus-visible'\)\)dialog\.focus\(\{preventScroll:true\}\);stop\(\);/);
  const css = fs.readFileSync(path.join(root, 'src/styles/setup-integration.css'), 'utf8');
  assert.match(css, /\.setup-dialog:focus,\.setup-dialog:focus-visible\{outline:none\}/);
  // keyboard focus on the controls keeps its ring
  const onboarding = fs.readFileSync(path.join(root, 'src/features/onboarding/onboarding.css'), 'utf8');
  assert.match(onboarding, /\.fr-stage :focus-visible \{\s*outline: 2px solid var\(--fr-accent\);/);
});

test('the guard targets the element setup mounts into, and the finale attribute it sets while leaving', () => {
  const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
  // `.setup-dialog` is rendered as a direct child of `.app` (the fragment's parent), next to the browser.
  assert.match(app, /setupVisible&&<div className="setup-dialog"/);
  const finale = fs.readFileSync(path.join(root, 'src/features/onboarding/finale.ts'), 'utf8');
  assert.match(finale, /root\.setAttribute\("data-fr-finale", tone\)/);
  // The theme crossfade and the capture prewarm both run while the setup dialog is mounted, so the :has() half covers
  // them; the finale's new frame has no setup dialog, so the attribute half covers it until its transition is done.
  assert.match(finale, /const unname = \(\) => \{[\s\S]*?root\.removeAttribute\("data-fr-finale"\)/);
});
