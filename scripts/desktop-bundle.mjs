// The main process ships as ONE bundle (desktop/main.cjs) instead of ~130 files with the same libraries copied into several of them.
// Fewer files to find, read and compile at start, and one copy of each dependency. Both release builds use this.
import fs from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {build as esbuild} from 'esbuild';
import {oneByteSource, oneByteFile, LATIN1} from './one-byte-source.mjs';

/** Never bundled: Electron itself, and packages the product loads by path or ships as their own file. */
export const EXTERNAL = ['electron', 'electron-chrome-extensions'];

/** A worker-thread script the bundle starts by path: built as a second bundle beside main.cjs (bundleDesktop), so it is not in PATH_LOADED. */
export const WORKER_ENTRY = 'desktop/browser-services/filter-engine-worker.cjs';

/** R4-37: Acira no longer registers Ghostery's cosmetic preload (content-filter-preload.cjs feeds the engine), so the release does not ship
 *  @ghostery/adblocker-electron-preload. The blocker library still resolves that package's path when it loads (preload_path.js, used only by its
 *  own enableBlockingInSession, which Acira never calls); in the bundle that path is a fixed empty string instead of a require.resolve. */
export function ghosteryPreloadPathStub() {
  return {name: 'ghostery-preload-path-stub', setup(build) {
    build.onResolve({filter: /^\.\/preload_path(?:\.js)?$/}, args => args.importer.replaceAll('\\', '/').includes('/@ghostery/adblocker-electron/') ? {path: 'ghostery-preload-path', namespace: 'acira-stub'} : undefined);
    build.onLoad({filter: /.*/, namespace: 'acira-stub'}, () => ({contents: "exports.PRELOAD_PATH='';", loader: 'js'}));
  }};
}

/**
 * Files the main process opens by path (preload scripts for sandboxed pages and dialogs, a page template). They are not require()d,
 * so they cannot be bundled; each is copied as it is, to the same place under desktop/ that the source expects.
 * Data files read by path are copied by the release builds themselves (annoyance lists, Reader assets, filter lists) and listed in DATA_LOADED.
 */
export const PATH_LOADED = [
  'desktop/dialog-preload.cjs',
  'desktop/share-preload.cjs',
  'desktop/page-input-preload.cjs',
  'desktop/preload.cjs',
  'desktop/browser-services/content-filter-preload.cjs',
  'desktop/browser-services/scriptlet-preload.cjs',
  'desktop/browser-services/passkey-guard-preload.cjs',
  'desktop/browser-services/mac-passkey-preload.cjs',
  'desktop/browser-services/passkey-test-stub-preload.cjs',
  'desktop/browser-services/farbling-preload.cjs',
  'desktop/browser-services/chrome-identity-preload.cjs',
  'desktop/browser-services/tor-identity.cjs',
  'desktop/browser-services/sign-in-beacons.cjs',
  'desktop/browser-services/permission-state-preload.cjs',
  'desktop/browser-services/user-scripts-preload.cjs',
  'desktop/browser-services/side-panel-frame.html',
  'desktop/browser-services/side-panel-frame-preload.cjs',
  'desktop/side-panel-sites-frame.html',
  'desktop/side-panel-sites-frame-preload.cjs',
  'desktop/browser-services/secured-notification-preload.cjs',
  'desktop/browser-services/site-notification-preload.cjs',   // 14.3: a page's notifications to Acira's own panel
  'desktop/browser-services/site-notification-worker-preload.cjs',   // 14.3: a service worker's notifications (type 'service-worker')
  'desktop/browser-services/media-session-preload.cjs',   // Beta 14: the page's media-key handlers, for the now-playing card's Previous / Next
  'desktop/browser-services/pip-signal-preload.cjs',   // Beta 14 (macOS): a video entered picture in picture, so its small window may join a fullscreen Space
  'desktop/devtools-divider.html',   // Beta 14: the divider between a page and its docked Developer tools
  'desktop/devtools-divider-preload.cjs',
  'desktop/rewind/peek-frame.html',
  'desktop/rewind/peek-frame-preload.cjs',
  'desktop/screenshot-layer.html',   // Beta 14: the area picker of the page screenshot, and its preload
  'desktop/screenshot-layer-preload.cjs',
  'desktop/tab-card.html',
  'desktop/zap-layer.html',   // Beta 14, Zap: the picker's layer above the page, and the page side that picks and hides
  'desktop/zap-layer-preload.cjs',
  'desktop/browser-services/zap-preload.cjs',
  'desktop/tab-card-preload.cjs',
  'desktop/swipe-nav.html',
  'desktop/season-overlay.html',   // Noël, Snowfall over the whole window: the click-through snow window above the page, its script (built from src/season/winter/overlay.ts) and its preload
  'desktop/season-overlay.js',
  'desktop/season-overlay-preload.cjs',
  'desktop/swipe-nav-preload.cjs',
  'desktop/site-prompt.html',
  'desktop/site-prompt-preload.cjs',
  'desktop/browser-services/js-dialog-preload.cjs',
  'desktop/browser-services/capture-tracker-preload.cjs',
  'desktop/passwords/page-preload.cjs',
  'desktop/passwords/prompt-frame.html',
  'desktop/passwords/prompt-frame-preload.cjs',
  'desktop/browser-services/protected-media-preload.cjs',
  'desktop/browser-services/store-bar-preload.cjs',
  'desktop/browser-services/search-preview-preload.cjs',
  'desktop/browser-services/page-risk-preload.cjs',
  'desktop/browser-services/de-amp-preload.cjs',
  'desktop/browser-services/extension-compat.json',
];

