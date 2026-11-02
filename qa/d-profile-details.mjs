// Stream D: profile picture, email and default profile — set through the real action boundary, kept across a restart,
// refused when invalid, and used to decide which profile a link from another app opens in.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';
const root = '.qa-profiles/d-profile-details'; await fs.rm(root, {recursive: true, force: true});
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
const fx = await httpFixture((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<title>link</title>x'); });
const link = `http://127.0.0.1:${fx.port}/from-another-app`, report = [];
const uiPages = app => app.context.pages().filter(p => { try { return p.url() === 'acira-browser-ui://ui/index.html'; } catch { return false; } });
const snapshots = async app => { const out = []; for (const page of uiPages(app)) { try { out.push(await page.evaluate(() => window.acira.getSnapshot())); } catch {} } return out; };
let app = await startApp({root}), workId;
try {
  await app.act({type: 'browser.profile.create', name: 'Work'});
  workId = (await app.state()).browserProfiles.find(p => p.name === 'Work').id;
  for (const bad of [{picture: 'javascript:alert(1)'}, {picture: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='}, {email: 'not an email'}, {default: 'yes'}])
    await assert.rejects(app.act({type: 'browser.profile.update', id: workId, ...bad}), /PNG, JPEG or WebP|email|true or false/i, JSON.stringify(bad).slice(0, 40));
  report.push('invalid picture, email and default are refused');
  await app.act({type: 'browser.profile.update', id: workId, picture: PNG, email: 'me@work.example', default: true});
  let s = await app.state(), work = s.browserProfiles.find(p => p.id === workId);
  assert.equal(work.picture, PNG); assert.equal(work.email, 'me@work.example'); assert.equal(s.settings.defaultProfileId, workId); report.push('picture, email and default are stored');
  // A link from another app opens in the default profile, in a window of its own, though the window in front is another profile.
  assert.notEqual(s.activeBrowserProfileId, workId);
  await app.main(({app: electron}, url) => { electron.emit('second-instance', {}, ['AciraBrowser.exe', url], process.cwd()); }, link);
  await poll(async () => (await snapshots(app)).some(x => x.activeBrowserProfileId === workId && x.tabs.some(t => t.url === link)), Boolean, 'link opened in the Work window', 20000);
  assert.equal(uiPages(app).length, 2, 'a Work window was opened for it'); report.push('an outside link opens in the default profile');
  await sleep(1200);
} finally { await app.close(); }
await sleep(1500);
app = await startApp({root, skipSetup: false});
try {
  await sleep(2500);
  const all = await snapshots(app), s = all[0], work = s.browserProfiles.find(p => p.id === workId);
  assert.equal(work.picture, PNG); assert.equal(work.email, 'me@work.example'); assert.equal(s.settings.defaultProfileId, workId); report.push('all three survive a restart');
  await app.act({type: 'browser.profile.update', id: workId, picture: null, email: null, default: false});
  const cleared = (await app.state()); assert.equal(cleared.browserProfiles.find(p => p.id === workId).picture, undefined); assert.equal(cleared.settings.defaultProfileId, undefined); report.push('null and default:false clear them');
} finally { await app.close(); await fx.close(); }
console.log(JSON.stringify({ok: true, report}, null, 1));
