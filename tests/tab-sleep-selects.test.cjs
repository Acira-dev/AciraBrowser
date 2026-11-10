'use strict';
// 13.5 (lower memory use): a drop-down whose value the PAGE's own script set (docs.python.org's version and language pickers) used to read as "the person edited a form", so
// the tab never slept (about 43 MB each). Now only a drop-down the person touched keeps a tab awake. This file: the page check with a fake DOM, the page preload's recorder with
// fake events, inspectLive with a fake page (every doubt keeps the tab awake), the wiring in main.cjs, and the real thing in a real Electron (tests/fixtures/tab-sleep-selects/run.cjs:
// the real preload, the browser's own trusted input events through the DevTools protocol, the real inspectLive).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), {spawnSync} = require('node:child_process');
const {inspectPage, sleepProbe, inspectLive, SELECT_WORLD, SELECT_RECORD} = require('../desktop/tab-sleep.cjs');

// ---------------------------------------------------------------- the page check, fake DOM
const option = (index, {selected = false, defaultSelected = false} = {}) => ({index, selected, defaultSelected});
const select = (options, over = {}) => ({tagName: 'SELECT', multiple: false, options, ...over});
const input = over => ({tagName: 'INPUT', type: 'text', value: '', hasAttribute: () => false, getAttribute: () => null, ...over});
function run(controls, argument, extra = {}) {
  const saved = {document: globalThis.document, MediaStream: globalThis.MediaStream}; globalThis.MediaStream = class {};
  globalThis.document = {designMode: 'off', querySelectorAll: selector => selector === 'input,textarea,select' ? controls : selector === 'audio,video' ? (extra.media || []) : [], querySelector: () => null, getElementsByTagName: () => ({length: 10}),
    createElement: () => { const attrs = {}; return {setAttribute: (k, v) => { attrs[k] = v; }, get value() { return attrs.value ?? ''; }}; }};
  try { return inspectPage(argument); } finally { globalThis.document = saved.document; if (saved.MediaStream === undefined) delete globalThis.MediaStream; else globalThis.MediaStream = saved.MediaStream; }
}
const untouched = select([option(0, {defaultSelected: false, selected: true}), option(1), option(2)]);                       // first option is the default
const scriptSet = select([option(0), option(1), option(2, {selected: true})]);                                              // value != default
const multiple = select([option(0), option(1, {selected: true}), option(2, {selected: true})], {multiple: true});

test('page check: a drop-down at its default is no edit; one that differs is an edit and says it is a select', () => {
  assert.deepEqual(run([untouched]), {safe: true});
  assert.deepEqual(run([scriptSet]), {safe: false, reason: 'edited-form', select: true});
  assert.deepEqual(run([scriptSet], false), {safe: false, reason: 'edited-form', select: true}, 'false is the 13.4 behaviour');
  assert.deepEqual(run([multiple]), {safe: false, reason: 'edited-form', select: true}, 'a multi-select with a changed choice is an edit too');
  assert.deepEqual(run([select([option(0, {selected: true, defaultSelected: true}), option(1)])]), {safe: true}, 'a default set in the page source');
  assert.deepEqual(run([select([])]), {safe: true}, 'an empty drop-down');
});

test('page check: skipSelects leaves drop-downs out and nothing else', () => {
  assert.deepEqual(run([scriptSet, multiple], true), {safe: true});
  assert.equal(run([scriptSet, input({value: 'typed'})], true).reason, 'edited-form', 'a typed text box still counts');
  assert.equal(run([scriptSet, input({value: 'typed'})], true).select, undefined, 'and is not reported as a drop-down');
  assert.equal(run([scriptSet, {tagName: 'TEXTAREA', value: 'draft', defaultValue: ''}], true).reason, 'edited-form');
  assert.equal(run([scriptSet, input({type: 'password', value: 'secret'})], true).reason, 'credential-or-file-input');
  assert.equal(run([scriptSet, input({type: 'checkbox', checked: true, defaultChecked: false})], true).reason, 'edited-form');
  assert.equal(run([scriptSet], true, {media: [{tagName: 'VIDEO', paused: false, ended: false, loop: false, muted: false, volume: 1}]}).reason, 'playing-media-or-live-stream');
  assert.equal(run([scriptSet], undefined).select, true, 'no argument = today\'s behaviour');
  assert.equal(run([scriptSet], 'yes').select, true, 'only the boolean true skips');
});

test('page check: a drop-down that comes BEFORE a typed text box does not hide it (the check goes on without the selects)', () => {
  const controls = [scriptSet, input({value: 'typed'})];
  assert.deepEqual(run(controls), {safe: false, reason: 'edited-form', select: true}, 'first pass stops at the drop-down');
  assert.deepEqual(run(controls, true), {safe: false, reason: 'edited-form'}, 'second pass finds the text');
});