/** Read by path, copied by the release builds (see release-build*.mjs) or built separately; tests/release-desktop-bundle.test.mjs checks the list is complete. */
export const DATA_LOADED = [
  'desktop/ui-preload.cjs', // built from ui-preload-entry.cjs
  'desktop/browser-services/autoconsent-preload.cjs', // built from autoconsent-preload-entry.cjs (the entry only: DuckDuckGo's autoconsent is the file below)
  'desktop/browser-services/autoconsent-library.js', // DuckDuckGo's autoconsent, built beside the preload by bundleAnswerPreload and handed to a frame that finds a consent tool (optional-filtering.cjs)
  'desktop/native/build/mac-material.node', // compiled and copied by copyMacMaterial on macOS
  'desktop/browser-services/annoyance-lists', 'desktop/browser-services/helium-annoyances.txt',
  'desktop/browser-services/vendor/readability/Readability.js', 'desktop/browser-services/vendor/dompurify/purify.min.js',
  'dist', 'resources/filters', 'preview-manifest.json', // dist/resources: next to desktop/ in the app; the manifest is a development-only extra
  'desktop/browser-services/tor-engine/win-x64/tor.exe', // extraResources puts it at resources/tor/tor.exe; this path is the development fallback
  'desktop/browser-services/tor-engine/win-x64/pluggable_transports', // bridge clients: resources/tor/pluggable_transports in the app; development fallback
  'scripts/fetch-tor.mjs', // development builds only (tor-engine.cjs repairDevEngine); installed apps ship tor.exe instead
  'desktop/browser-services/filter-engine-worker.cjs', // built by bundleDesktop beside main.cjs (WORKER_ENTRY): the filter engine's compile thread
  'desktop/main.cjs', // the bundle itself; web-apps.cjs names it only in development launch arguments
];

/**
 * Every module in the bundle shares one __dirname, so a file in desktop/browser-services/ that says __dirname would look beside the
 * bundle. Each module's __dirname is rewritten to the folder its source lives in, so paths like join(__dirname,'annoyance-lists') keep working.
 */
export function rewriteDirname(relative, text) {
  if (!relative.startsWith('desktop/') || !text.includes('__dirname')) return text;
  const folder = path.posix.dirname(relative.slice('desktop/'.length));
  if (folder === '.') return text;
  return text.replace(/\b__dirname\b/g, `require('node:path').join(__dirname,${JSON.stringify(folder)})`);
}

/** The main process asks for desktop/runtime.cjs (the reducer, built from src/runtime/core.ts) and desktop/i18n.cjs: in the bundle they are simply those sources.
 *  EXACT: only the request that resolves to desktop/runtime.cjs (or desktop/i18n.cjs) is aliased, whichever folder asks for it ('./runtime.cjs' from desktop/, '../runtime.cjs' from
 *  desktop/browser-services/). A same-named file elsewhere is not: ext-api/runtime.cjs (the chrome.runtime package) was once swallowed by a filter on the bare file name, so the
 *  packaged apps got the reducer where the package should be, and no extension API package installed (13.8). */
