'use strict';
// The AI-rules part of the frame script only (hide/unhide + rule engine), self-contained, for pasting into a console:
//   node qa/privacy-plus/ai-runtime-min.cjs www.google.com
const fs = require('node:fs'), path = require('node:path');
const { surfacesFor } = require('../../desktop/browser-services/ai-surfaces.cjs');
const surfaces = surfacesFor(process.argv[2] || 'www.google.com'); if (!surfaces) { console.error('no rules'); process.exit(1); }
const lines = fs.readFileSync(path.join(__dirname, '..', '..', 'desktop', 'browser-services', 'content-filter-preload.cjs'), 'utf8').split(/\r?\n/);
const take = prefixes => prefixes.map(prefix => { const line = lines.find(l => l.startsWith(prefix)); if (!line) throw new Error('missing ' + prefix); return line; }).join('\n');
const body = take([' function hide(', ' function unhide(', ' const norm=', ' const visibleKids=', ' function aiUnit(', ' function aiNodes(', ' function applyAiRules(']);
process.stdout.write(`(()=>{const hidden=new Map(),revealed=new WeakSet();const report=()=>{};const options={aiRules:${JSON.stringify(surfaces.items)}};${body}\napplyAiRules();window.__aiHidden=[...hidden.entries()].map(([n,e])=>(n.tagName.toLowerCase()+(n.id?'#'+n.id:'')+' h='+Math.round(n.getBoundingClientRect().height)+(e.placeholder?' [line]':' [quiet]')));return window.__aiHidden.join(' | ')||'nothing hidden';})()`);
