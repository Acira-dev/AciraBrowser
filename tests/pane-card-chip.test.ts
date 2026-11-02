import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { chipIconSource } from '../src/ui/chipIcon';
import { createSim, liquidSprings, simStep, type LiquidTarget } from '../src/ui/liquidSnap';

const read = (file: string) => fs.readFileSync(path.resolve(file), 'utf8');

test('R5 chip icon: a picture on screen is copied; a loading tab (its dot matrix copies blank) shows the favicon, else the stored icon, else the loader', () => {
  const stored = (url: string) => url.includes('stored.test') ? 'data:image/png;base64,STORED' : undefined;
  assert.deepEqual(chipIconSource({ picture: true, canvas: false }, { url: 'https://a.test/', favicon: 'https://a.test/f.ico' }, stored), { kind: 'shown' }, 'a picture on screen is kept');
  assert.deepEqual(chipIconSource({ picture: false, canvas: true }, { url: 'https://a.test/', favicon: 'https://a.test/f.ico' }, stored), { kind: 'favicon', src: 'https://a.test/f.ico' }, 'loading, favicon known');
  assert.deepEqual(chipIconSource({ picture: false, canvas: true }, { url: 'https://stored.test/' }, stored), { kind: 'stored', src: 'data:image/png;base64,STORED' }, 'loading, no favicon: the stored icon');
  assert.deepEqual(chipIconSource({ picture: false, canvas: true }, { url: 'https://new.test/' }, stored), { kind: 'loader' }, 'loading, nothing known: the loader');
  assert.deepEqual(chipIconSource({ picture: true, canvas: true }, { url: 'https://new.test/' }, stored), { kind: 'loader' }, 'a canvas anywhere means the copy would be blank');
  assert.deepEqual(chipIconSource({ picture: false, canvas: false }, null, null), { kind: 'loader' }, 'nothing at all: never blank');
  const surface = read('src/ui/useTabDragSurface.ts');
  assert.equal((surface.match(/fillChipIcon\(/g) ?? []).length, 2, 'both the carried chip (sidebar, pane ribbon) and the strip tab copy are filled');
  assert.match(read('src/App.tsx'), /setChipIconLookup\(\{ tab: id => state\.tabs\.find\(item => item\.id === id\), stored: storedIcon \}\)/);
  assert.match(read('src/ui/chipIcon.ts'), /preset: 'loader'/);
});

test('R5 layout card: the targeted cell is lit at once (fill and outline), and the liquid joining it takes the same accent', () => {
  const springs = liquidSprings(1), box = { left: 100, top: 100, right: 160, bottom: 140 };
  const cell = (hovered: boolean): LiquidTarget => ({ key: 'zone:0', box, radius: 3, owned: true, hovered });
  const inside = { x: 130, y: 120 };
  const lit = createSim(); simStep(lit, inside, { target: cell(true), anchor: inside, distance: 0 }, 1 / 60, springs);
  assert.equal(lit.bodies[0].hover.x, 1, 'the picker\'s target cell: full accent on the first frame');
  const easing = createSim(); simStep(easing, inside, { target: cell(false), anchor: inside, distance: 0 }, 1 / 60, springs);
  assert.ok(easing.bodies[0].hover.x > 0 && easing.bodies[0].hover.x < 1, 'a cell that is not the target eases in');
  const liquid = read('src/ui/liquidSnap.ts');
  assert.match(liquid, /b\.owned \? hover : 0\], i \* 4\)/, 'the lit amount goes to the shader');
  assert.match(liquid, /vec4 fill = mix\(zf,uChipFill,w\*\(1\.-hov\)\);/, 'a lit cell fills the neck and the chip plate with its accent');
});

test('R5 pane card: ribbon top corners take the page radius, its fill continues behind the page\'s top corners, the card\'s bottom is the page\'s; the loading line runs on the ribbon', () => {
  const css = read('src/features/split/split.css'), app = read('src/App.tsx'), ribbon = read('src/components/SplitRibbon.tsx');
  assert.match(css, /\.split-pages>\.page-pane>\.split-label\{border-radius:var\(--pane-radius,0px\) var\(--pane-radius,0px\) 0 0\}/, 'ribbon: round top, square bottom');
  assert.match(css, /\.split-pages>\.page-pane>\.split-label::after\{content:'';position:absolute;left:0;right:0;top:100%;height:var\(--pane-radius,0px\);background:inherit;/, 'the ribbon fill behind the page\'s top corners');
  assert.match(css, /\.split-pages>\.page-pane\{border-radius:var\(--pane-radius,0px\)\}/, 'the card\'s bottom corners are the page\'s');
  assert.match(app, /pageRadius: pageCardRadius\(\)/, 'the native page radius');
  assert.match(app, /'--pane-radius': `\$\{pageCardRadius\(\) \/ /, 'and the ribbon\'s, from the same value (in interface px)');
  assert.match(ribbon, /<NavigationProgress tab=\{tab\} placement="boundary" reduced=\{reducedMotion\}\/>/, 'the address bar\'s loading line, on the ribbon\'s bottom edge');
  assert.match(app, /dispatch=\{dispatch\} reducedMotion=\{s\.reducedMotion\}\/>/);
});