export function runtimeAlias(root) {
  // Compared as real paths: esbuild hands a plugin the REAL folder of the importer, and a checkout reached through a link (a Mac's /tmp, a Windows junction) must not turn the alias off.
  const real = folder => { try { return realpathSync.native(folder); } catch { return path.resolve(folder); } };
  const same = (a, b) => (process.platform === 'win32' || process.platform === 'darwin' ? a.toLowerCase() === b.toLowerCase() : a === b);
  const aliases = [['runtime.cjs', path.join(root, 'src/runtime/core.ts'), /^(?:\.{1,2}\/)+runtime\.cjs$/], ['i18n.cjs', path.join(root, 'src/i18n/main.ts'), /^(?:\.{1,2}\/)+i18n\.cjs$/]];
  return {name: 'runtime-from-source', setup(build) {
    for (const [name, to, filter] of aliases) {
      build.onResolve({filter}, args => {
        const folder = args.resolveDir || (args.importer ? path.dirname(args.importer) : '');
        return folder && same(path.resolve(real(folder), args.path), path.join(real(path.join(root, 'desktop')), name)) ? {path: to} : undefined;
      });
    }
  }};
}

/** For the working-tree build: desktop sources are read from disk with __dirname rewritten. */
export function workingTreeSource(root) {
  return {name: 'desktop-working-tree', setup(build) {
    build.onLoad({filter: /\.cjs$/}, async args => {
      const relative = path.relative(root, args.path).replaceAll('\\', '/');
      if (!relative.startsWith('desktop/')) return undefined;
      return {contents: rewriteDirname(relative, await fs.readFile(args.path, 'utf8')), loader: 'js', resolveDir: path.dirname(args.path)};
    });
  }};
}

/** Memory: the catalogs of the twelve other languages are 5.9 MB of text in the bundle, kept by V8 for as long as the process lives although a person uses at most one
 *  (src/i18n/main.ts builds a catalog the first time its language is in use). Here each is stored brotli-compressed (about 1 MB together) and unpacked at that moment:
 *  the same object comes out (tests/release-desktop-bundle.test.mjs). English stays plain: it is built at start and is the fallback. */
export const PACKED_CATALOG = /[\\/]src[\\/]i18n[\\/](?:es|fr|de|pt-BR|it|ja|zh-CN|ar|tr|ru|ko|hi)\.json$/;
export function packedCatalogs() {
  return {name: 'packed-catalogs', setup(build) {
    build.onLoad({filter: PACKED_CATALOG}, async args => {
      const json = JSON.stringify(JSON.parse(await fs.readFile(args.path, 'utf8')));
      const packed = zlib.brotliCompressSync(Buffer.from(json, 'utf8'), {params: {[zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_LGWIN]: 24, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: json.length}});
      return {contents: `module.exports = JSON.parse(require('node:zlib').brotliDecompressSync(Buffer.from(${JSON.stringify(packed.toString('base64'))}, 'base64')).toString('utf8'));`, loader: 'js'};
    });
  }};
}

/** Where the Chrome extension API work packages live. ext-api/_packages.cjs lists them by literal name so this bundle follows them (a folder read at run time is invisible to a bundler:
 *  until 13.8 the packaged Mac and Windows apps shipped none of them, silently). */
export const EXT_API_DIR = 'desktop/browser-services/ext-api';

/** The package files among repository paths (the loader's rule, ext-api/index.cjs loadPackages): top-level .cjs files of the folder, except index.cjs and names starting with '_'. */
export function extApiPackageFiles(paths) {
  const prefix = EXT_API_DIR + '/';
  return paths.map(item => String(item).replaceAll('\\', '/')).filter(item => item.startsWith(prefix) && !item.slice(prefix.length).includes('/')).map(item => item.slice(prefix.length))
    .filter(name => name.endsWith('.cjs') && name !== 'index.cjs' && !name.startsWith('_')).sort();
}

/** Throws unless the bundle carries every package file, the list that loads them (so `files.length + 1` files are expected), and each package file BOUND to the right module. `inputs` is the esbuild metafile's `inputs` object
 *  (the paths of the bundle's inputs and what each one required) or just the array of input paths (presence only); `files` the package files the source tree has (extApiPackageFiles).
 *  Bound: what ext-api/_packages.cjs requires as './runtime.cjs' must BE ext-api/runtime.cjs, not a same-named module somewhere else (an alias on a bare file name once put the reducer there). */
