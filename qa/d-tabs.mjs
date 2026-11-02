// Stream D: tab operations backend - move to new window, duplicate, pin, mute, reopen closed, close others/left/right.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';
const root = '.qa-profiles/d-tabs'; await fs.rm(root, {recursive: true, force: true});
const fx = await httpFixture((req, res) => { res.setHeader('content-type', 'text/html'); res.end(`<title>${req.url}</title>x`); });
const base = `http://127.0.0.1:${fx.port}`, report = [];
const app = await startApp({root});
try {
  for (const p of ['/a', '/b', '/c']) { await app.act({type: 'tab.new', url: base + p}); await app.waitWeb(base + p); }
  let s = await app.state(); const b = s.tabs.find(t => t.url === base + '/b');
  const uiPages = () => app.context.pages().filter(p => p.url() === 'acira-browser-ui://ui/index.html').length;
  assert.equal(uiPages(), 1);
  await app.act({type: 'tab.move-window', id: b.id}); await poll(uiPages, n => n === 2, 'second window opens');
  s = await poll(() => app.state(), st => !st.tabs.some(t => t.id === b.id), 'tab leaves the source window'); report.push('move to new window opens a window and removes the tab here');
  const moved = await poll(() => app.web(u => u === base + '/b'), Boolean, 'moved page loads in the new window'); assert.equal(await moved.title(), '/b'); report.push('moved tab loads the same page');
  // Duplicate / pin / mute / reopen.
  s = await app.state(); const a = s.tabs.find(t => t.url === base + '/a');
  await app.act({type: 'tab.duplicate', id: a.id}); s = await app.state(); assert.equal(s.tabs.filter(t => t.url === base + '/a').length, 2); report.push('duplicate');
  await app.act({type: 'tab.pin', id: a.id}); s = await app.state(); assert.equal(s.tabs[0].id, a.id); assert.equal(s.tabs[0].pinned, true); report.push('pin moves to the pinned zone');
  await app.act({type: 'tab.mute', id: a.id, muted: true}); s = await app.state(); assert.equal(s.tabs.find(t => t.id === a.id).muted, true);
  const wcMuted = await app.main(({webContents}, u) => webContents.getAllWebContents().filter(w => w.getURL() === u).map(w => w.audioMuted), base + '/a'); assert.ok(wcMuted.includes(true), JSON.stringify(wcMuted)); report.push('mute reaches the native page');
  const c = s.tabs.find(t => t.url === base + '/c'); await app.act({type: 'tab.close', id: c.id}); s = await app.state(); assert.ok(s.closedTabs.some(t => t.url === base + '/c'));
  await app.act({type: 'tab.restore'}); s = await app.state(); assert.ok(s.tabs.some(t => t.url === base + '/c')); report.push('reopen closed tab');
  // Search shortcuts resolve natively too (the address bar sends the raw text).
  await app.act({type: 'tab.navigate', url: '!d acira browser'}); s = await app.state(); assert.equal(s.tabs.find(t => t.id === s.activeTabId).url, 'https://duckduckgo.com/?q=acira%20browser'); report.push('!d shortcut picks DuckDuckGo');
  for (const [typed, expected] of [['localhost:3000/x?y=1#z', 'http://localhost:3000/x?y=1#z'], ['127.0.0.1:8080', 'http://127.0.0.1:8080/'], ['[::1]:9000/p', 'http://[::1]:9000/p'], ['172.31.254.253', 'http://172.31.254.253/'], ['http://172.31.254.253/admin', 'http://172.31.254.253/admin'], ['https://172.31.254.253/', 'https://172.31.254.253/']]) { await app.act({type: 'tab.navigate', url: typed}); s = await app.state(); assert.equal(s.tabs.find(t => t.id === s.activeTabId).url, expected, typed); }
  report.push('local addresses keep scheme, port, path, query and fragment; no search');
} finally { await app.close(); await fx.close(); }
console.log(JSON.stringify({ok: true, report}, null, 1));
