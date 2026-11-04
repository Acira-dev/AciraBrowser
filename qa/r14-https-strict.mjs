// Strict HTTPS-only mode ("Always use HTTPS") and the "No secure connection" page ask one question, not two. Before: Continue over http
// opened http, strict mode upgraded it again and asked its own question; a site the profile had chosen opened http by itself and strict
// mode asked anyway. Now the page is the one question, its answer is strict mode's answer for this tab, nothing is kept while strict mode
// is on, and a kept choice never opens http by itself in strict mode. Strict mode's own question still guards every other http address.
//   node qa/r14-https-strict.mjs [shots]     (R14_ROOT=.qa-profiles/<folder> picks the profile folder; shots of the note go there)
// Native dialogs are stubbed in the main process and counted: nothing can appear on screen, and the count is the number of questions.
// Prints one JSON line; exit code 1 when anything asked twice or opened http without asking.
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp, httpFixture, sleep} from './d-harness.mjs';

const root = process.env.R14_ROOT || '.qa-profiles/r14-strict-' + process.pid; await fs.rm(root, {recursive: true, force: true}); await fs.mkdir(root, {recursive: true});
const shots = process.argv.includes('shots'), seen = {}, problems = [];
let hits = 0;
const site = await httpFixture((_request, response) => { hits++; response.setHeader('content-type', 'text/html'); response.end('<title>plain site</title><h1>plain</h1>'); });
// A name with no port, as people type it: an address with a port (or a reserved name such as .example) opens over http without an https try
// (src/runtime/navigation.ts). Both its https and http ports go to the local http server; the name never reaches real DNS.
const address = 'http-only.example.com', hostRules = `--host-resolver-rules=MAP http-only.example.com:443 127.0.0.1:${site.port},MAP http-only.example.com:80 127.0.0.1:${site.port},EXCLUDE localhost`;
const app = await startApp({root, args: ['--use-mock-keychain', hostRules], env: {ACIRA_BROWSER_TEST_DOWNLOAD_DIR: path.join(path.resolve(root), 'downloads')}});
const lastTab = async () => (await app.state()).tabs.at(-1);
const asked = () => app.main(() => globalThis.__r14Asked.slice());
const until = async (fn, ms) => { const end = Date.now() + ms; while (Date.now() < end) { const value = await fn(); if (value) return value; await sleep(150); } return null; };
const page = app.ui, opened = t => t.title === 'plain site' && t.url.startsWith('http://');
async function answerPage() {
  const link = page.getByRole('button', {name: /Continue over http \(not secure\)/}); await link.waitFor({timeout: 8000}); await link.click();
  await page.getByRole('group', {name: 'Continue over http'}).waitFor({timeout: 5000});
  const note = await page.locator('.ne-unsafe [role=group] .ne-note').textContent();
  await page.locator('.ne-unsafe [role=group] .ne-button').click();
  return note;
}
async function typed(label) { const q = (await asked()).length; await app.act({type: 'tab.new', url: address}); const tab = await until(async () => { const t = await lastTab(); return t.error || t.url.startsWith('http://') ? t : null; }, 20000); await sleep(1500); const now = await lastTab(); return {label, error: tab?.error || null, urlAfterWait: now.url, openedByItself: now.url.startsWith('http://'), nativeQuestions: (await asked()).slice(q)}; }
try {
  if (await app.main(({app}) => app.commandLine.hasSwitch('use-mock-keychain')) !== true) throw new Error('mock keychain');
  const userData = await app.main(({app}) => app.getPath('userData')), real = await fs.realpath(userData);
  if (!path.resolve(userData).startsWith(path.resolve(root))) throw new Error('throwaway profile only: ' + userData);
  seen.profile = real;
  // Every native question is counted and answered Cancel.
  await app.main(({dialog}) => { globalThis.__r14Asked = []; for (const name of ['showMessageBox', 'showMessageBoxSync']) dialog[name] = (...a) => { const o = a.at(-1) || {}; globalThis.__r14Asked.push(String(o.title || o.message || '')); return name.endsWith('Sync') ? 0 : Promise.resolve({response: 0, checkboxChecked: false}); }; });
  await app.act({type: 'settings.update', patch: {language: 'en', appearance: 'light', interfaceScale: 100}});
  await app.svc({type: 'https.set', enabled: true});

  // 1. Strict mode on, a typed address with no secure connection: one question, on the page.
  let step = await typed('strict: first visit'); const before1 = hits;
  if (step.openedByItself) problems.push('strict: opened http by itself');
  step.note = await answerPage();
  step.openedAfterAnswer = Boolean(await until(async () => opened(await lastTab()), 10000)); step.questionsAfterAnswer = await asked(); step.httpRequests = hits - before1;
  if (!step.openedAfterAnswer) problems.push('strict: the answer did not open the page');
  if (step.questionsAfterAnswer.length) problems.push('strict: asked again after the page: ' + step.questionsAfterAnswer.join(' / '));
  if (!/Acira asks again next time/.test(step.note)) problems.push('strict: the note does not say it asks again: ' + step.note);
  seen.strictFirst = step;
  if (shots) for (const appearance of ['light', 'dark']) { await app.act({type: 'tab.new', url: address}); await until(async () => (await lastTab()).error, 20000); await app.act({type: 'settings.update', patch: {appearance}}); await sleep(900); await page.getByRole('button', {name: /Continue over http/}).click(); await sleep(400); await page.locator('.navigation-error').screenshot({path: path.join(root, `strict-note-${appearance}.png`)}); }
  await app.act({type: 'settings.update', patch: {appearance: 'light'}});

  // 2. Strict mode keeps nothing: the next visit asks again, and nothing opens by itself.
  step = await typed('strict: next visit'); seen.strictNext = step; if (step.openedByItself || step.nativeQuestions.length) problems.push('strict: the answer was kept (the next visit opened http or asked a native question)');

  // 3. Strict mode off: the answer is kept for this profile, as the page says.
  await app.svc({type: 'https.set', enabled: false});
  step = await typed('ordinary: first visit'); seen.ordinaryFirst = step;
  if (step.openedByItself) problems.push('strict: the answer given in strict mode was kept, so this visit opened http by itself');
  else { step.note = await answerPage(); step.opened = Boolean(await until(async () => opened(await lastTab()), 10000)); if (!step.opened || !/remembers this choice/.test(step.note)) problems.push('ordinary: the kept choice or its note changed'); }
  step = await typed('ordinary: next visit'); seen.ordinaryNext = step; if (!step.openedByItself) problems.push('ordinary: the kept choice did not open the site');

  // 4. Strict mode on again: the kept choice does not open http by itself; the page asks once and its answer is enough.
  await app.svc({type: 'https.set', enabled: true}); const questions = (await asked()).length, before4 = hits;
  step = await typed('strict: a kept site'); step.httpRequestsBeforeAnswer = hits - before4; step.questionsBeforeAnswer = step.nativeQuestions;
  if (step.openedByItself || step.httpRequestsBeforeAnswer) problems.push('strict: a kept site opened http by itself');
  if (step.questionsBeforeAnswer.length) problems.push('strict: a kept site asked a native question: ' + step.questionsBeforeAnswer.join(' / '));
  if (!step.openedByItself && !step.questionsBeforeAnswer.length) { step.note = await answerPage(); step.openedAfterAnswer = Boolean(await until(async () => opened(await lastTab()), 10000)); step.questionsAfterAnswer = (await asked()).slice(questions); if (!step.openedAfterAnswer || step.questionsAfterAnswer.length) problems.push('strict: a kept site asked twice'); }
  seen.strictKept = step;

  // 5. Control: any other http address still gets strict mode's own question (one).
  const control = (await asked()).length; await app.act({type: 'tab.new', url: 'http://http-only.example.com/other'});
  seen.strictOther = {questions: (await until(async () => { const now = (await asked()).slice(control); return now.length ? now : null; }, 15000)) || []};
  if (seen.strictOther.questions.length !== 1) problems.push('strict: its own question for other http addresses changed: ' + seen.strictOther.questions.length);
} catch (error) { problems.push('rig: ' + String(error?.stack || error).split('\n').slice(0, 3).join(' | ')); }
finally { await app.close(); await site.close(); if (!shots) await fs.rm(root, {recursive: true, force: true}); }
console.log(JSON.stringify({ok: !problems.length, problems, ...seen}));
if (problems.length) process.exitCode = 1;
