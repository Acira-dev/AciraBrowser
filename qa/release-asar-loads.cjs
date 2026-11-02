'use strict';
// Release gate, check 2: every file the packaged app loads from desktop/ is inside the asar.
// 31 Oct (r22): desktop/site-prompt.cjs required ../src/ui/internalPages.json, the installed app ships no src/, and the app never opened.
// Reads the asar header only (no extraction): walks every script under desktop/ (and the entry named by package.json "main"), resolves each
// require()/import() the way Node does against the asar's own file list, and each literal path.join(__dirname, ...) file reference too.
const path = require('node:path');
const asar = require('@electron/asar');
const { builtinModules } = require('node:module');

const SCRIPT = /\.(?:cjs|mjs|js)$/;
const EXTENSIONS = ['', '.js', '.cjs', '.mjs', '.json', '.node'];
// Dependencies Electron itself provides, or that only exist at build time and are never required at runtime.
const PROVIDED = new Set(['electron', ...builtinModules]);
// Both comment forms are blanked, keeping string contents: a require() inside a comment is not a load.
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

/** Opens an asar and returns a small read-only view: has(path), read(path), list. Paths are posix and relative to the asar root. */
function openAsar(archive) {
  const files = new Set(), dirs = new Set(['']);
  for (const entry of asar.listPackage(archive)) {
    const rel = entry.replace(/\\/g, '/').replace(/^\/+/, '');
    files.add(rel);
    for (let dir = path.posix.dirname(rel); dir && dir !== '.' && !dirs.has(dir); dir = path.posix.dirname(dir)) dirs.add(dir);
  }
  // listPackage lists directories and files alike: anything that is a parent of another entry is a directory.
  for (const dir of dirs) files.delete(dir);
  return {
    files, dirs,
    isFile: (rel) => files.has(rel), isDir: (rel) => dirs.has(rel),
    read: (rel) => asar.extractFile(archive, path.normalize(rel)).toString('utf8'),
  };
}

/** Node's resolution of a relative request inside the asar view. Returns the resolved file, or null. */
function resolveFile(view, base) {
  for (const ext of EXTENSIONS) if (view.isFile(base + ext)) return base + ext;
  if (view.isDir(base)) {
    if (view.isFile(base + '/package.json')) {
      try { const main = JSON.parse(view.read(base + '/package.json')).main; if (main) { const hit = resolveFile(view, path.posix.join(base, main)); if (hit) return hit; } } catch { /* fall through to index */ }
    }
    for (const ext of EXTENSIONS.slice(1)) if (view.isFile(base + '/index' + ext)) return base + '/index' + ext;
  }
  return null;
}

/** A package request ('electron-updater', 'a/b', '@scope/p/sub') searched up the node_modules chain from the requiring file. */
function resolvePackage(view, fromDir, request) {
  const parts = request.split('/'), name = parts.slice(0, request.startsWith('@') ? 2 : 1).join('/'), sub = parts.slice(name.split('/').length).join('/');
  for (let dir = fromDir; ; dir = path.posix.dirname(dir)) {
    const base = path.posix.join(dir === '.' ? '' : dir, 'node_modules', name);
    if (view.isDir(base)) {
      if (!sub) return resolveFile(view, base);
      try { const exp = JSON.parse(view.read(base + '/package.json')).exports; if (exp && typeof exp === 'object' && ('./' + sub) in exp) return base + '/package.json'; } catch { /* no exports map */ }
      return resolveFile(view, base + '/' + sub);
    }
    if (dir === '' || dir === '.') return null;
  }
}

/** True when the index sits inside a try { } block: such a load is optional (the code carries on without it), so a miss is reported, not failed. */
function inTry(text, index) {
  let depth = 0;
  for (let i = index - 1; i >= 0; i--) {
    if (text[i] === '}') depth++;
    else if (text[i] === '{') { if (depth > 0) depth--; else if (/\btry\s*$/.test(text.slice(Math.max(0, i - 12), i))) return true; }
  }
  return false;
}