test('the probe string runs inspectPage with the argument and keeps the picture-in-picture and PDF checks', () => {
  for (const [argument, text] of [[undefined, 'false'], [false, 'false'], [true, 'true']]) {
    const probe = sleepProbe(argument);
    assert.ok(probe.includes(inspectPage.toString()) && probe.trimEnd().endsWith(`)(${text});})()`), String(argument));
    assert.ok(probe.includes('pictureInPictureElement') && probe.includes("'application/pdf'"));
    assert.doesNotThrow(() => new vm.Script(probe));
  }
});

// ---------------------------------------------------------------- inspectLive with a fake page
/** A fake webContents. record: what the isolated world answers ('throw' | 'hang' | a value). first / second: the answers of the two probes. */
function fakePage({record, first = {safe: true}, second = {safe: true}, firstThrows = false} = {}) {
  const calls = {isolated: [], main: []};
  return {calls, executeJavaScript(code) {
    calls.main.push(code);
    if (calls.main.length === 1) return firstThrows ? Promise.reject(new Error('page is gone')) : Promise.resolve(first);
    return Promise.resolve(second);
  }, executeJavaScriptInIsolatedWorld(world, scripts) {
    calls.isolated.push([world, scripts]);
    const answer = Array.isArray(record) && record.length && record.every(item => item && typeof item === 'object' && 'answers' in item) ? record[0].answers[Math.min(calls.isolated.length - 1, record[0].answers.length - 1)] : record;
    if (answer === 'throw') return Promise.reject(new Error('no such world'));
    if (answer === 'hang') return new Promise(() => {});
    if (answer === 'sync-throw') throw new Error('destroyed');
    return Promise.resolve(answer);
  }};
}
const selectFinding = {safe: false, reason: 'edited-form', select: true};

test('inspectLive: the record is read from the preload\'s world and a drop-down nobody touched does not hold the tab', async () => {
  const page = fakePage({record: {touched: false, nav: 'navigate'}, first: selectFinding, second: {safe: true}});
  assert.deepEqual(await inspectLive(page), {safe: true});
  assert.equal(page.calls.isolated.length, 2, 'read after the first pass found a drop-down, and again alongside the second pass'); assert.equal(page.calls.isolated[0][0], SELECT_WORLD); assert.equal(SELECT_WORLD, 999);
  assert.equal(page.calls.isolated[0][0 + 1][0].code, SELECT_RECORD);
  assert.equal(page.calls.main.length, 2); assert.ok(page.calls.main[0].trimEnd().endsWith('(false);})()') && page.calls.main[1].trimEnd().endsWith('(true);})()'), 'second pass skips the selects');
});

test('inspectLive: the record is read again with the second pass; a document that is not trusted by then (replaced, touched) keeps the drop-down answer', async () => {
  const trusted = {touched: false, nav: 'navigate'};
  for (const second of [{touched: true, nav: 'navigate'}, {touched: false, nav: 'back_forward'}, {touched: false, nav: 'reload'}, null, 'throw', 'hang', {touched: 'no'}]) {
    const page = fakePage({record: [{answers: [trusted, second]}], first: selectFinding, second: {safe: true}});
    assert.deepEqual(await inspectLive(page, 80), selectFinding, JSON.stringify(second)); assert.equal(page.calls.main.length, 2);
  }
  const fine = fakePage({record: [{answers: [trusted, trusted]}], first: selectFinding, second: {safe: true}}); assert.deepEqual(await inspectLive(fine), {safe: true});
  const failing = fakePage({record: {touched: false, nav: 'navigate'}, first: selectFinding}); failing.executeJavaScript = (() => { let n = 0; return () => ++n === 1 ? Promise.resolve(selectFinding) : Promise.reject(new Error('navigated away')); })();
  await assert.rejects(inspectLive(failing), /navigated/);
});

test('inspectLive: whatever else is wrong with the page is still found after the selects are set aside', async () => {
  for (const second of [{safe: false, reason: 'edited-form'}, {safe: false, reason: 'credential-or-file-input'}, {safe: false, reason: 'editable-or-canvas-content'}, {safe: false, reason: 'playing-media-or-live-stream'}, {safe: false, reason: 'pdf'}])
    assert.deepEqual(await inspectLive(fakePage({record: {touched: false, nav: 'navigate'}, first: selectFinding, second})), second);
});

test('inspectLive: only an ordinary navigation is trusted; Back, reload and unknown kinds keep the 13.4 rule, except the page Acira restored itself on waking the tab', async () => {
  for (const [nav, appRestored, sleeps] of [['navigate', false, true], ['navigate', true, true], ['back_forward', false, false], ['back_forward', true, true], ['reload', false, false], ['reload', true, false], ['prerender', true, false], ['', true, false], [undefined, true, false]]) {
    const page = fakePage({record: {touched: false, nav}, first: selectFinding, second: {safe: true}});
    assert.deepEqual(await inspectLive(page, 1500, appRestored), sleeps ? {safe: true} : selectFinding, `${nav} restored=${appRestored}`);
  }
  const touched = fakePage({record: {touched: true, nav: 'back_forward'}, first: selectFinding}); assert.deepEqual(await inspectLive(touched, 1500, true), selectFinding, 'a touch always wins');
  const flag = fakePage({record: {touched: false, nav: 'back_forward'}, first: selectFinding, second: {safe: true}}); assert.deepEqual(await inspectLive(flag, 1500, 'yes'), selectFinding, 'only the boolean true says Acira restored it');
});

