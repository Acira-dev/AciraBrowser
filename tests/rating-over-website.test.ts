// R4-61 gap: the feature-rating card also appears while a website is on screen, on the native overlay's transient (toast) layer, with
// the same eligibility (never during setup, never in the first session, never while typing: page keys are checked by main).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { quietMoment, ratingCardSize, RATING_WIDTH } from '../src/features/metrics/ratingMoment';
import { ratingOnScreen, setRatingOnScreen } from '../src/features/metrics/ratingStore';

const require = createRequire(import.meta.url);
const { validateLayout, validateCommand } = require('../desktop/validation.cjs');
const { createInitialState } = require('../desktop/runtime.cjs');
const root = path.join(import.meta.dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

const web = { id: 't1', contentKind: 'web', url: 'https://example.com/', media: undefined } as never;
const settings = (onboardingComplete: boolean) => ({ onboardingComplete } as never);

test('a website on screen no longer blocks the ask; setup, private windows and playing video still do', () => {
  assert.equal(quietMoment({ tabs: [web], activeTabId: 't1', settings: settings(true) }, false), true, 'over a website is a calm moment now');
  assert.equal(quietMoment({ tabs: [web], activeTabId: 't1', settings: settings(false) }, false), false, 'never during setup');
  assert.equal(quietMoment({ tabs: [web], activeTabId: 't1', settings: settings(true) }, true), false, 'never in a private window');
  assert.equal(quietMoment({ tabs: [{ ...(web as object), media: 'playing' } as never], activeTabId: 't1', settings: settings(true) }, false), false, 'never while video plays');
});

test('main keeps "never while typing" for websites: no offer within 30 s of a key pressed in a page, and the first session rule is unchanged', () => {
  const main = read('desktop/main.cjs');
  assert.match(main, /if\(input\.type==='keyDown'\)pageKeyAt=Date\.now\(\);/, 'every page keydown is noted');
  assert.match(main, /if\(request\.type==='rating\.offer'\)return \{rating:Date\.now\(\)-pageKeyAt<30000\?null:m\.ratingOffer\(\)\};/);
  const rating = require('../desktop/browser-services/feature-rating.cjs');
  let s = rating.startSession(null, '2026-10-20'); for (let i = 0; i < 3; i++) s = rating.countUse(s, 'splitView');
  assert.equal(rating.blocker(s, { sharing: true, ask: true, today: '2026-10-27', launchedAt: 0, now: rating.RULES.quietMs }), 'first session');
});

test('the overlay carries the card on a toast layer of its own: closed feature list, phase, nothing else', () => {
  const layout = (context: object, kind = 'toast') => ({ views: [], visible: true, overlay: { id: 7, kind, bounds: { x: 900, y: 600, width: RATING_WIDTH, height: 122 }, anchor: { x: 1060, y: 738, width: 1, height: 1 }, origin: { x: 1, y: 1 }, contentHeight: 122, context } });
  const card = { feature: 'splitView', phase: 'ask', leaving: false };
  assert.deepEqual(validateLayout(layout({ rating: card })).overlay.context.rating, card);
  assert.doesNotThrow(() => validateLayout(layout({ rating: { ...card, phase: 'thanks', leaving: true } })));
  for (const bad of [{ ...card, feature: 'history' }, { ...card, phase: 'leaving' }, { ...card, leaving: 'yes' }, { ...card, stars: 4 }, { ...card, url: 'https://x' }, { feature: 'peek', phase: 'ask' }])
    assert.throws(() => validateLayout(layout({ rating: bad })), Error, JSON.stringify(bad));
  assert.throws(() => validateLayout(layout({ rating: card }, 'menu')), /transient layer/);
  assert.throws(() => validateLayout(layout({ rating: card, toasts: [{ id: 1, text: 'Saved' }] })), /transient layer/);
});

test('the overlay answers through ui actions; only a rating answer names stars, 1 to 5', () => {
  const s = createInitialState(), tabId = s.activeTabId;
  for (const action of ['rating-hold', 'rating-dismiss']) assert.doesNotThrow(() => validateCommand({ type: 'ui', tabId, action }, s));
  assert.doesNotThrow(() => validateCommand({ type: 'ui', tabId, action: 'rating-submit', stars: 4 }, s));
  for (const stars of [0, 6, 2.5, '3', undefined]) assert.throws(() => validateCommand({ type: 'ui', tabId, action: 'rating-submit', stars }, s), Error, String(stars));
  assert.throws(() => validateCommand({ type: 'ui', tabId, action: 'toast-hold', stars: 3 }, s));
  const main = read('desktop/main.cjs');
  assert.match(main, /'toast-release','rating-hold','rating-dismiss','rating-submit'\]\.includes\(c\.action\)\)closeOverlay\(true\)/, 'rating actions never close the layer themselves');
  assert.match(main, /\.\.\.\(c\.action==='rating-submit'&&Number\.isInteger\(c\.stars\)\?\{stars:c\.stars\}:\{\}\)/);
  assert.match(main, /event\.sender!==chromeView\?\.webContents\)return \{rating:null\}/, 'only the main interface may offer, show or send a rating');
});

test('the card size is known before the host paints, and the shared store only changes on a real change', () => {
  assert.deepEqual(ratingCardSize('splitView'), { width: 320, height: 122 }, 'one line: 12 + 18 + 10 + 32 + 10 + 28 + 12');
  setRatingOnScreen({ feature: 'peek', phase: 'ask', leaving: false });
  const first = ratingOnScreen(); setRatingOnScreen({ feature: 'peek', phase: 'ask', leaving: false });
  assert.equal(ratingOnScreen(), first, 'the same card is not a change (the layout is not re-sent)');
  setRatingOnScreen({ feature: 'peek', phase: 'thanks', leaving: false }); assert.equal(ratingOnScreen()?.phase, 'thanks');
  setRatingOnScreen(null); assert.equal(ratingOnScreen(), null);
});

test('the browser layout puts the card on the overlay over websites only, after popups and toasts, and the overlay draws it', () => {
  const app = read('src/App.tsx');
  assert.match(app, /if \(native && !popup && rating && rating\.feature !== ratingHidden && toastOverChrome && !setupVisible && ratingOverlayId\.current\)/);
  assert.match(app, /popup = \{ id: ratingOverlayId\.current, kind: 'toast', tabId: tab\.id, bounds, context: \{ rating: \{ feature: rating\.feature, phase: rating\.phase, leaving: rating\.leaving \} \}/);
  assert.ok(app.indexOf("context: { rating: {") > app.indexOf("kind: 'toast', tabId: tab.id, bounds, context: { toasts:"), 'toasts take the layer first');
  assert.match(app, /overlay\.kind === 'toast' && overlay\.context\?\.rating \? <RatingLayer rating=\{overlay\.context\.rating\} tabId=\{state\.activeTabId\}\/>/);
  const card = read('src/features/metrics/RatingCard.tsx'), moment = read('src/features/metrics/ratingMoment.ts');
  assert.match(card, /if \(!feature \|\| ratingOverWebsite\(state\)\) return null;/, 'drawn inline only over Acira pages');
  assert.doesNotMatch(card + moment, /return active\?\.contentKind !== 'web';/, 'the old "only over Acira pages" rule is gone from the moment check');
});
