export function verifyRuntimePolicy({policy,version,executableSha256}){
 const parse=value=>{const match=/^(\d+)\.(\d+)\.(\d+)$/.exec(value||'');if(!match)throw new Error('Release runtime must be an exact stable version');return match.slice(1).map(Number);},actual=parse(version),minimum=parse(policy.minimumVersion);
 if(actual[0]!==policy.supportedMajor)throw new Error('Runtime family requires explicit qualification');
 if(actual.some((part,index)=>actual.slice(0,index).every((p,i)=>p===minimum[i])&&part<minimum[index]))throw new Error('Runtime is below the required security patch: '+policy.minimumVersion);
 const selected=policy.selectedRuntime;if(!selected?.qualified||selected.version!==version)throw new Error('Awaiting the frontend-qualified patched runtime pin');
 if(!/^[a-f0-9]{64}$/.test(executableSha256||'')||selected.executableSha256!==executableSha256)throw new Error('Runtime executable differs from the qualified frontend hash');
 return {status:'PASS',version,upstreamExecutableSha256:executableSha256,qualification:selected,advisories:policy.advisories};
}
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const require=createRequire(import.meta.url),root=path.resolve(fileURLToPath(new URL('..',import.meta.url))),pkg=require('electron/package.json'),executable=path.join(path.dirname(require.resolve('electron/package.json')),'dist/electron.exe');
 const result=verifyRuntimePolicy({policy:JSON.parse(await fs.readFile(path.join(root,'packaging/runtime-security.json'),'utf8')),version:pkg.version,executableSha256:createHash('sha256').update(await fs.readFile(executable)).digest('hex')});console.log(JSON.stringify(result,null,2));
}
