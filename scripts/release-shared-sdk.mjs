import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {root,sha} from './release-build.mjs';
const require=createRequire(import.meta.url);

// The SDK owns process-wide Session->runtime and partition-resolver registries.
// Every main-process service must require the same module instance. Generate a
// single bundled module, its required preload and notices; never copy a tree.
export async function bundleSharedExtensionSDK(output){
 const name='electron-chrome-extensions',source=path.resolve(path.dirname(require.resolve(name)),'../..'),pkg=JSON.parse(await fs.readFile(path.join(source,'package.json'),'utf8'));
 if(pkg.name!==name||pkg.version!=='4.9.0')throw new Error('Shared native extension SDK shape requires qualification for '+pkg.version);
 const folder=path.join(output,'node_modules',name);await fs.mkdir(folder,{recursive:true});
 const result=await build({absWorkingDir:root,entryPoints:[require.resolve(name)],outfile:path.join(folder,'index.cjs'),bundle:true,platform:'node',format:'cjs',target:'node24',external:['electron'],metafile:true,logLevel:'silent'});
 await fs.copyFile(require.resolve(name+'/preload'),path.join(folder,'chrome-extension-api.preload.js'));
 const licenses=(await fs.readdir(source)).filter(file=>/^LICENSE(?:[.-]|$)/i.test(file));if(!licenses.some(file=>/GPL/i.test(file)))throw new Error('Full selected GPL extension SDK license is required');
 for(const file of licenses)await fs.copyFile(path.join(source,file),path.join(folder,file));
 await fs.writeFile(path.join(folder,'package.json'),JSON.stringify({name,version:pkg.version,license:pkg.license,aciraLicenseSelection:'GPL-3.0',main:'index.cjs',exports:{'.':'./index.cjs','./preload':'./chrome-extension-api.preload.js'},repository:pkg.repository},null,2)+'\n');
 return {name,version:pkg.version,bundledEntry:'node_modules/'+name+'/index.cjs',entrySha256:sha(await fs.readFile(path.join(folder,'index.cjs'))),preloadSha256:sha(await fs.readFile(path.join(folder,'chrome-extension-api.preload.js'))),licenseFiles:licenses,warnings:result.warnings.map(w=>w.text),dependenciesBundled:Object.keys(result.metafile.inputs).filter(file=>file.startsWith('node_modules/')),qualification:'One generated native SDK module instance; only its compiled entry, preload, metadata and full licenses retained.'};
}
