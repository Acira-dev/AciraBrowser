// R3-44 row "Chrome Web Store: extension install". Real network, real Chrome Web Store, one isolated profile, one app, closed in finally.
//   node qa/r3-proof/cws-install.mjs
// Both extensions go through Acira's own install path (window.acira.extensions({type:'install'}): store download, CRX3 check, permission review, load). The review
// message box is answered "Add" by the harness, like a click. uBlock Origin Lite and Dark Reader; Dark Reader's effect is then measured on a local page.
import fs from 'node:fs';
import path from 'node:path';
import {launch, install, installedManifest, sleep} from '../extension-matrix/lib.mjs';
import {httpFixture, poll} from '../d-harness.mjs';
import {probe, withSlot, capturePage} from './lib.mjs';

const P = probe('cws-install');
const UBO_LITE = 'ddkjiahejlhfcafbddmgiahcphecmpfh', DARK_READER = 'eimadpbcbfnmbkopoojfekhnkhdbieeh';
const site = await httpFixture((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>Extension target</title><body style="background:#ffffff;color:#111;font:20px system-ui"><h1>Ordinary page</h1><p>Plain white page; Dark Reader should turn it dark.</p>'); });

await withSlot('proof-cws-install', async () => {
  const app = await launch('proof-cws');
  try {
    const profile = (await app.state()).browserProfiles.find(p => p.id === app.profileId);
    for (const [id, name] of [[UBO_LITE, 'uBlock Origin Lite'], [DARK_READER, 'Dark Reader']]) {
      const done = await install(app, id);
      P.check(`${name}: installed from the Chrome Web Store through Acira's install path`, !done.error && done.entry, done.error || `${done.ms} ms, listed as "${done.entry?.name}" ${done.entry?.version || ''}`);
      const disk = await installedManifest(app, id);
      P.check(`${name}: unpacked into the profile with a Manifest V3 manifest`, disk?.manifest?.manifest_version === 3 && disk.manifest.name, disk ? `${disk.manifest.name} ${disk.manifest.version}, ${path.basename(disk.folder)}` : 'not in the registry');
    }
    const reviews = await app.reviews();
    P.check('a permission review was shown before each add', reviews.length >= 2 && /uBlock/i.test(JSON.stringify(reviews[0])) && /Dark Reader/i.test(JSON.stringify(reviews[1])), reviews.map(r => String(r.message || '').slice(0, 60)).join(' | '));
    const listed = (await app.ext({type: 'list'})).extensions || [];
    P.check('both extensions are enabled in the extension list', [UBO_LITE, DARK_READER].every(id => listed.find(e => e.id === id && e.enabled !== false)), JSON.stringify(listed.map(e => ({name: e.name, enabled: e.enabled}))));
    // Loaded into the browser session itself.
    const loaded = await app.main(({session}, partition) => session.fromPartition(partition).extensions.getAllExtensions().map(e => e.id), profile.partition).catch(error => ['error ' + error.message]);
    P.check('the engine has loaded both into the profile session', loaded.includes(UBO_LITE) && loaded.includes(DARK_READER), JSON.stringify(loaded));
    // Dark Reader on a page: a content script that restyles the page.
    await app.act({type: 'tab.new', url: `http://127.0.0.1:${site.port}/`});
    const page = await app.waitWeb(u => u.startsWith(`http://127.0.0.1:${site.port}`), 'target page');
    const probePage = () => page.evaluate(() => ({mode: document.documentElement.getAttribute('data-darkreader-mode'), scheme: document.documentElement.getAttribute('data-darkreader-scheme'), bg: getComputedStyle(document.body).backgroundColor, styles: document.querySelectorAll('style.darkreader,style[class*="darkreader"]').length}));
    const dark = await poll(probePage, v => v.mode || v.styles > 0, 'dark reader applied', 25000).catch(() => probePage());
    await sleep(800);
    const png = await capturePage(app, `127.0.0.1:${site.port}`, P.shot('dark-reader-applied.png'));
    const rgb = (dark.bg.match(/\d+/g) || [255, 255, 255]).slice(0, 3).map(Number);
    P.check('Dark Reader works on a page: the white page is turned dark', Boolean(dark.mode || dark.styles) && Math.max(...rgb) < 90, JSON.stringify(dark), png);
  } finally {
    await app.close();
  }
});
await site.close();
P.finish();
process.exit(P.checks.every(c => c.ok) && P.checks.length ? 0 : 1);
