// P1's Vimium tab-command rig (qa/extension-api-probe/tabs-store-ext.mjs) without its g$ / g0 steps. Vimium's "first" / "last" commands do not read sender.tab
// (they only call tabs.query), and those two key sequences do not take effect in this rig on this machine with or without the sender.tab fix, which
// knocked the rest of its sequence (<<, x) off page 2. Here the tab is selected directly, so K / J / << / x / t run as intended.
// Run from a short directory (see the rig's header):  node qa/p3-vimium-tabs.mjs
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'extension-api-probe');
const text = fs.readFileSync(path.join(dir, 'tabs-store-ext.mjs'), 'utf8');
const pattern = /  await press\('g', 'Shift\+4'\)[^\n]*\n[^\n]*\n  await press\('g', '0'\)[^\n]*\n[^\n]*\n/;
if (!pattern.test(text)) throw new Error('the g$ / g0 steps of the rig were not found');
const select = "  await act({type: 'tab.select', id: (await tabsNow()).find(t => t.url.endsWith('/p/1')).id}); await sleep(500);   // (p3-vimium-tabs.mjs: g$ / g0 replaced)\n";
const temp = path.join(dir, `tabs-store-ext.p3-${Date.now().toString(36)}.mjs`);
fs.writeFileSync(temp, text.replace(pattern, select));
try { await import(pathToFileURL(temp).href); }
finally { fs.rmSync(temp, {force: true}); }
