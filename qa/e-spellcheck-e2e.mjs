// Stream E: spelling dictionaries end to end against a LOCAL mirror. Fetches one real dictionary (the file the mirror script would upload),
// serves it from 127.0.0.1 as if it were the 'spellcheck-dictionaries' release, points the app at it with ACIRA_SPELLCHECK_DICTIONARY_URL,
// asks for Polish and waits for Chromium's own download-success event. Needs internet once (to fetch the dictionary).
//   node qa/e-spellcheck-e2e.mjs
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {startApp, httpFixture, sleep} from './d-harness.mjs';
const name = 'pl-pl-3-0.bdic';
const source = await fetch('https://redirector.gvt1.com/edgedl/chrome/dict/' + name).catch(() => null);
if (!source?.ok) { console.log(JSON.stringify({ok: true, skipped: 'offline'})); process.exit(0); }
const bytes = Buffer.from(await source.arrayBuffer()), seen = [];
const mirror = await httpFixture((req, res) => { seen.push(req.url); if (req.url === '/' + name) { res.setHeader('content-type', 'application/octet-stream'); res.end(bytes); } else { res.statusCode = 404; res.end(); } });
await fs.rm('.qa-profiles/e-spellcheck', {recursive: true, force: true});
const app = await startApp({root: '.qa-profiles/e-spellcheck', env: {ACIRA_SPELLCHECK_DICTIONARY_URL: `http://127.0.0.1:${mirror.port}/`}});
try {
  await app.main(({session}) => { globalThis.__dict = []; for (const s of [session.defaultSession]) { s.on('spellcheck-dictionary-download-success', (_e, lang) => globalThis.__dict.push('success ' + lang)); s.on('spellcheck-dictionary-download-failure', (_e, lang) => globalThis.__dict.push('failure ' + lang)); s.on('spellcheck-dictionary-initialized', (_e, lang) => globalThis.__dict.push('initialized ' + lang)); s.setSpellCheckerEnabled(true); s.setSpellCheckerLanguages(['pl']); } });
  let events = []; for (let i = 0; i < 40 && !events.some(e => /^(success|failure)/.test(e)); i++) { await sleep(500); events = await app.main(() => globalThis.__dict); }
  const result = {requested: seen, events, sha256: createHash('sha256').update(bytes).digest('hex').slice(0, 12), bytes: bytes.length};
  console.log(JSON.stringify(result));
  if (!events.some(e => e === 'success pl') || !seen.includes('/' + name)) { console.error('FAIL: dictionary was not downloaded from the mirror'); process.exitCode = 1; }
  else console.log(JSON.stringify({ok: true}));
} finally { await app.close(); await mirror.close(); }
