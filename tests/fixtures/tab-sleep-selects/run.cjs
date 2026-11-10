'use strict';
// Real Electron (13.5): the tab-sleep page check against real drop-downs. A page window is made exactly as Acira makes a tab's page (the real desktop/page-input-preload.cjs as its
// preload, context isolation, sandbox, sub-frame preloads), local pages are loaded, a person's input is sent through the DevTools protocol (Input.dispatchMouseEvent /
// Input.dispatchKeyEvent / Input.insertText: the browser's own, trusted events), a page's script does what docs.python.org's pickers do, and the REAL desktop/tab-sleep.cjs
// inspectLive() (the function main.cjs protectedReason calls) says whether the tab may sleep. Prints one line: RESULT <json>. Run by tests/tab-sleep-selects.test.cjs
// (also: electron tests/fixtures/tab-sleep-selects/run.cjs). SELECTS_PORT = the local port (default: any free one).
// Typing into a closed drop-down by letter is used instead of the arrow keys: on macOS an arrow key opens the system menu, which waits for a person.
const {app, BrowserWindow} = require('electron'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
app.commandLine.appendSwitch('use-mock-keychain'); app.commandLine.appendSwitch('mute-audio'); // never the real Keychain, never a sound
app.on('window-all-closed', () => {}); // a window closed on purpose (a tab put to sleep, a page done with) must not end the run: Electron quits when the last window goes unless this is heard
const root = path.resolve(__dirname, '..', '..', '..');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-tab-sleep-selects-')); app.setPath('userData', data); app.setName('Acira tab sleep selects qualification');
const {inspectLive, sleepProbe, SELECT_WORLD, SELECT_RECORD} = require(path.join(root, 'desktop', 'tab-sleep.cjs'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), stage = text => process.stderr.write('stage ' + text + '\n'); // progress on stderr: where a crash happened
const out = {scenarios: [], errors: []};
let finished = false;
const done = (code, error) => { if (finished) return; finished = true; let text; try { text = JSON.stringify({...out, ...(error ? {error: String(error)} : {})}); } catch (failure) { text = JSON.stringify({scenarios: [], errors: ['result not printable: ' + failure.message], error: String(error || failure.message)}); } console.log('RESULT ' + text); try { fs.rmSync(data, {recursive: true, force: true}); } catch { /* left for the OS */ } app.exit(code); };
setTimeout(() => done(3, 'timed out'), 300000).unref();
process.on('uncaughtException', error => { out.errors.push('uncaught: ' + String(error && error.stack || error).slice(0, 300)); stage('uncaught ' + String(error).slice(0, 120)); });
process.on('unhandledRejection', error => { out.errors.push('unhandled: ' + String(error && error.stack || error).slice(0, 300)); stage('unhandled ' + String(error).slice(0, 120)); });
const heartbeat = setInterval(() => stage('beat'), 15000); heartbeat.unref();
const ends = (promise, ms, what) => { let timer; return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout after ' + ms + ' ms: ' + what)), ms); })]).finally(() => clearTimeout(timer)); };

const OPTIONS = '<option>one<option>two<option>three<option>four';
const page = (body, script = '') => `<!doctype html><meta charset=utf-8><title>t</title><body style="margin:20px;font:16px sans-serif">${body}${script ? `<script>${script}</script>` : ''}`;
const PAGES = {
  // nothing was changed by anybody
  plain: page(`<select id=s>${OPTIONS}</select><select id=l size=4>${OPTIONS}</select>`),
  // (a) the person
  'list-click': page(`<select id=s size=4>${OPTIONS}</select>`),
  'closed-typeahead': page('<select id=s><option>apple<option>banana<option>cherry</select>', 'document.getElementById("s").focus()'),
  'list-keys': page(`<select id=s size=4>${OPTIONS}</select>`, 'document.getElementById("s").focus()'),
  // (b) the page's own script, the docs.python.org pattern and its relatives
  'script-value': page(`<select id=v>${OPTIONS}</select><select id=l>${OPTIONS}</select>`, 'for(const s of document.querySelectorAll("select")){s.value="three";s.dispatchEvent(new Event("change",{bubbles:true}));}'),
  'script-option-property': page(`<select id=s>${OPTIONS}</select>`, 'document.getElementById("s").options[2].selected=true'),
  'script-selected-attribute': page(`<select id=s>${OPTIONS}</select>`, 'document.getElementById("s").options[2].setAttribute("selected","")'),
  'script-timer': page(`<select id=s>${OPTIONS}</select>`, 'setTimeout(()=>{document.getElementById("s").value="four"},250)'),
  'script-fake-events': page(`<select id=s size=4>${OPTIONS}</select>`, 'const s=document.getElementById("s");s.focus();s.click();s.options[1].click();for(const type of ["pointerdown","mousedown","click"])s.dispatchEvent(new MouseEvent(type,{bubbles:true,composed:true}));s.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",bubbles:true,composed:true}));s.value="three";s.dispatchEvent(new Event("input",{bubbles:true,composed:true}));s.dispatchEvent(new Event("change",{bubbles:true}));'),
  'script-spa-rebuild': page('<div id=box></div>', 'function draw(value){document.getElementById("box").innerHTML="<select id=s>' + OPTIONS + '</select>";document.getElementById("s").value=value}draw("two");'),
  // (c) the person edits, then the page's script moves the value again
  'list-click-then-script-other': page(`<select id=s size=4>${OPTIONS}</select>`, 'const s=document.getElementById("s");s.addEventListener("change",()=>setTimeout(()=>{s.value="four"},50))'),
  'list-click-then-script-default': page(`<select id=s size=4>${OPTIONS}</select>`, 'const s=document.getElementById("s");s.addEventListener("change",()=>setTimeout(()=>{s.selectedIndex=-1;s.value="one"},50))'),
  'list-click-then-rebuilt': page(`<div id=box><select id=s size=4>${OPTIONS}</select></div>`, 'const s=document.getElementById("s");s.addEventListener("change",()=>setTimeout(()=>{const v=s.value;document.getElementById("box").innerHTML="<select id=s2 size=4>' + OPTIONS + '</select>";document.getElementById("s2").value=v},50))'),
  // (d) a select the page check cannot see
  iframe: page('<iframe id=f src="/p/inner" width=300 height=120></iframe>'),
  'iframe-other-site': page('<iframe id=f src="http://localhost:PORT/p/inner" width=300 height=120></iframe>'),
  inner: page(`<select id=s size=4>${OPTIONS}</select>`, 'document.getElementById("s").value="three"'),
  shadow: page('<div id=host></div>', 'const r=document.getElementById("host").attachShadow({mode:"open"});r.innerHTML="<select id=s size=4>' + OPTIONS + '</select>";r.getElementById("s").value="three"'),
  'shadow-clean': page('<div id=host></div>', 'const r=document.getElementById("host").attachShadow({mode:"open"});r.innerHTML="<select id=s size=4>' + OPTIONS + '</select>"'),
  // (e) multiple
  'multi-script': page(`<select id=s multiple size=4>${OPTIONS}</select>`, 'const s=document.getElementById("s");s.options[1].selected=true;s.options[3].selected=true'),
  'multi-click': page(`<select id=s multiple size=4>${OPTIONS}</select>`),
  // (f) navigation
  'spa-list': page(`<select id=s size=4>${OPTIONS}</select>`),
  'next-page': page(`<select id=s>${OPTIONS}</select>`, 'document.getElementById("s").value="three"'),
  // the person typed in a text box while the page's script moved a drop-down: the text still keeps the tab awake whichever comes first in the page
  'text-and-script-select': page(`<select id=s>${OPTIONS}</select><input id=t type=text>`, 'document.getElementById("s").value="three"'),
  'script-select-and-script-text': page(`<select id=s>${OPTIONS}</select><textarea id=t></textarea>`, 'document.getElementById("s").value="three";document.getElementById("t").value="a draft the script wrote"'),
  'script-select-and-video': page(`<select id=s>${OPTIONS}</select><audio id=v loop muted></audio>`, 'document.getElementById("s").value="three";const n=8000,b=new DataView(new ArrayBuffer(44+n));const w=(o,t)=>{for(let i=0;i<t.length;i++)b.setUint8(o+i,t.charCodeAt(i))};w(0,"RIFF");b.setUint32(4,36+n,true);w(8,"WAVEfmt ");b.setUint32(16,16,true);b.setUint16(20,1,true);b.setUint16(22,1,true);b.setUint32(24,8000,true);b.setUint32(28,8000,true);b.setUint16(32,1,true);b.setUint16(34,8,true);w(36,"data");b.setUint32(40,n,true);for(let i=0;i<n;i++)b.setUint8(44+i,128);const a=document.getElementById("v");a.src=URL.createObjectURL(new Blob([b],{type:"audio/wav"}));a.play()'),
  // a custom drop-down (select2, Chosen, Radix...): a hidden native select that the widget's script sets after the person clicked the widget and picked an entry, with a synthetic change
  widget: page('<select id=s style="display:none">' + OPTIONS + '</select><div id=w tabindex=0 style="border:1px solid #888;padding:8px;width:160px">pick one</div><ul id=menu hidden style="margin:0;padding:0;list-style:none"><li data-i=1 style="padding:8px;border:1px solid #888">two<li data-i=2 style="padding:8px;border:1px solid #888">three</ul>',
    'const s=document.getElementById("s"),w=document.getElementById("w"),menu=document.getElementById("menu");w.onclick=()=>{menu.hidden=!menu.hidden};menu.onclick=e=>{const i=Number(e.target.dataset.i);if(!Number.isNaN(i)){setTimeout(()=>{s.selectedIndex=i;s.dispatchEvent(new Event("change",{bubbles:true}));w.textContent=s.options[i].text;menu.hidden=true},120)}}'),
  // an extension that fills a form (a password manager choosing a country): its content script runs in its own isolated world and its events are not trusted
  'ext-select': page(`<select id=s>${OPTIONS}</select><p id=p style="height:60px">some text to click on</p>`),
  // pointers and keys near a select that are not about it
  'script-select-click-elsewhere': page(`<select id=s>${OPTIONS}</select><p id=p style="height:60px">some text to click on</p><a id=a href="#top">a link</a>`, 'document.getElementById("s").value="three"'),
  'script-select-hover-wheel': page(`<select id=s>${OPTIONS}</select><p>some text</p>`, 'document.getElementById("s").value="three"'),
  'script-select-pointer-elsewhere': page(`<select id=s>${OPTIONS}</select><input id=t type=text><p id=p style="height:60px">some text</p>`, 'document.getElementById("s").value="three"'),
  'script-select-tab-through': page(`<input id=a type=text><select id=s>${OPTIONS}</select><input id=b type=text>`, 'document.getElementById("s").value="three";document.getElementById("a").focus()'),
};

// the lost-edit hunt: one page per kind of control a person can change, on its own, in a same-site iframe and in a cross-site iframe
const KINDS = {
  select: '<select id=c>' + OPTIONS + '</select>', 'select-list': '<select id=c size=4>' + OPTIONS + '</select>', multiple: '<select id=c multiple size=4>' + OPTIONS + '</select>',
  text: '<input id=c type=text>', textarea: '<textarea id=c rows=3 cols=30></textarea>', checkbox: '<input id=c type=checkbox>', radio: '<input id=c type=radio name=r value=a><input id=d type=radio name=r value=b checked>',
  contenteditable: '<div id=c contenteditable=true style="min-height:40px;border:1px solid #888">type here</div>', file: '<input id=c type=file>', range: '<input id=c type=range min=0 max=100 value=50 style="width:200px">',
  date: '<input id=c type=date>', number: '<input id=c type=number>', password: '<input id=c type=password>', search: '<input id=c type=search>',
};
for (const [kind, control] of Object.entries(KINDS)) {
  PAGES['ctl/' + kind] = page('<h1>' + kind + '</h1>' + control);
  PAGES['ctl-frame/' + kind] = page('<iframe id=f src="/p/ctl/' + kind + '" width=420 height=220></iframe>');
  PAGES['ctl-cross/' + kind] = page('<iframe id=f src="http://localhost:PORT/p/ctl/' + kind + '" width=420 height=220></iframe>');
}

app.whenReady().then(async () => {
  const server = http.createServer((request, response) => {
    const name = request.url.replace(/^\/p\//, '').replace(/^\//, '').replace(/\?.*$/, '');
    const body = PAGES[name]; response.setHeader('content-type', 'text/html; charset=utf-8');
    if (body === undefined) { response.statusCode = 404; response.end('no'); return; }
    response.end(body.replaceAll('PORT', String(server.address().port)));
  });
  await new Promise(resolve => server.listen(Number(process.env.SELECTS_PORT || 0), '127.0.0.1', resolve));
  const port = server.address().port, url = name => `http://127.0.0.1:${port}/p/${name}`;
  const windows = [], pool = new Map();
  const open = async (name, {preload = true} = {}) => {
    let window = pool.get(preload), fresh = false;
    if (!window || window.isDestroyed()) {
      window = new BrowserWindow({show: false, width: 700, height: 500, webPreferences: {partition: 'tab-sleep-selects-' + windows.length, backgroundThrottling: false, contextIsolation: true, nodeIntegration: false, sandbox: true, nodeIntegrationInSubFrames: true,
        ...(preload ? {preload: path.join(root, 'desktop', 'page-input-preload.cjs')} : {})}});
      windows.push(window); pool.set(preload, window); fresh = true;
    }
    stage('window ' + name);
    const wc = window.webContents; if (!fresh) await ends(wc.loadURL('about:blank'), 20000, 'about:blank before ' + name); /* the same address twice in a row would be a reload, not a new navigation */ await ends(wc.loadURL(url(name)), 20000, 'load ' + name); await sleep(120); stage('loaded ' + name);
    if (fresh) wc.debugger.attach('1.3'); stage('attached ' + name);
    const cdp = (method, params) => ends(wc.debugger.sendCommand(method, params), 20000, method);
    const evaluate = code => ends(wc.executeJavaScript(code), 20000, 'evaluate');
    const centre = async (selector, nth = 0, frame = '') => { const box = await evaluate(`(()=>{const root=${frame ? `document.getElementById(${JSON.stringify(frame)}).contentDocument` : 'document'};const e=root.querySelectorAll(${JSON.stringify(selector)})[${nth}];const r=e.getBoundingClientRect();const o=${frame ? `document.getElementById(${JSON.stringify(frame)}).getBoundingClientRect()` : '{left:0,top:0}'};return {x:Math.round(o.left+r.left+r.width/2),y:Math.round(o.top+r.top+r.height/2)}})()`); return box; };
    const mouse = async (x, y, modifiers = 0) => { await cdp('Input.dispatchMouseEvent', {type: 'mouseMoved', x, y, modifiers}); await cdp('Input.dispatchMouseEvent', {type: 'mousePressed', x, y, button: 'left', clickCount: 1, buttons: 1, modifiers}); await cdp('Input.dispatchMouseEvent', {type: 'mouseReleased', x, y, button: 'left', clickCount: 1, modifiers}); await sleep(80); };
    const move = async (x, y) => { await cdp('Input.dispatchMouseEvent', {type: 'mouseMoved', x, y}); await sleep(40); };
    const wheel = async (x, y) => { await cdp('Input.dispatchMouseEvent', {type: 'mouseWheel', x, y, deltaX: 0, deltaY: 40}); await sleep(80); };
    const keys = {ArrowDown: ['ArrowDown', 'ArrowDown', 40], Tab: ['Tab', 'Tab', 9], Shift: ['Shift', 'ShiftLeft', 16]};
    const key = async name => { const [k, code, vk] = keys[name]; await cdp('Input.dispatchKeyEvent', {type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk}); await cdp('Input.dispatchKeyEvent', {type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk}); await sleep(80); };
    const type = async letter => { await cdp('Input.dispatchKeyEvent', {type: 'keyDown', key: letter, code: 'Key' + letter.toUpperCase(), text: letter, unmodifiedText: letter, windowsVirtualKeyCode: letter.toUpperCase().charCodeAt(0)}); await cdp('Input.dispatchKeyEvent', {type: 'keyUp', key: letter, code: 'Key' + letter.toUpperCase(), windowsVirtualKeyCode: letter.toUpperCase().charCodeAt(0)}); await sleep(80); };
    const text = async value => { await cdp('Input.insertText', {text: value}); await sleep(80); };
    // frame-aware helpers for the hunt: the control's centre in page coordinates, and a script run in the frame that holds the control (the iframe's, when there is one)
    const inner = () => wc.mainFrame.framesInSubtree.find(frame => frame !== wc.mainFrame) || wc.mainFrame;
    const where = async (selector, nth = 0) => { const frame = inner(), box = await frame.executeJavaScript(`(()=>{const r=document.querySelectorAll(${JSON.stringify(selector)})[${nth}].getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`); if (frame === wc.mainFrame) return {x: Math.round(box.x), y: Math.round(box.y)}; const o = await evaluate('(()=>{const r=document.getElementById("f").getBoundingClientRect();return {x:r.left,y:r.top}})()'); return {x: Math.round(o.x + box.x), y: Math.round(o.y + box.y)}; };
    const landed = () => inner().executeJavaScript(`(()=>{const c=document.getElementById('c');if(!c)return null;if(c.type==='checkbox'||c.type==='radio')return c.checked;if(c.tagName==='SELECT')return [...c.selectedOptions].map(o=>o.index).join(',');if(c.isContentEditable)return c.textContent;if(c.type==='file')return c.files.length;return c.value})()`);
    const focusIn = selector => inner().executeJavaScript(`document.querySelector(${JSON.stringify(selector)}).focus()`);
    const arrow = async () => { await cdp('Input.dispatchKeyEvent', {type: 'rawKeyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39}); await cdp('Input.dispatchKeyEvent', {type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39}); await sleep(60); };
    return {landed, where, focusIn, arrow, window, wc, cdp, evaluate, centre, mouse, move, wheel, key, type, text, navigate: async next => { await wc.loadURL(url(next)); await sleep(150); }};
  };
  const record = wc => Promise.resolve(wc.executeJavaScriptInIsolatedWorld(SELECT_WORLD, [{code: SELECT_RECORD}])).catch(error => 'error: ' + error.message);
  const check = async (name, setup, options) => {
    const entry = {name}; stage('check ' + name);
    try {
      const page_ = await open(name, options); entry.record0 = await record(page_.wc);
      if (setup) await setup(page_);
      entry.record = await record(page_.wc);
      entry.value = await page_.evaluate('JSON.stringify([...document.querySelectorAll("select")].map(s=>[...s.selectedOptions].map(o=>o.index)))');
      entry.found = await inspectLive(page_.wc); entry.foundAppRestored = await inspectLive(page_.wc, 1500, true); // the second: main.cjs says Acira itself restored this document
      // the same page asked the way 13.4 asked: every select that differs from its default is an edit
      entry.before = await page_.evaluate(sleepProbe(false)).catch(() => undefined);
      
    } catch (error) { entry.error = String(error && error.stack || error); out.errors.push(name + ': ' + entry.error); }
    out.scenarios.push(entry);
  };
  try {
    await check('plain');
    // (a) the person changes a drop-down
    await check('list-click', async p => { const c = await p.centre('#s option', 2); await p.mouse(c.x, c.y); });
    await check('closed-typeahead', async p => { await p.type('b'); });
    await check('list-keys', async p => { await p.key('ArrowDown'); await p.key('ArrowDown'); });
    // (b) the page's own script
    await check('script-value'); await check('script-option-property'); await check('script-selected-attribute');
    await check('script-timer', async () => { await sleep(500); });
    await check('script-fake-events');
    await check('script-spa-rebuild', async p => { await p.evaluate('draw("three")'); });
    // pointers and keys that are not about a select
    await check('script-select-pointer-elsewhere', async p => { const t = await p.centre('#t'), q = await p.centre('#p'); await p.mouse(t.x, t.y); await p.type('x'); await p.move(q.x, q.y); await p.wheel(q.x, q.y); await p.mouse(q.x, q.y); });
    const extensionFill = p => p.wc.executeJavaScriptInIsolatedWorld(2001, [{code: 'const s=document.getElementById("s");s.value="three";s.dispatchEvent(new Event("input",{bubbles:true}));s.dispatchEvent(new Event("change",{bubbles:true}))'}]);
    await check('ext-select', async p => { await extensionFill(p); await sleep(100); }); out.scenarios.at(-1).name = 'ext-fill-no-input';
    await check('ext-select', async p => { const q = await p.centre('#p'); await p.mouse(q.x, q.y); await sleep(100); await extensionFill(p); await sleep(100); }); out.scenarios.at(-1).name = 'ext-fill-after-click';
    await check('ext-select', async p => { await p.cdp('Emulation.setFocusEmulationEnabled', {enabled: true}); await sleep(200); await p.cdp('Emulation.setFocusEmulationEnabled', {enabled: false}); await sleep(300); out.blurReached = await record(p.wc); await extensionFill(p); await sleep(100); }); out.scenarios.at(-1).name = 'ext-fill-after-blur';
    await check('script-select-click-elsewhere', async p => { const q = await p.centre('#p'); await p.mouse(q.x, q.y); await p.key('Tab'); const a = await p.centre('#a'); await p.mouse(a.x, a.y); });
    await check('widget'); await check('widget', async p => { const w = await p.centre('#w'); await p.mouse(w.x, w.y); await sleep(100); const item = await p.centre('#menu li', 1); await p.mouse(item.x, item.y); await sleep(400); }); out.scenarios.at(-1).name = 'widget-picked';
    await check('widget', async p => { const w = await p.centre('#w'); await p.mouse(w.x, w.y); await sleep(100); await p.mouse(w.x, w.y); }); out.scenarios.at(-1).name = 'widget-opened-and-closed';
    await check('script-select-tab-through', async p => { await p.key('Tab'); await p.key('Tab'); }); // the second Tab is pressed ON the drop-down
    await check('script-select-tab-through', async p => { await p.key('Tab'); }); out.scenarios.at(-1).name = 'script-select-tab-into'; // the one Tab moves focus onto it from the box before it
    await check('script-select-hover-wheel', async p => { const c = await p.centre('#s'); await p.move(c.x, c.y); await p.wheel(c.x, c.y); }, undefined);
    // (c) the person edits, then the page moves the value
    await check('list-click-then-script-other', async p => { const c = await p.centre('#s option', 2); await p.mouse(c.x, c.y); await sleep(300); });
    await check('list-click-then-script-default', async p => { const c = await p.centre('#s option', 2); await p.mouse(c.x, c.y); await sleep(300); });
    await check('list-click-then-rebuilt', async p => { const c = await p.centre('#s option', 2); await p.mouse(c.x, c.y); await sleep(300); });
    // (d) iframe and shadow DOM: the page check does not look inside either
    await check('iframe', async p => { await sleep(300); const c = await p.centre('#s option', 1, 'f'); await p.mouse(c.x, c.y); });
    await check('iframe-other-site', async p => { await sleep(500); });
    await check('shadow');
    await check('shadow-clean', async p => { const box = await p.evaluate('(()=>{const r=document.getElementById("host").shadowRoot.getElementById("s").options[2].getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()'); await p.mouse(box.x, box.y); });
    // (e) multi-select
    await check('multi-script');
    await check('multi-click', async p => { const a = await p.centre('#s option', 1), b = await p.centre('#s option', 3); await p.mouse(a.x, a.y); await p.mouse(b.x, b.y, process.platform === 'darwin' ? 4 : 2); });
    // (f) navigation: pushState keeps the record, a full navigation starts a new one
    await check('spa-list', async p => { const c = await p.centre('#s option', 2); await p.mouse(c.x, c.y); await p.evaluate('history.pushState({},"","/p/spa-list?step=2")'); await sleep(100); });
    await check('spa-list', async p => { const c = await p.centre('#s option', 2); await p.mouse(c.x, c.y); await p.evaluate('history.pushState({},"","/p/spa-list?step=2")'); await p.evaluate('history.replaceState({},"","/p/spa-list?step=3")'); await p.evaluate('history.back()'); await sleep(200); });
    out.scenarios.at(-1).name = 'spa-list-back';
    await check('next-page', async p => { await p.navigate('spa-list'); const c = await p.centre('#s option', 2); await p.mouse(c.x, c.y); await p.navigate('next-page'); });
    out.scenarios.at(-1).name = 'touched-then-full-navigation';
    // documents that Chromium may have put the person's earlier choice back into (Back, reload), and the app's own history restore of a woken tab: the first two keep the 13.4 rule
    await check('script-value', async p => { p.wc.reload(); await sleep(900); }); out.scenarios.at(-1).name = 'nav-reload';
    await check('list-click', async p => { const c = await p.centre('#s option', 2); await p.mouse(c.x, c.y); await p.navigate('plain'); p.wc.navigationHistory.goBack(); await sleep(1200); out.restoredValue = await p.evaluate('document.getElementById("s").selectedIndex'); }); out.scenarios.at(-1).name = 'nav-back-restores-the-choice';
    await check('script-value', async p => { await p.navigate('plain'); p.wc.navigationHistory.goBack(); await sleep(1200); }); out.scenarios.at(-1).name = 'nav-back-script-set';
    { // the app restores a woken tab's history (main.cjs loadPage) on a web contents that has not loaded anything yet
      const entry = {name: 'nav-history-restore'}; stage('check ' + entry.name);
      try {
        const window = new BrowserWindow({show: false, width: 700, height: 500, webPreferences: {partition: 'tab-sleep-selects-restore', backgroundThrottling: false, contextIsolation: true, nodeIntegration: false, sandbox: true, nodeIntegrationInSubFrames: true, preload: path.join(root, 'desktop', 'page-input-preload.cjs')}});
        windows.push(window); const wc = window.webContents;
        await ends(wc.navigationHistory.restore({entries: [{url: url('script-value'), title: 'a'}, {url: url('plain'), title: 'b'}], index: 0}), 20000, 'restore'); await sleep(1500);
        entry.record = await record(wc); entry.found = await inspectLive(wc); entry.foundAppRestored = await inspectLive(wc, 1500, true);
      } catch (error) { entry.error = String(error && error.stack || error); out.errors.push(entry.name + ': ' + entry.error); }
      out.scenarios.push(entry);
    }
    // text typed while a drop-down was set by the script, in either order, and a script-set select next to other things that keep a tab awake
    await check('text-and-script-select', async p => { const c = await p.centre('#t'); await p.mouse(c.x, c.y); await p.text('typed by the person'); });
    await check('script-select-and-script-text'); await check('script-select-and-video', async () => { await sleep(600); });
    // the lost-edit hunt: every kind of control a person can change, on the page, in a same-site iframe and in a cross-site iframe, after pushState. The 13.4 answer (sleepProbe(false), what
    // every select difference used to be) is recorded next to the new one: nothing the old check kept awake may sleep now.
    const person = {
      select: async p => { await p.focusIn('#c'); await p.type('t'); },
      'select-list': async p => { const c = await p.where('#c option', 2); await p.mouse(c.x, c.y); },
      multiple: async p => { const a = await p.where('#c option', 1), b = await p.where('#c option', 3); await p.mouse(a.x, a.y); await p.mouse(b.x, b.y, process.platform === 'darwin' ? 4 : 2); },
      text: async p => { const c = await p.where('#c'); await p.mouse(c.x, c.y); await p.text('abc'); }, textarea: async p => { const c = await p.where('#c'); await p.mouse(c.x, c.y); await p.text('a draft'); },
      search: async p => { const c = await p.where('#c'); await p.mouse(c.x, c.y); await p.text('query'); }, password: async p => { const c = await p.where('#c'); await p.mouse(c.x, c.y); await p.text('secret'); },
      number: async p => { const c = await p.where('#c'); await p.mouse(c.x, c.y); await p.text('5'); },
      checkbox: async p => { const c = await p.where('#c'); await p.mouse(c.x, c.y); }, radio: async p => { const c = await p.where('#c'); await p.mouse(c.x, c.y); },
      contenteditable: async p => { const c = await p.where('#c'); await p.mouse(c.x, c.y); await p.text('typed'); },
      range: async p => { await p.focusIn('#c'); for (let i = 0; i < 5; i++) await p.arrow(); },
      date: async p => { await p.focusIn('#c'); for (const digit of '01012030') await p.type(digit); },
      file: async p => { const file = path.join(data, 'chosen.txt'); fs.writeFileSync(file, 'x'); const {root: doc} = await p.cdp('DOM.getDocument', {depth: -1, pierce: true}); const {nodeId} = await p.cdp('DOM.querySelector', {nodeId: doc.nodeId, selector: '#c'}); await p.cdp('DOM.setFileInputFiles', {files: [file], nodeId}); },
    };
    out.hunt = [];
    for (const kind of Object.keys(KINDS)) for (const place of ['', 'frame', 'cross']) {
      if (place && (kind === 'file' || kind === 'select')) continue; // a file chooser and a native menu cannot be driven from outside a frame without a person
      const name = (place ? 'ctl-' + place + '/' : 'ctl/') + kind, entry = {kind, place: place || 'page'}; stage('hunt ' + name);
      try {
        const p = await open(name); await sleep(place ? 500 : 100);
        entry.untouched = await inspectLive(p.wc);
        await person[kind](p); await sleep(150); entry.landed = await p.landed();
        entry.record = await record(p.wc); entry.found = await inspectLive(p.wc);
        entry.before = await p.evaluate(sleepProbe(false)).catch(() => undefined);
        if (!place) { await p.evaluate('history.pushState({},"","/p/' + name + '?step=2")'); await sleep(100); entry.afterPushState = await inspectLive(p.wc); }
        
      } catch (error) { entry.error = String(error && error.stack || error).slice(0, 400); out.errors.push('hunt ' + name + ': ' + entry.error); }
      out.hunt.push(entry);
    }
    // fail safe: a page that never ran the preload has no record
    await check('script-value', async () => {}, {preload: false}); out.scenarios.at(-1).name = 'script-value-no-preload';
  } catch (error) { out.errors.push(String(error && error.stack || error)); }
  for (const window of windows) try { window.destroy(); } catch { /* gone */ }
  server.close();
  done(out.errors.length ? 2 : 0);
});
