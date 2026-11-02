import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { popupGeometry } from '../src/ui/popup';

const { measuredPlacement, snapBounds, snapOverlay, fitWindowsOverlay } = createRequire(import.meta.url)('../desktop/popup-measure.cjs') as {
  measuredPlacement: (input: { current: any; height: number; windowHeight: number; scale?: number; lockedTop?: number }) => { y: number; h: number; up: boolean; centered: boolean; keepTop: boolean; unchanged: boolean };
  snapBounds: (bounds: any) => any;
  snapOverlay: (layout: any) => any;
  fitWindowsOverlay: (layout: any, size: [number, number], scale?: number) => any;
};

test('Windows tall sheets keep their first fields below the header at every interface scale', () => {
  for (const scale of [.8, .9, 1, 1.1, 1.25, 1.5]) for (const height of [600, 720, 1080]) for (const kind of ['workspace-edit', 'profile', 'tabs', 'split', 'menu']) {
    const size: [number, number] = [1280, height];
    const views = [{tabId: 'website', bounds: {x: 240, y: 84 * scale, width: 1040, height: height - 84 * scale}}];
    const layout = {views, captionHeight: 40 * scale, pageBounds: {x: 240, y: 84 * scale, width: 1040, height: height - 84 * scale}, overlay: {kind, contentHeight: 900 * scale, anchor: {x: 8, y: height - 60, width: 28, height: 28}, bounds: {x: 12 * scale, y: 12 * scale, width: 360 * scale, height: height - 24 * scale}}};
    const fitted = fitWindowsOverlay(layout, size, scale);
    assert(fitted.overlay.bounds.y >= layout.pageBounds.y + 8 * scale);
    assert(fitted.overlay.bounds.y + fitted.overlay.bounds.height <= height - Math.round(12 * scale));
    assert.equal(fitted.overlay.contentHeight, layout.overlay.contentHeight, 'natural height stays available to the scrollable form');
    assert.equal(fitted.views, views, 'website and split-pane bounds are untouched');
    assert.equal(fitted.overlay.anchor, layout.overlay.anchor, 'the trigger stays where the person clicked');
    assert.equal(fitWindowsOverlay(fitted, size, scale), fitted, 'repeated native measurements do not move a fitted sheet');
  }
});

test('Windows fitting contains flyouts and preserves already contained overlays', () => {
  const base = {views: [], captionHeight: 40, pageBounds: {x: 0, y: 84, width: 900, height: 516}, overlay: {kind: 'workspace-context', bounds: {x: 20, y: 100, width: 260, height: 180}}};
  assert.equal(fitWindowsOverlay(base, [900, 600]), base);
  const next = fitWindowsOverlay({...base, overlay: {...base.overlay, auxiliaryBounds: {x: 890, y: -10, width: 280, height: 900}}}, [900, 600]);
  assert(next.overlay.auxiliaryBounds.x >= 12);
  assert(next.overlay.auxiliaryBounds.x + next.overlay.auxiliaryBounds.width <= 888);
  assert(next.overlay.auxiliaryBounds.y >= 92);
  assert(next.overlay.auxiliaryBounds.y + next.overlay.auxiliaryBounds.height <= 588);
  assert.deepEqual(next.overlay.bounds, base.overlay.bounds);
});

/** The formulas main.cjs used inline before desktop/popup-measure.cjs (bare DIP constants), kept here to prove scale 1 is unchanged. */
function legacy(current: any, height: number, windowHeight: number, lockedTop?: number) {
  const anchor = current.anchor || current.bounds, below = windowHeight - anchor.y - anchor.height - 20, above = anchor.y - 20, point = anchor.width <= 2 && anchor.height <= 2, gap = point ? 2 : 8;
  const up = below < (point ? height : Math.min(height, 280)) && above > below, centered = current.origin?.x === .5 && current.origin?.y === .5, keepTop = current.kind === 'palette';
  const h = Math.min(height, centered || keepTop ? windowHeight - 120 : Math.max(100, up ? above : below), windowHeight - 24);
  const y = keepTop ? Math.max(12, Math.min(windowHeight - h - 12, current.bounds.y)) : centered ? Math.max(60, Math.min(windowHeight - h - 12, lockedTop !== undefined ? lockedTop : (windowHeight - h) / 2)) : Math.max(12, Math.min(up ? anchor.y - h - gap : anchor.y + anchor.height + gap, windowHeight - h - 12));
  return { y, h, up };
}

