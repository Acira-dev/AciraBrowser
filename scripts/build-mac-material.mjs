import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

// Node-API is ABI stable: the same universal binary loads in Node and Electron.
// Windows/Linux builds never load the module or require Apple build tools.
if(process.platform==='darwin'){
 const root=fileURLToPath(new URL('../',import.meta.url)),source=path.join(root,'desktop/native/mac-material.mm');
 const directory=path.join(root,'desktop/native/build'),output=path.join(directory,'mac-material.node'),stamp=path.join(directory,'source.sha256');
 const passkeys=path.join(root,'desktop/native/mac-passkeys.mm'),header=path.join(root,'desktop/native/mac-passkeys.h');
 const digest=createHash('sha256').update(fs.readFileSync(source)).update(fs.readFileSync(passkeys)).update(fs.readFileSync(header)).update('universal-napi8-passkeys-v1').digest('hex');
 if(!fs.existsSync(output)||!fs.existsSync(stamp)||fs.readFileSync(stamp,'utf8')!==digest){
  const candidates=[process.env.npm_config_nodedir&&path.join(process.env.npm_config_nodedir,'include/node'),path.resolve(path.dirname(fs.realpathSync(process.execPath)),'../include/node'),'/usr/local/include/node','/opt/homebrew/include/node'].filter(Boolean);
  const headers=candidates.find(directory=>fs.existsSync(path.join(directory,'node_api.h')));
  if(!headers)throw new Error('Acira Mac glass needs the Node.js development headers (node_api.h). Install Node.js from nodejs.org or set npm_config_nodedir.');
  fs.mkdirSync(directory,{recursive:true});
  const temporary=output+'.tmp';
  const result=spawnSync('/usr/bin/clang++',['-bundle','-undefined','dynamic_lookup','-fobjc-arc','-std=c++17','-DNAPI_VERSION=8','-mmacosx-version-min=11.0','-arch','arm64','-arch','x86_64','-I',headers,'-framework','Cocoa','-framework','QuartzCore','-framework','LocalAuthentication','-framework','AuthenticationServices','-framework','Security',source,passkeys,'-o',temporary],{stdio:'inherit'});
  if(result.error||result.status!==0)throw new Error('Could not build Acira Mac glass. Install the Xcode command-line tools (xcode-select --install).');
  fs.renameSync(temporary,output);fs.writeFileSync(stamp,digest);
  console.log('Built native Mac material appearance (arm64 + x86_64).');
 }
}
