'use strict';
const path = require('node:path');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const run = promisify(execFile);

// Match executable paths, including Electron helpers, only inside the bundle
// being replaced. Another Acira copy or a profile directory is not this app.
function runningInBundle(output, application) {
 const prefix = path.resolve(application, 'Contents') + path.sep;
 return String(output).split(/\r?\n/).some(line => {
  const match = /^\s*([1-9]\d*)\s+(.+?)\s*$/.exec(line);
  return !!match && path.isAbsolute(match[2]) && path.resolve(match[2]).startsWith(prefix);
 });
}

async function assertApplicationStopped(application, readProcesses = async () =>
 (await run('/bin/ps', ['-ww', '-axo', 'pid=,comm='], {encoding:'utf8', timeout:5000, maxBuffer:8*1024*1024})).stdout) {
 let output;
 try { output = await readProcesses(); }
 catch {
  throw Object.assign(new Error('Acira could not check whether the browser is running. Quit Acira and try again.'), {code:'ACIRA_PROCESS_CHECK_FAILED'});
 }
 if (runningInBundle(output, application))
  throw Object.assign(new Error('Quit Acira before updating it, then choose Try again. Your tabs and browser data stay saved.'), {code:'ACIRA_RUNNING'});
}

module.exports = {runningInBundle, assertApplicationStopped};
