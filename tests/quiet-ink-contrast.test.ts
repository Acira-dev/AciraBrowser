// beta.10 leftovers (contrast-2): the quiet inks that sat just under their line. The sidebar's "12 tabs" count and the New tab row's count
// (12 px at 44% ink, 2.5-2.8:1 on the five light finishes), the sidebar's group dot (2.73:1 for blue on Sand over a dark desktop, yellow 1.7:1),
// the labels and faint notes on a deep finish in light mode (50% white, 4.15-4.3:1), the compact strip's current tab × under the pointer (a dark
// square holding a white × on the white card) and the "Update" pill on a colour of the person's own (1.05-2.6:1). Text needs 4.5:1, a count
// or a mark 3:1, as the round-1 notes measured them. Backgrounds: the sidebar's real pixels on the Mac's glass over a white and a dark desktop
// (tab-ink's glass pass, 3 Nov: the darkest and the lightest sample of each finish in light mode) and the opaque frame (Reduce transparency,
// Increase Contrast, Windows with transparency off or the window inactive, with its 4% white top lift).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appearancePalettes, palettePreference } from '../src/runtime/appearancePalettes';
import { createInitialState } from '../src/runtime/core';
import { contrast, mix, themeTokens } from '../src/ui/theme';
import { fromOklch } from '../src/ui/colorMath';

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
    out.push([head.replace(/\s+/g, ' '), text.slice(i + 1, close).trim(), blocks.length > 0, blocks.at(-1) ?? ''] as const); i = close; from = close + 1;
  }
  return out;
}
const declared = (body: string, name: string) => body.match(new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`))?.[1].trim();
const base = createInitialState().settings;
const settingsFor = (name: string, extra: Record<string, unknown> = {}) => ({...base, ...palettePreference(appearancePalettes.find(p => p.name === name)!), ...extra}) as typeof base;
const hex = (c: number[]) => '#' + c.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const rgbOf = (value: string) => value.split(' ').map(Number);
/** The sidebar on the Mac's glass in light mode: the darkest and lightest pixel over a white desktop, then over a dark one (tab-ink, 3 Nov). */
const macGlass: Record<string, string[]> = {
  'Porcelain': ['#edeeee', '#eff0f0', '#e4e5e5', '#e7e8e8'],
  'Burgundy': ['#4e2930', '#4f2a31', '#431e24', '#441f26'],
  'Deep Blue': ['#2a3949', '#2b394b', '#1f2e3d', '#202e3e'],
  'Ocean Blue': ['#c3deef', '#c6e0f0', '#bbd5e6', '#bdd8e8'],
  'iPhone Blue': ['#1c3956', '#1c3957', '#0f2e4a', '#0f2e4b'],
  'Emerald Green': ['#193f33', '#1a4034', '#0c3427', '#0d3528'],
  'Alpine Green': ['#213e36', '#223f37', '#16332a', '#17342b'],
  'Deep Purple': ['#442d4b', '#452e4c', '#39223f', '#3a2340'],
  'Desert Titanium': ['#dfd5cc', '#dfd7ce', '#d4cdc5', '#d6cfc6'],
  'Natural Titanium': ['#d4d8dc', '#d6dadd', '#ccd0d3', '#ced2d5'],
  'Silver': ['#e2e6e9', '#e4e8eb', '#dbdde0', '#dce0e3'],
  'Black Titanium': ['#31363c', '#32373d', '#262b2f', '#272c30'],
};
/** Every background the sidebar of a finish has in light mode: the glass samples and the opaque frame with and without its top lift. */
function sidebarBackgrounds(name: string, extra: Record<string, unknown> = {}) {
  const t = themeTokens(settingsFor(name, extra), false), side = t['--sidebar-rgb'];
  return {t, all: [...(extra.sidebarColor ? [] : macGlass[name]), hex(rgbOf(side)), mix('#ffffff', hex(rgbOf(side)), .04)]};
}
/** The sidebar's top-level token blocks (`.app.style-acira[…] .ed-rail.acira-sidebar`) that apply in a window, most specific first: a deep
 * frame (`[data-chrome=dark]`), light mode (`[data-appearance=light]`), and whether it is a private or Tor window (`[data-window-finish]`). */
function sidebarScope(chromeDark: boolean, light: boolean, windowFinish?: string) {
  return rules('components/sidebar/sidebar.css').filter(([list, , inside]) => !inside && /^\.app\.style-acira\S* \.ed-rail\.acira-sidebar$/.test(list)).filter(([list]) => {
    const app = list.split(' ')[0];
    return (light || !app.includes('[data-appearance=light]')) && (chromeDark || !app.includes('[data-chrome=dark]')) && (!windowFinish || !app.includes(':not([data-window-finish])')) && (!!windowFinish || !/\[data-window-finish[\]=]/.test(app.replace(':not([data-window-finish])', '')));
  }).sort(([a], [b]) => b.split(' ')[0].length - a.split(' ')[0].length).map(([, body]) => body);
}
/** The alpha of `rgb(var(--ink) / a)` a sidebar colour resolves to, through the token blocks that apply in that window. */
function sidebarAlpha(value: string, chromeDark: boolean, light: boolean, windowFinish?: string): number {
  const direct = value.match(/^rgb\(var\(--ink\) \/ ([\d.]+)\)$/);
  if (direct) return Number(direct[1]);
  const ref = value.match(/^var\((--[\w-]+)(?:,\s*(.+))?\)$/);
  assert.ok(ref, `an ink alpha or a token: ${value}`);
  for (const body of sidebarScope(chromeDark, light, windowFinish)) { const found = declared(body, ref![1]); if (found) return sidebarAlpha(found, chromeDark, light, windowFinish); }
  assert.ok(ref![2], `${ref![1]} is declared for the sidebar`);
  return sidebarAlpha(ref![2]!, chromeDark, light, windowFinish);
}
const colourOf = (file: string, selector: string) => { const found = rules(file).filter(([list, , inside]) => !inside && list === selector); assert.equal(found.length, 1, `${file}: one rule ${selector}`); return declared(found[0][1], 'color')!; };

test('the sidebar\'s counts and the New tab "+" (the quiet ink) keep 3:1 on every finish, the counts one colour', () => {
  const marks = {
    'the workspace title\'s "12 tabs"': colourOf('styles/workspaces.css', '.sb-ws-title-count'),
    'the New tab row\'s count': colourOf('components/sidebar/sidebar.css', '.app.style-acira .acira-sidebar .sb-new-end>small'),
    'the New tab "+"': colourOf('components/sidebar/sidebar.css', '.app.style-acira .acira-sidebar .sb-new-tab>.sb-tab-icon'),
    'the Bookmarks mark': colourOf('components/sidebar/sidebar.css', '.app.style-acira .acira-sidebar .sb-zone-mark'),
  };
  for (const palette of appearancePalettes) {
    const {t, all} = sidebarBackgrounds(palette.name), dark = t['--chrome-tone'] === 'dark', ink = hex(rgbOf(t['--chrome-ink']));
    const alphas = Object.values(marks).map(value => sidebarAlpha(value, dark, true));
    assert.equal(new Set(alphas).size, 1, `${palette.name}: the counts and the quiet marks are one ink (founder, 28 Oct)`);
    for (const [label, value] of Object.entries(marks)) for (const bg of all) {
      const shown = mix(ink, bg, sidebarAlpha(value, dark, true));
      assert.ok(contrast(shown, bg) >= 3, `${palette.name} light: ${label} ${shown} on ${bg} (${contrast(shown, bg).toFixed(2)}:1)`);
    }
  }
  // The least raise: 44% stays on dark sidebars (3.6:1 or better there), light ones take the lowest step that holds Porcelain over a dark desktop.
  assert.equal(sidebarAlpha('var(--sb-quiet)', true, false), .44);
  assert.ok(sidebarAlpha('var(--sb-quiet)', false, true) <= .52);
});

test('labels and faint notes keep 4.5:1 on a deep finish in light mode; dark mode keeps its 50%', () => {
  const faint = ['.app.style-acira .acira-sidebar .sb-bookmarks-empty', '.app.style-acira .acira-sidebar .sb-section-empty', '.app.style-acira .acira-sidebar .sb-row-note', '.app.style-acira .acira-sidebar .sb-custom-note', '.app.style-acira .acira-sidebar .sb-apps.sb-apps-hint']
    .map(selector => [selector, colourOf('components/sidebar/sidebar.css', selector)] as const);
  assert.ok(faint.every(([, value]) => value === 'var(--sb-faint)'), 'the empty states, notes and hints read --sb-faint');
  for (const palette of appearancePalettes) {
    const {t, all} = sidebarBackgrounds(palette.name), dark = t['--chrome-tone'] === 'dark', ink = hex(rgbOf(t['--chrome-ink']));
    for (const token of ['--sb-faint', '--sb-label']) for (const bg of all) {
      const shown = mix(ink, bg, sidebarAlpha(`var(${token})`, dark, true));
      assert.ok(contrast(shown, bg) >= 4.5, `${palette.name} light: ${token} ${shown} on ${bg} (${contrast(shown, bg).toFixed(2)}:1)`);
    }
  }
  assert.deepEqual([sidebarAlpha('var(--sb-faint)', true, false), sidebarAlpha('var(--sb-label)', true, false)], [.5, .5], 'dark mode unchanged');
  // Private and Tor windows wear their own deep finish in light mode too. They keep wip/beta10's 50%, which already reads there: the sidebar's
  // real pixels in a private window on the Mac's glass over a white desktop (tab-ink's private-window run) and the opaque frame of both.
  const privateGlass = ['#1a3030', '#193030', '#192f30'];
  for (const windowFinish of ['private', 'tor'] as const) {
    const t = themeTokens({...base, windowFinish} as typeof base, false), side = hex(rgbOf(t['--sidebar-rgb']));
    assert.equal(t['--chrome-tone'], 'dark', `a ${windowFinish} window is deep in light mode`);
    for (const token of ['--sb-faint', '--sb-label']) {
      assert.equal(sidebarAlpha(`var(${token})`, true, true, windowFinish), .5, `${windowFinish} window, light: ${token} as on wip/beta10`);
      for (const bg of [side, mix('#ffffff', side, .04), ...(windowFinish === 'private' ? privateGlass : [])]) { const shown = mix('#ffffff', bg, .5); assert.ok(contrast(shown, bg) >= 4.5, `${windowFinish} window: ${token} ${shown} on ${bg} (${contrast(shown, bg).toFixed(2)}:1)`); }
    }
  }
  assert.ok(sidebarAlpha('var(--sb-faint)', true, true) <= .55, 'the least raise (55% is the sleeping title, tab-ink)');
});

test('the sidebar\'s group dot keeps 3:1 for all nine colours on every light sidebar, in its own hue', () => {
  const concept: Record<string, [number, number, number]> = {grey: [.55, 0, 0], blue: [.58, .15, 255], red: [.57, .17, 25], yellow: [.7, .13, 90], green: [.58, .13, 150], pink: [.6, .16, 350], purple: [.56, .15, 300], cyan: [.62, .1, 210], orange: [.64, .15, 55]};
  const light = rules('components/sidebar/sidebar.css').find(([list, , inside]) => !inside && list === '.app.style-acira .ed-rail.acira-sidebar')![1];
  const lightSidebars = appearancePalettes.map(p => sidebarBackgrounds(p.name)).filter(({t}) => t['--sidebar-tone'] === 'light');
  assert.equal(lightSidebars.length, 5, 'Porcelain, Ocean, Sand, Stone and Silver');
  // A sidebar colour of one's own, light, on a deep finish: the dot follows the sidebar's tone, not the frame's.
  for (const sidebarColor of ['#ffffff', '#f2f2f2', '#f6efdc', '#e9eef5']) { const own = sidebarBackgrounds('Burgundy', {sidebarColor}); assert.equal(own.t['--sidebar-tone'], 'light'); lightSidebars.push(own); }
  for (const [name, [L0, C0, H0]] of Object.entries(concept)) {
    const m = declared(light, `--tab-group-${name}`)!.match(/^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/);
    assert.ok(m, `--tab-group-${name} is an OKLCH colour`);
    const [L, C, H] = m!.slice(1).map(Number), color = fromOklch(L, C, H * Math.PI / 180);
    assert.equal(H, H0, `${name} keeps its hue`);
    assert.ok(L <= L0 && L >= L0 - .15 && Math.abs(C - C0) <= .025, `${name}: a deeper tone of the same colour, only as far as needed`);
    for (const {t, all} of lightSidebars) for (const bg of all) assert.ok(contrast(color, bg) >= 3, `${name} ${color} on ${t['--finish']} ${bg} (${contrast(color, bg).toFixed(2)}:1)`);
  }
  // The lighter colours are the dark sidebar's: keyed on the sidebar's own tone (equal to the frame's without a sidebar colour).
  const gated = rules('components/sidebar/sidebar.css').filter(([list, body, inside]) => inside && list === '.app.style-acira .ed-rail.acira-sidebar' && body.includes('--tab-group-'));
  assert.deepEqual(gated.map(([, , , prelude]) => prelude), ['@container style(--sidebar-tone: dark)']);
  assert.ok(!rules('components/sidebar/sidebar.css').some(([list, body, inside]) => !inside && list.includes('[data-chrome=dark]') && body.includes('--tab-group-')), 'no palette keyed on the frame');
  const darkPalette = gated[0][1];
  for (const palette of appearancePalettes) for (const dark of [false, true]) {
    const t = themeTokens(settingsFor(palette.name), dark); if (t['--sidebar-tone'] !== 'dark') continue;
    const side = hex(rgbOf(t['--sidebar-rgb']));
    for (const name of Object.keys(concept)) { const [L, C, H] = declared(darkPalette, `--tab-group-${name}`)!.match(/[\d.]+/g)!.map(Number); assert.ok(contrast(fromOklch(L, C, H * Math.PI / 180), side) >= 3, `${palette.name} ${dark ? 'dark' : 'light'}: ${name} on the dark sidebar`); }
  }
  // A Windows contrast theme forces the group's line to the page colour: it is drawn in CanvasText, and so is the folder glyph (unfilled).
  const forced = rules('components/sidebar/sidebar.css').filter(([, , inside, prelude]) => inside && prelude === '@media(forced-colors:active)');
  assert.ok(forced.some(([list, body]) => list.split(',').includes('.app.style-acira .acira-sidebar .sb-group-members::before') && /background:CanvasText/.test(body)), 'the group line shows in forced colours');
  assert.ok(forced.some(([list, body]) => list.split(',').includes('.app.style-acira .acira-sidebar .sb-group-folder') && /color:CanvasText/.test(body)), 'the folder glyph shows in forced colours');
});

test('the compact strip\'s current tab: its × under the pointer is a quiet step of the card, with the card\'s ink, where the frame or toolbar is dark', () => {
  // Not in private and Tor windows: their own deep finish keeps the frame's square there, as on wip/beta10 (the App marks them).
  const compact = rules('components/CompactTabs.css').filter(([list, , inside]) => inside && list === '.app.style-acira[data-appearance=light]:not([data-window-finish]) .acira-compact-tabs .acira-compact-tab.selected .acira-compact-tab-close:hover');
  assert.ok(!rules('components/CompactTabs.css').some(([list]) => list.includes('.acira-compact-tab-close:hover') && list.includes('[data-appearance=light]') && !list.includes(':not([data-window-finish])')), 'no compact × rule reaches private and Tor windows');
  assert.match(read('App.tsx'), /data-window-finish=\{windowFinish\(state\)\}/);
  assert.deepEqual(compact.map(([, , , prelude]) => prelude).sort(), ['@container style(--chrome-tone: dark)', '@container style(--toolbar-tone: dark)']);
  for (const [, body] of compact) assert.equal(body, 'background:color-mix(in srgb,var(--tab-selection-fg) 13%,transparent);color:var(--tab-selection-fg)');
  // It outranks the shared hover (mac-material.css: (0,5,0)) wherever its container matches; on light finishes that shared square stays.
  assert.ok(css('styles/mac-material.css').includes('.app.style-acira :is(.browser-tab .tab-close,.acira-compact-tab-close):hover{background:var(--chrome-pressed);color:var(--chrome-fg)}'));
  let checked = 0;
  for (const palette of appearancePalettes) for (const toolbarColor of [undefined, '#ffffff', '#1d2733', '#7a2030']) {
    const t = themeTokens(settingsFor(palette.name, {toolbarColor}), false);
    if (t['--chrome-tone'] !== 'dark' && t['--toolbar-tone'] !== 'dark') continue;
    const card = t['--surface'], ink = t['--tab-selection-fg'], square = mix(ink, card, .13); checked++;
    const at = `${palette.name} light${toolbarColor ? ' + toolbar ' + toolbarColor : ''}`;
    assert.ok(contrast(ink, square) >= 4.5, `${at}: × ${ink} on its square ${square}`);
    assert.ok(contrast(square, card) <= 1.5, `${at}: the square ${square} is a quiet step of the card ${card}, as on a light finish (1.4-1.9:1)`);
  }
  assert.ok(checked >= 20, 'deep finishes, and a dark toolbar colour on a light one');
});

test('the "Update" pill reads on any colour of the person\'s own under the toolbar, and keeps its accent where that reads', () => {
  const toolbars = ['#ffffff', '#f6efdc', '#e4e4e4', '#c9c2b8', '#b0b0b0', '#9a9a9a', '#808080', '#6e6e6e', '#4a4f57', '#2b2b2b', '#1c1c1e', '#000000', '#7a2030', '#1d2733', '#2f6f4f', '#d9c06a', '#89b4e6', '#e85d75'];
  let switched = 0, kept = 0;
  for (const palette of appearancePalettes) for (const dark of [false, true]) {
    const plain = themeTokens(settingsFor(palette.name), dark);
    assert.equal(plain['--toolbar-pill-ink'], undefined, 'no toolbar colour: the frame\'s rule (round 1) draws it');
    assert.equal(plain['--sidebar-pill-ink'], undefined, 'no sidebar colour: the frame\'s rule draws it');
    for (const colour of toolbars) for (const kind of ['toolbar', 'sidebar'] as const) {
      const t = themeTokens(settingsFor(palette.name, {[`${kind}Color`]: colour}), dark), surface = colour, ownInk = t[`--${kind}-ink`];
      // What update-pill.css drew before: the frame's accent (--ed-blue = --chrome-accent) where the toolbar's tone is dark, else the page's.
      const accent = (kind === 'toolbar' ? t['--toolbar-tone'] : t['--chrome-tone']) === 'dark' ? t['--chrome-accent'] : t['--accent'];
      const tint = mix(accent, surface, .13), ink = t[`--${kind}-pill-ink`], at = `${palette.name} ${dark ? 'dark' : 'light'} ${kind} ${colour}`;
      assert.ok(ink, `${at}: the pill has an ink for it`);
      const was = contrast(accent, tint), now = contrast(ink, tint);
      if (was >= 4.5) { assert.equal(ink, accent, `${at}: keeps its accent (${was.toFixed(2)}:1)`); kept++; continue; }
      assert.ok(now >= 4.5 || now >= contrast(ownInk, tint) - .001, `${at}: "Update" ${ink} on ${tint} reads ${now.toFixed(2)}:1 (was ${was.toFixed(2)}), as the toolbar's own text`);
      if (ink !== accent) switched++;
    }
  }
  assert.ok(switched > 100 && kept > 100, `both kinds occur (switched ${switched}, kept ${kept})`);
  const pill = rules('features/updates/update-pill.css').filter(([, , inside, prelude]) => inside && prelude === '@media not (forced-colors: active)');
  assert.ok(pill.some(([list, body]) => list === ".app.style-acira[data-toolbar-color] .update-pill[data-phase='ready']" && body === 'color: var(--toolbar-pill-ink, var(--toolbar-ink));'));
  // The sidebar colour is under the toolbar exactly where frame.css puts the toolbar on the sidebar's frame.
  const frame = rules('styles/frame.css').find(([list, , inside]) => !inside && list.endsWith('.browser-shell > .browser-toolbar.acira-persistent-toolbar') && list.includes(':not([data-toolbar-color])') && list.startsWith(':root:root:root:not([data-edge-float])'))![0];
  const where = frame.replace(' .browser-shell > .browser-toolbar.acira-persistent-toolbar', '').replace('.app.style-acira:not([data-toolbar-color])', '.app.style-acira[data-sidebar-color]:not([data-toolbar-color])');
  const flat = (list: string) => list.replace(/,\s+/g, ',');
  assert.ok(pill.some(([list, body]) => flat(list) === flat(`${where} .update-pill[data-phase='ready']`) && body === 'color: var(--sidebar-pill-ink, var(--sidebar-ink));'), 'the sidebar colour rule mirrors frame.css');
  assert.match(read('App.tsx'), /data-sidebar-color=\{state\.settings\.sidebarColor \? '' : undefined\}/);
});
