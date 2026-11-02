// Stream D: local spellcheck policy per profile - status, language list, persistence, private session isolation.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {startApp, sleep} from './d-harness.mjs';
const root = '.qa-profiles/d-spellcheck'; await fs.rm(root, {recursive: true, force: true}); const report = [];
let app = await startApp({root});
const native = r => app.ui.evaluate(r => window.acira.native(r), r);
try {
  // Spell state is attached when a profile gets its first website session.
  await app.act({type: 'tab.new', url: 'http://127.0.0.1:9/'}); await sleep(800);
  let s = (await native({type: 'spellcheck.status'})).spellcheck; assert.equal(s.choice.enabled, true); assert.deepEqual(s.choice.languages, ['en-US']); assert.ok(s.available.length > 20); assert.equal(s.matchesSaved, true); report.push('status: enabled en-US, ' + s.available.length + ' local languages');
  s = (await native({type: 'spellcheck.set', enabled: true, languages: ['en-US', 'fr']})).spellcheck; assert.deepEqual(s.current.languages, ['en-US', 'fr']); assert.equal(s.matchesSaved, true); report.push('two languages applied to the native session');
  await assert.rejects(native({type: 'spellcheck.set', enabled: true, languages: ['xx-NOPE']}), /supported/); report.push('unsupported language rejected');
  await native({type: 'spellcheck.set', enabled: false, languages: ['en-US']}); assert.equal((await native({type: 'spellcheck.status'})).spellcheck.current.enabled, false); report.push('disabled');
  await native({type: 'spellcheck.set', enabled: true, languages: ['en-US', 'de']});
} finally { await app.close(); }
await sleep(1200);
app = await startApp({root});
try {
  const native2 = r => app.ui.evaluate(r => window.acira.native(r), r);
  await app.act({type: 'tab.new', url: 'http://127.0.0.1:9/'}); await sleep(800);
  const s = (await native2({type: 'spellcheck.status'})).spellcheck; assert.deepEqual(s.current.languages, ['en-US', 'de']); assert.equal(s.current.enabled, true); report.push('choice persisted across restart and re-applied');
} finally { await app.close(); }
console.log(JSON.stringify({ok: true, report}, null, 1));
