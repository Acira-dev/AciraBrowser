// 13.10 rounds 3 + 4 (laptop traces, Windows and Linux): while a Seamless float is out the interface asked main for the Full-view page rectangle {x0,y72,W,H-72} with motion 'slide' (the pane stayed at the
// resting {6,6,W-12,H-12}) and the page really moved there. Round 3 held "the last layout sent at rest"; on the laptop that memory was the START-UP layout (a window never activated since launch: no rest layout
// came after the Seamless entry, the toolbar was still asked for; Linux: the same on every reveal). The card is the pane's own rectangle, which the DOM keeps in place: it is what is sent when nothing better is
// known (src/ui/floatHold.ts). Each test below fails on the floatHold before this change.
import test from 'node:test';
import assert from 'node:assert/strict';
import { placeFloat, restFrom, type FloatLayoutInput, type RestSent } from '../src/ui/floatHold';

const rest = { x: 6, y: 6, width: 1440, height: 911 }, card = { x: 6, y: 6, width: 1428, height: 911 }, full = { x: 0, y: 72, width: 1440, height: 851 };
const base: FloatLayoutInput = { floating: false, seamless: true, edgeTransition: false, flags: { side: false, top: false }, pinned: false, split: false, morph: false, pageBounds: rest, views: [{ tabId: 'a', bounds: card }], measuredView: card, viewport: { width: 1440, height: 923 } };
const remember = (input: FloatLayoutInput) => restFrom(input) as RestSent;
const during = (extra: Partial<FloatLayoutInput> = {}): FloatLayoutInput => ({ ...base, floating: true, flags: { side: true, top: false }, pageBounds: full, ...extra });

test('a Seamless window at rest remembers the layout it sent (the card at the window\'s edge, held by the page rectangle)', () => {
  const remembered = restFrom(base);
  assert.ok(remembered && remembered !== 'forget');
  assert.deepEqual(remembered.pageBounds, rest);
  assert.deepEqual(remembered.views.get('a'), card);
});

test('what is not a rest is not remembered: a float out, the edge transition running, an edge floating, a split, a morph, a pinned edge, a page rectangle that starts below the card', () => {
  for (const change of [{ floating: true }, { edgeTransition: true }, { flags: { side: true, top: false } }, { flags: { side: false, top: true } }, { split: true }, { morph: true }, { pinned: true }, { pageBounds: full }, { views: [] }, { viewport: undefined }, { measuredView: undefined }] as Partial<FloatLayoutInput>[]) {
    const out = restFrom({ ...base, ...change });
    assert.equal(out === null || out === 'forget', true, JSON.stringify(change));
  }
});

test('the START-UP layout is no Seamless rest (round 4): the Full view sits at y=72 for its page and its pane alike, so "the page starts where its view starts" was true of it', () => {
  const startup: FloatLayoutInput = { ...base, pageBounds: full, views: [{ tabId: 'a', bounds: full }], measuredView: full };
  assert.equal(restFrom(startup), null);
  // nor is a half-played entry glide ({6,36,..}, the toolbar's row on its way out)
  const glide = { x: 6, y: 36, width: 1428, height: 881 };
  assert.equal(restFrom({ ...base, pageBounds: glide, views: [{ tabId: 'a', bounds: glide }], measuredView: glide }), null);
});

test('the Seamless entry\'s own layout, sent inside the entry\'s view transition, IS the rest: nothing else is sent in a window never activated, and the float had no memory at all (round 4)', () => {
  // (round 3 refused every layout inside ANY view transition (`inTransition`), and no layout came after the entry's: the input of a render inside the entry's transition, not the edge's)
  const insideEntry = { ...base, inTransition: true, edgeTransition: false } as unknown as FloatLayoutInput;
  const remembered = restFrom(insideEntry);
  assert.ok(remembered && remembered !== 'forget');
  assert.deepEqual(remembered.pageBounds, rest);
});

test('a window that is plainly not Seamless at rest forgets what it remembered, but not in the middle of a float', () => {
  assert.equal(restFrom({ ...base, seamless: false }), 'forget');
  assert.equal(restFrom({ ...base, seamless: false, floating: true }), null, 'a render that takes the window for Full view must not erase the memory');
});

