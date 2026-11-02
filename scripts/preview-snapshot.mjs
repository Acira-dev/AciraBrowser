import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {spawnSync} from 'node:child_process';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
// POSIX execute bits are part of a runnable build (Tor and bridge helpers).
// Windows has no equivalent executable-file mode and keeps its existing identity.
const modeOf=file=>process.platform==='win32'?undefined:fs.lstatSync(file).mode&0o777;
const identify=(identity,file,bytes,mode)=>{identity.update(file).update('\0');if(mode!==undefined)identity.update('mode:'+mode+'\0');identity.update(bytes);};
export function verifyPreservedBuild(manifest){
 const root=path.resolve(manifest.launchPath),identity=createHash('sha256');if(!/^[a-f0-9]{64}$/.test(manifest.id)||!Array.isArray(manifest.files))throw Error('Invalid preserved preview manifest.');
 for(const file of manifest.files){const target=path.resolve(root,file.path);if(!target.startsWith(root+path.sep)||fs.lstatSync(target).isSymbolicLink()||!fs.realpathSync(target).startsWith(fs.realpathSync(root)+path.sep))throw Error('Invalid preserved preview file.');const bytes=fs.readFileSync(target);if(hash(bytes)!==file.sha256)throw Error('A preserved preview build was changed: '+file.path);if(file.mode!==undefined&&(!Number.isInteger(file.mode)||file.mode<0||file.mode>0o777||modeOf(target)!==file.mode))throw Error('A preserved preview build mode was changed: '+file.path);identify(identity,file.path,bytes,file.mode);}
 if(identity.digest('hex')!==manifest.id)throw Error('Preserved preview identity does not match its files.');return manifest;
}
/** Preserve code/assets only. Never open/copy browser profile databases or credentials. */
export function preservePreviewBuild({root,directory,checkSyntax=true}){
 root=path.resolve(root);directory=path.resolve(directory);const files=[];
 const visit=(relative)=>{const source=path.join(root,relative),stat=fs.lstatSync(source);if(stat.isSymbolicLink())throw Error('Preview source links are unsupported: '+relative);if(stat.isDirectory()){for(const name of fs.readdirSync(source).sort())visit(path.join(relative,name));}else if(stat.isFile())files.push(relative);};
 for(const source of ['desktop','dist','resources','design-tokens.json','page-zoom-levels.json','package.json'])visit(source);
 for(const required of ['desktop/main.cjs','desktop/preload.cjs','desktop/ui-preload.cjs','desktop/runtime.cjs','dist/index.html'])if(!files.includes(path.normalize(required)))throw Error('Missing preview build file: '+required);
 const captured=files.sort().map(relative=>({relative,bytes:fs.readFileSync(path.join(root,relative)),mode:modeOf(path.join(root,relative))})),identity=createHash('sha256');for(const file of captured)identify(identity,file.relative.replaceAll(path.sep,'/'),file.bytes,file.mode);const id=identity.digest('hex'),target=path.join(directory,id.slice(0,20));
 // Recheck after the read, before publishing the snapshot, to detect concurrent writes.
 if(captured.some(file=>!fs.readFileSync(path.join(root,file.relative)).equals(file.bytes)||modeOf(path.join(root,file.relative))!==file.mode))throw Error('Build changed while preserving the preview. Finish the coherent build first.');
 fs.mkdirSync(target,{recursive:true});for(const file of captured){const destination=path.join(target,file.relative);fs.mkdirSync(path.dirname(destination),{recursive:true});if(fs.existsSync(destination)){if(!fs.readFileSync(destination).equals(file.bytes))throw Error('A preserved preview build was changed: '+file.relative);if(modeOf(destination)!==file.mode)throw Error('A preserved preview build mode was changed: '+file.relative);}else{fs.writeFileSync(destination,file.bytes);if(file.mode!==undefined)fs.chmodSync(destination,file.mode);}}
 if(checkSyntax)for(const file of captured.filter(file=>file.relative.endsWith('.cjs'))){const result=spawnSync(process.execPath,['--check',path.join(target,file.relative)],{windowsHide:true,encoding:'utf8'});if(result.status!==0)throw Error('Preview native syntax failed: '+file.relative+' '+result.stderr);}
 const manifest={id,created:new Date().toISOString(),launchPath:target,entry:path.join(target,'desktop','main.cjs'),files:captured.map(file=>({path:file.relative.replaceAll(path.sep,'/'),sha256:hash(file.bytes),...(file.mode===undefined?{}:{mode:file.mode})}))};fs.writeFileSync(path.join(target,'preview-manifest.json'),JSON.stringify(manifest,null,2));return manifest;
}
