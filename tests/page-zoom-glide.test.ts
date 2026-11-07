import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { planGlide, MAX_RATIO } from '../src/ui/pageZoomGlideMath';
import { motionTokens, springForFrequent, kick } from '../src/ui/motionTokens';

// A page the interface draws and a website glide a plus, minus or Reset step by one rule (ui/pageZoomGlideMath.ts, desktop/page-zoom-glide.cjs).
const require = createRequire(import.meta.url), main = require('../desktop/page-zoom-glide.cjs'), levels: number[] = require('../page-zoom-levels.json');
const here = path.dirname(fileURLToPath(import.meta.url)), read = (file: string) => fs.readFileSync(path.join(here, '..', file), 'utf8');

test('the interface and main plan every step, burst and reversal alike', () => {
  assert.equal(MAX_RATIO, main.MAX_RATIO);
  const fractions = levels.map(level => level / 100), scales = [1, 1.05, 1.2, 1.4, 1.59];
  let cases = 0;
  for (const layout of fractions) for (const target of [...fractions, layout * 1.03, layout * .97, layout * 1.7]) for (const scale of scales) {
    assert.deepEqual(planGlide({ layout, scale }, target), main.planGlide({ layout, scale }, target), `${layout} x${scale} -> ${target}`); cases++;
  }
  assert.ok(cases > 1500);
  for (const bad of [{ layout: 1, scale: .5 }, { layout: NaN, scale: 1 }, { layout: 0, scale: 1 }]) assert.deepEqual(planGlide(bad, 1.1), main.planGlide(bad, 1.1));
});

test('every preset step is a glide (the biggest is 33% to 50%), Reset from far away is a cut', () => {
  for (let i = 1; i < levels.length; i++) {
    for (const [from, to] of [[levels[i - 1], levels[i]], [levels[i], levels[i - 1]]]) {
      const plan = planGlide({ layout: from / 100, scale: 1 }, to / 100);
      assert.equal(plan.kind, 'glide', `${from} -> ${to}`);
      if (plan.kind === 'glide') assert.ok(plan.scale >= 1 && plan.goal >= 1 && plan.scale <= MAX_RATIO && plan.goal <= MAX_RATIO);
    }
  }
  assert.equal(planGlide({ layout: 5, scale: 1 }, 1).kind, 'cut'); assert.equal(planGlide({ layout: .25, scale: 1 }, 1).kind, 'cut');
});

test('the page.zoom token is the length main glides a website for: 205 ms Premium, 95 ms Fast, none when off', () => {
  assert.deepEqual(motionTokens['page.zoom'], ['S', main.BASE_SECONDS, 0]);
  assert.equal(springForFrequent('page.zoom', 'premium')!.duration, main.glideSeconds('premium'));
  assert.equal(springForFrequent('page.zoom', 'fast')!.duration, main.glideSeconds('fast'));
  assert.equal(springForFrequent('page.zoom', 'off'), null); assert.equal(main.glideSeconds('off'), null);
  assert.equal(main.kickFor('fast'), kick.fast); assert.equal(main.kickFor('premium'), kick.premium); assert.equal(main.kickFor('off'), kick.off);
});

test('the glide is wired in: main reads the zoom a glide is going to, the interface holds the layout of a zoom in', () => {
  const mainSource = read('desktop/main.cjs'), app = read('src/App.tsx');
  assert.match(mainSource, /require\('\.\/page-zoom-glide\.cjs'\)/);
  assert.match(mainSource, /zoomGlide\.request\(\{wc,target:zoom/);
  for (const reader of ['pageZoomNow(page)', 'pageZoomNow(wc)*100', 'pageZoomNow(entry.view.webContents)']) assert.ok(mainSource.includes(reader), reader);
  assert.equal((mainSource.match(/instant:true/g) ?? []).length, 3, 'the three wheel paths stay instant');
  assert.ok(mainSource.includes("emitBrowser({type:'page-zoom-set',tabId:tab.id,glide:!c.instant});browserEvent(tab.id,{zoom:"), 'the glide flag is sent before the new level');
  assert.match(app, /'--page-zoom': shownZoom\(t\.id, t\.zoom \/ 100\)/); assert.match(app, /installPageZoomGlide\(\)/);
  // main's own copy of the page.zoom length is in the hash of what the build is made of
  assert.ok(mainSource.includes("'page-zoom-glide.cjs'"));
});
