// Founder, beta.10: "When you select a tab, the highlight colour covers the X so it doesn't show; the text too; when you drag a tab,
// its label doesn't show." Measured on real pixels (tab-ink rig, beta.10 notes): on the seven deep finishes in light mode a narrow
// current tab floated its × on a white square in a white ×, the carried tab and its drag copy drew white text on the white carry card,
// a current private or Tor tab kept dark ink on the dark toolbar surface, and the sidebar's and compact strip's current white cards kept
// the frame's white ink for the ×, mute and sound glyphs, the private and Tor marks and Acira's own logo. Sleeping tabs stacked two
// dims (about 1.4:1). The rule now: a tab's ink follows the surface it sits on. Text at least 4.5:1, the × and icons at least 3:1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appearancePalettes, palettePreference } from '../src/runtime/appearancePalettes';
import { createInitialState } from '../src/runtime/core';
import { contrast, mix, rgb, themeTokens, type WindowFinish } from '../src/ui/theme';

const read = (file: string) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
const css = (file: string) => read(file).replace(/\/\*[\s\S]*?\*\//g, '');
/** [selector list, declarations, inside an @media/@container block, that block's prelude] for every style rule. */
function rules(file: string) {
  const text = css(file), out: (readonly [string, string, boolean, string])[] = [], blocks: string[] = [];
  for (let i = 0, from = 0; i < text.length; i++) {
    if (text[i] === '}') { blocks.pop(); from = i + 1; continue; }
    if (text[i] !== '{') continue;
    const head = text.slice(from, i).trim();
    if (head.startsWith('@')) { blocks.push(head); from = i + 1; continue; }
    const close = text.indexOf('}', i);
    out.push([head, text.slice(i + 1, close), blocks.length > 0, blocks.at(-1) ?? ''] as const); i = close; from = close + 1;
  }
  return out;
}
function splitList(list: string): string[] {
  const out: string[] = []; let depth = 0, start = 0;
  for (let i = 0; i < list.length; i++) { const c = list[i]; if (c === '(') depth++; else if (c === ')') depth--; else if (c === ',' && !depth) { out.push(list.slice(start, i).trim()); start = i + 1; } }
  out.push(list.slice(start).trim()); return out;
}
/** Selectors Level 4 specificity; :is/:not/:has take their most specific argument, :where none. */
function specificity(s: string): [number, number, number] {
  let a = 0, b = 0, c = 0, i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '#') { a++; i++; while (i < s.length && /[\w-]/.test(s[i])) i++; }
    else if (ch === '.') { b++; i++; while (i < s.length && /[\w-]/.test(s[i])) i++; }
    else if (ch === '[') { b++; i = s.indexOf(']', i) + 1; }
    else if (ch === ':' && s[i + 1] === ':') { c++; i += 2; while (i < s.length && /[\w-]/.test(s[i])) i++; }
    else if (ch === ':') {
      i++; let name = ''; while (i < s.length && /[\w-]/.test(s[i])) name += s[i++];
      if (s[i] === '(') {
        let d = 1, j = i + 1; while (j < s.length && d) { if (s[j] === '(') d++; else if (s[j] === ')') d--; j++; }
        const inner = s.slice(i + 1, j - 1); i = j;
        if (['is', 'not', 'has'].includes(name)) { const best = splitList(inner).map(x => specificity(x.replace(/^[>+~]\s*/, ''))).sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]).at(-1)!; a += best[0]; b += best[1]; c += best[2]; }
        else if (name !== 'where') b++;
      } else b++;
    }
    else if (/[a-zA-Z]/.test(ch)) { c++; while (i < s.length && /[\w-]/.test(s[i])) i++; }
    else i++;
  }
  return [a, b, c];
}
const outranks = (x: [number, number, number], y: [number, number, number]) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
/** The one top-level rule (by exact selector) of a file; `nested` looks inside @container/@media blocks instead. */
function rule(file: string, selector: string | RegExp, nested = false) {
  const found = rules(file).filter(([list, , inside]) => inside === nested && (typeof selector === 'string' ? list === selector : selector.test(list)));
  assert.equal(found.length, 1, `${file}: exactly one rule ${selector} (found ${found.length})`);
  return found[0];
}
/** A custom property set by a top-level block of toolbar-controls.css, e.g. token('.app.style-acira[data-chrome=dark]', '--tab-surface'). */
const token = (block: string, name: string) => rules('styles/toolbar-controls.css').filter(([list, , inside]) => list === block && !inside).map(([, body]) => body.match(new RegExp(`(?:^|;)${name}:([^;]+)`))?.[1].trim()).find(Boolean);
/** `rgb(r g b / a)` or `#rrggbb` over an opaque colour, in sRGB like the browser composites. */
function over(top: string, under: string) {
  const m = top.match(/^rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)$/);
  if (!m) return top;
  const [r, g, b, alpha] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])], [ur, ug, ub] = rgb(under);
  return '#' + [r * alpha + ur * (1 - alpha), g * alpha + ug * (1 - alpha), b * alpha + ub * (1 - alpha)].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
}
const percent = (value: string) => Number(value.replace('%', '')) / 100;
const base = createInitialState().settings;
const finishes: [string, Record<string, unknown>][] = [...appearancePalettes.map(p => [p.name, palettePreference(p)] as [string, Record<string, unknown>]), ['private window', {windowFinish: 'private' as WindowFinish}], ['Tor window', {windowFinish: 'tor' as WindowFinish}]];

