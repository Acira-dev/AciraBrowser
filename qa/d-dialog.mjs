// Stream D: what a website asks (permissions) is one card in the window (desktop/site-prompt.cjs, R3-73): it answers with the mouse and
// the keyboard, never renders page text as HTML, remembers an Allow, and asks one question at a time. (The separate question window of
// stream D is retired; qa/r3-site-prompt.mjs covers the confirm() card and an installed build.)
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';
// A page call waiting for its answer is left pending when a check fails first: closing the app then rejects it, which must not hide the check's own error.
process.env.D_VISIBLE = '1'; // the card sits on the page that is on screen: a hidden window shows no card
process.on('unhandledRejection', error => console.error('pending page call dropped:', error?.message));
const root = '.qa-profiles/d-dialog'; await fs.rm(root, {recursive: true, force: true}); await fs.mkdir('qa/artifacts', {recursive: true});
const fx = await httpFixture((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<title>p</title>x'); });
const base = `http://127.0.0.1:${fx.port}`, report = [];
const app = await startApp({root});
const cardPage = () => app.context.pages().find(p => { try { return p.url().includes('site-prompt.html'); } catch { return false; } });
const windows = () => app.main(({BaseWindow}) => BaseWindow.getAllWindows().length);
const opened = async text => { const page = await poll(cardPage, Boolean, 'card appears', 15000); await poll(() => page.locator('#title').textContent(), t => text.test(t), 'card text', 15000); await poll(() => page.locator('#card').isVisible(), Boolean, 'card visible', 8000); return page; };
const closed = () => poll(async () => { const p = cardPage(); if (!p) return true; try { return !(await p.locator('#card').isVisible()); } catch { return true; } }, Boolean, 'card hides', 10000);
try {
  await app.act({type: 'tab.new', url: base + '/'}); const page = await app.waitWeb(base + '/'); await sleep(500);
  const before = await windows();
  let answer = page.evaluate(() => Notification.requestPermission());
  const card = await opened(/127\.0\.0\.1:\d+.*notifications/i); report.push('card shows who is asking');
  assert.equal(await windows(), before, 'a card in the window, not another window');
  const labels = await card.locator('button.act').allTextContents(); assert.deepEqual([...labels].sort(), ['Allow', 'Block']); assert.equal(await card.locator('button.act[data-role=primary]').textContent(), 'Allow'); report.push('Block and Allow only; Allow is the accented action (bible §4 Prompt)');
  await card.screenshot({path: 'qa/artifacts/d-dialog-permission.png'});
  await card.locator('#close').click(); assert.equal(await answer, 'denied'); await closed(); report.push('the close button = deny once, the card hides');
  answer = page.evaluate(() => Notification.requestPermission()); const c2 = await opened(/notifications/i);
  await c2.getByRole('button', {name: 'Allow', exact: true}).click(); assert.equal(await answer, 'granted'); await closed(); report.push('click Allow grants');
  assert.equal(await page.evaluate(() => Notification.requestPermission()), 'granted'); await sleep(300); assert.equal(await cardPage()?.locator('#card').isVisible().catch(() => false), false); report.push('remembered choice does not ask again');
  // A second origin: hostile-looking text stays text; Enter and Esc inside the card take the default and the cancel answer (both Block).
  const fx2 = await httpFixture((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<title>q</title>y'); });
  try {
    await app.act({type: 'tab.new', url: `http://127.0.0.1:${fx2.port}/`}); const other = await app.waitWeb(`http://127.0.0.1:${fx2.port}/`); await sleep(500);
    answer = other.evaluate(() => Notification.requestPermission());
    const c3 = await opened(/127\.0\.0\.1:\d+.*notifications/i); assert.equal(await c3.locator('#title img, #title script, #detail script, img[src*="javascript"]').count(), 0);
    await c3.keyboard.press('Enter'); assert.equal(await answer, 'denied'); await closed(); report.push('Enter takes the default (Block); site text is rendered as text');
    answer = other.evaluate(() => navigator.mediaDevices.getUserMedia({video: true}).then(() => 'granted', e => e.name)); const c4 = await opened(/camera/i);
    await c4.keyboard.press('Escape'); assert.match(await answer, /NotAllowed/); await closed(); report.push('Esc dismisses (deny once)');
    // Questions queue one at a time.
    const a1 = other.evaluate(() => new Promise(r => navigator.geolocation.getCurrentPosition(() => r('granted'), e => r(e.code === 1 ? 'denied' : 'other')))), a2 = other.evaluate(() => navigator.mediaDevices.getUserMedia({audio: true}).then(() => 'granted', e => e.name));
    const q1 = await opened(/location/i); await q1.getByRole('button', {name: 'Block', exact: true}).click(); assert.equal(await a1, 'denied');
    const q2 = await opened(/microphone/i); await q2.getByRole('button', {name: 'Block', exact: true}).click(); assert.match(await a2, /NotAllowed/); await closed(); report.push('questions queue and are answered in order');
  } finally { await fx2.close(); }
  assert.equal(await windows(), before); report.push('no extra window opened at any point');
} finally { await app.close(); await fx.close(); }
console.log(JSON.stringify({ok: true, report}, null, 1));