test('inspectLive: a drop-down the person touched keeps the tab awake (the answer of 13.4, no second pass)', async () => {
  const page = fakePage({record: {touched: true}, first: selectFinding});
  assert.deepEqual(await inspectLive(page), selectFinding); assert.equal(page.calls.main.length, 1);
});

test('inspectLive: every doubt about the record keeps the tab awake exactly as in 13.4', async () => {
  for (const record of [null, undefined, {}, {touched: 'false'}, {touched: 0}, {touched: null}, 'false', false, 0, [], {touched: undefined}, 'throw', 'sync-throw']) {
    const page = fakePage({record, first: selectFinding});
    assert.deepEqual(await inspectLive(page), selectFinding, `record ${JSON.stringify(record)}`); assert.equal(page.calls.main.length, 1);
  }
  const slow = fakePage({record: 'hang', first: selectFinding});
  assert.deepEqual(await inspectLive(slow, 60), selectFinding, 'a world that never answers');
  const noWorld = fakePage({first: selectFinding}); delete noWorld.executeJavaScriptInIsolatedWorld;
  assert.deepEqual(await inspectLive(noWorld), selectFinding, 'an object without the call');
});

test('inspectLive: no drop-down finding, no second pass, no read of the record and no change of answer', async () => {
  for (const first of [{safe: true}, {safe: false, reason: 'edited-form'}, {safe: false, reason: 'pdf'}, {safe: false, reason: 'picture-in-picture'}, {safe: false, reason: 'page-too-large'}, {safe: false, reason: 'edited-form', select: false}, null]) {
    const page = fakePage({record: {touched: false, nav: 'navigate'}, first});
    assert.deepEqual(await inspectLive(page), first); assert.equal(page.calls.main.length, 1); assert.equal(page.calls.isolated.length, 0, 'a page without a drop-down finding never touches the isolated world');
  }
});

test('inspectLive: a page that does not answer rejects (the tab stays awake: inspection-failed), as before', async () => {
  await assert.rejects(inspectLive(fakePage({record: {touched: false, nav: 'navigate'}, firstThrows: true})), /gone/);
  await assert.rejects(inspectLive({executeJavaScript: () => new Promise(() => {}), executeJavaScriptInIsolatedWorld: () => Promise.resolve({touched: false, nav: 'navigate'})}, 40), /slow/);
  await assert.rejects(inspectLive({executeJavaScript() { throw new Error('Object has been destroyed'); }}), /destroyed/);
  // the second pass can fail too
  const page = fakePage({record: {touched: false, nav: 'navigate'}, first: selectFinding}); page.executeJavaScript = (() => { let n = 0; return () => ++n === 1 ? Promise.resolve(selectFinding) : Promise.reject(new Error('navigated away')); })();
  await assert.rejects(inspectLive(page), /navigated/);
});

test('inspectLive: no unhandled rejection from a record that fails after the first pass already failed', async () => {
  const seen = []; const listener = error => seen.push(error); process.on('unhandledRejection', listener);
  try {
    await assert.rejects(inspectLive({executeJavaScript: () => Promise.reject(new Error('gone')), executeJavaScriptInIsolatedWorld: () => Promise.reject(new Error('world gone'))}));
    await new Promise(resolve => setTimeout(resolve, 30));
  } finally { process.off('unhandledRejection', listener); }
  assert.deepEqual(seen, []);
});

// ---------------------------------------------------------------- the preload's recorder, fake events
function loadRecorder({isMainFrame = true, navigation = 'navigate', selects = [], document: fakeDocument} = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'page-input-preload.cjs'), 'utf8');
  const start = source.indexOf('if(process.isMainFrame){'), end = source.indexOf('// No API is exposed to websites.');
  assert.ok(start > 0 && end > start, 'the recorder sits at the top of the preload');
  const listeners = [], window = {addEventListener: (type, fn, options) => listeners.push({type, fn, options})};
  vm.runInNewContext(source.slice(start, end), {process: {isMainFrame}, window, document: fakeDocument || {querySelectorAll: () => selects}, performance: {getEntriesByType: () => navigation === null ? [] : [{type: navigation}]}});
  return {window, listeners, fire: (type, event) => listeners.filter(l => l.type === type).forEach(l => l.fn({type, ...event}))};
}
const dom = (tagName, parent = null) => { const node = {tagName, parentNode: parent, closest(selector) { let at = node; while (at) { if (at.tagName.toLowerCase() === selector) return at; at = at.parentNode; } return null; }}; return node; };
const trusted = (target, over = {}) => ({isTrusted: true, target, composedPath: () => [target], ...over});