test('the trace, Windows: a window never activated, NO rest ever sent after the entry; the first reveal measures the Full-view rectangle (50 ms in, before the picture float is up): the card goes', () => {
  const early = during({ floating: false, pageBounds: { x: 0, y: 72, width: 1280, height: 608 }, views: [{ tabId: 'a', bounds: { x: 6, y: 6, width: 1268, height: 668 } }], measuredView: { x: 6, y: 6, width: 1268, height: 668 }, viewport: { width: 1280, height: 680 } });
  const placed = placeFloat(early, null);
  assert.equal(placed?.kind, 'card');
  assert.deepEqual(placed?.pageBounds, { x: 6, y: 6, width: 1268, height: 668 }, 'never {0,72,..} during a reveal');
  assert.deepEqual(placed?.views[0].bounds, { x: 6, y: 6, width: 1268, height: 668 });
});

test('the trace, Linux: no rest layout is ever sent, every reveal measures {0,72,1440,851} (the toolbar\'s row above the page area), the pane stays at {6,6,1428,911}', () => {
  for (const extra of [{ floating: true }, { floating: false }, { flags: { side: false, top: true } }, { edgeTransition: true, floating: false }] as Partial<FloatLayoutInput>[]) {
    const placed = placeFloat(during(extra), null);
    assert.equal(placed?.kind, 'card', JSON.stringify(extra));
    assert.deepEqual(placed?.pageBounds, card);
  }
});

test('a Full-view rest in the memory (what the start-up layout left there) is not held: the float sends the card, not {0,72,..}', () => {
  const stale: RestSent = { pageBounds: full, views: new Map([['a', full]]), width: 1440, height: 923 };
  const placed = placeFloat(during(), stale);
  assert.equal(placed?.kind, 'card');
  assert.deepEqual(placed?.pageBounds, card);
});

test('a Seamless rest in the memory is held for the whole float, with the pane where it was (the rest\'s own width, as the 13.9 rest sent it)', () => {
  const remembered = remember(base);
  const placed = placeFloat(during(), remembered);
  assert.equal(placed?.kind, 'rest');
  assert.deepEqual(placed?.pageBounds, rest);
  assert.deepEqual(placed?.views[0].bounds, card);
  // also from a render that takes the window for Full view, and for the toolbar's float
  assert.deepEqual(placeFloat(during({ flags: { side: false, top: true } }), remembered)?.pageBounds, rest);
});

test('the toolbar shown for any other reason (the address field holds the focus, nothing ever blurs it in a window never activated) does not push the page down either', () => {
  const placed = placeFloat({ ...base, flags: { side: false, top: true }, pageBounds: full }, null);
  assert.equal(placed?.kind, 'card');
  assert.deepEqual(placed?.pageBounds, card);
});

test('nothing odd and nothing remembered: the layout goes as measured (today\'s behaviour is untouched)', () => {
  assert.equal(placeFloat(during({ pageBounds: rest }), null), null);
  assert.equal(placeFloat({ ...base, pageBounds: rest }, null), null, 'no float, no edge: never touched');
  assert.equal(placeFloat({ ...base, pageBounds: rest }, remember(base)), null, 'at rest the remembered rest is not imposed: only a float holds it');
  // but a page rectangle that does not hold its pane is never sent, float or not (the page area is the window onto the pane)
  const lower = placeFloat({ ...base, pageBounds: full }, null);
  assert.equal(lower?.kind, 'card');
  assert.deepEqual(lower?.pageBounds, card);
});

test('nothing is placed when nothing can be said: not Seamless, a split, a morph, a pinned edge, no pane measured, another window size (then the card, not the old rest)', () => {
  const remembered = remember(base);
  assert.equal(placeFloat(during({ seamless: false }), remembered), null);
  assert.equal(placeFloat(during({ split: true }), remembered), null);
  assert.equal(placeFloat(during({ morph: true }), remembered), null);
  assert.equal(placeFloat(during({ pinned: true }), remembered), null, 'a pinned sidebar docks the page as before');
  assert.equal(placeFloat(during({ measuredView: undefined }), remembered), null);
  assert.equal(placeFloat(during({ views: [] }), remembered), null);
  const resized = placeFloat(during({ viewport: { width: 1200, height: 923 } }), remembered);
  assert.equal(resized?.kind, 'card', 'another window size: the old rest is not held');
});

// D128 (22 Nov, 14.1): a tab CHOSEN WHILE THE FLOAT WAS OUT (a Favorite's tile, a row, a New Tab shortcut) is laid out only with a float flag, no layout at rest follows the hide, so the memory holds the page
// that was on screen before it and nothing for the chosen one. The pane's own rectangle during a float is BESIDE the sidebar ({240,6,..} in the log): `placeFloat` used to answer nothing for the unknown page and
// the page was laid out beside the sidebar at the choosing click and at every reveal after it (resizes 2 / 3 per reveal and hide; Favorite and normal tab alike).
const beside = { x: 246, y: 6, width: 1182, height: 911 };   // the pane's rectangle while a 240 sidebar floats over it (measured: the page area is the window onto it)
const chosen = (extra: Partial<FloatLayoutInput> = {}): FloatLayoutInput => ({ ...base, floating: true, flags: { side: true, top: false }, pageBounds: rest, views: [{ tabId: 'b', bounds: beside }], measuredView: beside, ...extra });

