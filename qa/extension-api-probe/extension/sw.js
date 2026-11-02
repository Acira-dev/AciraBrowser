// Service-worker context of the API surface probe. config.js is written by the rig (qa/extension-api-probe/run.mjs).
importScripts('config.js', 'walk.js');
let ran = false;
const run = () => { if (ran) return; ran = true; self.aciraProbe('service_worker', self.ACIRA_PROBE_CONFIG); };
chrome.runtime.onInstalled.addListener(run);
chrome.runtime.onStartup.addListener(run);
setTimeout(run, 1500);
// Keeps messaging answerable while the page and content-script probes run.
chrome.runtime.onMessage.addListener((message, _sender, reply) => { if (message && message.probe === 'ping') reply({pong: true}); });