test('the strip: a current tab, a private or Tor one too, reads on the toolbar surface, and a narrow tab\'s × on its patch', () => {
  for (const [name, settings] of finishes) for (const dark of [false, true]) {
    const t = themeTokens({...base, ...settings} as typeof base, dark), chromeDark = t['--chrome-tone'] === 'dark';
    const block = chromeDark ? '.app.style-acira[data-chrome=dark]' : '.app.style-acira';
    const surface = token(block, '--tab-surface')!, recess = token(block, '--tab-strip-recess')!;
    // The current tab's paint, which the narrow tab's × patch now repeats: the active surface on the recessed strip row.
    const plate = over(surface, over(recess, t['--frame']));
    const at = `${name} ${dark ? 'dark' : 'light'}`;
    assert.ok(contrast(t['--frame-text'], plate) >= 4.5, `${at}: current title ${t['--frame-text']} on ${plate}`);
    for (const kind of ['private', 'tor']) {
      const wash = token(block, `--${kind}-wash`) ?? token('.app.style-acira', `--${kind}-wash`)!, current = token(block, `--${kind}-current`) ?? token('.app.style-acira', `--${kind}-current`)!;
      const washed = mix(wash, plate, percent(current));
      assert.ok(contrast(t['--frame-text'], washed) >= 4.5, `${at}: current ${kind} title ${t['--frame-text']} on its wash ${washed}`);
      const mark = token(block, `--${kind}-mark`) ?? token('.app.style-acira', `--${kind}-mark`)!;
      assert.ok(contrast(mark, washed) >= 3, `${at}: ${kind} mark ${mark} on the current ${kind} tab ${washed}`);
    }
  }
});

