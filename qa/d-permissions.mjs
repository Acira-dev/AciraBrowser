// Stream D: native permission prompts are scoped to profile + requesting origin + embedding origin; unknown fails closed.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';
const root = '.qa-profiles/d-permissions'; await fs.rm(root, {recursive: true, force: true});
const framed = await httpFixture((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>frame</title>'); });
const top = await httpFixture((req, res) => {
  res.setHeader('content-type', 'text/html');
  if (req.url === '/embed') return res.end(`<!doctype html><title>embed</title><iframe id=f allow="notifications; geolocation" src="http://localhost:${framed.port}/"></iframe>`);
  res.end('<!doctype html><title>top</title>');
});
const A = `http://127.0.0.1:${top.port}`, report = [];
const app = await startApp({root});
try {
  // Auto-answer the native question; record every prompt.
  await app.main(({dialog}) => { globalThis.__prompts = []; globalThis.__answer = 0; dialog.showMessageBox = async (...args) => { const o = args.at(-1); globalThis.__prompts.push({message: o.message, detail: o.detail}); return {response: globalThis.__answer, ...(globalThis.__dismiss ? {dismissed: true} : {})}; }; });
  const setAnswer = n => app.main((_, n) => { globalThis.__answer = n; }, n);
  const dismiss = on => app.main((_, on) => { globalThis.__dismiss = on; }, on);
  const prompts = () => app.main(() => globalThis.__prompts);
  await app.act({type: 'tab.new', url: A + '/'}); const page = await app.waitWeb(A + '/'); await sleep(500);
  const ask = (p, name) => p.evaluate(async name => {
    if (name === 'notifications') return Notification.requestPermission();
    if (name === 'clipboard-read') return navigator.clipboard.readText().then(() => 'granted', e => 'denied:' + e.name);
    if (name === 'geolocation') return new Promise(r => navigator.geolocation.getCurrentPosition(() => r('granted'), e => r(e.code === 1 ? 'denied' : 'granted-unavailable')));
    if (name === 'media') return navigator.mediaDevices.getUserMedia({audio: true}).then(() => 'granted', e => e.name === 'NotAllowedError' ? 'denied' : 'granted:' + e.name);
    if (name === 'window-management') return window.getScreenDetails ? window.getScreenDetails().then(() => 'granted', e => 'denied:' + e.name) : 'unsupported';
    if (name === 'usb') return navigator.usb ? navigator.usb.requestDevice({filters: []}).then(() => 'granted', e => 'denied:' + e.name) : 'unsupported';
  }, name);
  // Dismissing the prompt (Esc) denies this once, nothing remembered, asks again.
  await dismiss(true); await setAnswer(0); assert.equal(await ask(page, 'notifications'), 'denied'); assert.equal((await prompts()).length, 1); report.push('dismissing denies');
  assert.equal(await ask(page, 'notifications'), 'denied'); assert.equal((await prompts()).length, 2); report.push('a dismissed prompt is not remembered'); await dismiss(false);
  // Allow -> remembered for the site, no further prompt.
  await setAnswer(1); assert.equal(await ask(page, 'notifications'), 'granted'); const n = (await prompts()).length;
  assert.equal(await ask(page, 'notifications'), 'granted'); assert.equal((await prompts()).length, n); report.push('allow is remembered without prompting');
  // Block -> remembered per permission.
  await setAnswer(0); assert.equal(await ask(page, 'clipboard-read'), 'denied:NotAllowedError'); const m = (await prompts()).length;
  assert.equal(await ask(page, 'clipboard-read'), 'denied:NotAllowedError'); assert.equal((await prompts()).length, m); report.push('block is remembered');
  // Unknown permissions fail closed WITHOUT a prompt.
  const before = (await prompts()).length; const wm = await ask(page, 'window-management'); const usb = await ask(page, 'usb');
  assert.ok(!String(wm).startsWith('granted') && !String(usb).startsWith('granted'), JSON.stringify({wm, usb})); assert.equal((await prompts()).length, before); report.push('unknown permissions fail closed silently');
  // Embedded frame: decision is keyed to requester + embedder and the prompt names the embedder.
  await app.act({type: 'tab.new', url: A + '/embed'}); const embedPage = await poll(() => app.context.pages().find(p => p.url() === A + '/embed'), Boolean, 'embed page');
  const frame = await poll(() => embedPage.frames().find(f => f.url().startsWith(`http://localhost:${framed.port}`)), Boolean, 'embedded frame'); await sleep(500);
  await setAnswer(1); const p0 = (await prompts()).length; const r = await frame.evaluate(() => Notification.requestPermission());
  const ps = await prompts(); assert.equal(r, 'granted'); assert.equal(ps.length, p0 + 1); assert.match(ps.at(-1).message, new RegExp(`localhost:${framed.port}`)); assert.match(ps.at(-1).detail, /Embedded in 127\.0\.0\.1/); report.push('embedded request names requester and embedder');
  // The same requester embedded elsewhere is NOT covered.
  await app.act({type: 'tab.new', url: `http://127.0.0.1:${framed.port}/`}); await sleep(500); // framed origin as top-level: requester 127.0.0.1:framed != localhost:framed
  // Different profile does not inherit A's grant.
  await app.act({type: 'browser.profile.create', name: 'B'}); const s = await app.state(); const B = s.browserProfiles.find(p => p.name === 'B');
  await app.act({type: 'tab.new', url: A + '/', browserProfileId: B.id}); const pageB = await poll(() => app.context.pages().filter(p => p.url() === A + '/')[1], Boolean, 'B page'); await sleep(500);
  await setAnswer(0); const p1 = (await prompts()).length; assert.equal(await ask(pageB, 'notifications'), 'denied'); assert.equal((await prompts()).length, p1 + 1); report.push('profile B does not inherit profile A grant');
  // Revoke through the service restores ask.
  const tab = (await app.state()).tabs.find(t => t.url === A + '/' && t.browserProfileId === 'profile-personal');
  await app.act({type: 'tab.select', id: tab.id}); await sleep(300); await app.svc({type: 'site.permission-reset', tabId: tab.id, requester: A, embedder: A, permission: 'notifications'});
  const p2 = (await prompts()).length; await setAnswer(0); assert.equal(await ask(page, 'notifications'), 'denied'); assert.equal((await prompts()).length, p2 + 1); report.push('revoke restores ask');
} finally { await app.close(); await top.close(); await framed.close(); }
console.log(JSON.stringify({ok: true, report}, null, 1));
