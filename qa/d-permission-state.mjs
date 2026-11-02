// Stream D: a site that looks before it asks ("Notification.permission", "permissions.query") must hear "default" / "prompt" for a question
// nobody has answered, so it goes on to ask; after the person answers, the page hears granted / denied.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {startApp, httpFixture, sleep} from './d-harness.mjs';
const root = '.qa-profiles/d-permission-state'; await fs.rm(root, {recursive: true, force: true});
const top = await httpFixture((req, res) => {
  res.setHeader('content-type', 'text/html');
  res.end('<!doctype html><title>top</title>');
});
const A = `http://127.0.0.1:${top.port}`, report = [];
const app = await startApp({root});
try {
  await app.main(({dialog}) => { globalThis.__prompts = 0; globalThis.__answer = 0; dialog.showMessageBox = async () => { globalThis.__prompts++; return {response: globalThis.__answer}; }; });
  const answer = n => app.main((_, n) => { globalThis.__answer = n; }, n), prompts = () => app.main(() => globalThis.__prompts);
  await app.act({type: 'tab.new', url: A + '/'}); const page = await app.waitWeb(A + '/'); await sleep(500);
  const look = () => page.evaluate(async () => {
    const query = async name => (await navigator.permissions.query({name})).state;
    return {notification: Notification.permission, notifications: await query('notifications'), geolocation: await query('geolocation'), camera: await query('camera'), microphone: await query('microphone')};
  });
  // Nobody has been asked: the page sees an open question, not a refusal.
  assert.deepEqual(await look(), {notification: 'default', notifications: 'prompt', geolocation: 'prompt', camera: 'prompt', microphone: 'prompt'}); assert.equal(await prompts(), 0, 'looking never asks');
  report.push('undecided: default / prompt, and looking asks nothing');
  // The page looks, sees "default", and asks: the question appears; Allow is then what the page hears.
  await answer(1); assert.equal(await page.evaluate(() => Notification.requestPermission()), 'granted'); assert.equal(await prompts(), 1);
  assert.deepEqual(await look(), {notification: 'granted', notifications: 'granted', geolocation: 'prompt', camera: 'prompt', microphone: 'prompt'}); report.push('after Allow: granted, other questions still open');
  // Block is remembered and read back as denied.
  await answer(0); await page.evaluate(() => new Promise(r => navigator.geolocation.getCurrentPosition(() => r(), () => r())));
  assert.equal((await look()).geolocation, 'denied'); report.push('after Block: denied');
  // Camera and microphone are separate questions.
  await answer(1); await page.evaluate(() => navigator.mediaDevices.getUserMedia({audio: true}).then(s => s.getTracks().forEach(t => t.stop()), () => {}));
  const media = await look(); assert.equal(media.microphone, 'granted'); assert.equal(media.camera, 'prompt'); report.push('microphone answered, camera still open');
  // The answer carries into the same site's next page and survives a reload.
  await page.reload(); await sleep(500); assert.equal((await look()).notification, 'granted'); report.push('kept across a reload');
  // Reset puts the question back to open.
  const tab = (await app.state()).tabs.find(t => t.url.startsWith(A));
  await app.svc({type: 'site.permission-reset', tabId: tab.id, requester: A, embedder: A, permission: 'notifications'}); await page.reload(); await sleep(500);
  assert.equal((await look()).notification, 'default'); report.push('reset: open again');
  // Frames inside the page keep the engine's plain answer: preload scripts only run in a tab's main frame (no nodeIntegrationInSubFrames).
} finally { await app.close(); await top.close(); }
console.log(JSON.stringify({ok: true, report}, null, 1));