test('recorder: starts untouched, registers capturing passive listeners first, exposes one record', () => {
  const {window, listeners} = loadRecorder();
  assert.deepEqual({...window.__aciraSelectRecord}, {v: 1, touched: false, nav: 'navigate', baseline: false});
  assert.deepEqual([...new Set(listeners.map(l => l.type))].sort(), ['change', 'click', 'input', 'keydown', 'mousedown', 'pointerdown']);
  assert.ok(listeners.every(l => l.options.capture === true && l.options.passive === true));
});

test('recorder: a trusted change, input, key, pointer or click on a select (or inside one) is a touch', () => {
  const sel = dom('SELECT'), opt = dom('OPTION', dom('OPTGROUP', sel)), custom = dom('BUTTON', sel);
  for (const type of ['change', 'input', 'pointerdown', 'mousedown', 'click', 'keydown'])
    for (const target of [sel, opt, custom]) { const r = loadRecorder(); r.fire(type, trusted(target)); assert.equal(r.window.__aciraSelectRecord.touched, true, `${type} on ${target.tagName}`); }
});

test('recorder: a page\'s own events, other elements and the page itself are not a touch', () => {
  const sel = dom('SELECT'), div = dom('DIV'), inp = dom('INPUT'), form = dom('FORM');
  const r = loadRecorder();
  for (const type of ['change', 'input', 'pointerdown', 'mousedown', 'click', 'keydown']) {
    r.fire(type, {...trusted(sel), isTrusted: false});                    // dispatchEvent, element.click(): never trusted
    r.fire(type, trusted(div)); r.fire(type, trusted(inp)); r.fire(type, trusted(form)); r.fire(type, trusted(null)); r.fire(type, {isTrusted: true, target: {}}); r.fire(type, trusted(dom('OPTION', dom('DATALIST'))));
  }
  assert.equal(r.window.__aciraSelectRecord.touched, false);
  r.fire('keydown', trusted(sel)); assert.equal(r.window.__aciraSelectRecord.touched, true, 'and the first real touch still counts afterwards');
});

test('recorder: a select inside a shadow root is seen through the composed path; a closed root shows only its host', () => {
  const r = loadRecorder(), inner = dom('SELECT'), host = dom('DIV');
  r.fire('input', {isTrusted: true, target: host, composedPath: () => [inner, host]}); assert.equal(r.window.__aciraSelectRecord.touched, true);
  const closed = loadRecorder(); closed.fire('input', {isTrusted: true, target: host, composedPath: () => [host]}); assert.equal(closed.window.__aciraSelectRecord.touched, false);
});

// a select as the recorder sees it: chosen option(s)
const chooser = (selected = 0, multiple = false) => { const select = {tagName: 'SELECT', multiple, selectedIndex: multiple ? selected[0] ?? -1 : selected, selectedOptions: multiple ? selected.map(index => ({index})) : [], closest(selector) { return selector === 'select' ? select : null; }}; return select; };
const press = (target = dom('DIV')) => trusted(target);

test('recorder: a custom drop-down (a hidden native select its widget sets after the person clicked the widget) is a touch; the page\'s own earlier script is not', () => {
  const hidden = chooser(1);                                   // the page set it to the second option before anybody pressed anything
  const r = loadRecorder({selects: [hidden]});
  assert.equal(r.window.__aciraSelectRecord.touched, false, 'nothing pressed yet');
  r.fire('pointerdown', press()); r.fire('mousedown', press()); r.fire('click', press());
  assert.equal(r.window.__aciraSelectRecord.touched, false, 'the person pressed something: the select is where the page left it');
  hidden.selectedIndex = 2;                                    // the widget's script sets the hidden select after the click
  assert.equal(r.window.__aciraSelectRecord.touched, true, 'the chosen option moved after the first press');
  hidden.selectedIndex = 1;                                    // and back
  assert.equal(r.window.__aciraSelectRecord.touched, false, 'back where it was when the person first pressed: nothing of theirs is in it');
});

test('recorder: what is compared is the state at the person\'s FIRST trusted press, read before the page\'s handlers; untrusted presses and other events set no baseline', () => {
  const select = chooser(0), r = loadRecorder({selects: [select]});
  r.fire('click', {...press(), isTrusted: false}); select.selectedIndex = 3;       // a script's own click, then its own change
  assert.equal(r.window.__aciraSelectRecord.touched, false, 'no baseline from an untrusted press: nothing to compare');
  r.fire('input', press(dom('INPUT')));                                              // a trusted input event is not a press
  select.selectedIndex = 1; assert.equal(r.window.__aciraSelectRecord.touched, false);
  r.fire('keydown', press(dom('INPUT')));                                            // the first trusted key: the baseline is 1 now
  assert.equal(r.window.__aciraSelectRecord.touched, false); select.selectedIndex = 2;
  assert.equal(r.window.__aciraSelectRecord.touched, true);
  const later = chooser(0), s2 = loadRecorder({selects: [later]}); s2.fire('mousedown', press()); later.selectedIndex = 1; s2.fire('mousedown', press()); later.selectedIndex = 0;
  assert.equal(s2.window.__aciraSelectRecord.touched, false, 'a second press does not move the baseline; back at the first state means unchanged');
});

