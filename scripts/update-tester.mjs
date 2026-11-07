#!/usr/bin/env node
// Points ONE installed Acira at the founder's testers folder, and puts it in the first share of a staged rollout. It edits two small files in a profile folder
// you name; it never guesses a profile, and it refuses while Acira is open on that profile (quit it first).
//   node scripts/update-tester.mjs status --profile <folder>
//   node scripts/update-tester.mjs on     --profile <folder>   beta.11 and later read https://update.acirabrowser.com/testers/ only (updater.json "testersFeed": true)
//   node scripts/update-tester.mjs off    --profile <folder>
//   node scripts/update-tester.mjs pin    --profile <folder>   .updaterId is set so this copy is inside every staged share (the first 1%): it is offered a staged release at once
// The profile folder is where updater.json lives: Mac ~/Library/Application Support/AciraBrowser, Windows %APPDATA%\AciraBrowser (RELEASING.md); on Linux the folder
// that holds updater.json and .updaterId. Never use this on a profile that is not yours; the release rigs use throwaway profiles under /tmp/acira-qa/.
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Where an id stands in a staged rollout (0 to 100): electron-updater reads the last four bytes of the id as a fraction. */
export const shareOf=id=>{const hex=String(id).replace(/-/g,'');return parseInt(hex.slice(24,32),16)/0xffffffff*100;};
/** A random id whose last four bytes are zero: inside any staged share from 1% up. */
export const pinnedId=(random=randomUUID)=>random().slice(0,28)+'00000000';

const readJson=async file=>{try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw Error(file+' cannot be read ('+error.message+').');}};
const running=async dir=>{for(const name of ['SingletonLock','SingletonSocket','SingletonCookie'])if(await fs.lstat(path.join(dir,name)).then(()=>true,()=>false))return true;return false;};

export async function tester(command,profile,{force=false}={}){
 if(!profile)throw Error('--profile <folder> is required: the folder that holds updater.json.');
 const dir=path.resolve(profile),file=path.join(dir,'updater.json'),idFile=path.join(dir,'.updaterId');
 if(!(await fs.stat(dir).then(s=>s.isDirectory(),()=>false)))throw Error(dir+' is not a folder.');
 const saved=await readJson(file),id=await fs.readFile(idFile,'utf8').then(text=>text.trim(),()=>null);
 if(command==='status')return {profile:dir,testersFeed:saved?.testersFeed===true,updaterJson:saved!==null,updaterId:id,share:id&&UUID.test(id)?Number(shareOf(id).toFixed(1)):null};
 if(!['on','off','pin'].includes(command))throw Error('Use status, on, off or pin.');
 if(!force&&await running(dir))throw Error('Acira seems to be open on '+dir+' (the profile is locked). Quit it first: a running copy writes updater.json again and would undo this.');
 if(command==='pin'){await fs.writeFile(idFile,pinnedId());return {profile:dir,pinned:true,share:0};}
 if(command==='on'&&saved===null)throw Error(file+' does not exist yet: start this Acira once so it makes updater.json (and then quit it), or this would be a profile that has never run.');
 const next={...(saved||{})};
 if(command==='on')next.testersFeed=true;else delete next.testersFeed;
 await fs.writeFile(file,JSON.stringify(next),{mode:0o600});
 return {profile:dir,testersFeed:command==='on'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [command,...rest]=process.argv.slice(2),at=rest.indexOf('--profile');
 tester(command,at>=0?rest[at+1]:null,{force:rest.includes('--force')}).then(result=>console.log(JSON.stringify(result,null,2)),error=>{console.error(error.message);process.exitCode=1;});
}