export function checkBundledPackages(inputs, files) {
  const paths = Array.isArray(inputs) ? inputs : Object.keys(inputs), norm = item => String(item).replaceAll('\\', '/');
  const has = file => paths.some(item => { const value = norm(item); return value === `${EXT_API_DIR}/${file}` || value.endsWith(`:${EXT_API_DIR}/${file}`); });
  if (!files.length) throw new Error(`No extension API packages found in ${EXT_API_DIR}: the release would ship without them.`);
  const missing = files.filter(file => !has(file));
  if (!has('_packages.cjs')) missing.unshift('_packages.cjs');
  if (missing.length) throw new Error(`The main bundle is missing ${missing.length} of ${files.length + 1} extension API package files (${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ', ...' : ''}): list each in ${EXT_API_DIR}/_packages.cjs.`);
  if (Array.isArray(inputs)) return;
  const listKey = paths.find(item => { const value = norm(item); return value === `${EXT_API_DIR}/_packages.cjs` || value.endsWith(`:${EXT_API_DIR}/_packages.cjs`); }), required = inputs[listKey]?.imports || [];
  const wrong = [];
  for (const file of files) {
    const found = required.find(entry => entry.original === `./${file}`);
    if (!found) wrong.push(`${file} (not required by _packages.cjs)`);
    else if (!(norm(found.path) === `${EXT_API_DIR}/${file}` || norm(found.path).endsWith(`:${EXT_API_DIR}/${file}`))) wrong.push(`${file} (bound to ${norm(found.path)})`);
  }
  if (wrong.length) throw new Error(`${wrong.length} extension API package file(s) are bound to the wrong module in the bundle: ${wrong.slice(0, 6).join('; ')}${wrong.length > 6 ? '; ...' : ''}. A plugin's filter is matching by file name.`);
}

/** The same checks on a FINISHED main.cjs (a packaged app's, read from its app.asar): esbuild writes a comment line with the source path above every module it bundles, so a package that
 *  is in the bundle has its path there; and the package map in the bundled _packages.cjs must call, for each file, the module that was bundled FROM that file (esbuild writes the source path
 *  into each module's definition). scripts/check-bundled-ext-api.mjs runs this on a packaged app. */
export function checkBundledText(text, files) {
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const has = file => new RegExp(`^// .*${escape(EXT_API_DIR + '/' + file)}$`, 'm').test(text);
  if (!files.length) throw new Error(`No extension API packages found in ${EXT_API_DIR}.`);
  const missing = files.filter(file => !has(file));
  if (!has('_packages.cjs')) missing.unshift('_packages.cjs');
  if (missing.length) throw new Error(`The packaged main.cjs is missing ${missing.length} of ${files.length + 1} extension API package files (${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ', ...' : ''}).`);
  // Bindings: inside the bundled _packages.cjs, "<file>": require_x() where require_x was bundled from ext-api/<file>.
  const header = new RegExp(`^// .*${escape(EXT_API_DIR + '/_packages.cjs')}$`, 'm').exec(text), after = text.slice(header.index + header[0].length), next = after.search(/^\/\/ \S/m), region = next < 0 ? after : after.slice(0, next);
  const wrong = [];
  for (const file of files) {
    const call = new RegExp(`"${escape(file)}":\\s*([A-Za-z_$][\\w$]*)\\(\\)`).exec(region);
    if (!call) { wrong.push(`${file} (the package map does not call a bundled module for it)`); continue; }
    const definition = new RegExp(`var ${escape(call[1])} = __commonJS\\(\\{\\s*"([^"]+)"`).exec(text);
    if (!definition || !(definition[1] === `${EXT_API_DIR}/${file}` || definition[1].endsWith(`/${EXT_API_DIR}/${file}`))) wrong.push(`${file} (bound to ${definition ? definition[1] : call[1]})`);
  }
  if (wrong.length) throw new Error(`${wrong.length} extension API package file(s) are bound to the wrong module in the packaged main.cjs: ${wrong.slice(0, 6).join('; ')}${wrong.length > 6 ? '; ...' : ''}.`);
}

