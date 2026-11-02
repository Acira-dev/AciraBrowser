import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {verifyRuntimePolicy} from '../scripts/release-runtime-policy.mjs';

const hash=async file=>createHash('sha256').update(await fs.readFile(file)).digest('hex');

/** Palette QA can launch only a qualified engine and a verified code snapshot. */
export async function paletteNativeIdentity(argv=process.argv){
 const require=createRequire(import.meta.url),executable=require('electron'),installed=JSON.parse(await fs.readFile('node_modules/electron/package.json','utf8'));
 const runtime={version:installed.version,executable,executableSha256:await hash(executable)};
 const runtimeGate=verifyRuntimePolicy({policy:JSON.parse(await fs.readFile('packaging/runtime-security.json','utf8')),version:runtime.version,executableSha256:runtime.executableSha256});
 if(argv.includes('--check-runtime'))return{runtime,runtimeGate,checkOnly:true};
 const argument=argv.indexOf('--snapshot');if(argument<0||!argv[argument+1])throw Error('Use --snapshot with the explicit immutable code-only build; mutable root launch is not qualified.');
 const allowed=(await fs.realpath(path.resolve('.preview-profile/builds')))+path.sep,codeRoot=await fs.realpath(path.resolve(argv[argument+1]));
 if(!codeRoot.toLowerCase().startsWith(allowed.toLowerCase()))throw Error('Snapshot must stay inside the code-only builds directory.');
 const manifestPath=path.join(codeRoot,'preview-manifest.json'),manifest=JSON.parse(await fs.readFile(manifestPath,'utf8')),identity=createHash('sha256');
 for(const file of manifest.files){
  const target=await fs.realpath(path.resolve(codeRoot,file.path));if(!target.toLowerCase().startsWith((codeRoot+path.sep).toLowerCase()))throw Error('Snapshot file escapes code-only root.');
  const bytes=await fs.readFile(target);if(createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw Error('Snapshot file changed: '+file.path);
  identity.update(file.path.replaceAll('\\','/')).update('\0').update(bytes);
 }
 const entry=path.join(codeRoot,'desktop/main.cjs');if(identity.digest('hex')!==manifest.id||path.resolve(manifest.entry)!==entry)throw Error('Snapshot entry/aggregate identity differs.');
 return{codeRoot,entry,executable,runtime,runtimeGate,snapshot:{id:manifest.id,entry,manifestSha256:await hash(manifestPath)},source:manifest.files};
}

export async function paletteNativeSourceStable(identity){
 return(await Promise.all(identity.source.map(async file=>await hash(path.join(identity.codeRoot,file.path))===file.sha256))).every(Boolean);
}
