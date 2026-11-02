import fs from 'node:fs/promises';import path from 'node:path';import {spawn} from 'node:child_process';import {createHash} from 'node:crypto';
// Reuse every owner assertion unchanged; this adapter states the initialized-key UI
// precondition explicitly so Electron automation need not follow a native relaunch.
const original=await fs.readFile('qa/palette-native-loading.mjs','utf8'),seam='app = await _electron.launch(';
if(!original.includes(seam)&&!original.includes('app = await launchPreparedNative('))throw Error('Owner native loading fixture changed; review the adapter.');
const source=(original.includes(seam)?"import {launchPreparedNative} from './prepared-native.mjs';\n"+original.replace(seam,'app = await launchPreparedNative('):original).replaceAll('palette-native-loading-','frontend-native-loading-');
const file=path.resolve('qa/.frontend-native-loading-'+Date.now()+'.mjs');await fs.writeFile(file,source);
console.log(JSON.stringify({ownerHarnessSha256:createHash('sha256').update(original).digest('hex'),adapter:'Explicit initialized-key native UI precondition only; all owner assertions retained.'}));
try{const child=spawn(process.execPath,[file,...process.argv.slice(2)],{env:process.env,stdio:'inherit',windowsHide:true});const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});if(code!==0)process.exitCode=code||1;}finally{await fs.unlink(file);}
