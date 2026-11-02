// R3-73 live check (works against the source tree, or an installed build with D_APP_EXE): a website's permission request and its
// JavaScript confirm() each show ONE in-window card (desktop/site-prompt.cjs) instead of a separate system window, the page text
// stays text, and the answer reaches the page. qa/d-dialog.mjs still describes the retired separate question window.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';
process.env.D_VISIBLE ??= '1'; // the card sits on the page that is on screen: a hidden window shows no card
const root = '.qa-profiles/r3-site-prompt', shots = process.env.R3_SHOTS || 'qa/artifacts';
await fs.rm(root, {recursive: true, force: true}); await fs.mkdir(shots, {recursive: true});
const fx = await httpFixture((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<title>p</title>x'); });
const base = `http://127.0.0.1:${fx.port}`, report = [];
const app = await startApp({root});
const windows = () => app.main(({BaseWindow}) => BaseWindow.getAllWindows().length);
const cardPage = () => app.context.pages().find(p => { try { return p.url().includes('site-prompt.html'); } catch { return false; } });
const card = async (text, label) => { const page = await poll(cardPage, Boolean, label + ' card appears', 15000); await poll(() => page.locator('#title').textContent(), t => text.test(t), label + ' card text'); return page; };
const gone = () => poll(async () => { const p = cardPage(); if (!p) return true; try { return !(await p.locator('#card').isVisible()); } catch { return true; } }, Boolean, 'card hides', 10000);
try {
  await app.act({type: 'tab.new', url: base + '/'}); const page = await app.waitWeb(base + '/'); await sleep(500);
  const before = await windows();
  let answer = page.evaluate(() => Notification.requestPermission());
  const c1 = await card(/127\.0\.0\.1:\d+.*notifications/i, 'permission');
  assert.equal(await windows(), before, 'the card is a view in the window, not another window'); report.push('permission request shows an in-window card naming the site, no extra window');
  const labels = await c1.locator('button.act').allTextContents(); assert.ok(labels.includes('Block') && labels.includes('Allow'), JSON.stringify(labels)); report.push('card offers ' + labels.join(' / '));
  assert.equal(await c1.locator('#title img, #title script, #detail script, img[src*="javascript"]').count(), 0); report.push('site text is rendered as text');
  await c1.screenshot({path: `${shots}/r3-site-prompt-permission.png`});
  await c1.locator('button.act', {hasText: /^Block$/}).click(); assert.equal(await answer, 'denied'); await gone(); report.push('Block answers "denied" and the card hides');
  // Not remembered as a block-forever? A second request may ask again or answer from the saved choice; either way the page gets an answer.
  const again = await Promise.race([page.evaluate(() => Notification.requestPermission()), sleep(4000).then(() => 'asked')]);
  if (again === 'asked') { const c2 = await card(/notifications/i, 'second permission'); await c2.locator('button.act', {hasText: /^Allow$/}).click(); await gone(); report.push('a second request asks again and Allow is accepted'); }
  else report.push('second request answered from the saved choice: ' + again);
  // JavaScript confirm(): a centred card; OK answers true.
  await page.evaluate(() => { setTimeout(() => { window.__confirm = confirm('Really leave the <b>fixture</b>?'); }, 0); });
  const c3 = await card(/127\.0\.0\.1:\d+ says/, 'confirm'); assert.equal(await c3.locator('#detail').textContent(), 'Really leave the <b>fixture</b>?'); assert.equal(await c3.locator('#detail b').count(), 0);
  report.push('confirm() shows a card titled with the site; the page text is shown as plain text, not HTML');
  await c3.screenshot({path: `${shots}/r3-site-prompt-confirm.png`});
  await c3.locator('button.act', {hasText: /^OK$/}).click(); await poll(() => page.evaluate(() => window.__confirm), v => v === true, 'confirm answered true'); await gone(); report.push('OK answers confirm() with true');
  assert.equal(await windows(), before); report.push('no extra window opened at any point');
  console.log(JSON.stringify({status: 'PASS', report}, null, 1));
} finally { await app.close(); await fx.close(); }
