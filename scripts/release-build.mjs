import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {build as esbuild} from 'esbuild';
import {build as viteBuild} from 'vite';
import {bundleSharedExtensionSDK} from './release-shared-sdk.mjs';
import {bundleDesktop,runtimeAlias,workingTreeSource,PATH_LOADED} from './desktop-bundle.mjs';
const require=createRequire(import.meta.url);
export const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function filesIn(dir){
  const files=[];for(const item of await fs.readdir(dir,{withFileTypes:true})){const full=path.join(dir,item.name);if(item.isSymbolicLink())throw new Error('Symlink is not permitted in release inputs: '+full);if(item.isDirectory())files.push(...await filesIn(full));else if(item.isFile())files.push(full);}return files.sort();
}
export async function copyMacMaterial(output,source,extraSources={}){
  if(process.platform!=='darwin')return;
  const file=path.join(root,'desktop/native/mac-material.mm');
  if(source&&!source.equals(await fs.readFile(file)))throw new Error('Mac material source differs from committed source');
  for(const [name,expected]of Object.entries(extraSources))if(!expected.equals(await fs.readFile(path.join(root,'desktop/native',name))))throw new Error('Mac passkey source differs from committed source: '+name);
  execFileSync(process.execPath,[path.join(root,'scripts/build-mac-material.mjs')],{cwd:root,stdio:'inherit'});
  const target=path.join(output,'desktop/native/build');await fs.mkdir(target,{recursive:true});
  await fs.copyFile(path.join(root,'desktop/native/build/mac-material.node'),path.join(target,'mac-material.node'));
}
export async function sourceIdentity(){
  const files=[];for(const dir of ['src','desktop','resources','public'])files.push(...await filesIn(path.join(root,dir)));
  for(const file of ['package.json','package-lock.json','index.html','vite.config.ts','tsconfig.json','design-tokens.json','page-zoom-levels.json']){try{await fs.access(path.join(root,file));files.push(path.join(root,file));}catch{}}
  const entries=[];for(const file of files){if(['runtime.cjs','i18n.cjs'].some(name=>file===path.join(root,'desktop',name))||file.startsWith(path.join(root,'desktop/native/build')+path.sep))continue;entries.push({file:path.relative(root,file).replaceAll('\\','/'),sha256:sha(await fs.readFile(file))});}
  entries.sort((a,b)=>a.file.localeCompare(b.file));return {digest:sha(JSON.stringify(entries)),files:entries};
}
export async function copyReaderAssets(output){
  for(const relative of ['README.md','readability/Readability.js','readability/LICENSE.md','readability/upstream-package.json','dompurify/purify.min.js','dompurify/LICENSE.txt']){const source=path.join(root,'desktop/browser-services/vendor',relative),target=path.join(output,'desktop/browser-services/vendor',relative);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(source,target);}
}
export async function buildIsolated(output){
  output=path.resolve(output);if(!output.startsWith(path.join(root,'qa/artifacts/release-'))&&!output.startsWith(path.join(root,'release/')))throw new Error('Output must be in ignored qa/artifacts/release-* or release/');
  try{await fs.access(path.join(output,'build-identity.json'));throw new Error('Use a fresh candidate directory; existing evidence is immutable');}catch(error){if(error.code!=='ENOENT')throw error;}
  const before=await sourceIdentity();await fs.mkdir(output,{recursive:true});await copyMacMaterial(output);
  const roots=['main.cjs','preload.cjs','page-input-preload.cjs'];try{await fs.access(path.join(root,'desktop/browser-services/optional-filtering.cjs'));roots.push('browser-services/content-filter-preload.cjs');}catch{}
  const natives=[],queue=roots.map(file=>path.join(root,'desktop',file)),seen=new Set();
  while(queue.length){const file=queue.shift();if(seen.has(file)||['runtime.cjs','i18n.cjs'].some(name=>file===path.join(root,'desktop',name)))continue;seen.add(file);natives.push(file);const text=await fs.readFile(file,'utf8');for(const match of text.matchAll(/require\(['"](\.{1,2}\/[^'"]+\.cjs)['"]\)/g)){const target=path.resolve(path.dirname(file),match[1]);if(!target.startsWith(path.join(root,'desktop')+path.sep))throw new Error('Native import escaped desktop source: '+match[1]);queue.push(target);}}
  const sharedSDK=await bundleSharedExtensionSDK(output),warnings=[...sharedSDK.warnings];
  // The main process is one bundle (scripts/desktop-bundle.mjs).
  const nativeResult=await bundleDesktop({root,output,plugins:[runtimeAlias(root),workingTreeSource(root)]});
  warnings.push(...nativeResult.warnings.map(w=>w.text));
  const hasUiPreload=await fs.access(path.join(root,'desktop/ui-preload-entry.cjs')).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});
  const uiPreload=hasUiPreload?await esbuild({absWorkingDir:root,entryPoints:['desktop/ui-preload-entry.cjs'],outfile:path.join(output,'desktop/ui-preload.cjs'),bundle:true,platform:'node',format:'cjs',target:'node24',external:['electron'],metafile:true,logLevel:'silent'}):null;
  warnings.push(...(uiPreload?.warnings||[]).map(w=>w.text));
  if(uiPreload&&Object.values(uiPreload.metafile.outputs).some(file=>file.imports.some(entry=>entry.external&&entry.path!=='electron')))throw new Error('Sandbox UI preload must bundle every dependency except electron');
  // The cookie-banner answering preload bundles DuckDuckGo's autoconsent the same way (a sandboxed frame preload cannot require it).
  const hasAnswerPreload=await fs.access(path.join(root,'desktop/browser-services/autoconsent-preload-entry.cjs')).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});
  const answerPreload=hasAnswerPreload?await esbuild({absWorkingDir:root,entryPoints:['desktop/browser-services/autoconsent-preload-entry.cjs'],outfile:path.join(output,'desktop/browser-services/autoconsent-preload.cjs'),bundle:true,platform:'browser',format:'cjs',target:'chrome130',external:['electron'],legalComments:'inline',metafile:true,logLevel:'silent'}):null;
  warnings.push(...(answerPreload?.warnings||[]).map(w=>w.text));
  if(answerPreload&&Object.values(answerPreload.metafile.outputs).some(file=>file.imports.some(entry=>entry.external&&entry.path!=='electron')))throw new Error('Sandbox cookie-answer preload must bundle every dependency except electron');
  // Optional filtering reads this exact preload source to construct an inert
  // child-frame runtime. Preserve its byte-level source contract after bundling.
  // Files the main process opens by path rather than require(): copied as they are.
  for(const file of PATH_LOADED)await fs.mkdir(path.dirname(path.join(output,file)),{recursive:true}).then(()=>fs.copyFile(path.join(root,file),path.join(output,file)));
  if(roots.includes('browser-services/content-filter-preload.cjs'))await fs.copyFile(path.join(root,'desktop/browser-services/content-filter-preload.cjs'),path.join(output,'desktop/browser-services/content-filter-preload.cjs'));
  // These sandbox preloads are registered by path, outside the native require graph.
  await esbuild({absWorkingDir:root,entryPoints:['src/runtime/core.ts'],outfile:path.join(output,'desktop/runtime.cjs'),bundle:true,platform:'node',format:'cjs',target:'node22',logLevel:'silent'});
  await viteBuild({root,build:{outDir:path.join(output,'dist'),emptyOutDir:false},logLevel:'warn'});
  await fs.cp(path.join(root,'resources'),path.join(output,'resources'),{recursive:true,errorOnExist:true});
  // Every build starts from today's lists and scriptlets (a failed download keeps the committed ones and says so loudly), then compiles the engine from them.
  execFileSync(process.execPath,[path.join(root,'scripts','fetch-baseline-filters.mjs'),path.join(output,'resources','filters'),'--soft'],{stdio:'inherit'});
  // A first run would otherwise spend about a second parsing the bundled filter lists: ship the compiled engine (ignored when the lists differ).
  execFileSync(process.execPath,[path.join(root,'scripts','build-filter-engine.cjs'),path.join(output,'resources','filters')],{stdio:'inherit'});
  for(const file of await filesIn(path.join(root,'desktop'))){if(!/\.(?:txt|json)$/.test(file))continue;const target=path.join(output,'desktop',path.relative(path.join(root,'desktop'),file));await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(file,target);}
  // Reader evaluates these pinned source files as text in an isolated world;
  // esbuild cannot discover fs.readFileSync assets. Include their full notices.
  if(natives.includes(path.join(root,'desktop/browser-services/reader.cjs')))await copyReaderAssets(output);
  if(natives.includes(path.join(root,'desktop/browser-services/annoyance-rules.cjs')))for(const name of ['easylist-cookie.txt','README.md','LICENSE.CC-BY-3.0.txt']){const target=path.join(output,'desktop/browser-services/annoyance-lists',name);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(path.join(root,'desktop/browser-services/annoyance-lists',name),target);}
  try{await fs.copyFile(path.join(root,'page-zoom-levels.json'),path.join(output,'page-zoom-levels.json'));}catch(error){if(error.code!=='ENOENT')throw error;}
  for(const [module,file]of [['electron-chrome-extensions','chrome-extension-api.preload.js'],['electron-chrome-web-store','chrome-web-store.preload.js']]){
    await fs.copyFile(require.resolve(module+'/preload'),path.join(output,'desktop',file));
  }
  // R4-37: Ghostery's cosmetic preload is no longer used (content-filter-preload.cjs feeds the engine) and is not shipped;
  // the blocker's load-time path lookup is a fixed stub in the bundle (desktop-bundle.mjs ghosteryPreloadPathStub).
  const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));await fs.writeFile(path.join(output,'package.json'),JSON.stringify({name:pkg.name,version:pkg.version,description:pkg.description,license:pkg.license,main:'desktop/main.cjs'},null,2)+'\n');
  const after=await sourceIdentity(),stable=before.digest===after.digest;
  const artifacts=[];for(const file of await filesIn(output))artifacts.push({file:path.relative(output,file).replaceAll('\\','/'),sha256:sha(await fs.readFile(file))});
  const identity={schema:1,createdAt:new Date().toISOString(),commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sourceDigest:before.digest,stable,source:before.files,version:pkg.version,electron:require('electron/package.json').version,lockSha256:sha(await fs.readFile(path.join(root,'package-lock.json'))),host:{platform:process.platform,arch:process.arch,node:process.version},artifacts,warnings,dependenciesBundled:[...new Set([...Object.keys(nativeResult.metafile.inputs),...Object.keys(uiPreload?.metafile.inputs||{}),...sharedSDK.dependenciesBundled].filter(file=>file.startsWith('node_modules/')))],sharedNativeSDK:sharedSDK,qualification:'Isolated source build only; native acceptance required.'};
  await fs.writeFile(path.join(output,'build-identity.json'),JSON.stringify(identity,null,2)+'\n');
  if(!stable)throw new Error('Sources changed during build. Candidate invalid; retained for diagnosis.');return identity;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const output=process.argv[2]||path.join(root,'qa/artifacts/release-'+new Date().toISOString().replace(/[:.]/g,'-'));
  const identity=await buildIsolated(output);console.log(JSON.stringify({output,sourceDigest:identity.sourceDigest,stable:identity.stable,version:identity.version,electron:identity.electron,files:identity.artifacts.length,warnings:identity.warnings},null,2));
}
