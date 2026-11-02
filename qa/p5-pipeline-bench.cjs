'use strict';
// P5 perf: the request pipeline's cost per request with the extension webRequest observers in place and NO extension listening, against
// the pipeline before P5 (git show <ref>:desktop/request-pipeline.cjs), and with one extension listening to every event.
// Same handler chain as a page load (four synchronous participants), 200k requests x 4 Electron events, best of 7 rounds.
//   node qa/p5-pipeline-bench.cjs [<git ref of the old pipeline, default HEAD~1>]
const {execFileSync} = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const ref = process.argv[2] || 'a6f62676~1';
const oldFile = path.join(os.tmpdir(), `p5-old-pipeline-${process.pid}.cjs`);
fs.writeFileSync(oldFile, execFileSync('git', ['show', `${ref}:desktop/request-pipeline.cjs`], {encoding: 'utf8'}));
const OldPipeline = require(oldFile).RequestPipeline;
const {RequestPipeline, observeRequests} = require('../desktop/request-pipeline.cjs');
function fakeSession() {
  const hooks = {}, webRequest = {};
  for (const name of ['onBeforeRequest', 'onBeforeSendHeaders', 'onSendHeaders', 'onHeadersReceived', 'onResponseStarted', 'onBeforeRedirect', 'onCompleted', 'onErrorOccurred'])
    webRequest[name] = (filter, listener) => { if (listener === undefined) listener = filter; if (listener) hooks[name] = listener; else delete hooks[name]; };
  return {session: {webRequest}, hooks};
}
function build(Pipeline, observe) {
  const {session, hooks} = fakeSession();
  const pipeline = new Pipeline(session);
  for (let i = 0; i < 4; i++) pipeline.useBefore(details => (details.url.length < 0 ? {cancel: true} : {}));
  pipeline.useSendHeaders(() => ({}));
  pipeline.useHeaders(() => ({}));
  if (observe) observeRequests(session, {phases: ['before', 'sendHeaders', 'sent', 'headers', 'responseStarted', 'redirect', 'completed', 'error'], notify: observe});
  return hooks;
}
const N = 200000, noop = () => {};
function round(hooks) {
  const details = {id: 0, url: 'https://cdn.example/app.js', method: 'GET', resourceType: 'script', requestHeaders: {Accept: '*/*'}, responseHeaders: {}};
  const start = process.hrtime.bigint();
  for (let i = 0; i < N; i++) {
    details.id = i;
    hooks.onBeforeRequest(details, noop); hooks.onBeforeSendHeaders(details, noop); hooks.onHeadersReceived(details, noop); hooks.onCompleted(details);
  }
  return Number(process.hrtime.bigint() - start) / N; // ns per request (4 events)
}
// Each case runs in its own process (a fresh JIT: sharing one process makes the shared pipeline code polymorphic and skews the numbers).
const only = process.env.P5_BENCH_CASE;
if (only) {
  const hooks = only === 'before' ? build(OldPipeline) : only === 'after' ? build(RequestPipeline) : build(RequestPipeline, () => {});
  let best = Infinity; for (let r = 0; r < 9; r++) best = Math.min(best, round(hooks));
  fs.rmSync(oldFile, {force: true});
  process.stdout.write(String(best));
  process.exit(0);
}
fs.rmSync(oldFile, {force: true});
const best = {};
for (let r = 0; r < 3; r++) for (const name of ['before', 'after', 'listening']) {
  const value = Number(execFileSync(process.execPath, [__filename, ref], {env: {...process.env, P5_BENCH_CASE: name}, encoding: 'utf8'}));
  best[name] = Math.min(best[name] ?? Infinity, value);
}
const fmt = ns => `${ns.toFixed(0)} ns`;
console.log(JSON.stringify({requests: N, nsPerRequest: Object.fromEntries(Object.entries(best).map(([k, v]) => [k, Math.round(v)])),
  noListenerOverhead: `${(((best.after - best.before) / best.before) * 100).toFixed(1)}%`, summary: `before ${fmt(best.before)}, after (no listener) ${fmt(best.after)}, with an observer ${fmt(best.listening)}`}, null, 1));
