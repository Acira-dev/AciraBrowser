'use strict';
// R3-82 (P0): "whenever I enter Focus mode I cannot even exit Focus mode, nor click anything else in the toolbar".
// Cause: a stylesheet rule from the old two-row Focus design, `.acira-shell[data-layout=focus] .acira-persistent-toolbar{pointer-events:none}`,
// survived R3-65 (Focus is now the persistent toolbar itself), so every control in the Focus row inherited pointer-events:none and real
// clicks fell through to the shell. Nothing that holds chrome-row controls may ever switch pointer events off (an [inert]/[hidden] row may,
// and the empty caption spacer may); and every interactive control in a chrome row stays a no-drag region.
const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const src = path.join(__dirname, '..', 'src');
const cssFiles = [];
(function walk(dir) { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) walk(full); else if (entry.name.endsWith('.css')) cssFiles.push(full); } })(src);

/** Every style rule as { selector, body } (comments stripped, nested at-rules flattened). */
function rulesOf(css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [], stack = [];
  let start = 0;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === '{') { stack.push(css.slice(start, i).trim()); start = i + 1; }
    else if (c === '}') {
      const selector = stack.pop();
      const body = css.slice(start, i);
      if (selector && !selector.startsWith('@') && !/[{]/.test(body)) rules.push({ selector, body });
      start = i + 1;
    }
    else if (c === ';' && stack.length === 0) start = i + 1;
  }
  return rules;
}

// The elements that hold chrome-row controls (App.tsx: tab row, toolbar, leading controls, navigation, address bar, actions).
const HOLDERS = ['.browser-shell', '.acira-shell', '.browser-root', '.browser-toolbar', '.acira-persistent-toolbar', '.acira-leading-controls', '.compact-navigation', '.expanded-navigation', '.navigation-controls', '.acira-tab-row', '.acira-focus-row', '.acira-compact-tabs', '.address-bar', '.toolbar-actions', '.app'];
const lastCompound = selector => selector.trim().split(/[\s>+~]+/).filter(Boolean).pop() || '';
// inert/hidden rows, pseudo-elements (decoration, not the control), and the setup finale/prewarm (first run only, while the card is on screen).
const SAFE = /\[inert\]|\[hidden\]|:disabled|\[aria-hidden|\[data-edge-hidden|:not\(\[data-|::?(?:before|after)\b|\[data-fr-(?:finale|prewarm)\]/;

test('no rule switches pointer events off on anything that holds chrome-row controls (Focus, Compact, Seamless, Tor)', () => {
  const offenders = [];
  for (const file of cssFiles) for (const rule of rulesOf(fs.readFileSync(file, 'utf8'))) {
    if (!/pointer-events\s*:\s*none/.test(rule.body)) continue;
    for (const part of rule.selector.split(',')) {
      const last = lastCompound(part);
      if (!HOLDERS.some(holder => last === holder || last.startsWith(holder + '[') || last.startsWith(holder + ':') || last.startsWith(holder + '.'))) continue;
      if (SAFE.test(part)) continue;
      offenders.push(`${path.relative(src, file)}: ${part.trim()}`);
    }
  }
  assert.deepEqual(offenders, [], 'these rules make chrome-row controls unclickable:\n' + offenders.join('\n'));
});

test('the stale Focus-layout rule is gone and Focus renders the persistent toolbar as its row', () => {
  const shell = fs.readFileSync(path.join(src, 'shell-references.css'), 'utf8');
  assert.doesNotMatch(shell, /data-layout=focus\]\s*\.acira-persistent-toolbar\s*\{[^}]*pointer-events\s*:\s*none/);
  const app = fs.readFileSync(path.join(src, 'App.tsx'), 'utf8');
  assert.match(app, /className="browser-toolbar acira-persistent-toolbar"/, 'Focus uses the persistent toolbar');
  assert.ok(!/className="[^"]*acira-focus-row/.test(app), 'there is no separate Focus row any more, so nothing may disable the toolbar for it');
});

test('interactive controls in every chrome row are no-drag regions (the rows themselves drag the window)', () => {
  const frost = fs.readFileSync(path.join(src, 'frost-preview.css'), 'utf8');
  assert.match(frost, /\.app\.style-acira :is\(button,input,textarea,select,\[role=tab\][^)]*\)\s*\{\s*-webkit-app-region:\s*no-drag/, 'every button and field is no-drag');
  // a drag region may never be declared on a control itself
  for (const file of cssFiles) for (const rule of rulesOf(fs.readFileSync(file, 'utf8'))) {
    if (!/-webkit-app-region\s*:\s*drag/.test(rule.body)) continue;
    for (const part of rule.selector.split(',')) assert.ok(!/(^|[\s>+~])(button|input|select|textarea)(?![\w-])(?:\.[\w-]+|\[[^\]]*\]|:[\w-]+)*\s*$/.test(part.trim()) && !/\.icon-button\s*$/.test(part.trim()), `${path.relative(src, file)}: a drag region on a control: ${part.trim()}`);
  }
});
