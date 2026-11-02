// R3-58: the real app reports only the first system language as what websites see (the chrome-identity fix), the same as navigator.languages in a page.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {startApp, sleep} from './d-harness.mjs';
const ROOT = '.qa-profiles/r3-language-status'; await fs.rm(ROOT, {recursive: true, force: true});
async function takeSlot(name) { for (let i = 0; i < 40; i++) { for (const n of [1, 2, 3]) { try { const h = await fs.open(`C:/ae/slot-${n}.lock`, 'wx'); await h.write(`${name} ${new Date().toISOString()}`); await h.close(); return n; } catch (e) { if (e.code !== 'EEXIST') throw e; } } await sleep(30000); } throw new Error('no slot'); }
const slot = await takeSlot('network-r3-58'); let app;
try {
  app = await startApp({root: ROOT});
  const status = (await app.svc({type: 'website-language.status'})).websiteLanguages;
  await app.act({type: 'tab.new', url: 'acira://new'});
  const system = await app.main(({app}) => app.getPreferredSystemLanguages());
  console.log(JSON.stringify({system, current: status.current, visible: status.visible, willSee: status.willSee, choice: status.choice}));
  assert.equal(status.visible.length, 1, 'only the first language is visible by default');
  assert.equal(status.visible[0], status.current[0]);
  console.log('PASS visible =', status.visible.join(','));
} catch (error) { console.log('FAILED', error.message); process.exitCode = 1; }
finally { try { await app?.close(); } catch {} await fs.rm(`C:/ae/slot-${slot}.lock`, {force: true}); }