test('D128: a page chosen while the float was out (no rest of its own) takes the place the remembered page rested in, at the choosing click and at every reveal after it', () => {
  const remembered = remember(base);
  assert.equal(remembered.views.has('b'), false);
  for (const extra of [{}, { floating: false, edgeTransition: true }, { flags: { side: false, top: true }, floating: false }, { floating: false, flags: { side: true, top: false } }] as Partial<FloatLayoutInput>[]) {
    const placed = placeFloat(chosen(extra), remembered);
    assert.equal(placed?.kind, 'rest', JSON.stringify(extra));
    assert.deepEqual(placed?.pageBounds, rest);
    assert.deepEqual(placed?.views[0].bounds, card, 'the remembered page\'s own place, never the pane beside the sidebar');
    assert.equal(placed?.views[0].tabId, 'b');
  }
});

test('D128: the page the memory knows is placed exactly as before (its own place, the rest\'s view)', () => {
  const remembered = remember(base);
  const own = placeFloat(chosen({ views: [{ tabId: 'a', bounds: beside }] }), remembered);
  assert.equal(own?.kind, 'rest');
  assert.deepEqual(own?.views[0].bounds, remembered.views.get('a'));
  // a memory made of two different places: the page that is in it gets its own, the page that is not gets nothing guessed
  const two: RestSent = { ...remembered, views: new Map([['a', card], ['c', { ...card, width: 700 }]]) };
  assert.deepEqual(placeFloat(chosen({ views: [{ tabId: 'c', bounds: beside }] }), two)?.views[0].bounds, { ...card, width: 700 });
  assert.equal(placeFloat(chosen(), two)?.kind === 'rest', false, 'a memory of several pages says nothing about a page it does not hold');
});

test('D128: nothing else changes for a page chosen under the float: at rest the rest is not imposed, a split / morph / pinned edge / another window size still answer as before', () => {
  const remembered = remember(base);
  assert.equal(placeFloat(chosen({ floating: false, flags: { side: false, top: false }, edgeTransition: false, pageBounds: rest }), remembered), null, 'no float, no edge: never touched');
  assert.equal(placeFloat(chosen({ split: true }), remembered), null);
  assert.equal(placeFloat(chosen({ morph: true }), remembered), null);
  assert.equal(placeFloat(chosen({ pinned: true }), remembered), null);
  assert.equal(placeFloat(chosen({ measuredView: undefined }), remembered), null);
  assert.equal(placeFloat(chosen({ seamless: false }), remembered), null);
  assert.equal(placeFloat(chosen({ views: [{ tabId: 'b', bounds: beside }, { tabId: 'c', bounds: beside }] }), remembered), null);
});

test('D128 + window resized while the float is out, then a tile click: another window size is not held for the new page either (the card, not a stale rest)', () => {
  const remembered = remember(base);
  const placed = placeFloat(chosen({ viewport: { width: 1480, height: 923 }, pageBounds: { x: 6, y: 6, width: 1480, height: 911 } }), remembered);
  assert.notEqual(placed?.kind, 'rest');
  assert.notDeepEqual(placed?.views[0].bounds, card, 'never the old size\'s place');
  assert.deepEqual(placeFloat(chosen({ viewport: { width: 1480, height: 923 }, pageBounds: full }), remembered)?.views[0].bounds, beside, 'what the card is while the float is out (the DOM\'s own pane), as for any page in another window size');
});

test('D128 + round 4 for a page the memory does not know: a Full-view rest (the start-up layout) is not held, nor is an empty memory, nor a toolbar-pushed page rectangle', () => {
  const stale: RestSent = { pageBounds: full, views: new Map([['a', full]]), width: 1440, height: 923 };
  const fromStale = placeFloat(chosen({ pageBounds: full }), stale);
  assert.equal(fromStale?.kind, 'card');
  assert.deepEqual(fromStale?.views[0].bounds, beside, 'the pane\'s own rectangle, never {0,72,..}');
  assert.equal(placeFloat(chosen({ pageBounds: rest }), null), null, 'no memory at all: the layout goes as measured, as in 14.1');
  const early = placeFloat(chosen({ floating: false, flags: { side: false, top: true }, pageBounds: full }), null);
  assert.equal(early?.kind, 'card');
  assert.deepEqual(early?.pageBounds, beside);
});
