'use strict';
// 14.3 (smaller main, start-up): the heavy one-shot jobs of the background lists (the filter engine build in filter-updates.cjs, the threat-list parses in threat-lists.cjs) run in a short-lived
// Electron UTILITY PROCESS instead of a worker thread of main. A worker thread's heap lives in main's address space: the engine build's reaches 120-170 MB, and after the worker was gone V8 kept
// about 160 MB of its pages committed in main for a while or for minutes (Electron 45 / V8 14: main 87 -> 248-330 MB; 1 launch in 6 kept 238 MB for 80 s and more on the packaged 14.2 line, and a
// ladder of reducing collections still left 181-206 MB in 1 of 8). A process that ends gives all of its memory back at once, whatever V8 does with its pages, and main only ever holds the answer.
//
// runJob() resolves with the job's first message ({bytes, rules}, {error}, a list parse's result). Where no utility process can be had (tests, a start that fails, an exit before the answer)
// it runs the very same job on a worker thread, as before. ACIRA_JOBS_IN_WORKER=1 forces the worker thread. Keep this file ASCII only.

const path = require('node:path');
const ENGINE_JOB_FILE = path.join(__dirname, 'filter-engine-worker.cjs');

/** Electron's utilityProcess, once the app is ready; null in plain Node and when the worker thread is asked for. */
function electronUtility() {
  try {
    if (process.env.ACIRA_JOBS_IN_WORKER === '1') return null;
    const electron = require('electron');
    return electron && electron.utilityProcess && typeof electron.utilityProcess.fork === 'function' && electron.app && typeof electron.app.isReady === 'function' && electron.app.isReady() ? electron.utilityProcess : null;
  } catch { return null; }
}

function transportError(message) { const error = new Error(message); error.jobTransport = true; return error; }

function viaUtility(utility, {data, kind, source, label, timeoutMs}) {
  return new Promise((resolve, reject) => {
    let child = null, done = false;
    const finish = (error, value) => {
      if (done) return; done = true; clearTimeout(timer);
      try { child && child.kill(); } catch { /* already gone */ }
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => finish(new Error(label + ' took too long.')), timeoutMs);
    try { child = utility.fork(ENGINE_JOB_FILE, [], {serviceName: 'Acira list job', stdio: 'ignore'}); } catch (error) { finish(transportError(String(error && error.message || error))); return; }
    child.once('spawn', () => { try { child.postMessage(kind === 'source' ? {kind: 'source', source, data} : data); } catch (error) { finish(transportError(String(error && error.message || error))); } });
    child.once('message', message => finish(null, message));
    child.once('exit', code => finish(transportError(label + ' stopped (' + code + ').')));
  });
}

function viaWorker({data, kind, source, label, timeoutMs, limits}) {
  return new Promise((resolve, reject) => {
    let worker = null, done = false;
    const finish = (error, value) => {
      if (done) return; done = true; clearTimeout(timer);
      try { worker && worker.terminate(); } catch { /* already gone */ }
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => finish(new Error(label + ' took too long.')), timeoutMs);
    try {
      const {Worker} = require('node:worker_threads');
      worker = kind === 'source' ? new Worker(source, {eval: true, workerData: data}) : new Worker(ENGINE_JOB_FILE, {workerData: data, ...(limits ? {resourceLimits: limits} : {})});
    } catch (error) { finish(error); return; }
    worker.once('message', message => finish(null, message));
    worker.once('error', error => finish(error));
    worker.once('exit', code => finish(new Error(label + ' worker stopped (' + code + ').')));
  });
}

/**
 * One job. `data` is the job's input (a structured clone); without `source` it is the filter engine build ({text, resources, checksum}); with `source` it is a script written for a worker
 * thread (it reads `workerData`, answers with `parentPort.postMessage`). `utility` lets a test hand in its own fork (null: always a worker thread).
 */
async function runJob({data, source = null, label = 'The list job', timeoutMs = 180000, limits = null, utility = undefined}) {
  const kind = source ? 'source' : 'engine', chosen = utility === undefined ? electronUtility() : utility;
  if (chosen) {
    try { return await viaUtility(chosen, {data, kind, source, label, timeoutMs}); } catch (error) { if (!(error && error.jobTransport)) throw error; /* the process could not start or stopped without an answer: the same job on a worker thread */ }
  }
  return viaWorker({data, kind, source, label, timeoutMs, limits});
}

module.exports = {runJob, electronUtility, ENGINE_JOB_FILE};
