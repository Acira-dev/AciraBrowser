'use strict';
// Prints the exact frame script the app injects for a host, for pasting into any browser console or the built-in browser:
//   node qa/privacy-plus/ai-runtime.cjs www.google.com
const fs = require('node:fs'), path = require('node:path');
const { surfacesFor } = require('../../desktop/browser-services/ai-surfaces.cjs');
const host = process.argv[2] || 'www.google.com', surfaces = surfacesFor(host);
if (!surfaces) { console.error('no AI rules for ' + host); process.exit(1); }
const runtime = fs.readFileSync(path.join(__dirname, '..', '..', 'desktop', 'browser-services', 'content-filter-preload.cjs'), 'utf8').replace("const {ipcRenderer}=require('electron');", '').replace('function restore(){', "globalThis[Symbol.for('acira.frame-filter-teardown')]=()=>{dead=true;observer?.disconnect();clearTimeout(timer);restore();};function restore(){");
const options = { enabled: true, selectors: [], sources: [], annoyanceSelectors: [], aiRules: surfaces.items };
process.stdout.write(`(()=>{const old=globalThis[Symbol.for('acira.frame-filter-teardown')];if(typeof old==='function')old();const ipcRenderer={invoke:async()=>(${JSON.stringify(options)}),send:()=>{},on:()=>{}};${runtime}\n})()`);
