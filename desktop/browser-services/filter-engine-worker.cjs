'use strict';
// Runs off the main thread (job-process.cjs): compiles the filter lists and scriptlet resources into the serialized engine the browser loads (filter-updates.cjs buildEngineInWorker), and runs
// the small self-contained list parses of threat-lists.cjs. 14.3: it runs in a short-lived Electron utility process, so the 120-170 MB its heap reaches go back to the system when the process
// ends instead of staying committed in main; a worker thread (tests, and where a utility process cannot start) runs the same code as before.
// It uses the engine's core package, which has no Electron dependency, with the options the main process uses. Nothing here touches the network or the disk.
const wt = require('node:worker_threads');

function buildEngine(data) {
  const {FiltersEngine} = require('@ghostery/adblocker');   // loaded for an engine job only
  const engine = FiltersEngine.parse(data.text, {enableCompression: true, loadNetworkFilters: true, loadCosmeticFilters: true, enableMutationObserver: true});
  if (data.resources) engine.updateResources(data.resources, data.checksum || 'updated');
  // The rule count goes with the bytes: main checks the engine has rules without expanding every filter on its own thread (filter-updates.cjs checkCounted).
  const filters = engine.getFilters(), rules = filters.networkFilters.length + filters.cosmeticFilters.length;
  const serialized = engine.serialize(), bytes = new Uint8Array(serialized.length); bytes.set(serialized);
  return {bytes, rules};
}

/** A source job (threat-lists.cjs): a script written for a worker thread, run here with `require('node:worker_threads')` giving it the job's data and a port whose first message is the answer. */
function runSource(job) {
  let answer; const port = {postMessage(message) { if (answer === undefined) answer = message; }};
  const shim = {parentPort: port, workerData: job.data, isMainThread: false, threadId: 0};
  new Function('require', job.source)(id => { if (id === 'node:worker_threads' || id === 'worker_threads') return shim; throw new Error('A list job may use the thread API only.'); });
  return answer === undefined ? {error: 'The list job gave no answer.'} : answer;
}

function runJob(job) {
  try { return job && job.kind === 'source' ? runSource(job) : buildEngine(job || {}); } catch (error) { return {error: String(error && error.message || error)}; }
}

if (wt.parentPort && !wt.isMainThread) {
  // a worker thread: the build starts at once from workerData, as it always did
  const message = runJob(wt.workerData);
  if (message && message.bytes) wt.parentPort.postMessage(message, [message.bytes.buffer]); else wt.parentPort.postMessage(message);
} else if (process.parentPort) {
  // an Electron utility process: one job per process; main ends the process when it has the answer, this is the backstop
  process.parentPort.once('message', event => { process.parentPort.postMessage(runJob(event.data)); const t = setTimeout(() => process.exit(0), 20000); if (t.unref) t.unref(); });
}
