// Founder, beta.10: "the highlight colour covers the X so it doesn't show". On Windows that X can also be the window's own close
// button (titleBarOverlay, drawn by Windows with the glyph colour Acira sends). Its glyphs must read on the band they sit on in every
// finish, light and dark, private and Tor windows, and the colours people pick themselves: at least 3:1 (icons, WCAG 1.4.11).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appearancePalettes, palettePreference } from '../src/runtime/appearancePalettes';
import { createInitialState } from '../src/runtime/core';
import { contrast, studyFinish, themeTokens, type WindowFinish } from '../src/ui/theme';
import { windowCaptionColors } from '../src/ui/windowCaption';

const base = createInitialState().settings;
const places = {top: {standardTop: true, sidebarFrame: false, toolbarOwn: false}, sidebar: {standardTop: false, sidebarFrame: true, toolbarOwn: false}, compact: {standardTop: false, sidebarFrame: false, toolbarOwn: false}};
function worst(settings: typeof base & {windowFinish?: WindowFinish}, extraPlaces: Record<string, {standardTop: boolean; sidebarFrame: boolean; toolbarOwn: boolean}> = {}) {
  let low = {ratio: 99, at: ''};
  for (const dark of [false, true]) {
    const finish = studyFinish(settings, dark), colors = themeTokens(settings, dark);
    for (const [name, place] of Object.entries({...places, ...extraPlaces})) {
      const {captionColor, captionForeground} = windowCaptionColors(finish, colors, place), ratio = contrast(captionForeground, captionColor);
      if (ratio < low.ratio) low = {ratio, at: `${dark ? 'dark' : 'light'} ${name}: ${captionForeground} on ${captionColor}`};
    }
  }
  return low;
}

test('Windows caption buttons: the glyphs read on their band in every finish, light and dark, and in private and Tor windows', () => {
  for (const palette of appearancePalettes) {
    const low = worst({...base, ...palettePreference(palette)});
    assert.ok(low.ratio >= 3, `${palette.name} ${low.at} is ${low.ratio.toFixed(2)}:1`);
  }
  for (const windowFinish of ['private', 'tor'] as const) {
    const low = worst({...base, windowFinish});
    assert.ok(low.ratio >= 3, `${windowFinish} ${low.at} is ${low.ratio.toFixed(2)}:1`);
  }
});

test('Windows caption buttons: custom tints and a sidebar or toolbar colour of their own keep readable glyphs', () => {
  const steps = [0, 64, 128, 204, 255], hex = (r: number, g: number, b: number) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
  for (const r of steps) for (const g of steps) for (const b of steps) {
    const tint = hex(r, g, b);
    for (const extra of [{}, {sidebarColor: tint}, {toolbarColor: tint}]) {
      const settings = {...base, colorPreset: 'Custom', browserTint: tint, accentColor: tint, ...extra};
      const low = worst(settings, 'toolbarColor' in extra ? {toolbar: {standardTop: false, sidebarFrame: true, toolbarOwn: true}} : {});
      assert.ok(low.ratio >= 3, `${tint} ${JSON.stringify(extra)} ${low.at} is ${low.ratio.toFixed(2)}:1`);
    }
  }
});

test('the window sends these caption colours: App builds its layout with windowCaptionColors and main passes them to titleBarOverlay', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8'), main = readFileSync(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(app, /\.\.\.windowCaptionColors\(finish, colors as Record<string, string>, \{ standardTop: effectiveMode === 'standard' && !sideTabs, sidebarFrame, toolbarOwn \}\)/);
  assert.doesNotMatch(app, /captionForeground:/, 'one place decides the caption colours');
  assert.match(main, /symbolColor:layout\.captionForeground\|\|/);
});