/** Every module request and literal file reference in one source text. */
function references(source) {
  const text = stripComments(source), found = [];
  for (const m of text.matchAll(/\brequire\(\s*(['"`])([^'"`$]+)\1\s*\)/g)) found.push({ kind: 'require', request: m[2], optional: inTry(text, m.index) });
  for (const m of text.matchAll(/\bimport\(\s*(['"`])([^'"`$]+)\1\s*\)/g)) found.push({ kind: 'require', request: m[2], optional: inTry(text, m.index) });
  for (const m of text.matchAll(/\b(?:path\.)?(?:join|resolve)\(\s*__dirname\s*((?:,\s*(['"])[^'"]*\2\s*)+)\)/g)) {
    const parts = [...m[1].matchAll(/(['"])([^'"]*)\1/g)].map((p) => p[2]);
    found.push({ kind: 'path', request: parts.join('/'), optional: inTry(text, m.index) });
  }
  return found;
}

/** Walks the asar. Returns {scanned, problems, optional}. A problem is a load that cannot be satisfied from the archive; an optional miss is one inside try { }. */
function checkAsar(archive) {
  const view = openAsar(archive), problems = [], optional = [];
  const pkg = view.isFile('package.json') ? JSON.parse(view.read('package.json')) : null;
  if (!pkg) return { scanned: 0, problems: [{ file: 'package.json', request: '', why: 'package.json is not in the asar' }] };
  const entry = pkg.main ? resolveFile(view, path.posix.normalize(pkg.main)) : null;
  if (!entry) problems.push({ file: 'package.json', request: pkg.main || '(no main)', why: 'the "main" entry is not in the asar' });
  const roots = [...view.files].filter((f) => f.startsWith('desktop/') && !f.includes('/node_modules/') && SCRIPT.test(f));
  if (entry && !roots.includes(entry)) roots.push(entry);
  if (!roots.length) problems.push({ file: 'desktop/', request: '', why: 'no scripts under desktop/ in the asar' });
  for (const file of roots) {
    const dir = path.posix.dirname(file);
    for (const ref of references(view.read(file))) {
      // A mac-*.node addon is built and shipped only in the macOS package; its Windows loader is a darwin-only lazy default.
      const macOnly = /(?:^|\/)mac-[^/]*\.node$/.test(ref.request);
      const miss = (why, request = ref.request) => (ref.optional || macOnly ? optional : problems).push({ file, request, why });
      if (ref.kind === 'path') {
        // Only references that name a file (an extension on the last part) are checked: a folder may be created at run time.
        if (!/\.[a-z0-9]{1,6}$/i.test(ref.request)) continue;
        const target = path.posix.normalize(path.posix.join(dir, ref.request));
        if (!view.isFile(target)) miss(`file reference resolves to ${target}, which is not in the asar`);
        continue;
      }
      if (ref.request.startsWith('node:') || PROVIDED.has(ref.request) || PROVIDED.has(ref.request.split('/')[0])) continue;
      if (ref.request.startsWith('.')) {
        const target = path.posix.normalize(path.posix.join(dir, ref.request));
        if (!resolveFile(view, target)) miss(`resolves to ${target}, which is not in the asar`);
      } else if (!resolvePackage(view, dir, ref.request)) {
        miss('package is not in the asar node_modules');
      }
    }
  }
  return { scanned: roots.length, problems, optional };
}

/**
 * Proves the walker can fail. Copies desktop/ and package.json out of the real asar into a throwaway folder, repacks an untouched control and a
 * copy with one required desktop file removed, and requires the control to be clean of that file while the broken copy reports it.
 * Returns {ok, victim, detail}. The real asar is only read.
 */
async function selfTest(archive, workDir) {
  const fs = require('node:fs'), os = require('node:os');
  const view = openAsar(archive);
  const dir = fs.mkdtempSync(path.join(workDir || os.tmpdir(), 'asar-selftest-'));
  try {
    const keep = [...view.files].filter((f) => f === 'package.json' || (f.startsWith('desktop/') && !f.includes('/node_modules/')));
    const tree = path.join(dir, 'app');
    for (const rel of keep) { const out = path.join(tree, rel); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, asar.extractFile(archive, path.normalize(rel))); }
    // The victim: a desktop script that another desktop script requires directly and not inside try { }.
    let victim = null;
    for (const file of keep.filter((f) => SCRIPT.test(f))) {
      for (const ref of references(view.read(file))) {
        if (ref.kind !== 'require' || ref.optional || !ref.request.startsWith('.') || !/\.(?:cjs|js)$/.test(ref.request)) continue;
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), ref.request));
        if (keep.includes(target) && target !== file) { victim = { target, by: file }; break; }
      }
      if (victim) break;
    }
    if (!victim) return { ok: false, victim: null, detail: 'no direct desktop require found to break' };
    const control = path.join(dir, 'control.asar'), broken = path.join(dir, 'broken.asar');
    await asar.createPackage(tree, control);
    fs.rmSync(path.join(tree, victim.target));
    await asar.createPackage(tree, broken);
    const names = (r) => r.problems.map((p) => p.request + ' in ' + p.file);
    const before = checkAsar(control), after = checkAsar(broken);
    const flagged = after.problems.filter((p) => p.file === victim.by && path.posix.normalize(path.posix.join(path.posix.dirname(p.file), p.request)) === victim.target);
    // package.json's node_modules are not copied, so both archives report the same missing packages; only the delta matters.
    const control_hit = before.problems.some((p) => p.file === victim.by && path.posix.normalize(path.posix.join(path.posix.dirname(p.file), p.request)) === victim.target);
    const ok = flagged.length > 0 && !control_hit;
    return { ok, victim: victim.target, detail: ok ? 'removing ' + victim.target + ' (required by ' + victim.by + ') is reported; the untouched repack is clean of it' : 'removing ' + victim.target + ' went unreported (' + names(after).length + ' problems in the broken copy, ' + names(before).length + ' in the control)' };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

module.exports = { checkAsar, references, openAsar, selfTest };

if (require.main === module) {
  const result = checkAsar(path.resolve(process.argv[2] || ''));
  for (const p of result.problems) console.log(`MISSING ${p.file}: ${p.request} (${p.why})`);
  for (const p of result.optional) console.log(`optional ${p.file}: ${p.request} (${p.why})`);
  console.log(`${result.scanned} scripts scanned, ${result.problems.length} problems, ${result.optional.length} optional misses`);
  process.exit(result.problems.length ? 1 : 0);
}
