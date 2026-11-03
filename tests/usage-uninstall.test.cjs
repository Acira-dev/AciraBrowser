'use strict';
// beta.9: the Windows uninstaller's one usage message (packaging/acira-installer.nsh, un.AcUsageUninstalled). Windows is built on
// another PC, so the uninstaller cannot run here: the function's own text is run by a small interpreter of exactly the NSIS instructions
// it uses (any other instruction fails the test), against real metrics.json files written by the app's own code (metrics.cjs).
// It checks: never on an update (--updated, /KEEP_APP_DATA), only with sharing on, a valid id and the route note "ok", never in a QA
// build, before anything is removed, the exact message the server accepts and "See what's sent" shows, short limits, no retry, every
// handle closed, nothing written.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createMetrics, uninstallMessage, SAMPLE_ID } = require('../desktop/browser-services/metrics.cjs');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/^\uFEFF/, '');
const NSH = read('packaging', 'acira-installer.nsh');
const server = import('../supabase/functions/usage/handler.mjs');
const NOW = Date.parse('2026-11-03T09:30:00Z');
const APPDATA = 'C:\\Users\\Ada\\AppData\\Roaming';

/** The `!define`s outside the QA block (the real build) or inside it (`qa`). */
function defines({ qa = false } = {}) {
  const out = { VERSION: '0.1.0-beta.9' };
  const lines = NSH.split(/\r?\n/); const stack = [];
  for (const line of lines) {
    const t = line.trim();
    let m;
    if ((m = /^!ifdef (\w+)$/.exec(t))) { stack.push(m[1] === 'ACIRA_QA' ? qa : m[1] === 'BUILD_UNINSTALLER' ? true : null); continue; }
    if ((m = /^!ifndef (\w+)$/.exec(t))) { stack.push(m[1] === 'ACIRA_QA' ? !qa : m[1] === 'BUILD_UNINSTALLER' ? false : null); continue; }
    if (t === '!else') { stack[stack.length - 1] = stack.at(-1) === null ? null : !stack.at(-1); continue; }
    if (t === '!endif') { stack.pop(); continue; }
    if (stack.some((value) => value === false)) continue;
    if ((m = /^!define (AC_\w+) "([^"]*)"$/.exec(t))) out[m[1]] = m[2];
  }
  return out;
}
const body = () => { const start = NSH.indexOf('Function un.AcUsageUninstalled'); assert.ok(start >= 0); return NSH.slice(start, NSH.indexOf('FunctionEnd', start)); };

/** NSIS argument splitting: "…", '…' and `…` are delimiters; anything else ends at a space. */
function words(line) {
  const out = []; let i = 0;
  while (i < line.length) {
    if (line[i] === ' ') { i++; continue; }
    const q = line[i];
    if (q === '"' || q === "'" || q === '`') { const end = line.indexOf(q, i + 1); assert.ok(end > i, 'unclosed quote: ' + line); out.push({ text: line.slice(i + 1, end), quoted: true }); i = end + 1; continue; }
    let end = line.indexOf(' ', i); if (end < 0) end = line.length; out.push({ text: line.slice(i, end), quoted: false }); i = end;
  }
  return out;
}
/** System::Call argument list split at commas outside quotes. */
const commaSplit = (text) => { const out = []; let depth = '', start = 0; for (let i = 0; i < text.length; i++) { const c = text[i]; if (depth) { if (c === depth) depth = ''; } else if (c === '"' || c === "'") depth = c; else if (c === ',') { out.push(text.slice(start, i).trim()); start = i + 1; } } out.push(text.slice(start).trim()); return out.filter(Boolean); };

