// Builds docs/launch/extension-api-coverage.json and the per-namespace tables of docs/launch/EXTENSION_API_COVERAGE.md from:
//   - Chromium's surface (desktop/browser-services/extension-api-surface.gen.cjs, via plan.mjs),
//   - a real-app probe run (run.mjs --out <file>),
//   - the code reading of Acira's shims and electron-chrome-extensions 4.9 (data/shim-classification.json),
//   - the usage census of 258 Web Store extensions (data/usage.json).
// Usage: node qa/extension-api-probe/coverage.mjs --probe <results.json> [--shim data/shim-classification.json] [--usage data/usage.json]
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromiumMembers, surface, CRASHES} from './plan.mjs';

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const here = path.dirname(fileURLToPath(import.meta.url));
const probe = JSON.parse(fs.readFileSync(arg('--probe'), 'utf8'));
const shim = JSON.parse(fs.readFileSync(arg('--shim', path.join(here, 'data/shim-classification.json')), 'utf8'));
const usage = JSON.parse(fs.readFileSync(arg('--usage', path.join(here, 'data/usage.json')), 'utf8'));
const DOC = path.resolve('docs/launch/EXTENSION_API_COVERAGE.md'), JSON_OUT = path.resolve('docs/launch/extension-api-coverage.json');

const sw = probe.reports.service_worker || {surface: {}, calls: {}, validation: {}};
const page = probe.reports.extension_page || {surface: {}, calls: {}, validation: {}};
const cs = probe.reports.content_script || {surface: {}, calls: {}, validation: {}};
const STUB_ERROR = /Access to extension API denied|not available|not implemented|not supported|Unknown Extension API|is not a function/i;
const DEVTOOLS = /^devtools\./;

function classify(m) {
  const notes = [];
  const call = sw.calls[m.path] || page.calls[m.path];
  const present = sw.surface[m.path] || page.surface[m.path] || (call && call.status !== 'absent' ? 'function' : null);
  if (/^(runtime|extension)\.lastError$/.test(m.path) && (sw.surface[m.ns] || page.surface[m.ns])) {
    const code = shim.members[m.path];
    return {status: code?.status === 'full' ? 'full' : 'partial', evidence: 'code', argChecks: null, provider: code?.provider || 'electron-native', file: code?.file || null,
      contexts: {serviceWorker: true, extensionPage: true, contentScript: !!cs.surface[m.ns]}, call: null,
      notes: ['defined only while a callback runs (so absent from the walk)', ...(code?.notes ? [code.notes] : [])]};
  }
  const validation = sw.validation[m.path] || page.validation[m.path];
  const code = shim.members[m.path];
  let status, evidence;
  if (!present && DEVTOOLS.test(m.path)) {
    status = code ? (code.status === 'missing-but-namespace-present' ? 'missing' : code.status) : 'partial';
    evidence = 'code'; notes.push('devtools.* exists only in DevTools pages (not probed); Electron provides devtools.inspectedWindow/network/panels natively');
  } else if (!present) { status = 'missing'; evidence = 'probe'; }
  else if (CRASHES.has(m.path)) { status = 'stub'; evidence = 'probe'; notes.push('CALLING IT CRASHES ACIRA (main process exits; found by this probe)'); }
  else if (call && call.status !== 'absent') {
    evidence = 'probe';
    if (call.status === 'ok') status = 'full';
    else if (call.status === 'sync') {
      if (call.value !== 'undefined' || m.fn.returns_async === undefined) status = 'full';
      else if (call.callbackForm && call.callbackForm.status === 'ok' && call.callbackForm.value !== 'undefined') { status = 'partial'; notes.push('callback only: returns no promise'); }
      else { status = 'stub'; notes.push('returns nothing (no promise, no callback value)'); }
    } else if (call.status === 'timeout') { status = 'stub'; notes.push('never answers (1 s limit)'); }
    else if (call.status === 'error' || call.status === 'threw') {
      if (STUB_ERROR.test(call.message || '')) { status = 'stub'; notes.push(`answers "${(call.message || '').slice(0, 90)}"`); }
      else if (/^Error in invocation/.test(call.message || '')) { status = 'partial'; notes.push(`rejects Chromium-valid arguments: ${(call.message || '').slice(0, 120)}`); }
      else { status = 'full'; notes.push(`answered a bogus id with "${(call.message || '').slice(0, 80)}" (as Chrome would)`); }
    }
  } else {
    evidence = code ? 'code' : 'presence';
    status = code ? (code.status === 'missing-but-namespace-present' ? 'missing' : code.status) : 'partial';
    if (!code) notes.push('exists; not exercised by the probe (destructive or user-visible) - behaviour unverified');
  }
  // Code reading knows about missing options and dead events that a single call cannot show.
  if (code && present) {
    const rank = {full: 3, partial: 2, stub: 1, missing: 0, 'missing-but-namespace-present': 0};
    if (evidence !== 'code' && rank[code.status] < rank[status]) { status = code.status === 'missing-but-namespace-present' ? 'missing' : code.status; }
    if (code.notes) notes.push(code.notes);
  }
  let argChecks = null;
  if (validation && validation.status !== 'absent') {
    argChecks = validation.status === 'threw' && /^Error in invocation/.test(validation.message || '');
    if (!argChecks) notes.push('no Chromium argument checks (extra arguments accepted)');
  }
  const csExpected = (m.contexts || []).includes('content_script');
  const inContentScript = !!cs.surface[m.path];
  if (csExpected && !inContentScript && status !== 'missing') notes.push('missing in content scripts');
  return {status, evidence, argChecks, provider: code?.provider || (present ? 'electron-native' : null), file: code?.file || null,
    contexts: {serviceWorker: !!sw.surface[m.path], extensionPage: !!page.surface[m.path], contentScript: inContentScript},
    call: call ? {status: call.status, ...(call.message ? {message: call.message.slice(0, 160)} : {}), ...(call.value ? {value: call.value} : {})} : null, notes};
}