test('recorder: the window losing the focus is NOT a first moment (in the real app it fires while the page is still loading, which made a docs-like tab look touched and never sleep)', () => {
  const hidden = chooser(1), r = loadRecorder({selects: [hidden]}), page = r.window;
  assert.equal(r.listeners.some(l => l.type === 'blur'), false, 'no blur listener');
  r.fire('blur', {isTrusted: true, target: page, composedPath: () => [page]}); assert.equal(page.__aciraSelectRecord.baseline, false);
  hidden.selectedIndex = 3; assert.equal(page.__aciraSelectRecord.touched, false, 'a select the page set after the window lost focus is still the page\'s own');
});

test('recorder: a select the page makes after the first press counts as changed; one that goes away does not; multiple selects compare every chosen option', () => {
  const kept = chooser(0), selects = [kept], r = loadRecorder({selects});
  r.fire('click', press()); assert.equal(r.window.__aciraSelectRecord.touched, false);
  selects.push(chooser(0)); assert.equal(r.window.__aciraSelectRecord.touched, true, 'a drop-down built after the press: unknown, so touched');
  selects.pop(); assert.equal(r.window.__aciraSelectRecord.touched, false);
  selects.shift(); assert.equal(r.window.__aciraSelectRecord.touched, false, 'removed from the page');
  const many = chooser([1, 2], true), m = loadRecorder({selects: [many]}); m.fire('click', press()); assert.equal(m.window.__aciraSelectRecord.touched, false);
  many.selectedOptions = [{index: 1}]; assert.equal(m.window.__aciraSelectRecord.touched, true, 'a multi-select lost a choice');
  many.selectedOptions = [{index: 1}, {index: 2}]; assert.equal(m.window.__aciraSelectRecord.touched, false);
});

test('recorder: anything that stops it from comparing counts as touched (the safe direction)', () => {
  const throwing = {querySelectorAll() { throw new Error('document gone'); }}, r = loadRecorder({document: throwing});
  r.fire('click', press()); assert.equal(r.window.__aciraSelectRecord.touched, true, 'the baseline could not be taken');
  const broken = chooser(0), b = loadRecorder({selects: [broken]}); b.fire('click', press()); Object.defineProperty(broken, 'selectedIndex', {get() { throw new Error('detached'); }});
  assert.equal(b.window.__aciraSelectRecord.touched, true, 'a select that cannot be read now');
  const calls = {n: 0}, once = loadRecorder({document: {querySelectorAll: () => { calls.n++; return []; }}}); once.fire('click', press()); once.fire('click', press()); once.fire('keydown', press());
  assert.equal(calls.n, 1, 'the baseline is taken once');
});

test('recorder: records how the document was reached; an unreadable kind is empty (so the sleep check does not trust it)', () => {
  for (const navigation of ['navigate', 'back_forward', 'reload', 'prerender']) assert.deepEqual({...loadRecorder({navigation}).window.__aciraSelectRecord}, {v: 1, touched: false, nav: navigation, baseline: false});
  assert.equal(loadRecorder({navigation: null}).window.__aciraSelectRecord.nav, '');
  const source = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'page-input-preload.cjs'), 'utf8'), piece = source.slice(source.indexOf('if(process.isMainFrame){'), source.indexOf('// No API is exposed to websites.')), window = {addEventListener() {}};
  vm.runInNewContext(piece, {process: {isMainFrame: true}, window, document: {querySelectorAll: () => []}, performance: {getEntriesByType() { throw new Error('no timing'); }}}); assert.equal(window.__aciraSelectRecord.nav, '', 'timing unreadable');
  const none = {addEventListener() {}}; vm.runInNewContext(piece, {process: {isMainFrame: true}, window: none, document: {querySelectorAll: () => []}}); assert.equal(none.__aciraSelectRecord.nav, '', 'no performance object at all');
});

test('recorder: a frame that is not the main frame records nothing and offers no record (nothing reads it there)', () => {
  const r = loadRecorder({isMainFrame: false}); assert.equal(r.listeners.length, 0); assert.equal(r.window.__aciraSelectRecord, undefined);
});

test('recorder: a failing listener registration leaves no record (so the check says unknown and the tab stays awake)', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'page-input-preload.cjs'), 'utf8');
  const piece = source.slice(source.indexOf('if(process.isMainFrame){'), source.indexOf('// No API is exposed to websites.')), window = {addEventListener() { throw new Error('no'); }};
  vm.runInNewContext(piece, {process: {isMainFrame: true}, window, document: {querySelectorAll: () => []}, performance: {getEntriesByType: () => [{type: 'navigate'}]}}); assert.equal(window.__aciraSelectRecord, undefined);
});

test('the preload is registered with context isolation, so the record lives in world 999 and the page cannot touch it (main.cjs)', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');
  assert.match(main, /function pageViewPreferences\(profile,tab\)\{return \{[^}]*contextIsolation:true,nodeIntegration:false,nodeIntegrationInSubFrames:true,sandbox:true[^}]*preload:path\.join\(__dirname,'page-input-preload\.cjs'\)/);
});

