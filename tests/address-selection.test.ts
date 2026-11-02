import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { addressDisplayMap, alignDisplay, hitDisplay, mapDisplayChar, mapDisplaySelection, stepAddressGesture, wordAt, type AddressGesture, type AddressGestureInput } from '../src/ui/addressSelection';

// Founder bug (27 Oct): selecting text in the address bar at rest picked other characters, or everything. The at-rest
// text hides `https://` and `www.`, so a drag's offsets must be remapped into the full address the input holds.

/** The full-address text a drag over shown characters [from, to) selects. */
function picked(full: string, from: number, to: number, backward = false) {
  const map = addressDisplayMap(full)!;
  const sel = backward ? mapDisplaySelection(map, to, from) : mapDisplaySelection(map, from, to);
  return { text: full.slice(sel.start, sel.end), shown: map.text.slice(from, to), direction: sel.direction };
}

test('the shown text drops the scheme, www. and a lone slash, and maps back character for character', () => {
  const map = addressDisplayMap('https://www.example.com/')!;
  assert.equal(map.text, 'example.com');
  assert.deepEqual(map.index, [...'example.com'].map((_, i) => 12 + i));
  assert.equal(addressDisplayMap('not a url'), null);
});

test('a drag over the host selects exactly the host characters dragged over', () => {
  const full = 'https://www.example.com/docs/guide?q=1#top';
  for (const [from, to] of [[0, 7], [2, 5], [0, 11], [8, 11]]) {
    const r = picked(full, from, to);
    assert.equal(r.text, r.shown, `[${from},${to})`);
  }
});

test('a drag over the path, query and fragment selects exactly those characters, either direction', () => {
  const full = 'https://www.example.com/docs/guide?q=1#top';
  const map = addressDisplayMap(full)!;
  assert.equal(map.text, 'example.com/docs/guide?q=1#top');
  for (const [from, to] of [[11, 16], [12, 22], [22, 26], [26, 30], [5, 30]]) {
    assert.equal(picked(full, from, to).text, map.text.slice(from, to));
    const back = picked(full, from, to, true);
    assert.equal(back.text, map.text.slice(from, to));
    assert.equal(back.direction, 'backward');
  }
});

test('subdomains, ports, user info and the dropped slash before a query stay aligned', () => {
  for (const full of ['https://docs.github.com/en/get-started', 'http://localhost:5173/app', 'https://user:pw@www.example.org:8443/x', 'https://example.com/?q=1#h', 'https://www.wikipedia.org/wiki/Web', 'acira://settings/privacy']) {
    const map = addressDisplayMap(full)!;
    for (let from = 0; from < map.text.length; from += 1) {
      for (let to = from + 1; to <= map.text.length; to += 1) {
        const r = picked(full, from, to);
        // A drag that crosses a left-out character (the `/` before `?`) keeps it: the selection is contiguous.
        assert.ok(r.text === r.shown || r.text.replace('/?', '?') === r.shown, `${full} [${from},${to}): ${r.text} vs ${r.shown}`);
      }
    }
  }
  assert.equal(addressDisplayMap('https://www.wikipedia.org/')!.text, 'wikipedia.org');
  assert.deepEqual(alignDisplay('https://www.wikipedia.org/', 'wikipedia.org').slice(0, 1), [12], 'the hidden www. is skipped, not matched');
});

test('a collapsed drag maps to a caret, and offsets clamp to the text', () => {
  const map = addressDisplayMap('https://example.com/a')!;
  assert.deepEqual(mapDisplaySelection(map, 3, 3), { start: 11, end: 11, direction: 'none' });
  assert.deepEqual(mapDisplaySelection(map, -5, 99), { start: 8, end: 21, direction: 'forward' });
});

test('a shown character with no twin (decoded text) takes the gap between its neighbours', () => {
  // Not produced by today's display, but the mapping must not fall apart if the display ever decodes escapes.
  const full = 'https://example.com/caf%C3%A9/menu', shown = 'example.com/café/menu';
  const map = { text: shown, index: alignDisplay(full, shown), full };
  const all = mapDisplaySelection(map, 0, shown.length);
  assert.equal(full.slice(all.start, all.end), 'example.com/caf%C3%A9/menu');
  const word = mapDisplaySelection(map, 12, 16);
  assert.equal(full.slice(word.start, word.end), 'caf%C3%A9');
});

test('double-click words come from the full address at the mapped character', () => {
  const full = 'https://www.example.com/docs/guide';
  const map = addressDisplayMap(full)!;
  const at = mapDisplayChar(map, map.text.indexOf('guide') + 2);
  const w = wordAt(full, at);
  assert.equal(full.slice(w.start, w.end), 'guide');
  const slash = wordAt(full, mapDisplayChar(map, map.text.indexOf('/docs')));
  assert.equal(full.slice(slash.start, slash.end), '/');
});

test('the pointer picks the nearest caret and the character under it', () => {
  const edges = [10, 20, 30, 40]; // three characters
  assert.deepEqual(hitDisplay(edges, 5), { caret: 0, char: 0 });
  assert.deepEqual(hitDisplay(edges, 14), { caret: 0, char: 0 });
  assert.deepEqual(hitDisplay(edges, 16), { caret: 1, char: 0 });
  assert.deepEqual(hitDisplay(edges, 36), { caret: 3, char: 2 });
  assert.deepEqual(hitDisplay(edges, 90), { caret: 3, char: 2 });
  assert.deepEqual(hitDisplay(edges, 25, 24), { caret: 3, char: 2 }, 'past the clip edge the drag runs to the end');
  assert.deepEqual(hitDisplay([0], 5), { caret: 0, char: 0 });
});

