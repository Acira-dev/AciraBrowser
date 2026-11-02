// R3-12: pop-up and pop-under ads in the real isolated app, on pages served locally.   node qa/r3-popup-ads.mjs   (cwd = worktree root; D_VISIBLE=1 for the pop-under part)
// Names that look like real sites are mapped to 127.0.0.1 with --host-resolver-rules, so the real rules (popads.net, exoclick.com ...) see real-looking hosts.
// No credentials are typed anywhere: the "sign-in" page is a static page and only has to open.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {startApp, sleep, poll} from './d-harness.mjs';

const results = [];
const note = (name, ok, detail = '') => { results.push({name, ok, detail}); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' :: ' + detail : '')); };

async function withSlot(name, fn) {
  const until = Date.now() + 20 * 60 * 1000; let held = null;
  while (!held && Date.now() < until) {
    for (const n of [1, 2, 3]) {
      const file = `C:\\ae\\slot-${n}.lock`;
      try { const fd = fs.openSync(file, 'wx'); fs.writeSync(fd, `${name} ${new Date().toISOString()}`); fs.closeSync(fd); held = file; break; } catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    if (!held) await sleep(30000);
  }
  if (!held) throw new Error('No native slot became free in 20 minutes.');
  try { return await fn(); } finally { try { fs.unlinkSync(held); } catch {} }
}

const root = path.resolve('.qa-profiles/r3-popup-ads');
fs.rmSync(root, {recursive: true, force: true});
fs.mkdirSync(root, {recursive: true});

let PORT = 0;
const hits = [];
const page = body => `<!doctype html><meta charset=utf-8><title>t</title><style>body{font:16px system-ui;margin:0;padding:24px}button,a.btn{display:block;width:420px;height:44px;margin:0 0 14px;font-size:16px}a.btn{border:1px solid #888;line-height:44px;text-align:center;text-decoration:none;color:inherit}</style>${body}`;
const ORIGIN = () => `http://streamtest.com:${PORT}`;
const server = http.createServer((req, res) => {
  const host = String(req.headers.host || '').split(':')[0];
  hits.push(host + req.url);
  res.setHeader('content-type', 'text/html');
  if (host === 'streamtest.com' && req.url === '/') {
    const ad = host2 => `http://${host2}:${PORT}`;
    return res.end(page(`<h2>Test streaming page</h2>
<button id=ad-click onclick="window.open('${ad('popads.net')}/ad','_blank')">Play (opens a listed ad network)</button>
<a class=btn id=ad-link target=_blank href="${ad('exoclick.com')}/ad">Overlay link to a listed ad network</a>
<button id=unlisted-under onclick="var w=window.open('${ad('unlisted-ads.test')}/under','_blank','width=420,height=320,left=40,top=40');try{w.blur();}catch(e){}window.focus();setTimeout(function(){window.focus()},120)">Pop-under to an unlisted host</button>
<button id=fake-ctrl onclick="var a=document.createElement('a');a.href='${ad('popads.net')}/ctrl';a.target='_blank';document.body.appendChild(a);a.dispatchEvent(new MouseEvent('click',{ctrlKey:true,bubbles:true,cancelable:true}))">Synthetic Ctrl+click on a listed network (modern pop-under)</button>
<button id=bridge-js onclick="window.open('${ad('bridge-ads.test')}/bridge-js','_blank')">Bridge page that moves itself to a listed network</button>
<button id=bridge-302 onclick="window.open('${ad('bridge-ads.test')}/bridge-302','_blank')">Bridge page redirected to a listed network</button>
<button id=signin onclick="window.open('${ad('idp-login.test')}/oauth2/authorize?client_id=1&redirect_uri=x','login','width=480,height=560')">Sign in with a provider</button>
<a class=btn id=newtab target=_blank href="${ad('news.test')}/story">Open a story in a new tab</a>
<button id=own onclick="window.open('/popout','popout','width=420,height=320')">Pop out the player (same site)</button>
<button id=twice onclick="window.open('${ad('partner-one.test')}/a','_blank');window.open('${ad('partner-two.test')}/b','_blank')">Two windows at once</button>`));
  }
  if (req.url.startsWith('/bridge-302')) { res.statusCode = 302; res.setHeader('location', `http://popads.net:${PORT}/landing`); return res.end(); }
  if (req.url.startsWith('/bridge-js')) return res.end(page(`<p>one moment…</p><script>setTimeout(function(){location.replace('http://popads.net:${PORT}/landing')},150)</script>`));
  res.end(page(`<h3>${host}${req.url}</h3><p>This is only a test page.</p>`));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
PORT = server.address().port;

const HOSTS = ['streamtest.com', 'popads.net', 'exoclick.com', 'unlisted-ads.test', 'bridge-ads.test', 'idp-login.test', 'news.test', 'partner-one.test', 'partner-two.test'];
const mapRules = HOSTS.map(host => `MAP ${host} 127.0.0.1`).join(', ');

await withSlot('privacy-r3-popup-ads', async () => {
  const app = await startApp({root, args: [`--host-resolver-rules=${mapRules}`]});
  try {
    const tabs = async () => (await app.state()).tabs.map(tab => tab.url);
    const windows = () => app.main(({BrowserWindow}) => BrowserWindow.getAllWindows().filter(win => !win.isDestroyed()).map(win => win.webContents.getURL()).filter(url => /^https?:/.test(url)));
    const closeWindows = () => app.main(({BrowserWindow}) => { for (const win of BrowserWindow.getAllWindows()) { try { if (/^https?:/.test(win.webContents.getURL())) win.destroy(); } catch {} } });
    const closeExtraTabs = async () => { for (const tab of (await app.state()).tabs) if (tab.url && !tab.url.startsWith(ORIGIN()) && /^https?:/.test(tab.url)) await app.act({type: 'tab.close', id: tab.id}); };
    const toastText = async () => JSON.stringify((await app.state()).toast || '');
    const click = async id => {
      const rect = await app.main(async ({webContents}, [origin, id]) => {
        const wc = webContents.getAllWebContents().find(w => w.getURL().startsWith(origin));
        if (!wc) throw new Error('no opener page');
        return wc.executeJavaScript(`(()=>{const r=document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
      }, [ORIGIN(), id]);
      await app.main(async ({webContents}, [origin, rect]) => {
        const wc = webContents.getAllWebContents().find(w => w.getURL().startsWith(origin));
        wc.focus();
        wc.sendInputEvent({type: 'mouseMove', x: rect.x, y: rect.y});
        await new Promise(r => setTimeout(r, 150));
        wc.sendInputEvent({type: 'mouseDown', x: rect.x, y: rect.y, button: 'left', clickCount: 1});
        wc.sendInputEvent({type: 'mouseUp', x: rect.x, y: rect.y, button: 'left', clickCount: 1});
      }, [ORIGIN(), rect]);
    };
    await app.act({type: 'tab.new', url: ORIGIN() + '/'});
    await poll(tabs, list => list.some(url => url.startsWith(ORIGIN())), 'opener open', 20000);
    await sleep(1200);
    const adminTab = (await app.state()).tabs.find(tab => tab.url.startsWith(ORIGIN()));

    // 1. A listed ad network opened by a script on a real click is refused.
    await click('ad-click'); await sleep(1200);
    let w = await windows(), t = await tabs();
    note('script-opened ad network (popads.net) refused', !w.some(u => u.includes('popads.net')) && !t.some(u => u.includes('popads.net')), `windows=${w.length} tabs=${t.length}`);
    note('a "Pop-up ad blocked" notice is shown', /Pop-up ad blocked/.test(await toastText()), await toastText());

    // 2. A transparent overlay link to a listed network is refused.
    await sleep(4200);
    await click('ad-link'); await sleep(1200);
    w = await windows(); t = await tabs();
    note('overlay link to a listed network (exoclick.com) refused', !w.some(u => u.includes('exoclick')) && !t.some(u => u.includes('exoclick')), `windows=${w.length} tabs=${t.length}`);

    // 2b. A script that fakes a Ctrl+click (the usual modern pop-under) is refused too.
    await sleep(4200);
    await click('fake-ctrl'); await sleep(1200);
    w = await windows(); t = await tabs();
    note('synthetic Ctrl+click to a listed network refused', !w.some(u => u.includes('popads.net')) && !t.some(u => u.includes('popads.net')), `windows=${w.length} tabs=${t.length}`);

    // 3. A pop-under to an unlisted host is closed after it sinks behind the page (the page's window gets focus back, as window.focus() did in older engines).
    await sleep(4200);
    await click('unlisted-under'); await sleep(200);
    w = await windows();
    const opened = w.some(u => u.includes('unlisted-ads.test'));
    await app.main(({BaseWindow, BrowserWindow}) => { const main = BaseWindow.getAllWindows().find(win => !(win instanceof BrowserWindow)); if (main) main.focus(); });
    await sleep(1500);
    w = await windows();
    note('pop-under to an unlisted host closes itself', opened && !w.some(u => u.includes('unlisted-ads.test')), `openedAtFirst=${opened} windowsAfter=${w.length}`);
    note('a "Pop-under ad closed" notice is shown', /Pop-under ad closed/.test(await toastText()), await toastText());
    await closeWindows();

    // 4. A bridge page that moves itself, or is redirected, to a listed network is closed.
    for (const id of ['bridge-js', 'bridge-302']) {
      await sleep(4200);
      await click(id); await sleep(2200);
      w = await windows(); t = await tabs();
      note(`${id}: window closed once it heads for a listed network`, !w.some(u => u.includes('popads.net') || u.includes('bridge-ads.test')), `windows=${JSON.stringify(w)}`);
      await closeWindows();
    }

    // 5. A sign-in window opens and stays open, even when nobody touches it.
    await sleep(4200);
    await click('signin'); await sleep(3500);
    w = await windows();
    note('sign-in window (OAuth-shaped address) opens and stays', w.some(u => /idp-login\.test:\d+\/oauth2\/authorize/.test(u)), JSON.stringify(w));
    await closeWindows();

    // 6. "Open in a new tab" by link opens a tab.
    await sleep(1200);
    await click('newtab'); await sleep(1500);
    t = await tabs();
    note('a link the person clicked opens a new tab', t.some(u => /news\.test:\d+\/story/.test(u)), JSON.stringify(t));
    await closeExtraTabs();

    // 7. The site's own pop-out window opens.
    await sleep(4200);
    await click('own'); await sleep(1500);
    w = await windows();
    note('the site\'s own pop-out window opens', w.some(u => u.includes('/popout')), JSON.stringify(w));
    await closeWindows();

    // 8. Two script-opened windows from one click: the second is refused.
    await sleep(4200);
    await click('twice'); await sleep(1800);
    w = await windows();
    note('two windows at once: only the first opens', w.filter(u => /partner-(one|two)/.test(u)).length === 1, JSON.stringify(w));
    await closeWindows();

    // 9. Turned off for this site, the same ad opens.
    await app.svc({type: 'filters.set', tabId: adminTab.id, scope: 'site', patch: {popupAds: false}});
    const status = (await app.svc({type: 'filters.status', tabId: adminTab.id})).filters;
    note('filters.status reports the site switch off', status.popupAds === false, JSON.stringify({popupAds: status.popupAds}));
    await sleep(4200);
    await click('ad-click'); await sleep(1800);
    w = await windows(); t = await tabs();
    note('with the site switch off the listed ad opens (control)', w.some(u => u.includes('popads.net')) || t.some(u => u.includes('popads.net')), `windows=${JSON.stringify(w)}`);
    await closeWindows(); await closeExtraTabs();
    await app.svc({type: 'filters.set', tabId: adminTab.id, scope: 'site', patch: {popupAds: true}});
    await sleep(4200);
    await click('ad-click'); await sleep(1500);
    w = await windows();
    note('switched back on, it is refused again', !w.some(u => u.includes('popads.net')), JSON.stringify(w));
  } finally {
    await app.close();
  }
});
server.close();
const failed = results.filter(r => !r.ok);
fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify({results, hits}, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