/** Runs un.AcUsageUninstalled. `files` maps Windows paths to their text; `send` is what WinHttpSendRequest returns (1 ok, 0 failed). */
function runUninstallMessage({ params = '/currentuser /S', files = {}, qa = false, send = 1, now = NOW, version } = {}) {
  const defs = { ...defines({ qa }), ...(version ? { VERSION: version } : {}) };
  const lines = body().split(/\r?\n/).slice(1).map((l) => l.trim()).filter((l) => l && !l.startsWith(';'))
    .map((l) => l.replace(/\$\{(AC_\w+|VERSION)\}/g, (_, name) => { assert.ok(name in defs, 'unknown define ' + name); return defs[name]; }));
  const labels = {}; lines.forEach((l, i) => { const m = /^(\w+):$/.exec(l); if (m) labels[m[1]] = i; });
  const reg = Object.fromEntries([...Array(10).keys()].flatMap((n) => [['$' + n, `outer${n}`], ['$R' + n, `outerR${n}`]]));
  const stack = [], calls = [], handles = new Map(), memory = new Map(); let error = false, nextHandle = 100, pc = 0, steps = 0;
  const expand = (text) => text.replace(/\$(R?\d|APPDATA)/g, (m, name) => (name === 'APPDATA' ? APPDATA : reg['$' + name]));
  const value = (word) => expand(word.text);
  const jump = (label) => { if (label === '0' || label === undefined || label === '') return; assert.ok(label in labels, 'unknown label ' + label); pc = labels[label]; };
  const ifStack = [];
  const skipBlock = () => { let depth = 0; for (pc++; pc < lines.length; pc++) { if (/^\$\{If(Not)?\}/.test(lines[pc])) depth++; else if (lines[pc] === '${EndIf}') { if (depth === 0) return; depth--; } } assert.fail('no ${EndIf}'); };
  const condition = (rest) => {
    if (rest === '${isUpdated}') return /(^|\s)--updated(\s|$)/i.test(params);
    if (rest === '${Errors}') return error;
    const m = /^(\$\w+) <> (\d+)$/.exec(rest); assert.ok(m, 'unknown condition ' + rest);
    return Number(reg[m[1]]) !== Number(m[2]);
  };
  const getOption = (text, option) => { // FileFunc GetOptions: the option's first character is its delimiter; case-insensitive
    const delimiter = option[0], name = option.slice(1).toLowerCase(); let quote = '';
    for (let i = 0; i < text.length; i++) {
      const c = text[i]; if (quote) { if (c === quote) quote = ''; continue; } if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
      if (c === delimiter && text.slice(i + 1, i + 1 + name.length).toLowerCase() === name) return text.slice(i + 1 + name.length).split(delimiter)[0].trim();
    }
    return null;
  };
  const systemCall = (spec) => {
    let m;
    if ((m = /^\*\$(\d)\((.*)\)$/.exec(spec))) { // read a SYSTEMTIME
      const fields = memory.get(reg['$' + m[1]]); assert.ok(fields, 'reads allocated memory');
      commaSplit(m[2]).forEach((field, index) => { const out = /^&i2(?: \.r(\d))?$/.exec(field); assert.ok(out, 'struct field ' + field); if (out[1] !== undefined) reg['$' + out[1]] = String(fields[index]); });
      return;
    }
    m = /^(\w+)::(\w+)\((.*)\)(?: (\w)(?: \.r(\d))?)?$/.exec(spec); assert.ok(m, 'System::Call ' + spec);
    const [, dll, fn, argText, , outReg] = m;
    const args = commaSplit(argText).map((arg) => {
      const a = /^(\*?[pimw]) (.+)$/.exec(arg); assert.ok(a, 'argument ' + arg);
      const [, type, source] = a;
      if (/^r\d$/.test(source)) return { type, value: reg['$' + source[1]] };
      if (/^"(.*)"$/.test(source)) return { type, value: expand(source.slice(1, -1)) };
      assert.match(source, /^-?(0x[0-9a-f]+|\d+)$/i, 'argument ' + arg); return { type, value: Number(source) };
    });
    calls.push({ fn: `${dll}::${fn}`, args });
    let result = 0;
    if (fn === 'GetSystemTime') { const t = new Date(now); memory.set(args[0].value, [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDay(), t.getUTCDate(), t.getUTCHours(), t.getUTCMinutes(), t.getUTCSeconds(), 0]); }
    else if (['WinHttpOpen', 'WinHttpConnect', 'WinHttpOpenRequest'].includes(fn)) { result = nextHandle++; handles.set(result, fn); if (fn !== 'WinHttpOpen') assert.ok(handles.has(Number(args[0].value)), fn + ' on an open handle'); }
    else if (fn === 'WinHttpSendRequest') result = send;
    else if (fn === 'WinHttpCloseHandle') { assert.ok(handles.delete(Number(args[0].value)), 'closes an open handle once'); result = 1; }
    else if (['WinHttpSetTimeouts', 'WinHttpSetOption', 'WinHttpReceiveResponse'].includes(fn)) result = 1;
    else assert.fail('unexpected call ' + fn);
    assert.equal(dll, fn === 'GetSystemTime' ? 'kernel32' : 'winhttp');
    if (outReg !== undefined) reg['$' + outReg] = String(result);
  };
  for (pc = 0; pc < lines.length; pc++) {
    assert.ok(++steps < 20000, 'the function ends');
    const line = lines[pc];
    if (/^\w+:$/.test(line)) continue;
    if (/^\$\{If(Not)?\} /.test(line)) { const not = line.startsWith('${IfNot}'); const ok = condition(line.replace(/^\$\{If(Not)?\} /, '')) !== not; ifStack.push(ok); if (!ok) { skipBlock(); ifStack.pop(); } continue; }
    if (line === '${EndIf}') { ifStack.pop(); continue; }
    const [op, ...a] = words(line);
    switch (op.text) {
      case 'Push': stack.push(value(a[0])); break;
      case 'Pop': reg[a[0].text] = stack.pop(); break;
      case 'Goto': jump(a[0].text); break;
      case 'ClearErrors': error = false; break;
      case 'IfErrors': if (error) jump(a[0].text); else jump(a[1]?.text); break;
      case '${GetParameters}': reg[a[0].text] = params; break;
      case '${GetOptions}': { const found = getOption(value(a[0]), value(a[1])); error = found === null; reg[a[2].text] = found ?? ''; break; }
      case 'StrCpy': { const src = value(a[1]), max = a[2] ? Number(value(a[2])) : undefined, from = a[3] ? Number(value(a[3])) : 0; assert.ok(max === undefined || max >= 0); reg[a[0].text] = src.slice(from, max === undefined ? undefined : from + max); break; }
      case 'StrCmp': case 'StrCmpS': { const x = value(a[0]), y = value(a[1]); const same = op.text === 'StrCmpS' ? x === y : x.toLowerCase() === y.toLowerCase(); jump(same ? a[2].text : a[3]?.text); break; }
      case 'IntCmp': { const x = Number(value(a[0])), y = Number(value(a[1])); jump(x === y ? a[2].text : x < y ? a[3]?.text : a[4]?.text); break; }
      case 'IntOp': { assert.equal(a[2].text, '+'); reg[a[0].text] = String(Number(value(a[1])) + Number(value(a[3]))); break; }
      case 'StrLen': reg[a[0].text] = String(value(a[1]).length); break;
      case 'IntFmt': { assert.equal(a[1].text, '%02u'); reg[a[0].text] = String(Number(value(a[2]))).padStart(2, '0'); break; }
      case 'FileOpen': { assert.equal(a[2].text, 'r', 'the file is only read'); const file = value(a[1]); if (file in files) { reg[a[0].text] = 'file:' + file; error = false; } else { reg[a[0].text] = ''; error = true; } break; }
      case 'FileRead': { const file = reg[a[0].text].slice(5); const text = files[file]; const nl = text.indexOf('\n'); reg[a[1].text] = text.slice(0, Math.min(nl < 0 ? text.length : nl + 1, 1023)); break; }
      case 'FileClose': break;
      case 'System::Alloc': { const p = 5000 + memory.size; memory.set(String(p), null); stack.push(String(p)); assert.equal(a[0].text, '16'); break; }
      case 'System::Free': memory.delete(value(a[0])); break;
      case 'System::Call': assert.ok(a[0].quoted, 'quoted spec'); systemCall(a[0].text); break;
      default: assert.fail('instruction the test does not know: ' + line);
    }
  }
  const outer = Object.fromEntries([...Array(10).keys()].flatMap((n) => [['$' + n, `outer${n}`], ['$R' + n, `outerR${n}`]]));
  return { calls, sent: calls.filter((c) => c.fn === 'winhttp::WinHttpSendRequest'), openHandles: handles.size, registers: reg, outer, stackLeft: stack.length, error };
}

