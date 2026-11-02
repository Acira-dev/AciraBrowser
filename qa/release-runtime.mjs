import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {verifyRuntimePolicy} from '../scripts/release-runtime-policy.mjs';
const require=createRequire(import.meta.url);let known;
export async function qualifiedElectron(){
 const policy=JSON.parse(await fs.readFile(path.resolve('packaging/runtime-security.json'),'utf8')),executablePath=path.resolve(process.env.ACIRA_TEST_EXECUTABLE||(process.env.ELECTRON_OVERRIDE_DIST_PATH?path.join(process.env.ELECTRON_OVERRIDE_DIST_PATH,'electron.exe'):require('electron'))),stat=await fs.stat(executablePath),key=[executablePath,stat.size,stat.mtimeMs].join(':');
 if(known?.key!==key)known={key,sha256:createHash('sha256').update(await fs.readFile(executablePath)).digest('hex')};
 const qualification=verifyRuntimePolicy({policy,version:policy.selectedRuntime?.version,executableSha256:known.sha256});return {executablePath,qualification};
}