test('at interface scale 1 the measured placement equals the old inline formulas', () => {
  const anchors = [{ x: 580, y: 48, width: 36, height: 36 }, { x: 40, y: 700, width: 28, height: 28 }, { x: 300, y: 300, width: 2, height: 2 }, { x: 900, y: 40, width: 30, height: 30 }];
  const origins = [{ x: 1, y: 0 }, { x: .5, y: .5 }, { x: .2, y: 1 }];
  for (const anchor of anchors) for (const origin of origins) for (const kind of ['extensions', 'palette', 'profile']) for (const height of [90, 155, 300, 640, 900]) for (const windowHeight of [533, 600, 800]) for (const lockedTop of [undefined, 77]) {
    const current = { kind, origin, anchor, bounds: { x: 100, y: 120, width: 320, height: 200 }, contentHeight: 1 };
    const now = measuredPlacement({ current, height, windowHeight, scale: 1, lockedTop }), old = legacy(current, height, windowHeight, lockedTop);
    assert.deepEqual({ y: now.y, h: now.h, up: now.up }, old, JSON.stringify({ kind, origin, anchor, height, windowHeight, lockedTop }));
  }
});

test('a measure that changes nothing never moves the primary panel (a child flyout opening at 150%)', () => {
  const scale = 1.5, anchor = { x: 870, y: 72, width: 54, height: 54 };
  const current = { kind: 'extensions', origin: { x: .94, y: 0 }, anchor, bounds: { x: 444, y: 138, width: 480, height: 233 }, contentHeight: 232.5 };
  const same = measuredPlacement({ current, height: 232.5, windowHeight: 800, scale });
  assert.equal(same.unchanged, true);
  const grown = measuredPlacement({ current, height: 240 * scale, windowHeight: 800, scale });
  assert.equal(grown.unchanged, false);
  assert.equal(grown.y, 138, 'gap under the trigger is 8 CSS px = 12 DIP at 150%, where the renderer put the panel (not 8 DIP, which was 134)');
});

test('the main-side measured placement agrees with the renderer geometry at every interface scale', () => {
  for (const scale of [.8, .9, 1, 1.1, 1.25, 1.5]) for (const kind of ['extensions', 'profile', 'protection', 'downloads']) for (const natural of [120, 155, 233, 420]) {
    const viewport = { width: 960 / scale, height: 800 / scale }, source = { x: viewport.width - 60, y: 48, width: 36, height: 36 };
    const css = popupGeometry(kind, {} as any, viewport, source, natural);
    const dip = measuredPlacement({ current: { kind, origin: css.origin, anchor: { x: source.x * scale, y: source.y * scale, width: source.width * scale, height: source.height * scale }, bounds: { x: css.bounds.x * scale, y: 0, width: css.bounds.width * scale, height: 10 }, contentHeight: 1 }, height: css.contentHeight * scale, windowHeight: 800, scale });
    assert.ok(Math.abs(dip.y - css.bounds.y * scale) <= 1.01, `${kind} @${scale} natural ${natural}: main y ${dip.y} vs renderer ${css.bounds.y * scale}`);
    assert.ok(Math.abs(dip.h - css.bounds.height * scale) <= 1.01, `${kind} @${scale} natural ${natural}: main height ${dip.h} vs renderer ${css.bounds.height * scale}`);
  }
});

test('popup host bounds are rounded once to whole device pixels where CSS px become DIPs', () => {
  assert.deepEqual(snapBounds({ x: 444, y: 138, width: 480, height: 232.5 }), { x: 444, y: 138, width: 480, height: 233 });
  const layout = { views: [], overlay: { kind: 'extensions', bounds: { x: 443.6, y: 137.5, width: 479.9, height: 232.5 }, auxiliaryBounds: { x: 1.4, y: 2.5, width: 3.5, height: 4.4 }, anchor: { x: 1.5, y: 2.5, width: 3.5, height: 4.5 } } };
  const snapped = snapOverlay(layout);
  assert.deepEqual(snapped.overlay.bounds, { x: 444, y: 138, width: 480, height: 233 });
  assert.deepEqual(snapped.overlay.auxiliaryBounds, { x: 1, y: 3, width: 4, height: 4 });
  assert.deepEqual(snapped.overlay.anchor, layout.overlay.anchor, 'the anchor is the trigger\'s own box, left alone');
  assert.equal(snapOverlay({ views: [] }).overlay, undefined);
});