/** True when this main.cjs is a bundle: esbuild's module helper, or the source-path comment it writes above every module, is in it. The Linux app ships desktop/main.cjs as written
 *  (an unbundled tree: its package files are files in the app.asar), and has neither. */
export function isBundledMain(text) {
  return /^var __commonJS = /m.test(text) || /^\/\/ .*desktop\/[^\s]*\.cjs$/m.test(text);
}

/** The same guarantee for an UNBUNDLED app (Linux): throws unless every package file and the list that loads them are there as files. `paths` are the paths the app holds, written like the
 *  repository's (desktop/browser-services/ext-api/x.cjs; a leading slash and backslashes are fine: an app.asar's listing, or a folder's); only that folder's own entries count. `files` are the
 *  package files the source tree has (extApiPackageFiles); the list, _packages.cjs, makes one more. */
export function checkUnbundledTree(paths, files) {
  const prefix = EXT_API_DIR + '/';
  const present = new Set([...paths].map(item => String(item).replaceAll('\\', '/').replace(/^\/+/, '')).filter(item => item.startsWith(prefix) && !item.slice(prefix.length).includes('/')).map(item => item.slice(prefix.length)));
  if (!files.length) throw new Error(`No extension API packages found in ${EXT_API_DIR}.`);
  const missing = files.filter(file => !present.has(file));
  if (!present.has('_packages.cjs')) missing.unshift('_packages.cjs');
  if (missing.length) throw new Error(`The unbundled app is missing ${missing.length} of ${files.length + 1} extension API package files (${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ', ...' : ''}).`);
}

/** Builds output/desktop/main.cjs; the source map goes to output/sourcemaps/ (outside the product, kept with the release for crash stacks). */
export async function bundleDesktop({root, output, plugins, packageFiles}) {
  const result = await esbuild({
    absWorkingDir: root, entryPoints: [path.join(root, 'desktop/main.cjs')], outfile: path.join(output, 'desktop/main.cjs'),
    bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: EXTERNAL, sourcemap: 'external', sourcesContent: true, metafile: true, logLevel: 'silent', plugins: [ghosteryPreloadPathStub(), packedCatalogs(), ...(plugins || [])],
  });
  // The extension API packages must be in the bundle (the committed-source builds pass the files of the tree they build; otherwise the working tree's folder is read).
  checkBundledPackages(result.metafile.inputs, packageFiles ?? extApiPackageFiles((await fs.readdir(path.join(root, EXT_API_DIR)).catch(() => [])).map(name => `${EXT_API_DIR}/${name}`)));
  // Memory: plain ASCII only, so the main process holds the bundle's text as one byte per character instead of two (scripts/one-byte-source.mjs).
  const mainFile = path.join(output, 'desktop/main.cjs');
  await fs.writeFile(mainFile, oneByteSource(await fs.readFile(mainFile, 'utf8')));
  // The filter engine is compiled on a worker thread (desktop/browser-services/filter-updates.cjs); the worker is its own small bundle so it finds the engine library without node_modules.
  await esbuild({absWorkingDir: root, entryPoints: [path.join(root, WORKER_ENTRY)], outfile: path.join(output, WORKER_ENTRY), bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: EXTERNAL, logLevel: 'silent'});
  const workerFile = path.join(output, WORKER_ENTRY);
  await fs.writeFile(workerFile, oneByteSource(await fs.readFile(workerFile, 'utf8')));
  await fs.mkdir(path.join(output, 'sourcemaps'), {recursive: true});
  await fs.rename(path.join(output, 'desktop/main.cjs.map'), path.join(output, 'sourcemaps/main.cjs.map'));
  return result;
}

/** The cookie-banner answering preload (browser-services/autoconsent-preload-entry.cjs, DuckDuckGo's autoconsent bundled in: a sandboxed frame preload cannot require it).
 *  Memory: every frame of every page reads this 177 KB script, and any character above U+00FF in it (a typographic quote in a regular expression or a comment) makes
 *  the renderer hold it as two-byte text, so it comes out as Latin-1 (scripts/one-byte-source.mjs). The four builds that write it (build-ui-preload.mjs, release-build.mjs
 *  and the two committed-source builds) all go through here. */