test('the strip: on Porcelain a group\'s tab count is the strip\'s quiet ink, unless Increase Contrast is on; other finishes keep theirs', () => {
  const text = css('styles/toolbar-controls.css');
  const scoped = '.app.style-acira[data-finish=Porcelain]:not([data-chrome=dark]) .tab-strip-container .tabs-strip>.tab-group-header .tab-group-label>small{color:color-mix(in srgb,var(--frame-text) 80%,transparent)}';
  assert.ok(text.includes(`@media not (prefers-contrast:more){${scoped}}`), 'only Porcelain measured under 4.5:1 (on the glass over a dark desktop), and Increase Contrast keeps its full ink (TabGroups.css)');
  assert.equal(rules('styles/toolbar-controls.css').filter(([list]) => list.includes('.tab-group-label>small')).length, 1, 'no other strip count rule: every other finish keeps --group-count (and 94% on Mac glass, mac-material.css)');
  assert.match(css('components/TabGroups.css'), /@media\(prefers-contrast:more\)\{[^@]*\.tab-group-label,\.tab-group-label>small\{color:var\(--frame-text\)\}/);
  const t = themeTokens({...base, ...palettePreference(appearancePalettes.find(p => p.name === 'Porcelain')!)} as typeof base, false);
  const row = over(token('.app.style-acira', '--tab-strip-recess')!, t['--frame']), count = mix(t['--frame-text'], row, .8);
  // 5.5:1 on the flat row leaves room for the glass, which drew this row up to 7% darker over a black desktop (real pixels).
  assert.ok(contrast(count, row) >= 5.5, `Porcelain: the group count ${count} on the strip row ${row}`);
});

test('light cards: their ink, its 64% controls and the card marks read on the card in every finish', () => {
  const marks = {private: token('.app.style-acira', '--private-card-mark')!, tor: token('.app.style-acira', '--tor-card-mark')!};
  assert.deepEqual(marks, {private: token('.app.style-acira', '--private-mark'), tor: token('.app.style-acira', '--tor-mark')}, 'the card marks are the light frame\'s marks');
  for (const [name, settings] of finishes) {
    const t = themeTokens({...base, ...settings} as typeof base, false);
    for (const [bg, fg] of [['--tab-selection-bg', '--tab-selection-fg'], ['--tab-carry-bg', '--tab-carry-fg']]) {
      const card = t[bg], ink = t[fg], quiet = mix(ink, card, .64);
      assert.ok(contrast(ink, card) >= 4.5, `${name}: ${fg} on ${bg}`);
      assert.ok(contrast(quiet, card) >= 3, `${name}: the card's 64% ink (× and sound) ${quiet} on ${card}`);
      for (const kind of ['private', 'tor'] as const) {
        const washed = mix(token('.app.style-acira[data-chrome=dark]', `--${kind}-wash`)!, card, percent(token('.app.style-acira[data-chrome=dark]', `--${kind}-current`)!));
        assert.ok(contrast(marks[kind], washed) >= 3, `${name}: the ${kind} mark on a current light card ${washed}`);
        assert.ok(contrast(ink, washed) >= 4.5, `${name}: the title on a current ${kind} light card ${washed}`);
      }
    }
  }
});

/** What tab-ink.css declares on a light card in a finish: the declarations of every rule whose `.app.style-acira[data-appearance=light]
 * :is(…)` list (or single selector) names that card, top level or inside an `@container style(--…-tone: dark)` block whose tone is dark
 * in that finish; later rules win. */
function cardDeclarations(card: string, tones: Record<string, string>) {
  const out: Record<string, string> = {};
  for (const [list, body, inside, prelude] of rules('styles/tab-ink.css')) {
    const gate = prelude.match(/^@container style\((--[\w-]+): dark\)$/);
    if (inside && !(gate && tones[gate[1]] === 'dark')) continue;
    const m = list.match(/^\.app\.style-acira\[data-appearance=light\] (?::is\((.*)\)|(.*))$/);
    if (!m) continue;
    // `prefix :is(a,b)` names `prefix a` and `prefix b`; a bare `[data-drag-surface=held]` names every carried tab.
    const named = splitList(m[1] ?? m[2]).flatMap(one => { const group = one.match(/^(.*) :is\((.*)\)$/); return group ? splitList(group[2]).map(x => `${group[1]} ${x}`) : [one]; });
    if (!named.some(one => one === card || one === '[data-drag-surface=held]' && card.endsWith(' [data-drag-surface=held]'))) continue;
    for (const one of body.split(';')) { const i = one.indexOf(':'); if (i > 0) out[one.slice(0, i).trim()] = one.slice(i + 1).trim(); }
  }
  return out;
}
const cardsOf = (t: Record<string, string>): [string, string, string[]][] => [
  ['.acira-sidebar .sb-tab[aria-current=true]', '#ffffff', ['--sb-fg', '--sb-muted', '--sb-private', '--sb-tor', '--brand-tone']],
  ['.acira-compact-tabs .acira-compact-tab.selected', t['--tab-selection-bg'], ['--ed-ink', '--ed-muted', '--private-mark', '--tor-mark', '--mark-on', '--brand-tone']],
  ['.acira-compact-tabs [data-drag-surface=held]', t['--tab-carry-bg'], ['--ed-ink', '--ed-muted', '--private-mark', '--tor-mark', '--mark-on', '--brand-tone']],
  ['.tab-strip-container [data-drag-surface=held]', t['--tab-carry-bg'], ['--ed-ink', '--ed-muted', '--private-mark', '--tor-mark', '--mark-on', '--brand-tone']],
  ['.tab-drag-preview', t['--tab-carry-bg'], ['--ed-ink', '--ed-muted', '--private-mark', '--tor-mark', '--mark-on', '--brand-tone']],
  // A current strip tab while it settles or moves aside is the light card too (selection.css: --frame-selection-bg, which the strip
  // maps to --tab-selection-bg in light mode), not the toolbar surface.
  ['.tab-strip-container .browser-tab.selected[data-drag-surface]', t['--tab-selection-bg'], ['--ed-ink', '--ed-muted', '--private-mark', '--tor-mark', '--mark-on', '--brand-tone']],
];
// Light cards also sit on a toolbar colour or a sidebar colour of their own, dark on a light finish.
const withCustom: [string, Record<string, unknown>][] = [...finishes, ['Porcelain, dark toolbar colour', {...palettePreference(appearancePalettes.find(p => p.name === 'Porcelain')!), toolbarColor: '#1d2733'}], ['Porcelain, dark sidebar colour', {...palettePreference(appearancePalettes.find(p => p.name === 'Porcelain')!), sidebarColor: '#1d2733'}]];

test('light cards: every token a light card hands its contents resolves to a readable pair on that card, in every finish', () => {
  const sidebarCurrentFg = rules('components/sidebar/sidebar.css').map(([list, body]) => list === '.app.style-acira[data-appearance=light] .ed-rail.acira-sidebar' && body.match(/--sb-current-fg:([^;]+)/)?.[1]).find((value): value is string => typeof value === 'string')!;
  for (const [name, settings] of withCustom) {
    const t = themeTokens({...base, ...settings} as typeof base, false), chromeDark = t['--chrome-tone'] === 'dark';
    const frame = (n: string) => token(chromeDark ? '.app.style-acira[data-chrome=dark]' : '.app.style-acira', n) ?? token('.app.style-acira', n);
    // The value a card's contents fall back to when the card does not re-scope it: the frame's, the toolbar's own for the compact strip
    // (frame.css gives the toolbar row its ink), the sidebar's for its rows.
    const around = (card: string) => card.includes('acira-compact') && settings.toolbarColor ? t['--toolbar-ink'] : t['--chrome-fg'];
    const fallback = (card: string): Record<string, string> => ({'--brand-tone': t['--chrome-tone'], '--ed-ink': around(card), '--ed-muted': mix(around(card), '#ffffff', .94), '--private-mark': frame('--private-mark')!, '--tor-mark': frame('--tor-mark')!, '--mark-on': frame('--mark-on')!, '--sb-fg': t['--sidebar-ink'], '--sb-muted': mix(t['--sidebar-ink'], '#ffffff', .64), '--sb-private': frame('--private-mark')!, '--sb-tor': frame('--tor-mark')!});
    const cards = cardsOf(t);
    for (const [card, bg, needs] of cards) {
      const declared = cardDeclarations(card, t), at = `${name}, ${card}`;
      const resolve = (n: string): string => {
        const value = declared[n];
        if (value === undefined) return fallback(card)[n];
        const ref = value.match(/^var\((--[\w-]+)\)$/)?.[1], quiet = value.match(/^color-mix\(in srgb,var\((--[\w-]+)\) (\d+)%,transparent\)$/);
        const named = (v: string) => v === '--sb-current-fg' ? sidebarCurrentFg : t[v] ?? token('.app.style-acira', v)!;
        return quiet ? mix(named(quiet[1]), bg, Number(quiet[2]) / 100) : ref ? named(ref) : value;
      };
      const ink = resolve(needs.includes('--sb-fg') ? '--sb-fg' : '--ed-ink'), muted = resolve(needs.includes('--sb-muted') ? '--sb-muted' : '--ed-muted');
      assert.equal(resolve('--brand-tone'), 'light', `${at}: Acira's logo in colour on the white card`);
      assert.ok(contrast(ink, bg) >= 4.5, `${at}: ink ${ink} on ${bg}`);
      assert.ok(contrast(muted, bg) >= 3, `${at}: × and sound ${muted} on ${bg}`);
      for (const kind of ['private', 'tor'] as const) {
        const mark = resolve(needs.includes('--sb-private') ? `--sb-${kind}` : `--${kind}-mark`);
        const washed = mix(token('.app.style-acira[data-chrome=dark]', `--${kind}-wash`)!, bg, percent(token('.app.style-acira[data-chrome=dark]', `--${kind}-current`)!));
        assert.ok(contrast(mark, washed) >= 3, `${at}: the ${kind} mark ${mark} on ${washed}`);
        // The small badge (icon-only strip tab, labels-off compact tab): the glyph in --mark-on on a disc of the mark.
        if (needs.includes('--mark-on')) assert.ok(contrast(resolve('--mark-on'), mark) >= 4.5, `${at}: the ${kind} badge glyph ${resolve('--mark-on')} on its disc ${mark}`);
      }
    }
  }
});

test('light cards on a light finish keep that finish\'s own ink: only the logo tone and marks are named, with the values it has already', () => {
  for (const [name, settings] of finishes) {
    const t = themeTokens({...base, ...settings} as typeof base, false);
    if (t['--chrome-tone'] === 'dark') continue;
    for (const [card] of cardsOf(t)) {
      const declared = cardDeclarations(card, t);
      for (const ink of ['--ed-ink', '--ed-muted', '--sb-fg', '--sb-muted']) assert.equal(declared[ink], undefined, `${name}, ${card}: ${ink} stays the finish's own`);
      assert.equal(declared['--brand-tone'], t['--chrome-tone']);
      for (const [n, frameName] of [['--private-mark', '--private-mark'], ['--tor-mark', '--tor-mark'], ['--mark-on', '--mark-on'], ['--sb-private', '--private-mark'], ['--sb-tor', '--tor-mark']]) {
        if (declared[n] === undefined) continue;
        const ref = declared[n].match(/^var\((--[\w-]+)\)$/)![1];
        assert.equal(token('.app.style-acira', ref), token('.app.style-acira', frameName), `${name}, ${card}: ${n} is the light frame's own value`);
      }
    }
  }
});

test('the cascade: a carried tab keeps the carry card\'s ink, and only a resting current strip tab takes the frame\'s', () => {
  const [strip] = rule('styles/selection.css', /^:root:root \.app\.style-acira\[data-appearance=light\]\[data-chrome=dark\] \.tab-strip-container \.tabs-strip>\.browser-tab\.selected/);
  assert.match(strip, /\.browser-tab\.selected:not\(\[data-drag-surface\]\)$/, 'carried, settling and moving tabs are the light card, not the toolbar surface');
  assert.doesNotMatch(strip, /data-privacy/, 'a private or Tor tab sits on the same surface under its wash');
  const [held, heldInk] = rule('styles/selection.css', /\[data-drag-surface=held\]$/);
  assert.match(heldInk, /background:var\(--tab-carry-bg\);color:var\(--tab-carry-fg\)/);
  // Every colour rule that also matches a carried strip tab, and wins without the carry rule's rank (the white-on-white label).
  const rivals = [
    ['styles/mac-material.css', /^html\[data-material=vibrancy\] \.app\.style-acira:not\(\[data-finish=Porcelain\]\) :is\(\.ed-rail,\.browser-shell\) :is\(\.ed-rail-button,\.ed-rail-saved>button,\.browser-tab\)$/],
    ['styles/toolbar-controls.css', '.app.style-acira .tab-strip-container .tabs-strip>.browser-tab:not(.selected)'],
    ['styles/toolbar-controls.css', '.app.style-acira .tab-strip-container .tabs-strip>.browser-tab.selected'],
    // A toolbar colour of its own (frame.css): its selected strip tab took the toolbar's ink, white on the carry card when dark.
    ['styles/frame.css', /^:root:root \.app\.style-acira\[data-toolbar-color\] \.browser-shell > :is\(\.browser-toolbar\.acira-persistent-toolbar, \.acira-bookmarks-row\),/],
  ] as const;
  const carry = specificity(splitList(held).find(s => s.includes('.browser-tab')) ?? held);
  for (const [file, selector] of rivals) {
    const [list, body] = rule(file, selector);
    assert.match(body, /color:/, `${file}: ${list} sets the tab's ink`);
    for (const one of splitList(list).filter(one => one.includes('.browser-tab'))) {
      if (/:not\(\[data-drag-surface\]\)$/.test(one)) continue; // leaves carried, settling and moving tabs to the carry card
      assert.ok(outranks(carry, specificity(one)) > 0, `the carry ink outranks ${one}`);
    }
  }
});

test('the narrow current tab\'s × patch is the current tab\'s own paint', () => {
  const [, patch] = rule('components/BrowserTabs.css', '.tab-strip-container:not(.vertical) .browser-tab.selected:not([data-icon-only=true]):is(:hover,:focus-within)>.tab-close', true);
  assert.match(patch, /^background:var\(--tab-close-patch,var\(--frame-selection-bg\)\)$/);
  const [, plain] = rule('styles/toolbar-controls.css', '.app.style-acira .tab-strip-container .tabs-strip>.browser-tab.selected:not([data-drag-surface])');
  assert.match(plain, /--tab-close-patch:linear-gradient\(var\(--tab-surface\),var\(--tab-surface\)\),linear-gradient\(var\(--tab-strip-recess\),var\(--tab-strip-recess\)\),var\(--frame\)/);
  const [, washed] = rule('styles/toolbar-controls.css', '.app.style-acira .tab-strip-container .tabs-strip>.browser-tab.selected[data-privacy]:not([data-drag-surface])');
  assert.match(washed, /--tab-close-patch:linear-gradient\(color-mix\(in srgb,var\(--tab-wash\) var\(--mark-current\),transparent\)/, 'a private or Tor tab\'s patch carries its wash');
  // The plate the patch repeats.
  assert.match(rule('styles/toolbar-controls.css', '.app.style-acira .tab-strip-container .tab-strip-selection:not([data-privacy])')[1], /^background:var\(--tab-surface\)/);
});

test('light cards hand their own ink to everything inside them, after every other stylesheet', () => {
  const order = read('allStyles.ts').match(/^import '\.\/[^']+';$/gm)!;
  assert.equal(order.at(-1), "import './styles/tab-ink.css';", 'tab-ink.css loads last');
  const [cards, shared] = rule('styles/tab-ink.css', /^\.app\.style-acira\[data-appearance=light\] :is\(\.acira-sidebar \.sb-tab\[aria-current=true\]/);
  for (const surface of ['.acira-sidebar .sb-tab[aria-current=true]', '.acira-compact-tabs .acira-compact-tab.selected', '[data-drag-surface=held]', '.tab-drag-preview', '.tab-strip-container .browser-tab.selected[data-drag-surface]']) assert.ok(cards.includes(surface), `light card ${surface}`);
  assert.match(shared, /--brand-tone:light/, 'Acira\'s own logo in colour, not white, on a white card');
  assert.match(shared, /--private-mark:var\(--private-card-mark\);--tor-mark:var\(--tor-card-mark\);--mark-on:var\(--card-mark-on\)/, 'the mark and its badge glyph as one light-frame pair');
  assert.equal(token('.app.style-acira', '--card-mark-on'), token('.app.style-acira', '--mark-on'), 'the light frame\'s badge glyph');
  assert.match(rule('styles/tab-ink.css', '.app.style-acira[data-appearance=light] .acira-sidebar .sb-tab[aria-current=true]')[1], /^--sb-private:var\(--private-card-mark\);--sb-tor:var\(--tor-card-mark\)$/);
  const gated = Object.fromEntries(rules('styles/tab-ink.css').filter(([, , inside]) => inside).map(([list, body, , prelude]) => [prelude, [list, body]]));
  assert.deepEqual(Object.keys(gated).sort(), ['@container style(--chrome-tone: dark)', '@container style(--sidebar-tone: dark)', '@container style(--toolbar-tone: dark)']);
  assert.deepEqual(gated['@container style(--sidebar-tone: dark)'], ['.app.style-acira[data-appearance=light] .acira-sidebar .sb-tab[aria-current=true]', '--sb-fg:var(--sb-current-fg);--sb-muted:color-mix(in srgb,var(--sb-current-fg) 64%,transparent)']);
  assert.deepEqual(gated['@container style(--toolbar-tone: dark)'], ['.app.style-acira[data-appearance=light] .acira-compact-tabs :is(.acira-compact-tab.selected,[data-drag-surface=held])', '--ed-ink:var(--tab-selection-fg);--ed-muted:color-mix(in srgb,var(--tab-selection-fg) 64%,transparent)']);
  assert.deepEqual(gated['@container style(--chrome-tone: dark)'], ['.app.style-acira[data-appearance=light] :is(.tab-strip-container [data-drag-surface=held],.tab-drag-preview,.tab-strip-container .browser-tab.selected[data-drag-surface])', '--ed-ink:var(--tab-carry-fg);--ed-muted:color-mix(in srgb,var(--tab-carry-fg) 64%,transparent)']);
  // What reads those tokens: the sidebar's private and Tor rows, its × and mute buttons, the sound glyphs, the logo's tone query.
  assert.match(rule('components/sidebar/sidebar.css', '.app.style-acira .acira-sidebar .sb-tab:is([data-private],[data-tor])')[1], /color:var\(--sb-fg\)/);
  assert.match(rule('components/sidebar/sidebar.css', '.app.style-acira .acira-sidebar .sb-tab-close,.app.style-acira .acira-sidebar .sb-tab-action')[1], /color:var\(--sb-muted\)/);
  assert.match(rule('styles/tab-sound.css', '.tab-sound-meter')[1], /color:var\(--ed-ink,currentColor\)/);
  assert.match(css('styles.css'), /@container style\(--brand-tone: dark\)\{\.brand-logo\[data-brand-tone=auto\] img\.brand-light\{display:none\}/);
});

test('a sleeping tab is clearly quieter, not gone: icons and titles dimmed on every finish, titles still 3:1 and icon strokes 2:1', () => {
  // beta.12: beta.10 had pushed sleeping tabs to the lowest dims that kept 3:1 icons and 4.5:1 titles, and a sleeping tab then hardly
  // differed from an awake one (the strip's title was not dimmed at all). Now the icon is about half strength (52% on light frames, 44% on
  // dark), the title 66% (light frames) or 56% (dark) of an awake tab's in the strip and about two thirds of one in the sidebar; floors: titles 3:1, a single icon stroke 2:1.
  const sleeping = css('components/tab-sleeping.css');
  assert.match(sleeping, /@media not \(forced-colors: active\) \{\s*\.browser-tab\[data-sleeping\]:not\(\.selected\):not\(:hover\):not\(:focus-visible\) \.site-identity-icon,\s*\.acira-compact-tab:not\(\.selected\):not\(:hover\):not\(:focus-visible\) \.acira-compact-tab-icon\[data-sleeping\] \.site-identity-icon \{ opacity: 0\.44; \}/, 'strip and compact icons, dark frames; forced colours keep them at full');
  assert.match(sleeping, /\.app\.style-acira:not\(\[data-chrome=dark\]\) \.browser-tab\[data-sleeping\]:not\(\.selected\):not\(:hover\):not\(:focus-visible\) \.site-identity-icon,\s*\.app\.style-acira:not\(\[data-chrome=dark\]\) \.acira-compact-tab:not\(\.selected\):not\(:hover\):not\(:focus-visible\) \.acira-compact-tab-icon\[data-sleeping\] \.site-identity-icon \{ opacity: 0\.52; \}/, 'strip and compact icons, light frames');
  assert.match(sleeping, /@media not \(forced-colors: active\) \{[^@]*\.browser-tab\[data-sleeping\]:not\(\.selected\):not\(:hover\):not\(:focus-visible\)>\.tab-title,\s*\.acira-compact-tab:not\(\.selected\):not\(:hover\):not\(:focus-visible\) \.acira-compact-tab-icon\[data-sleeping\]~\.acira-compact-tab-label \{ opacity: 0\.56; \}/, 'strip and compact titles, dark frames; forced colours keep them at full');
  assert.match(sleeping, /\.app\.style-acira:not\(\[data-chrome=dark\]\) \.browser-tab\[data-sleeping\]:not\(\.selected\):not\(:hover\):not\(:focus-visible\)>\.tab-title,\s*\.app\.style-acira:not\(\[data-chrome=dark\]\) \.acira-compact-tab:not\(\.selected\):not\(:hover\):not\(:focus-visible\) \.acira-compact-tab-icon\[data-sleeping\]~\.acira-compact-tab-label \{ opacity: 0\.66; \}/, 'strip and compact titles, light frames');
  // The states that stay clear are never matched by the dim: a selected (waking) tab, a hovered one, a keyboard-focused one.
  for (const state of ['.selected', ':hover', ':focus-visible']) assert.ok(sleeping.includes(`:not(${state})`), `the dim skips ${state}`);
  // All-asleep group label (strip and compact strip) and sidebar header.
  assert.match(sleeping, /\.tab-group-header\[data-all-asleep\] \.tab-group-label:not\(:hover\):not\(:focus-visible\)>:is\(span,small,svg\) \{ opacity: 0\.6; \}/);
  assert.match(css('components/TabGroupTray.tsx'), /data-all-asleep=\{allAsleep\|\|undefined\}/);
  assert.match(css('components/TabGroupTray.tsx'), /groupForTab\(\{tabGroups:groups\},member\)\?\.id===group\.id/, 'members are found by the group name in scope, like everywhere else');
  assert.match(css('components/sidebar/AciraSidebar.tsx'), /data-all-asleep=\{members\.length>0&&members\.every\(member=>member\.sleeping\)\|\|undefined\}/);
  assert.match(css('components/sidebar/sidebar.css'), /\.sb-group\[data-all-asleep\]>\.sb-group-header:not\(:hover\):not\(:focus-visible\) :is\(\.sb-group-name,\.sb-group-folder,small\)\{opacity:\.62\}/);
  // Sidebar: the row's title takes --sb-sleeping; the icon wrapper takes --sb-sleeping-icon of the row's rest ink, and the current, hovered and focused rows are skipped.
  const quiet = ':not([aria-current=true]):not(:hover):not(:has(.sb-tab-main:focus-visible))';
  assert.match(rule('components/sidebar/sidebar.css', `.app.style-acira .acira-sidebar .sb-tab[data-sleeping]${quiet}`)[1], /^color:var\(--sb-sleeping,var\(--sb-faint\)\)$/);
  assert.match(rule('components/sidebar/sidebar.css', `.app.style-acira .acira-sidebar .sb-tab[data-sleeping]${quiet} .sb-tab-icon`)[1], /^opacity:var\(--sb-sleeping-icon\);color:var\(--sb-rest\)$/);
  const sidebarBlock = (list: string, name: string) => Number(rules('components/sidebar/sidebar.css').map(([l, body, inside]) => !inside && l === list && body.match(new RegExp(`${name}:(?:rgb\\(var\\(--ink\\) \\/ )?([\\d.]+)`))?.[1]).find(Boolean));
  const light = {title: sidebarBlock('.app.style-acira .ed-rail.acira-sidebar', '--sb-sleeping'), icon: sidebarBlock('.app.style-acira .ed-rail.acira-sidebar', '--sb-sleeping-icon')};
  const dark = {title: sidebarBlock('.app.style-acira[data-chrome=dark] .ed-rail.acira-sidebar', '--sb-sleeping'), icon: sidebarBlock('.app.style-acira[data-chrome=dark] .ed-rail.acira-sidebar', '--sb-sleeping-icon')};
  assert.deepEqual({light, dark}, {light: {title: .52, icon: .52}, dark: {title: .42, icon: .5}});
  // An awake row rests at 76% of its ink on light frames and 62% on dark ones; a sleeping title is about two thirds of that, a sleeping icon about half.
  const rest = (list: string) => Number(rules('components/sidebar/sidebar.css').map(([l, body, inside]) => !inside && l === list && body.match(/--sb-rest:color-mix\(in srgb,var\(--sb-fg\) (\d+)%,transparent\)/)?.[1]).find(Boolean)) / 100;
  const awake = {light: rest('.app.style-acira .ed-rail.acira-sidebar'), dark: rest('.app.style-acira[data-chrome=dark] .ed-rail.acira-sidebar')};
  assert.deepEqual(awake, {light: .76, dark: .62});
  for (const [name, settings] of finishes) for (const appearance of [false, true]) {
    const t = themeTokens({...base, ...settings} as typeof base, appearance), chromeDark = t['--chrome-tone'] === 'dark', at = `${name} ${appearance ? 'dark' : 'light'}`;
    const sidebar = '#' + t['--sidebar-rgb'].split(' ').map(v => Number(v).toString(16).padStart(2, '0')).join(''), tone = t['--sidebar-tone'] === 'dark', v = tone ? dark : light, rest = tone ? awake.dark : awake.light;
    assert.ok(contrast(mix(t['--sidebar-ink'], sidebar, v.title), sidebar) >= 3, `${at}: sleeping sidebar title`);
    assert.ok(contrast(mix(t['--sidebar-ink'], sidebar, rest * v.icon), sidebar) >= 2, `${at}: sleeping sidebar icon stroke`);
    assert.ok(v.title <= .7 * rest, `${at}: sleeping title at most 70% of an awake row's`);
    assert.ok(v.icon <= .55, `${at}: sleeping icon about half strength`);
    const row = over(token(chromeDark ? '.app.style-acira[data-chrome=dark]' : '.app.style-acira', '--tab-strip-recess')!, t['--frame']);
    assert.ok(contrast(mix(t['--frame-text'], row, .8 * (chromeDark ? .44 : .52)), row) >= 2, `${at}: sleeping strip icon stroke`);
    assert.ok(contrast(mix(t['--frame-text'], row, .8 * (chromeDark ? .56 : .66)), row) >= 3, `${at}: sleeping strip title`);
  }
});
