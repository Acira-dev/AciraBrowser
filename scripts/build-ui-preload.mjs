import {build} from 'esbuild';
import {bundleAnswerPreload} from './desktop-bundle.mjs';
await build({entryPoints:['desktop/ui-preload-entry.cjs'],outfile:'desktop/ui-preload.cjs',bundle:true,platform:'node',format:'cjs',target:'node24',external:['electron'],logLevel:'warning'});
// Answering cookie banners (browser-services/autoconsent-preload-entry.cjs): a sandboxed frame preload cannot require DuckDuckGo's autoconsent, so it is bundled in.
await bundleAnswerPreload({root:process.cwd(),outfile:'desktop/browser-services/autoconsent-preload.cjs',banner:'/* Built by scripts/build-ui-preload.mjs from autoconsent-preload-entry.cjs. Includes @duckduckgo/autoconsent (MPL-2.0, LICENSE.autoconsent.txt; source: https://github.com/duckduckgo/autoconsent). */',logLevel:'warning'});