const folder = () => fs.mkdtempSync(path.join(os.tmpdir(), 'acira-uninstall-'));
/** A real metrics.json from the app's own code: sharing on, then one maybeSend with the given route. */
async function savedFile({ on = true, route = true, endpoint = 'https://x.supabase.co/functions/v1/usage' } = {}) {
  const directory = folder();
  const metrics = createMetrics({ directory, endpoint, appVersion: '0.1.0-beta.9', platform: 'win32', arch: 'x64', language: 'en', send: async () => 204, routeOk: () => route, now: () => NOW });
  if (on) { await metrics.set(true); await metrics.maybeSend(); } else { await metrics.set(true); await metrics.set(false); }
  const text = fs.readFileSync(path.join(directory, 'metrics.json'), 'utf8');
  return { text, metrics, id: JSON.parse(text).installId, files: { [`${APPDATA}\\AciraBrowser\\metrics.json`]: text } };
}

test('sharing on: one HTTPS POST of exactly the message "See what\'s sent" shows and the server accepts', async () => {
  const { validateUninstall } = await server;
  const saved = await savedFile();
  assert.match(saved.text, /^\{"choice":"on","installId":"[0-9a-f-]{36}","route":"ok",/, 'the app writes the three keys first');
  const run = runUninstallMessage({ files: saved.files });
  assert.equal(run.sent.length, 1, 'one message');
  const [send] = run.sent;
  const message = JSON.parse(send.args[3].value);
  assert.deepEqual(message, uninstallMessage({ installId: saved.id, appVersion: '0.1.0-beta.9', arch: 'x64', day: '2026-11-03' }));
  assert.equal(send.args[3].value, JSON.stringify(message), 'same fields in the same order, no spaces');
  assert.equal(send.args[3].type, 'm', 'sent as bytes'); assert.equal(Number(send.args[4].value), send.args[3].value.length); assert.equal(Number(send.args[5].value), send.args[3].value.length);
  assert.match(send.args[3].value, /^[\x20-\x7e]+$/, 'ASCII only');
  assert.ok(validateUninstall(message, NOW), 'the usage function stores it');
  const status = await saved.metrics.status();
  assert.deepEqual(Object.keys(status.uninstallPayload), Object.keys(message), '"What\'s sent" lists the same fields');
  assert.equal(status.uninstallPayload.installId, saved.id);
  assert.equal(run.openHandles, 0, 'every WinHTTP handle is closed');
  assert.equal(run.stackLeft, 0); assert.deepEqual(run.registers, run.outer, 'every register is given back'); assert.equal(run.error, false);
});

test('the request: the usage address, https only, system proxy, the app\'s User-Agent, short limits, no cookies, redirects, sign-in or keep-alive', async () => {
  const run = runUninstallMessage({ files: (await savedFile()).files });
  const call = (name) => run.calls.find((c) => c.fn === 'winhttp::' + name);
  const config = require('../desktop/browser-services/metrics-config.cjs');
  const { AC_USAGE_HOST, AC_USAGE_PATH } = defines();
  assert.equal(`https://${AC_USAGE_HOST}${AC_USAGE_PATH}`, config.endpoint, 'the same address as the app (metrics-config.cjs)');
  assert.deepEqual(call('WinHttpOpen').args.map((a) => a.value), ['Acira/0.1.0-beta.9', 4, 0, 0, 0], 'WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY, synchronous');
  assert.deepEqual(call('WinHttpSetTimeouts').args.slice(1).map((a) => a.value), [1000, 1000, 1000, 1500], 'name, connect, send, answer (ms)');
  assert.ok(call('WinHttpSetTimeouts').args.slice(1).reduce((sum, a) => sum + a.value, 0) <= 5000, 'at most a few seconds in all');
  assert.deepEqual(call('WinHttpConnect').args.slice(1).map((a) => a.value), [AC_USAGE_HOST, 443, 0]);
  assert.deepEqual(call('WinHttpOpenRequest').args.slice(1).map((a) => a.value), ['POST', AC_USAGE_PATH, 0, 0, 0, 0x00800000], 'POST, no referrer, WINHTTP_FLAG_SECURE');
  assert.deepEqual(call('WinHttpSetOption').args.slice(1).map((a) => [a.type, a.value]), [['i', 63], ['*i', 15], ['i', 4]], 'WINHTTP_OPTION_DISABLE_FEATURE: cookies, redirects, authentication, keep-alive');
  assert.equal(call('WinHttpSendRequest').args[1].value, 'Content-Type: application/json', 'the only header besides the User-Agent');
  const order = run.calls.map((c) => c.fn.split('::')[1]);
  assert.deepEqual(order, ['GetSystemTime', 'WinHttpOpen', 'WinHttpSetTimeouts', 'WinHttpConnect', 'WinHttpOpenRequest', 'WinHttpSetOption', 'WinHttpSendRequest', 'WinHttpReceiveResponse', 'WinHttpCloseHandle', 'WinHttpCloseHandle', 'WinHttpCloseHandle']);
  assert.equal(run.sent.length, 1, 'no retry');
  const failed = runUninstallMessage({ files: (await savedFile()).files, send: 0 });
  assert.equal(failed.sent.length, 1, 'a failed send is not retried');
  assert.ok(!failed.calls.some((c) => c.fn.endsWith('WinHttpReceiveResponse')), 'and no answer is awaited');
  assert.equal(failed.openHandles, 0);
});

test('never during an update: --updated or /KEEP_APP_DATA (the new installer always passes them) sends nothing', async () => {
  const { files } = await savedFile();
  // electron-builder's installUtil.nsh runs the old uninstaller like this when a new version installs over it
  const template = read('node_modules', 'app-builder-lib', 'templates', 'nsis', 'include', 'installUtil.nsh');
  assert.match(template, /ExecWait '"\$uninstallerFileNameTemp" \/S \/KEEP_APP_DATA \$0 _\?=\$installationDir'/);
  assert.match(template, /StrCpy \$0 "\$0 --updated"/); assert.match(template, /StrCpy \$0 "\$0 --delete-app-data"/);
  for (const params of ['/S /KEEP_APP_DATA /currentuser --updated', '/S /KEEP_APP_DATA /currentuser --delete-app-data', '/S /KEEP_APP_DATA /currentuser --keep-shortcuts --updated', '/S --updated', '/currentuser /S /keep_app_data']) {
    const run = runUninstallMessage({ params, files });
    assert.equal(run.calls.length, 0, params + ': no network, not even the clock');
    assert.deepEqual(run.registers, run.outer, params + ': registers given back');
  }
  // a person's own uninstall: Settings > Apps opens AciraRemove.exe, which runs the real uninstaller with "/currentuser /S"; the
  // QuietUninstallString is "/currentuser /S" too; running the uninstaller by hand passes nothing
  const launcher = read('packaging', 'installer', 'AciraUninstall.cs');
  assert.match(launcher, /new ProcessStartInfo\(real, "\/currentuser \/S"\)/);
  for (const params of ['/currentuser /S', '/S', '', '/currentuser', '--delete-app-data']) assert.equal(runUninstallMessage({ params, files }).sent.length, 1, JSON.stringify(params) + ' is a real uninstall');
});

test('only with sharing on, a real id and the route note "ok"; a QA build never sends; a missing or odd file sends nothing', async () => {
  const off = await savedFile({ on: false });
  assert.match(off.text, /^\{"choice":"off","installId":"",/);
  assert.equal(runUninstallMessage({ files: off.files }).calls.length, 0, 'sharing off');
  const held = await savedFile({ route: false });
  assert.match(held.text, /^\{"choice":"on","installId":"[0-9a-f-]{36}","route":"held",/);
  assert.equal(runUninstallMessage({ files: held.files }).calls.length, 0, 'a manual proxy held the last check back');
  const on = await savedFile();
  assert.equal(runUninstallMessage({ files: on.files, qa: true }).calls.length, 0, 'QA build');
  assert.equal(runUninstallMessage({ files: { [`${APPDATA}\\AciraBrowserQA\\metrics.json`]: on.text }, qa: true }).calls.length, 0, 'QA build, its own profile');
  assert.equal(runUninstallMessage({ files: {} }).calls.length, 0, 'no metrics.json (sharing never on, or the data was deleted first)');
  const variants = {
    'not checked yet (no route key)': on.text.replace(/,"route":"ok"/, ''),
    'uppercase id': on.text.replace(on.id, on.id.toUpperCase()),
    'quote in the id': on.text.replace(on.id, on.id.slice(0, 35) + '"'),
    'short id': on.text.replace(on.id, on.id.slice(1)),
    'other key order': on.text.replace('{"choice":"on","installId":', '{"installId":').replace(`"${on.id}",`, `"${on.id}","choice":"on",`),
    'spaces': JSON.stringify(JSON.parse(on.text), null, 1),
    'choice "On"': on.text.replace('"choice":"on"', '"choice":"On"'),
    'route "OK"': on.text.replace('"route":"ok"', '"route":"OK"'),
    'empty': '',
    'damaged': '{broken',
  };
  for (const [label, text] of Object.entries(variants)) assert.equal(runUninstallMessage({ files: { [`${APPDATA}\\AciraBrowser\\metrics.json`]: text } }).calls.length, 0, label);
  // the app's long files (many counts and rating state) still start the same way, and only the start is read
  const long = on.text.replace(/\}$/, ',"padding":"' + 'x'.repeat(4000) + '"}');
  assert.equal(runUninstallMessage({ files: { [`${APPDATA}\\AciraBrowser\\metrics.json`]: long } }).sent.length, 1);
});

test('the app keeps the three keys first and the route note current; turning sharing off drops both', async () => {
  const directory = folder(); let route = true;
  const metrics = createMetrics({ directory, endpoint: 'https://x.supabase.co/functions/v1/usage', appVersion: '0.1.0-beta.9', platform: 'win32', arch: 'x64', language: 'en', send: async () => 204, routeOk: () => route, now: () => NOW });
  const file = () => fs.readFileSync(path.join(directory, 'metrics.json'), 'utf8');
  await metrics.set(true);
  assert.doesNotMatch(file(), /"route"/, 'not checked yet: the uninstaller sends nothing until the first check');
  assert.deepEqual(await metrics.maybeSend(), { sent: true }); assert.match(file(), /^\{"choice":"on","installId":"[0-9a-f-]{36}","route":"ok",/);
  metrics.note('splitView'); metrics.notePeaks({ tabsOpen: 12 }); await metrics.ratingAnswer('splitView', 5).catch(() => {});
  assert.match(file(), /^\{"choice":"on","installId":"[0-9a-f-]{36}","route":"ok",/, 'every later write keeps the order');
  route = false; assert.deepEqual(await metrics.maybeSend(), { sent: false, reason: 'already sent today' });
  assert.match(file(), /"route":"held"/, 'checked even when today\'s message has gone (a proxy turned on later in the day)');
  route = true; await metrics.maybeSend(); assert.match(file(), /"route":"ok"/);
  const throwing = createMetrics({ directory, endpoint: '', appVersion: '1.0.0', platform: 'win32', arch: 'x64', language: 'en', send: async () => 204, routeOk: () => { throw new Error('no profile yet'); }, now: () => NOW });
  assert.deepEqual(await throwing.maybeSend(), { sent: false, reason: 'no endpoint' }); assert.match(file(), /"route":"held"/, 'a failed check counts as held');
  await metrics.set(false);
  assert.match(file(), /^\{"choice":"off","installId":"",/); assert.doesNotMatch(file(), /"route"/);
  await metrics.set(true);
  assert.doesNotMatch(file(), /"route"/, 'a new id starts unchecked');
  // the main process checks again right after a proxy change, so the note never waits for the 6-hourly tick
  const main = read('desktop', 'main.cjs');
  assert.match(main, /const usageRouteChanged=\(\)=>\{try\{void metricsService\(\)\.maybeSend\(\);\}catch\{\}\};/);
  assert.equal((main.match(/\}usageRouteChanged\(\);return \{proxy:result\};\}/g) || []).length, 2, 'after proxy.set and proxy.takeBack');
  assert.match(main, /uninstallSends:process\.platform==='win32'&&!buildIdentity\.qa,/, 'a QA build shows no uninstall message');
});

test('"See what\'s sent" shows the uninstall message only where the uninstaller sends it', async () => {
  const make = (extra) => createMetrics({ directory: folder(), endpoint: '', appVersion: '0.1.0-beta.9', language: 'en', send: async () => 204, now: () => NOW, ...extra });
  const win = await make({ platform: 'win32', arch: 'x64' }).status();
  assert.deepEqual(win.uninstallPayload, { schema: 1, event: 'uninstall', installId: SAMPLE_ID, appVersion: '0.1.0-beta.9', platform: 'win32', arch: 'x64', day: '2026-11-03' }, 'while off: the placeholder id');
  assert.equal((await make({ platform: 'darwin', arch: 'arm64' }).status()).uninstallPayload, null, 'a Mac cannot tell it is being deleted');
  assert.equal((await make({ platform: 'linux', arch: 'x64' }).status()).uninstallPayload, null);
  assert.equal((await make({ platform: 'win32', arch: 'x64', uninstallSends: false }).status()).uninstallPayload, null, 'QA build');
  const sheet = read('src', 'features', 'metrics', 'UsageSent.tsx');
  assert.match(sheet, /uninstall = status\.uninstallPayload/); assert.match(sheet, /\{uninstall && \(/);
  assert.match(sheet, /t\('usage\.sent\.groupUninstall'\)/); assert.match(sheet, /t\('usage\.sent\.uninstall'\)/);
  const languages = ['en', 'ar', 'de', 'es', 'fr', 'hi', 'it', 'ja', 'ko', 'pt-BR', 'ru', 'tr', 'zh-CN'];
  for (const language of languages) {
    const catalog = JSON.parse(read('src', 'i18n', language + '.json'));
    for (const key of ['usage.sent.groupUninstall', 'usage.sent.uninstall']) assert.ok(typeof catalog[key] === 'string' && catalog[key].trim().length > 8, `${language} ${key}`);
    assert.notEqual(catalog['usage.sent.uninstall'], language === 'en' ? '' : JSON.parse(read('src', 'i18n', 'en.json'))['usage.sent.uninstall'], language + ' is translated');
  }
});

test('the uninstall message runs first in the uninstall, before the data question, and only in the uninstaller build', () => {
  const macro = NSH.slice(NSH.indexOf('!macro customUnInstall'), NSH.indexOf('!macroend', NSH.indexOf('!macro customUnInstall')));
  const lines = macro.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith(';'));
  assert.equal(lines[1], 'Call un.AcUsageUninstalled', 'the first instruction');
  assert.ok(macro.indexOf('Call un.AcUsageUninstalled') < macro.indexOf('RMDir /r "$APPDATA\\${AC_DATA_DIR}"'), 'before "delete my data"');
  // electron-builder's uninstall section: customUnInstall, then the files are removed (and AciraRemove.exe deletes data only after that)
  const section = read('node_modules', 'app-builder-lib', 'templates', 'nsis', 'uninstaller.nsh');
  assert.ok(section.indexOf('!insertmacro customUnInstall') < section.indexOf('RMDir /r $INSTDIR'));
  const launcher = read('packaging', 'installer', 'AciraUninstall.cs');
  assert.match(launcher, /ok = Gone\(\);\s*if \(ok && !keepData\) dataDeleted = DeleteUserData\(\);/, 'the launcher deletes data only once the files are gone');
  const fn = body();
  const before = NSH.slice(0, NSH.indexOf('Function un.AcUsageUninstalled'));
  assert.ok(before.lastIndexOf('!ifdef BUILD_UNINSTALLER') > before.lastIndexOf('!endif'), 'defined only in the uninstaller build (warningsAsErrors: no unused function)');
  for (const banned of ['FileWrite', 'WriteReg', 'DeleteReg', 'Delete ', 'RMDir', 'Exec', 'nsExec', 'inetc', 'NSISdl', 'powershell', 'Abort', 'Quit', 'SetErrorLevel', 'MessageBox', 'Sleep']) assert.ok(!fn.includes(banned), 'never ' + banned);
  // the payload template carries only the id, the version, the arch and the date
  const template = /StrCpy \$5 '(\{"schema":1,"event":"uninstall",[^']*\})'/.exec(fn);
  assert.ok(template); assert.deepEqual([...template[1].matchAll(/\$\{?(\w+)\}?/g)].map((m) => m[1]), ['3', 'VERSION', 'AC_USAGE_ARCH', '4']);
});

test('offsets in the uninstaller match the app\'s file; the arch is right for the build that ships', () => {
  const fn = body();
  const prefix = '{"choice":"on","installId":"', after = '","route":"ok"';
  assert.ok(fn.includes(`StrCpy $3 $2 ${prefix.length}\n`), 'prefix length ' + prefix.length);
  assert.ok(fn.includes(`StrCmpS $3 '${prefix}' 0 acUsageDone`));
  assert.ok(fn.includes(`StrCpy $3 $2 ${after.length} ${prefix.length + 36}\n`), 'route note at ' + (prefix.length + 36));
  assert.ok(fn.includes(`StrCmpS $3 '${after}' 0 acUsageDone`));
  assert.ok(fn.includes(`StrCpy $3 $2 36 ${prefix.length}\n`));
  const builder = JSON.parse(read('packaging', 'electron-builder.json'));
  assert.deepEqual([...new Set(builder.win.target.flatMap((t) => t.arch))], ['x64'], 'Windows ships x64 only; AC_USAGE_ARCH must change with it');
  assert.equal(defines().AC_USAGE_ARCH, 'x64');
  assert.equal(defines({ qa: true }).AC_USAGE_HOST, '', 'a QA build has no address');
  assert.equal(builder.nsis.deleteAppDataOnUninstall, false, 'electron-builder never deletes the data before the message');
});

test('the longest uninstall message fits the server limit', async () => {
  const { validateUninstall, UNINSTALL_MAX_BYTES } = await server;
  const longest = uninstallMessage({ installId: '6081ef29-10d4-4023-8c6e-7dc490f6903f', appVersion: '1234.1234.1234-' + 'a'.repeat(9), arch: 'arm64', day: '2026-11-03' });
  assert.ok(validateUninstall(longest, NOW));
  const bytes = Buffer.byteLength(JSON.stringify(longest));
  assert.ok(bytes < 180 && bytes < UNINSTALL_MAX_BYTES, `longest is ${bytes} bytes`);
});
