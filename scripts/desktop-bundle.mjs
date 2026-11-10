// The main process ships as ONE bundle (desktop/main.cjs) instead of ~130 files with the same libraries copied into several of them.
// Fewer files to find, read and compile at start, and one copy of each dependency. Both release builds use this.
import fs from 'node:fs/promises';
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
  'desktop/browser-services/secured-notification-preload.cjs',
  'desktop/rewind/peek-frame.html',
  'desktop/rewind/peek-frame-preload.cjs',
  'desktop/tab-card.html',
  'desktop/tab-card-preload.cjs',
  'desktop/swipe-nav.html',
  'desktop/swipe-nav-preload.cjs',
  'desktop/site-prompt.html',
  'desktop/site-prompt-preload.cjs',
  'desktop/browser-services/js-dialog-preload.cjs',
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
  'desktop/browser-services/autoconsent-preload.cjs', // built from autoconsent-preload-entry.cjs (DuckDuckGo's autoconsent bundled in)
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

/** The main process asks for ./runtime.cjs (the reducer, built from src/runtime/core.ts): in the bundle it is simply that source. */
export function runtimeAlias(root) {
  return {name: 'runtime-from-source', setup(build) { build.onResolve({filter: /^(?:\.{1,2}\/)+runtime\.cjs$/}, () => ({path: path.join(root, 'src/runtime/core.ts')})); build.onResolve({filter: /^(?:\.{1,2}\/)+i18n\.cjs$/}, () => ({path: path.join(root, 'src/i18n/main.ts')})); }};
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

/** Builds output/desktop/main.cjs; the source map goes to output/sourcemaps/ (outside the product, kept with the release for crash stacks). */
export async function bundleDesktop({root, output, plugins}) {
  const result = await esbuild({
    absWorkingDir: root, entryPoints: [path.join(root, 'desktop/main.cjs')], outfile: path.join(output, 'desktop/main.cjs'),
    bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: EXTERNAL, sourcemap: 'external', sourcesContent: true, metafile: true, logLevel: 'silent', plugins: [ghosteryPreloadPathStub(), packedCatalogs(), ...(plugins || [])],
  });
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
export async function bundleAnswerPreload({root, outfile, plugins = [], metafile = false, banner, logLevel = 'silent'}) {
  const result = await esbuild({absWorkingDir: root, entryPoints: [ANSWER_PRELOAD_ENTRY], outfile, bundle: true, platform: 'browser', format: 'cjs', target: 'chrome130', external: ['electron'], legalComments: 'inline', metafile, logLevel, plugins, ...(banner ? {banner: {js: banner}} : {})});
  await oneByteFile(path.resolve(root, outfile), LATIN1);
  return result;
}