const members = chromiumMembers().map(m => {
  const schema = surface.namespaces[m.ns];
  const gate = [...new Set([...(m.fn.feature?.permissions || []), ...(schema.permissions || [])])];
  const acira = classify(m);
  const codeRefs = usage.members[m.path] || 0;
  return {namespace: m.ns, member: m.path.slice(m.ns.length + 1), path: m.path, kind: m.kind, gatePermissions: gate,
    manifestKeys: schema.manifestKeys || [], chromium: {status: schema.status, contexts: m.contexts || [], ...(m.fn.deprecated ? {deprecated: true} : {}),
      ...(m.fn.feature?.maxManifestVersion ? {maxManifestVersion: m.fn.feature.maxManifestVersion} : {})},
    acira, usage: {codeRefs, permissionRequests: gate.reduce((n, p) => Math.max(n, usage.anyPermission[p] || 0), 0)}};
});

const nsSummary = {};
for (const m of members) {
  const s = nsSummary[m.namespace] || (nsSummary[m.namespace] = {namespace: m.namespace, full: 0, partial: 0, stub: 0, missing: 0, members: 0,
    gatePermissions: surface.namespaces[m.namespace].permissions || [], codeRefs: usage.namespaces[m.namespace] || usage.namespaces[m.namespace.split('.')[0]] || 0,
    permissionRequests: (surface.namespaces[m.namespace].permissions || []).reduce((n, p) => Math.max(n, usage.anyPermission[p] || 0), 0)});
  s[m.acira.status]++; s.members++;
}
for (const s of Object.values(nsSummary)) {
  s.status = s.missing === s.members ? 'missing' : s.full === s.members ? 'full' : s.stub + s.missing === s.members ? 'stub' : 'partial';
  s.provider = shim.namespaces[s.namespace]?.provider || null;
}
const counts = status => Object.values(nsSummary).filter(s => s.status === status).length;
const memberCounts = Object.fromEntries(['full', 'partial', 'stub', 'missing'].map(k => [k, members.filter(m => m.acira.status === k).length]));
const excluded = Object.fromEntries(Object.entries(surface.excluded).map(([k, v]) => [k, v.why.join('; ')]));
const out = {
  generated: new Date().toISOString(), chromium: surface.chromium, electron: probe.runtime?.electron || null,
  sources: {chromiumSurface: 'desktop/browser-services/extension-api-surface.gen.cjs', probe: 'qa/extension-api-probe/run.mjs', shimReading: 'qa/extension-api-probe/data/shim-classification.json', usage: 'qa/extension-api-probe/data/usage.json'},
  summary: {namespaces: Object.keys(nsSummary).length, namespaceStatus: {full: counts('full'), partial: counts('partial'), stub: counts('stub'), missing: counts('missing')},
    members: members.length, memberStatus: memberCounts, unverifiedMembers: members.filter(m => m.acira.evidence === 'presence').length,
    crashes: [...CRASHES], usageSample: usage.sampled, permissionsRequestedByProbe: probe.permissionsRequested?.length || null,
    browserNamespaceIsChrome: probe.reports.service_worker?.browserIsChrome ?? null},
  namespaces: Object.values(nsSummary).sort((a, b) => a.namespace.localeCompare(b.namespace)),
  excludedNamespaces: excluded, members
};
fs.writeFileSync(JSON_OUT, JSON.stringify(out, null, 1) + '\n');

// Markdown tables between the markers in the doc.
const esc = s => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const lines = [];
for (const s of out.namespaces) {
  lines.push(`### ${s.namespace} — ${s.status} (${s.full} full, ${s.partial} partial, ${s.stub} stub, ${s.missing} missing)`);
  lines.push(`Gate: ${s.gatePermissions.length ? s.gatePermissions.map(p => '`' + p + '`').join(', ') : 'none'} · requested by ${s.permissionRequests} of ${usage.sampled} sampled extensions · referenced in code by ${s.codeRefs}${s.provider ? ' · provider: ' + s.provider : ''}`);
  lines.push('');
  lines.push('| Member | Kind | Acira | Used by | Notes |');
  lines.push('|---|---|---|---|---|');
  for (const m of members.filter(x => x.namespace === s.namespace)) {
    lines.push(`| \`${esc(m.member)}\` | ${m.kind} | ${m.acira.status}${m.acira.argChecks === false ? ' ¹' : ''} | ${m.usage.codeRefs} | ${esc(m.acira.notes.join('; ').slice(0, 260))} |`);
  }
  lines.push('');
}
lines.push('¹ accepts arguments Chromium rejects (no "Error in invocation of …" checks).', '');
lines.push('### Not exposed to Web Store extensions on Windows (Chromium 152)', '', '| Namespace | Why |', '|---|---|');
for (const [k, v] of Object.entries(excluded).sort()) lines.push(`| \`${k}\` | ${esc(v)} |`);
const tables = lines.join('\n');
if (fs.existsSync(DOC)) {
  const doc = fs.readFileSync(DOC, 'utf8');
  const start = '<!-- tables:start -->', end = '<!-- tables:end -->';
  if (doc.includes(start)) fs.writeFileSync(DOC, doc.slice(0, doc.indexOf(start) + start.length) + '\n' + tables + '\n' + doc.slice(doc.indexOf(end)));
} else fs.writeFileSync(path.join(path.dirname(JSON_OUT), 'extension-api-coverage.tables.md'), tables);
console.log(JSON.stringify(out.summary));
