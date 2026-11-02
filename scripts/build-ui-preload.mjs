import {build} from 'esbuild';
await build({entryPoints:['desktop/ui-preload-entry.cjs'],outfile:'desktop/ui-preload.cjs',bundle:true,platform:'node',format:'cjs',target:'node24',external:['electron'],logLevel:'warning'});