// ---------------------------------------------------------------- wiring
test('main.cjs asks inspectLive for the page check and no longer builds its own probe', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');
  assert.match(main, /const found=await inspectLive\(wc,1500,entry\.restoredDoc===true\);return found\?\.safe\?null:\(found\?\.reason\|\|'unsafe'\);\}catch\{return 'inspection-failed';\}/);
  // the page Acira restores itself when it wakes a sleeping tab is marked from the moment its navigation starts, and only by loadPage's two restore calls
  assert.ok(main.includes("wc.on('did-start-navigation',details=>{if(details.isMainFrame&&!details.isSameDocument){entry.restoredDoc=entry.restoring===true;entry.restoring=false;}});"));
  assert.equal((main.match(/entry\.restoring=true;void wc\.navigationHistory\.restore\(/g) || []).length, 2, 'both restores in loadPage (the closed page\'s kept entries, the saved history)');
  assert.equal((main.match(/navigationHistory\.restore\(/g) || []).length, 2, 'and no other restore marks a page');
  assert.ok(!main.includes('const sleepProbe='), 'one probe, built in tab-sleep.cjs');
  assert.ok(!/wc\.executeJavaScript\(sleepProbe\)/.test(main));
  assert.match(main, /const \{createTabSleep,neverSleeps,inspectLive,stayAwakeKind\}=require\('\.\/tab-sleep\.cjs'\)/);
});

test('13.5: only the select rule changed: text boxes, text areas, checkboxes, files, passwords, editable pages and media keep their 13.4 rules', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'tab-sleep.cjs'), 'utf8');
  const body = source.slice(source.indexOf('function inspectPage('), source.indexOf('module.exports='));
  for (const needle of ["element.type==='password'&&element.value||element.type==='file'&&element.files.length", "['checkbox','radio'].includes(element.type)", 'element.checked!==element.defaultChecked',
    "const baseline=document.createElement('input')", "element.tagName==='TEXTAREA'&&element.value!==element.defaultValue", 'document.designMode===\'on\'||document.querySelector(\'[contenteditable]:not([contenteditable="false"]),canvas\')'])
    assert.ok(body.includes(needle), needle);
});

// ---------------------------------------------------------------- the real thing
const electron = (() => { try { const value = require('electron'); return typeof value === 'string' && fs.existsSync(value) ? value : null; } catch { return null; } })();
const fixture = path.join(__dirname, 'fixtures', 'tab-sleep-selects', 'run.cjs');
let realRun; const real = () => realRun ??= (() => {
  if (!electron) return null;
  const args = [fixture, ...(process.platform === 'darwin' ? ['-ApplePersistenceIgnoreState', 'YES'] : [])];
  const attempt = () => { const run = spawnSync(electron, args, {encoding: 'utf8', timeout: 320000, killSignal: 'SIGKILL', env: {...process.env, ELECTRON_RUN_AS_NODE: undefined, ELECTRON_ENABLE_LOGGING: '0'}}); const line = (run.stdout || '').split(/\r?\n/).find(text => text.startsWith('RESULT ')); return {signal: run.signal, status: run.status, result: line ? JSON.parse(line.slice(7)) : null, output: ((run.stdout || '') + (run.stderr || '')).slice(0, 800)}; };
  let first = attempt(); if (!first.result || first.result.error === 'timed out') first = attempt();
  if (process.env.TAB_SLEEP_DUMP) try { fs.writeFileSync(path.join(process.env.TAB_SLEEP_DUMP, 'selects.json'), JSON.stringify(first.result || {output: first.output}, null, 1)); } catch { /* a debugging aid only */ }
  return first;
})();
const skip = !electron ? 'electron binary not available' : process.env.SKIP_ELECTRON_FIXTURES === '1' ? 'SKIP_ELECTRON_FIXTURES=1 (the fixture launches a real Electron: hold the lock where one is shared)' : false;
const scenario = name => real().result.scenarios.find(item => item.name === name);
const AWAKE = {safe: false, reason: 'edited-form', select: true};

