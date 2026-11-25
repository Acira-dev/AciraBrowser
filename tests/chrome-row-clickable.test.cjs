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

// Beta 14: "in Focus with tabs on top the chips show but cannot be clicked" (a 13.7 tester). Cause, reproduced in the real app (a click on the middle of a chip, whose icon is
// where the compact chip's close button sits): a Focus rule of 27 Oct (R3-82) forced `pointer-events:auto` on EVERY button of the Focus row, which also woke each chip's invisible
// close button (opacity 0, pointer-events:none until its tab is the current one and hovered): it covered the middle of the chip and took the press, so the click never selected.
test('no rule gives every button of the Focus row pointer events (it woke the chips\' invisible close buttons: dead clicks in Focus)', () => {
  const offenders = [];
  for (const file of cssFiles) for (const rule of rulesOf(fs.readFileSync(file, 'utf8'))) {
    if (!/pointer-events\s*:\s*auto/.test(rule.body)) continue;
    for (const part of rule.selector.split(',')) if (/data-layout=focus/.test(part) && /\b(button|input|select|textarea)\b|\[role=button\]|\[data-popup-trigger\]/.test(part.replace(/\.[\w-]+/g, ''))) offenders.push(`${path.relative(src, file)}: ${part.trim()}`);
  }
  assert.deepEqual(offenders, [], 'a blanket pointer-events:auto over a row\'s buttons re-enables the ones that hide themselves:\n' + offenders.join('\n'));
});

test('a chip\'s close button takes presses only where it is on show: the current tab hovered or focused, or the Focus chip with room for it', () => {
  const closeRules = [];
  for (const file of cssFiles) for (const rule of rulesOf(fs.readFileSync(file, 'utf8'))) {
    if (!/pointer-events\s*:\s*auto/.test(rule.body)) continue;
    if (/acira-compact-tab-close/.test(rule.selector)) closeRules.push(rule.selector.trim());   // whole selector: a comma inside :is(...) is not a list
  }
  assert.ok(closeRules.length >= 2, 'the hover rule and the Focus chip rule are both there');
  for (const part of closeRules) assert.match(part, /\.selected:is\(:hover,:focus-within\)|\.focus-tab\b|:enabled/, `a rule that lets the close button take presses must say when: ${part}`);
  const base = fs.readFileSync(path.join(src, 'components', 'CompactTabs.css'), 'utf8');
  assert.match(base, /\.acira-compact-tab-close\{[^}]*opacity:0;pointer-events:none/, 'at rest the close button is invisible and takes nothing');
});

test('Focus with tabs on top draws the one chip and the tab-list button, and Compact keeps its row of chips (AA)', () => {
  const app = fs.readFileSync(path.join(src, 'App.tsx'), 'utf8');
  assert.match(app, /const focusTab = parts\.currentTab && <FocusTab /);
  assert.match(app, /\{parts\.miniTabs&&miniTabs\}\{focusTab\}/, 'the one chip stands where the row of chips stood');
  assert.match(app, /const tabOverview = \(s\.showTabOverview!==false \|\| parts\.currentTab\) && /, 'the list is the only way to the other tabs there: the Show tab overview setting does not hide it');
  const css = fs.readFileSync(path.join(src, 'components', 'FocusTab.css'), 'utf8');
  assert.match(css, /\.acira-compact-tabs\[data-single=true\]\{flex:0 1 168px/);
});