export const ANSWER_PRELOAD_ENTRY = 'desktop/browser-services/autoconsent-preload-entry.cjs';
/** Beta 14 speed pass 2: the library is not compiled in every document. A page's main frame only loads it where a consent tool turns up (autoconsent-lazy.cjs),
 *  yet its ~180 KB of code was part of the preload, so every new document parsed it at its start, before the page's own scripts (about 1.5-2 ms a load, measured
 *  with the library left out). The library is now bundled on its own and carried in the preload as the text of a string returned by a function nothing calls
 *  until `require('@duckduckgo/autoconsent').default` is first read (the entry's library()): the parser only skips over that text, and the library is compiled then,
 *  in the preload's own world (webFrame.executeJavaScriptInIsolatedWorld on Electron's context-isolation world, which runs at once and is not subject to the
 *  page's content security policy). Same library, same code, same moment of use. */
export const LIBRARY_KEY = 'acira.autoconsent.library', PRELOAD_WORLD = 999;
export async function answerLibrarySource(root) {
  const out = await esbuild({absWorkingDir: root, stdin: {contents: `globalThis[Symbol.for(${JSON.stringify(LIBRARY_KEY)})]=require('@duckduckgo/autoconsent').default;`, resolveDir: root, sourcefile: 'autoconsent-library.js', loader: 'js'}, bundle: true, write: false, platform: 'browser', format: 'iife', target: 'chrome130', legalComments: 'inline', logLevel: 'silent'});
  // one-byte like the preload itself, so the library is Latin-1 text when it is compiled too (scripts/one-byte-source.mjs)
  return oneByteSource(out.outputFiles[0].text, LATIN1);
}
export const LIBRARY_FILE = 'autoconsent-library.js', LIBRARY_CHANNEL = 'acira:autoconsent-library';
/** 14.4 (RAM): the library's text is no longer carried in the preload at all. Even as a string the parser only skips, the 193 KB were read and held by EVERY frame's renderer
 *  (1.4 MB a page on the bench: 20.2 against 18.8 MB with the text taken out). It is a file beside the preload (LIBRARY_FILE, written by bundleAnswerPreload) that the main process
 *  reads once and hands over, as text, to the one frame that finds a consent tool (LIBRARY_CHANNEL, optional-filtering.cjs); the frame compiles it as before, in the preload's own
 *  world (999). Same library, same code, same moment of use; where main cannot give it, the banner stays as the site drew it. */
export function onDemandLibrary() {
  return {name: 'acira-autoconsent-on-demand', setup(build) {
    build.onResolve({filter: /^@duckduckgo\/autoconsent$/}, () => ({path: 'autoconsent-on-demand', namespace: 'acira-autoconsent-on-demand'}));
    build.onLoad({filter: /.*/, namespace: 'acira-autoconsent-on-demand'}, () => ({loader: 'js', contents:
      `const {webFrame,ipcRenderer}=require('electron');const KEY=Symbol.for(${JSON.stringify(LIBRARY_KEY)});\n` +
      `function librarySource(){const text=ipcRenderer.sendSync(${JSON.stringify(LIBRARY_CHANNEL)});if(typeof text!=='string'||text.length<1000)throw new Error('The cookie-banner library was not handed over.');return text;}\n` +
      `module.exports={get default(){if(!globalThis[KEY]){const done=webFrame.executeJavaScriptInIsolatedWorld(${PRELOAD_WORLD},[{code:librarySource(),url:'acira-autoconsent-library.js'}]);if(done&&typeof done.catch==='function')done.catch(()=>{});}const library=globalThis[KEY];if(typeof library!=='function')throw new Error('The cookie-banner library did not load.');return library;}};\n`}));
  }};
}
export async function bundleAnswerPreload({root, outfile, plugins = [], metafile = false, banner, logLevel = 'silent'}) {
  const library = onDemandLibrary(), text = await answerLibrarySource(root);
  const result = await esbuild({absWorkingDir: root, entryPoints: [ANSWER_PRELOAD_ENTRY], outfile, bundle: true, platform: 'browser', format: 'cjs', target: 'chrome130', external: ['electron'], legalComments: 'inline', metafile, logLevel, plugins: [library, ...plugins], ...(banner ? {banner: {js: banner}} : {})});
  await oneByteFile(path.resolve(root, outfile), LATIN1);
  await fs.writeFile(path.join(path.dirname(path.resolve(root, outfile)), LIBRARY_FILE), text, 'latin1');
  return result;
}