test('real Electron: the fixture ran to the end with no error', {skip}, () => {
  const run = real(); assert.ok(run.result, 'no result: ' + run.output); assert.equal(run.signal, null); assert.equal(run.result.error, undefined, run.result.error); assert.deepEqual(run.result.errors, []);
});
test('real Electron (a): a drop-down the person changed with the mouse or the keyboard keeps the tab awake', {skip}, () => {
  for (const name of ['list-click', 'closed-typeahead', 'list-keys']) { const s = scenario(name); assert.deepEqual(s.found, AWAKE, name); assert.equal(s.record.touched, true, name); assert.equal(s.record0.touched, false, name + ' started untouched'); }
});
test('real Electron (b): a drop-down only the page\'s script set lets the tab sleep (the docs.python.org pattern)', {skip}, () => {
  for (const name of ['script-value', 'script-option-property', 'script-timer', 'script-fake-events', 'script-spa-rebuild']) {
    const s = scenario(name); assert.deepEqual(s.found, {safe: true}, name); assert.equal(s.record.touched, false, name);
    if (name !== 'script-selected-attribute') assert.deepEqual(s.before, AWAKE, `${name}: with the 13.4 check this page never sleeps`);
  }
  assert.deepEqual(scenario('script-selected-attribute').found, {safe: true}, 'a selected attribute written by script moves the default with it');
  assert.deepEqual(scenario('plain').found, {safe: true});
});
test('real Electron (b): the person pointing, scrolling, typing in a text box or tabbing through the page does not count as touching the drop-down', {skip}, () => {
  for (const name of ['script-select-hover-wheel', 'script-select-pointer-elsewhere']) { const s = scenario(name); assert.equal(s.record.touched, false, name); }
  assert.deepEqual(scenario('script-select-pointer-elsewhere').found, {safe: false, reason: 'edited-form'}, 'the text the person typed still keeps the tab awake');
  assert.deepEqual(scenario('script-select-hover-wheel').found, {safe: true});
  assert.equal(scenario('script-select-tab-into').record.touched, false, 'one Tab only moves the focus onto the drop-down; the key went to the box before it');
  assert.deepEqual(scenario('script-select-tab-into').found, {safe: true});
  assert.equal(scenario('script-select-tab-through').record.touched, true, 'a key pressed ON the drop-down counts: the safe direction');
  assert.deepEqual(scenario('script-select-tab-through').found, AWAKE);
});
test('real Electron: Back and reload documents are not trusted (Chromium may have restored the person\'s earlier choice into the drop-down); the page Acira restored itself on waking a tab is', {skip}, () => {
  const reload = scenario('nav-reload'); assert.equal(reload.record.nav, 'reload'); assert.deepEqual(reload.found, AWAKE, 'a reloaded document keeps the 13.4 rule'); assert.deepEqual(reload.foundAppRestored, AWAKE, 'Acira never restores by reload');
  const back = scenario('nav-back-restores-the-choice'); assert.equal(back.record.nav, 'back_forward'); assert.deepEqual(back.found, AWAKE, 'after the person\'s own Back: the 13.4 rule'); assert.deepEqual(back.foundAppRestored, {safe: true}, 'the same document, but Acira restored it itself (main.cjs says so)');
  assert.equal(real().result.restoredValue, 2, 'Chromium put the person\'s choice back into the drop-down on Back: the hazard this guards');
  const scriptSet = scenario('nav-back-script-set'); assert.equal(scriptSet.record.nav, 'back_forward'); assert.deepEqual(scriptSet.found, AWAKE);
  const restored = scenario('nav-history-restore'); assert.equal(restored.error, undefined, restored.error);
  if (restored.record.nav === 'back_forward') { assert.deepEqual(restored.found, AWAKE, 'restore navigations report back_forward: not trusted unless main says it restored them'); assert.deepEqual(restored.foundAppRestored, {safe: true}); }
  else { assert.equal(restored.record.nav, 'navigate'); assert.deepEqual(restored.found, {safe: true}); }
});
test('real Electron: a form filled by an extension (isolated world, untrusted events) keeps the tab awake once the person pressed something in the page; with no press at all it cannot be told from the page\'s own script (the residual)', {skip}, () => {
  const none = scenario('ext-fill-no-input'); assert.equal(none.record.baseline, false); assert.equal(none.record.touched, false, 'residual: no press, no trusted event on the select'); assert.deepEqual(none.found, {safe: true});
  const click = scenario('ext-fill-after-click'); assert.equal(click.record.baseline, true); assert.equal(click.record.touched, true); assert.deepEqual(click.found, AWAKE);
  const blur = scenario('ext-fill-after-blur'); assert.equal(blur.record.touched, false, 'the window losing focus is not a moment; the fill is the page\'s own as far as the record can tell'); assert.deepEqual(blur.found, {safe: true});
});
test('real Electron (g): a custom drop-down whose hidden native select the widget\'s script sets after the person picked an entry keeps the tab awake; opening it and closing it again, or clicking elsewhere on the page, does not', {skip}, () => {
  const picked = scenario('widget-picked'); assert.equal(picked.record.touched, true); assert.deepEqual(picked.found, AWAKE); assert.deepEqual(picked.before, AWAKE);
  assert.equal(scenario('widget').record.touched, false); assert.deepEqual(scenario('widget').found, {safe: true}, 'nothing was picked: the select is at its default');
  assert.equal(scenario('widget-opened-and-closed').record.touched, false); assert.deepEqual(scenario('widget-opened-and-closed').found, {safe: true});
  const elsewhere = scenario('script-select-click-elsewhere'); assert.equal(elsewhere.record.touched, false, 'clicks and keys that did not move any drop-down'); assert.deepEqual(elsewhere.found, {safe: true}); assert.deepEqual(elsewhere.before, AWAKE);
});
test('real Electron (c): the person edits and the page\'s script then moves the value: the tab stays awake', {skip}, () => {
  for (const name of ['list-click-then-script-other', 'list-click-then-rebuilt']) { const s = scenario(name); assert.equal(s.record.touched, true, name); assert.deepEqual(s.found, AWAKE, name); }
  // the page put the drop-down back to its default: nothing of the person's choice is left in it, and 13.4 let that page sleep too
  assert.deepEqual(scenario('list-click-then-script-default').found, {safe: true}); assert.deepEqual(scenario('list-click-then-script-default').before, {safe: true});
});
test('real Electron (d): a drop-down in an iframe or a shadow root is not examined, with the 13.4 check and with this one', {skip}, () => {
  for (const name of ['iframe', 'iframe-other-site', 'shadow', 'shadow-clean']) { const s = scenario(name); assert.deepEqual(s.found, {safe: true}, name); assert.deepEqual(s.before, {safe: true}, name + ' (13.4)'); }
});
test('real Electron (e): a multi-select the script set sleeps; one the person changed does not', {skip}, () => {
  assert.deepEqual(scenario('multi-script').found, {safe: true}); assert.deepEqual(scenario('multi-script').before, AWAKE);
  assert.deepEqual(scenario('multi-click').found, AWAKE); assert.equal(scenario('multi-click').record.touched, true);
});
test('real Electron (f): pushState keeps the record, a full navigation starts a new one', {skip}, () => {
  assert.deepEqual(scenario('spa-list').found, AWAKE); assert.equal(scenario('spa-list').record.touched, true);
  assert.deepEqual(scenario('spa-list-back').found, AWAKE);
  const next = scenario('touched-then-full-navigation'); assert.equal(next.record.touched, false); assert.deepEqual(next.found, {safe: true}, 'the new document has its own record: the script-set drop-down of the next page may sleep');
});
test('real Electron: a text box the person typed, or a text area / video the page keeps, still holds the tab whichever comes first', {skip}, () => {
  assert.deepEqual(scenario('text-and-script-select').found, {safe: false, reason: 'edited-form'});
  assert.deepEqual(scenario('script-select-and-script-text').found, {safe: false, reason: 'edited-form'}, 'a script-set text area stays awake as in 13.2');
  assert.deepEqual(scenario('script-select-and-video').found, {safe: false, reason: 'playing-media-or-live-stream'});
});
test('real Electron: a page that never ran the preload has no record and keeps the 13.4 answer (the safe direction)', {skip}, () => {
  const s = scenario('script-value-no-preload'); assert.equal(s.record0, null); assert.deepEqual(s.found, AWAKE);
});

