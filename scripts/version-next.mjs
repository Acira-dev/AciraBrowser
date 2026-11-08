// The one place a release version is chosen: package.json. The Windows build (scripts/build-windows.mjs) reads it, and the Mac packager
// (scripts/package-mac-widevine.mjs) now uses it too unless a version is passed (only for local builds, such as 0.1.0-beta.6.local.4).
//   npm run version:next                       0.1.0-beta.6 -> 0.1.0-beta.7 in package.json and package-lock.json (commit it, then build both platforms)
//                                              (a fix release counts up to the next beta too: 0.1.0-beta.13.1 -> 0.1.0-beta.14)
//   npm run version:next -- --fix              the next FIX of the same beta: 0.1.0-beta.13 -> 0.1.0-beta.13.1 -> 0.1.0-beta.13.2 (big features get the next beta, fixes the next .M)
//   npm run version:next -- --set 0.1.0-beta.9 choose the version yourself
//   npm run version:next -- --check            only check that the version in package.json can ship (rules shared with scripts/publish-update.mjs)
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),semver=require('semver'),U=require('../packaging/update-publish.cjs');
const defaultRoot=path.resolve(import.meta.dirname,'..');

export function nextVersion(current,{fix=false}={}){
 const match=/^(\d+\.\d+\.\d+-beta\.)(\d+)(?:\.(\d+))?$/.exec(current);
 if(!match)throw Error('Cannot count up from "'+current+'"; choose the version with --set, for example --set 0.1.0-beta.9 (or 0.1.0-beta.9.1 for a fix).');
 // beta.N -> beta.N+1, whatever fix number it has; with fix: beta.N -> beta.N.1 -> beta.N.2
 if(fix)return match[1]+match[2]+'.'+(Number(match[3]||0)+1);
 return match[1]+(Number(match[2])+1);
}
/** Every reason a version cannot be released on both platforms; empty when it can. */
export function releaseProblems(version,{channel='beta'}={}){
 const problems=[...U.versionProblems(version,channel)];
 if(!problems.length){
  if(!U.WINDOWS_VERSION.test(version))problems.push(version+' would be refused by the Windows build (scripts/build-windows.mjs needs ^0.1.N-beta.N$ or ^0.1.N-beta.N.M$).');
  problems.push(...U.newerProblems(version,U.SHIPPED.map(item=>({label:item.what,version:item.version}))));
 }
 return problems;
}
// Text edits, so the files keep their exact layout (package.json lists its test suites one per line, with blank lines JSON.stringify would drop).
function replaceOnce(text,pattern,replacement,what){
 const matches=text.match(new RegExp(pattern.source,pattern.flags.replace('g','')+'g'))||[];
 if(matches.length!==1)throw Error('Expected exactly one '+what+', found '+matches.length+'.');
 return text.replace(pattern,replacement);
}
export async function bumpVersion({root=defaultRoot,set,check=false,fix=false}={}){
 const packageFile=path.join(root,'package.json'),lockFile=path.join(root,'package-lock.json');
 const packageText=await fs.readFile(packageFile,'utf8'),current=JSON.parse(packageText).version,target=set??nextVersion(current,{fix});
 const problems=releaseProblems(check?current:target);
 if(check)return {current,target:current,problems,changed:false};
 if(problems.length)throw Error(problems.join('\n'));
 if(!semver.gt(target,current))throw Error(target+' is not higher than the current version '+current+'.');
 await fs.writeFile(packageFile,replaceOnce(packageText,/^(  "version": ")[^"]+(",)$/m,'$1'+target+'$2','top-level version in package.json'));
 const lockText=await fs.readFile(lockFile,'utf8'),lock=JSON.parse(lockText);
 if(lock.version!==current||lock.packages?.['']?.version!==current)throw Error('package-lock.json does not carry '+current+'; run npm install first.');
 let next=replaceOnce(lockText,/^(  "version": ")[^"]+(",)$/m,'$1'+target+'$2','top-level version in package-lock.json');
 next=replaceOnce(next,/^(    "": \{\n      "name": "acira-browser",\n      "version": ")[^"]+(",)$/m,'$1'+target+'$2','root package entry in package-lock.json');
 const after=JSON.parse(next);if(after.version!==target||after.packages[''].version!==target)throw Error('package-lock.json was not updated cleanly; nothing was written to it.');
 await fs.writeFile(lockFile,next);
 return {current,target,problems:[],changed:true};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),setAt=args.indexOf('--set'),check=args.includes('--check'),fix=args.includes('--fix'),set=setAt>=0?args[setAt+1]:undefined;
 if(setAt>=0&&!set)throw Error('--set needs a version.');
 if(fix&&set)throw Error('--fix counts the fix number up by itself; use either --fix or --set.');
 const result=await bumpVersion({set,check,fix}).catch(error=>{console.error(error.message);process.exit(1);});
 if(check){
  console.log('package.json version: '+result.current);
  if(result.problems.length){for(const problem of result.problems)console.log('  x '+problem);process.exit(1);}
  console.log('  ok: it can ship on both platforms (Windows build rule, release rules, newer than every shipped build).');
 }else{
  console.log('Version '+result.current+' -> '+result.target+' (package.json, package-lock.json). Nothing is committed.');
  console.log('Next: git commit -am "Version '+result.target+'", build Mac (scripts/package-mac-widevine.mjs, no version argument), build Windows on Windows (npm run build:windows).');
 }
}
