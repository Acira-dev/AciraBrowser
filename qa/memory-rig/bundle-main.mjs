// Builds the release's main-process bundle (the same esbuild step the release builds run, scripts/desktop-bundle.mjs) into a folder under /tmp,
// without packaging anything, and prints its size and whether it is plain ASCII (the main process keeps ASCII text at one byte per character).
// usage: node qa/memory-rig/bundle-main.mjs <repo root> <output folder>      (run with desktop/main.cjs as the SOURCE file, not an earlier bundle)
import path from 'node:path';
import fs from 'node:fs';
const [root, out] = [path.resolve(process.argv[2] || '.'), path.resolve(process.argv[3] || '')];
if (!out.startsWith('/tmp/')) { console.error('output must be under /tmp'); process.exit(2); }
const {bundleDesktop, runtimeAlias, workingTreeSource} = await import(path.join(root, 'scripts/desktop-bundle.mjs'));
fs.mkdirSync(out, {recursive: true});
await bundleDesktop({root, output: out, plugins: [runtimeAlias(root), workingTreeSource(root)]});
const text = fs.readFileSync(path.join(out, 'desktop/main.cjs'), 'utf8');
let wide = 0; for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) > 127) wide++;
console.log(`bundle ${path.join(out, 'desktop/main.cjs')}: ${fs.statSync(path.join(out, 'desktop/main.cjs')).size} bytes, ${wide} non-ASCII characters`);