function run(inputs: AddressGestureInput[], start: AddressGesture = { kind: 'idle' }) {
  let state = start;
  return inputs.map(input => { const step = stepAddressGesture(state, input); state = step.state; return step; });
}
const down = (o: Partial<Extract<AddressGestureInput, { type: 'down' }>> = {}): AddressGestureInput => ({ type: 'down', pointerId: 1, x: 100, y: 10, caret: 3, char: 3, button: 0, detail: 1, shift: false, time: 0, atRest: true, ...o });
const move = (x: number, caret: number): AddressGestureInput => ({ type: 'move', pointerId: 1, x, y: 10, caret });
const up = (x: number, caret: number, time = 50): AddressGestureInput => ({ type: 'up', pointerId: 1, x, y: 10, caret, time });

test('gesture: a plain click on the field at rest holds the press, then selects the whole address', () => {
  const steps = run([down(), move(101, 3), up(101, 3)]);
  assert.deepEqual(steps.map(s => s.effect.type), ['hold', 'none', 'select-all']);
  assert.equal(steps[2].state.kind, 'clicked');
});

test('gesture: a press-and-drag paints the dragged characters and selects exactly them on release', () => {
  const steps = run([down({ caret: 2 }), move(120, 5), move(160, 9), up(160, 9)]);
  assert.deepEqual(steps.map(s => s.effect.type), ['hold', 'paint', 'paint', 'select-range']);
  assert.deepEqual(steps[3].effect, { type: 'select-range', anchor: 2, focus: 9 });
  const back = run([down({ caret: 9, x: 160 }), move(100, 2), up(100, 2)]);
  assert.deepEqual(back[2].effect, { type: 'select-range', anchor: 9, focus: 2 });
});

test('gesture: double-click selects the word under the first press, triple-click selects all', () => {
  const steps = run([down({ char: 7 }), up(100, 3, 40), down({ atRest: false, detail: 2, time: 200, char: 30 }), up(100, 3, 260), down({ atRest: false, detail: 3, time: 400 })]);
  assert.deepEqual(steps.map(s => s.effect.type), ['hold', 'select-all', 'select-word', 'none', 'select-all']);
  assert.deepEqual(steps[2].effect, { type: 'select-word', char: 7 }, 'the word under the first press, not under the moved text');
});

test('gesture: shift+click on the field at rest selects from the start to the pointer', () => {
  const steps = run([down({ shift: true, caret: 6 }), up(100, 6)]);
  assert.deepEqual(steps[0].effect, { type: 'hold', anchor: 0, focus: 6 });
  assert.deepEqual(steps[1].effect, { type: 'select-range', anchor: 0, focus: 6 });
});

test('gesture: presses on a focused field, other buttons and stale double-clicks are left to the browser', () => {
  assert.equal(run([down({ atRest: false })])[0].effect.type, 'native', 'drag when already focused is untouched');
  assert.equal(run([down({ button: 2 })])[0].effect.type, 'native');
  const clicked: AddressGesture = { kind: 'clicked', x: 100, y: 10, char: 3, time: 0 };
  assert.equal(run([down({ atRest: false, detail: 2, time: 5000 })], clicked)[0].effect.type, 'native', 'too late');
  assert.equal(run([down({ atRest: false, detail: 2, x: 200 })], clicked)[0].effect.type, 'native', 'too far');
  assert.equal(run([down({ atRest: false, detail: 1 })], clicked)[0].effect.type, 'native', 'a fresh single click');
  assert.equal(run([down({ atRest: false, detail: 2, shift: true })], clicked)[0].effect.type, 'native');
});

test('gesture: a cancelled press expands the field; other pointers and reset are ignored', () => {
  assert.deepEqual(run([down(), { type: 'cancel', pointerId: 1 }])[1].effect, { type: 'select-all' });
  const other = run([down(), { type: 'move', pointerId: 2, x: 300, y: 10, caret: 9 }, { type: 'up', pointerId: 2, x: 300, y: 10, caret: 9, time: 1 }]);
  assert.deepEqual(other.slice(1).map(s => s.effect.type), ['none', 'none']);
  assert.deepEqual(run([down(), { type: 'reset' }])[1].state, { kind: 'idle' });
});

test('the address field keeps the at-rest text through a press and routes pointer input through the gesture machine', () => {
  const source = fs.readFileSync(new URL('../src/components/AddressField.tsx', import.meta.url), 'utf8');
  assert.match(source, /stepAddressGesture/);
  assert.match(source, /setPointerCapture/);
  assert.match(source, /mapDisplaySelection/);
  assert.match(source, /CSS\?\.highlights/);
});

test('the toolbar field names itself and its placeholder in the interface language', () => {
  // QA sweep 27 Oct: App.tsx passes neither, and the English defaults showed in every language.
  const source = fs.readFileSync(new URL('../src/components/AddressField.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /'Search or enter address'|'Address and search'/);
  assert.match(source, /placeholder=t\('addressfield\.placeholder'\),label=t\('addressfield\.label'\)/);
  for (const code of ['ar', 'de', 'en', 'es', 'fr', 'hi', 'it', 'ja', 'ko', 'pt-BR', 'ru', 'tr', 'zh-CN']) {
    const catalog = JSON.parse(fs.readFileSync(new URL(`../src/i18n/${code}.json`, import.meta.url), 'utf8'));
    assert.ok(catalog['addressfield.placeholder'] && catalog['addressfield.label'], code);
  }
});