// ---------------------------------------------------------------- the lost-edit hunt (real Electron): every kind of control a person can change
const KINDS = ['select', 'select-list', 'multiple', 'text', 'textarea', 'search', 'password', 'number', 'checkbox', 'radio', 'contenteditable', 'range', 'date', 'file'];
test('real Electron, lost-edit hunt: a control the person changed on the page keeps its tab awake, as in 13.4, and still does after pushState', {skip}, () => {
  const rows = real().result.hunt.filter(row => row.place === 'page'); assert.deepEqual(rows.map(row => row.kind).sort(), [...KINDS].sort());
  for (const row of rows) {
    assert.equal(row.error, undefined, row.kind + ': ' + row.error);
    assert.equal(row.found.safe, false, `${row.kind}: the person changed it and the tab may sleep (found ${JSON.stringify(row.found)}, 13.4 said ${JSON.stringify(row.before)})`);
    assert.deepEqual(row.afterPushState, row.found, row.kind + ' after pushState');
    if (row.before.safe === false) assert.equal(row.found.safe, false, row.kind + ': 13.4 kept it awake, so must 13.5');
  }
  const detail = Object.fromEntries(rows.map(row => [row.kind, row.found.reason]));
  for (const kind of ['select', 'select-list', 'multiple', 'text', 'textarea', 'search', 'number', 'checkbox', 'radio', 'range', 'date']) assert.equal(detail[kind], 'edited-form', kind);
  assert.equal(detail.password, 'credential-or-file-input'); assert.equal(detail.file, 'credential-or-file-input'); assert.equal(detail.contenteditable, 'editable-or-canvas-content');
});
test('real Electron, lost-edit hunt: nothing the 13.4 check kept awake sleeps now, in a frame either (the same answers as 13.4 everywhere)', {skip}, () => {
  for (const row of real().result.hunt) {
    assert.equal(row.error, undefined, `${row.kind}/${row.place}: ${row.error}`);
    if (row.before && row.before.safe === false) assert.equal(row.found.safe, false, `${row.kind}/${row.place}: 13.4 kept this tab awake`);
    assert.ok(row.landed !== null && row.landed !== undefined && row.landed !== '' && row.landed !== false || row.kind === 'radio', `${row.kind}/${row.place}: the person\'s input did land in the control (${JSON.stringify(row.landed)})`);
    assert.equal(row.found.safe, row.before.safe, `${row.kind}/${row.place}: the answer is the 13.4 answer`);
    assert.equal(row.untouched.safe === false ? row.untouched.reason : 'safe', row.kind === 'contenteditable' && row.place === 'page' ? 'editable-or-canvas-content' : 'safe', `${row.kind}/${row.place}: untouched page`);
  }
});
