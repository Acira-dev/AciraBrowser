// Real app: Ctrl+Shift+T (native key input) reopens exactly ONE tab per press, newest close first, whatever the kind: a batch of three ordinary
// tabs comes back one by one; a private tab comes back as a private tab. Isolated profile under .qa-profiles, one Electron, off-screen and not
// focusable, no real mouse. Run it inside a native slot:  node qa/native-slot.mjs reopen-one-tab -- node qa/reopen-one-tab.mjs
import path from 'node:path';
import {startApp, httpFixture, poll, sleep} from './d-harness.mjs';

const check = (ok, label) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`); if (!ok) process.exitCode = 1; };
const root = path.resolve(`.qa-profiles/reopen-one-tab-${Date.now()}`);
const site = await httpFixture((req, res) => { const n = req.url.replace(/\W/g, '') || 'root'; res.writeHead(200, {'content-type': 'text/html'}); res.end(`<!doctype html><title>${n.toUpperCase()} page</title><body>${n}</body>`); });
const base = `http://127.0.0.1:${site.port}`;
const t = await startApp({root, skipSetup: true});
try {
  await t.ui.locator('.setup-dialog').waitFor({state: 'hidden', timeout: 5000}).catch(() => {});
  await t.main(({BaseWindow}) => { for (const w of BaseWindow.getAllWindows()) { w.setFocusable(false); w.setIgnoreMouseEvents(true); } BaseWindow.getAllWindows()[0].setBounds({x: -20000, y: -20000, width: 1280, height: 900}); });
  await t.act({type: 'settings.update', patch: {onboardingComplete: true, language: 'en'}});
  // The key arrives the way a keyboard delivers it: a native keyDown/keyUp into the browser chrome, which the shortcut registry binds to Reopen closed tab.
  const press = () => t.main(({webContents}) => new Promise((resolve, reject) => {
    const ui = webContents.getAllWebContents().find(w => w.getURL() === 'acira-browser-ui://ui/index.html');
    const seen = (_event, input) => { if (input.type === 'keyDown' && input.key.toLowerCase() === 't' && input.control && input.shift) { clearTimeout(timer); ui.removeListener('before-input-event', seen); resolve(); } };
    const timer = setTimeout(() => { ui.removeListener('before-input-event', seen); reject(Error('Ctrl+Shift+T was not delivered')); }, 5000);
    ui.on('before-input-event', seen);
    ui.sendInputEvent({type: 'keyDown', keyCode: 't', modifiers: ['control', 'shift']});
    ui.sendInputEvent({type: 'keyUp', keyCode: 't', modifiers: ['control', 'shift']});
  }));
  const tabs = async () => (await t.state()).tabs;
  for (const n of ['a', 'b', 'c']) await t.act({type: 'tab.new', url: `${base}/${n}`, background: true});
  await poll(async () => (await tabs()).length === 4, Boolean, 'four tabs');
  const id = async n => (await tabs()).find(tab => tab.url === `${base}/${n}`)?.id;
  const ids = {a: await id('a'), b: await id('b'), c: await id('c')};
  // One close batch of three tabs (closes within a moment of each other share one Undo toast).
  for (const n of ['a', 'b', 'c']) await t.act({type: 'tab.close', id: ids[n]});
  await poll(async () => (await tabs()).length === 1, Boolean, 'batch of three closed');
  const batch = new Set((await t.state()).closedTabs.map(x => x.closedBatch));
  check(batch.size === 1, 'precondition: the three closes are ONE batch (' + [...batch].join(',') + ')');
  await press(); await sleep(400);
  let now = await tabs();
  check(now.length === 2 && now.some(x => x.id === ids.c) && !now.some(x => x.id === ids.a || x.id === ids.b), 'one Ctrl+Shift+T: exactly one tab back, the newest close (c); tabs now ' + now.length);
  await press(); await sleep(400); now = await tabs();
  check(now.length === 3 && now.some(x => x.id === ids.b) && !now.some(x => x.id === ids.a), 'second press: one more (b)');
  await press(); await sleep(400); now = await tabs();
  check(now.length === 4 && now.some(x => x.id === ids.a), 'third press: the last (a)');
  await press(); await sleep(400);
  check((await tabs()).length === 4, 'a fourth press has nothing to reopen');
  // A private tab comes back private, once, and leaves nothing in the saved closed list.
  await t.act({type: 'tab.new', url: `${base}/p`, privacy: 'private'});
  const priv = await poll(async () => (await tabs()).find(tab => tab.privacy === 'private'), Boolean, 'private tab');
  await t.act({type: 'tab.close', id: priv.id});
  await poll(async () => !(await tabs()).some(tab => tab.id === priv.id), Boolean, 'private tab closed');
  check((await t.state()).closedTabs.every(x => !x.privacy), 'the saved closed list holds no private tab');
  await press(); await sleep(500);
  now = await tabs();
  check(now.length === 5 && now.some(x => x.id === priv.id && x.privacy === 'private'), 'Ctrl+Shift+T reopened the private tab as a private tab');
} finally { await t.close?.(); }
process.exit(process.exitCode || 0);
