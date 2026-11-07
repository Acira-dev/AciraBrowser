#!/usr/bin/env node
// One command, on the Mac, for the bridge release (beta.11) and the release after it (beta.12): collect the three builds, verify them, upload, and write the
// feeds with the feed write last. It does nothing live unless --publish is given, and each live step needs the version(s) typed (or --yes). The story, the
// exact order of writes and what each step's rollback is: docs/launch/UPDATE_HOST.md. The rules it applies: packaging/release-publish.cjs.
//
//   site      commit the static files of update.acirabrowser.com (CNAME, .nojekyll, index, 404, robots.txt, the Stable placeholders) to docs/ of the public repository (needs no versions)
//   prepare   collect + verify + plan (a dry run). With --publish: W1/W2 upload both releases hidden and download every file back, W3 the rehearsal and testers documents.
//   go        needs a receipt for every private test. W5: update.acirabrowser.com gets the next release; W6: the GitHub feed gets the bridge release at 10%.
//   unhold    W8: the next release becomes visible on the website (the bridge release stays hidden for good).
//   widen | halt | resume | pace     the staged rollout, on either release (--which bridge|next|both)
//   rollback-host   undo W5 (only before W6): the next release's documents are removed from update.acirabrowser.com
//   freeze    record the frozen set (the GitHub feed and the bridge release's files); from then on this tool refuses to write the GitHub feed
//   seal      archive the old repository (only when the next releases live in another one)
//   check     the live documents and files against the frozen set and each other
//   status    where the run stands
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import readline from 'node:readline/promises';
import {planUpdate,planFeedChange,publishPlan,commitFeed,readLive,waitForFeed,describePlan,discoverMac,notFound,ghCli,standInTransport,inspectWindowsInstaller,inspectLinuxBuild} from './publish-update.mjs';
const require=createRequire(import.meta.url),repo=path.resolve(import.meta.dirname,'..'),run=promisify(execFile);
const semver=require('semver'),U=require('../packaging/update-publish.cjs'),P=require('../packaging/release-publish.cjs'),T=require('../packaging/update-targets.cjs'),S=require('../packaging/update-site.cjs');
const TARGETS=T.targets();
const FROZEN_FILE='packaging/frozen-manifest.json';
const MARKER=U.HIDDEN_MARKER;

export const HELP=`Usage: node scripts/release-publish.mjs <command> --bridge <0.1.0-beta.11> --next <0.1.0-beta.12> [options]

  site     [--publish]   the static files of update.acirabrowser.com (CNAME, .nojekyll, index, 404, robots.txt, Stable placeholders) into docs/ of the public repository; no versions needed
  prepare  [--publish]   collect and check the three builds of both releases, plan every document; with --publish upload both releases hidden (W1, W2) and write the rehearsal and testers documents (W3)
  go       --publish     after the private tests (a receipt each): W5 update.acirabrowser.com gets the next release, W6 the GitHub feed gets the bridge release at ${P.BRIDGE_ROLLOUT}%
  unhold   --publish     W8: the next release becomes visible on the website
  widen --percent <n> | halt | resume [--percent <n>] | pace --seconds <600..86400|clear>    [--which bridge|next|both] [--publish]
  rollback-host --publish   undo W5 (refused once the GitHub feed has the bridge release)
  freeze                 record the frozen set in ${FROZEN_FILE} (commit it); the GitHub feed is never written again without --emergency-legacy-feed
  seal     --publish     archive the old repository (only when update-targets.json names another repository for the next releases)
  check                  compare the live documents and files with the frozen set and with each other
  status                 where this run stands

  --bridge-notes-file <file>  --next-notes-file <file>   what's new, one bullet per line (required with --publish)
  --bridge-mac-dir <folder>  --next-mac-dir <folder>     release/mac-widevine-<version>-<commit>.noindex (default: found in release/ by version)
  --refresh                    download the Windows and Linux handoffs again
  --from <version>             the version the private test of hop 1 started from (default 0.1.0-beta.10)
  --accept-unsigned-host       a Windows or Linux build that asks update.acirabrowser.com first is not signed: release it anyway (PLAN.md section 4.3)
  --emergency-legacy-feed      write the frozen GitHub feed (a one-off fix reaching beta.1 to beta.11); type the version to confirm
  --yes                        do not ask to type the versions
  --stand-in <url>             testing: a local stand-in for GitHub and the feed (qa/publish-stand-in.mjs); gh is never run
`;
const FLAGS=new Set(['publish','yes','refresh','accept-unsigned-host','emergency-legacy-feed','help','halt']);
const VALUES=new Set(['bridge','next','bridge-notes-file','next-notes-file','bridge-mac-dir','next-mac-dir','from','which','percent','seconds','stand-in','review-dir','handoff-dir','state-dir','receipts-dir']);
export function parseArguments(argv){
 const [command,...rest]=argv,options={command};
 for(let index=0;index<rest.length;index++){
  const argument=rest[index];if(!argument.startsWith('--'))throw Error('Unexpected argument '+argument+'.\n\n'+HELP);
  const name=argument.slice(2);
  if(FLAGS.has(name))options[name]=true;
  else if(VALUES.has(name)){const value=rest[++index];if(value===undefined||value.startsWith('--'))throw Error('--'+name+' needs a value.');options[name]=value;}
  else throw Error('Unknown option '+argument+'.\n\n'+HELP);
 }
 return options;
}

const exists=file=>fs.access(file).then(()=>true,()=>false);
const readJSON=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const sleepFor=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const COMMANDS=['site','prepare','go','unhold','widen','halt','resume','pace','rollback-host','freeze','seal','check','status'];

/** gh, fetch and the rest, from the real thing or a stand-in. Everything a test needs to replace is here. */
function makeDeps(options,overrides){
 const transport=options['stand-in']?standInTransport(options['stand-in']):null;
 const deps={log:console.log,fetch:globalThis.fetch,root:repo,now:()=>new Date(),sleep:sleepFor,targets:TARGETS,...require('../packaging/macos/update-verify.cjs'),inspectWindowsInstaller,inspectLinuxBuild,gh:ghCli(),
  git:async args=>(await run('git',args,{cwd:repo,maxBuffer:64*1024*1024})).stdout,expectedLogin:'Acira-dev',...(transport||{}),...overrides};
 if(transport)deps.log('STAND-IN: every GitHub and feed request goes to '+transport.label+'; nothing reaches GitHub and gh is not used.');
 return deps;
}
const stateFile=(options,deps)=>path.join(deps.root,options['state-dir']||'release/publish-state',P.stateName(options));
async function loadState(options,deps){try{return await readJSON(stateFile(options,deps));}catch{return P.emptyState(options);}}
async function saveState(options,deps,state){const file=stateFile(options,deps);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify(state,null,2)+'\n');}
async function confirm(deps,options,what,expected){
 if(options.yes)return true;
 if(deps.prompt)return (await deps.prompt(what,expected))===expected;
 if(!process.stdin.isTTY)throw Error('This step asks you to type '+JSON.stringify(expected)+'; run it in a terminal, or add --yes.');
 const rl=readline.createInterface({input:process.stdin,output:process.stdout});
 try{return (await rl.question('\n'+what+'\nType '+expected+' to continue: ')).trim()===expected;}finally{rl.close();}
}
const frozenNow=async deps=>exists(path.join(deps.root,FROZEN_FILE));
const releaseOf=(result,platform)=>result.plan.releases.find(release=>release.platform===platform);
const updateAsset=(result,platform)=>{const release=releaseOf(result,platform);return release&&release.assets.find(asset=>asset.role===(platform==='mac'?'update':'installer')&&(platform!=='mac'||asset.arch==='arm64'));};

/** Windows and Linux: the private handoff release, downloaded and checked against the record the machine wrote. */
async function collect({platform,version,options,deps}){
 const dir=path.join(deps.root,options['handoff-dir']||'release/handoff',version,platform);
 if(options.refresh||!(await exists(dir))){
  const listed=JSON.parse(await deps.gh(['release','list','--repo',deps.targets.handoffRepo,'--limit','100','--json','tagName']));
  const tag=listed.map(item=>item.tagName).find(name=>name.startsWith('handoff-v'+version+'-'+platform+'-'));
  if(!tag)return {dir,problems:['No handoff for the '+platform+' build of '+version+' in '+deps.targets.handoffRepo+'. On the '+platform+' machine: npm run handoff:'+platform+'.']};
  await fs.rm(dir,{recursive:true,force:true});
  await deps.gh(['release','download',tag,'--repo',deps.targets.handoffRepo,'--dir',dir]);
 }
 const files=new Map();
 for(const entry of await fs.readdir(dir,{withFileTypes:true}))if(entry.isFile()){const d=await U.describeFile(path.join(dir,entry.name));files.set(entry.name,{sha256:d.sha256,sha512:d.sha512,size:d.size});}
 const handoff=await readJSON(path.join(dir,'HANDOFF.json')).catch(()=>null);
 return {dir,handoff,problems:P.checkHandoff(handoff,{platform,version,files,acceptUnsignedHost:Boolean(options['accept-unsigned-host'])})};
}

/** Everything both releases need, checked and planned, with no live write. Resolves {ok, problems, warnings, bridge, next, documents, ...}. */
export async function analyze({options,deps,publishing,releaseDate,skipNext=false}){
 const {log}=deps,problems=[],warnings=[],bridge=options.bridge,next=options.next;
 if(!bridge||!next)throw Error('Say both releases: --bridge 0.1.0-beta.11 --next 0.1.0-beta.12\n\n'+HELP);
 problems.push(...U.versionProblems(bridge,'beta'),...U.versionProblems(next,'beta'));
 if(semver.valid(bridge)&&semver.valid(next)&&!semver.gt(next,bridge))problems.push(next+' is not higher than '+bridge+'.');
 if(publishing){
  const login=JSON.parse(await deps.gh(['api','user'])).login;
  if(login!==deps.expectedLogin)problems.push('gh is signed in as '+login+', not '+deps.expectedLogin+'. Every push and release uses the Acira-dev account (gh auth switch).');
 }
 const dirs={},commits={};
 for(const version of [bridge,next])for(const platform of ['windows','linux']){
  log('Collecting the '+platform+' build of '+version+'...');
  const found=await collect({platform,version,options,deps});problems.push(...found.problems);dirs[version+platform]=found.dir;commits[version+platform]=found.handoff?.commit;
 }
 // the next release is the bridge release plus its version number, on every machine
 for(const platform of ['windows','linux']){
  const a=commits[bridge+platform],b=commits[next+platform];
  if(a&&b)try{
   const changed=(await deps.git(['diff','--name-only',a,b])).split('\n').map(line=>line.trim()).filter(Boolean);
   let versionOnly=true;
   for(const file of changed.filter(name=>['package.json','package-lock.json'].includes(name))){
    const diff=(await deps.git(['diff','-U0',a,b,'--',file])).split('\n').filter(line=>/^[+-]/.test(line)&&!/^(\+\+\+|---)/.test(line));
    if(!diff.every(line=>/"version"/.test(line)||/^\+\s*$|^-\s*$/.test(line)))versionOnly=false;
   }
   problems.push(...P.nextIsBridgePlusBump({changed,versionOnly}));
  }catch(error){warnings.push('Could not compare the commits '+a.slice(0,8)+' and '+b.slice(0,8)+' ('+String(error.message).split('\n')[0]+'); check by hand that '+next+' is '+bridge+' plus its version number.');}
 }
 if(commits[bridge+'windows']&&commits[bridge+'linux']&&commits[bridge+'windows']!==commits[bridge+'linux'])problems.push('The Windows and Linux builds of '+bridge+' come from different commits.');
 if(commits[next+'windows']&&commits[next+'linux']&&commits[next+'windows']!==commits[next+'linux'])problems.push('The Windows and Linux builds of '+next+' come from different commits.');
 const now=()=>new Date(releaseDate||deps.now());
 const macDirs={};
 for(const [version,explicit] of [[bridge,options['bridge-mac-dir']],[next,options['next-mac-dir']]]){
  const found=await discoverMac({version,macDir:explicit,root:deps.root});
  if(!found.base)problems.push('No Mac build of '+version+' (release/mac-widevine-'+version+'-<commit>.noindex, or --'+(version===bridge?'bridge':'next')+'-mac-dir).');
  macDirs[version]=found.base;
 }
 const common={};
 log('\nChecking '+bridge+' (the bridge release, GitHub feed)...');
 const bridgeResult=await planUpdate({...common,version:bridge,'windows-dir':dirs[bridge+'windows'],'linux-dir':dirs[bridge+'linux'],'mac-dir':macDirs[bridge],'no-dmg':true,hold:true,notes:undefined,'notes-file':options['bridge-notes-file'],publish:publishing,rollout:'100'},{...deps,now,target:TARGETS.legacy,hidden:true,withLinux:true});
 problems.push(...bridgeResult.problems);warnings.push(...bridgeResult.warnings);
 // the next release plans its Windows differential from the bridge release's setup, which is not live yet: its planned document and local blockmap stand in
 const prior=bridgeResult.plan.feeds.filter(feed=>feed.platform==='windows').slice(0,1).map(feed=>{const doc=U.parseFeed(feed.text);return {platform:'windows',version:bridge,file:feed.file,files:doc.files,previousBlockMaps:doc.previousBlockMaps||[],doc};});
 const local=new Map();for(const asset of bridgeResult.plan.releases.flatMap(release=>release.assets))if(asset.path&&/\.blockmap$/.test(asset.name))local.set(asset.url,asset.path);
 const planFetch=async(url,init)=>local.has(String(url))?new Response(await fs.readFile(local.get(String(url)))):deps.fetch(url,init);
 if(skipNext)return {ok:problems.length===0,problems,warnings,bridge:bridgeResult,next:null,documents:{legacy:P.bridgeDocuments(bridgeResult.plan.feeds),rehearsal:[],testers:[],host:[]},dirs,commits,releaseDate:now().toISOString()};
 log('\nChecking '+next+' (the release after it, update.acirabrowser.com)...');
 const nextResult=await planUpdate({...common,version:next,'windows-dir':dirs[next+'windows'],'linux-dir':dirs[next+'linux'],'mac-dir':macDirs[next],hold:true,'notes-file':options['next-notes-file'],publish:publishing,rollout:'100'},{...deps,now,fetch:planFetch,target:TARGETS.current,hidden:true,withLinux:true,references:[{label:'the bridge release',version:bridge}],priorWindows:prior});
 problems.push(...nextResult.problems);warnings.push(...nextResult.warnings);
 const documents={
  legacy:P.bridgeDocuments(bridgeResult.plan.feeds),                  // W6: the GitHub feed, ${P.BRIDGE_ROLLOUT}%
  rehearsal:P.underFolder(bridgeResult.plan.feeds,P.REHEARSAL_PATH),  // W3: what a beta.10 test copy reads
  testers:P.underFolder(nextResult.plan.feeds,P.TESTERS_PATH),        // W3: what a beta.11 test copy reads
  host:P.hostDocuments(nextResult.plan.feeds),                        // W5: update.acirabrowser.com
 };
 return {ok:problems.length===0,problems,warnings,bridge:bridgeResult,next:nextResult,documents,dirs,commits,releaseDate:now().toISOString()};
}

const digestOf=documents=>Object.fromEntries(Object.entries(documents).flatMap(([group,feeds])=>feeds.map(feed=>[group+':'+feed.file,P.sha256Text(JSON.stringify(JSON.parse(feed.text).files||[])+'|'+JSON.parse(feed.text).version)])));
/** The documents before a write, so the write can be checked against exactly what was planned from. */
async function withBefore(feeds,{deps,target,authoritative}){
 const out=[];
 for(const feed of feeds){const live=await readLive({deps,file:feed.file,authoritative,target});if(live.error)throw Error('Could not read '+target.dir+'/'+feed.file+' ('+live.error+').');out.push({...feed,before:live.doc||null,beforeText:live.text||''});}
 return out;
}
const feedOnly=(result,target,feeds)=>({...result.plan,mode:'release',repo:target.repo,target,releases:[],feeds,verify:[],untouched:[]});
async function writeReviewFolder({analysis,options,deps}){
 const dir=path.resolve(deps.root,options['review-dir']||path.join('release/update-review',options.bridge+'__'+options.next));
 await fs.rm(dir,{recursive:true,force:true});
 for(const [group,feeds] of Object.entries(analysis.documents))for(const feed of feeds){const out=path.join(dir,group,...feed.file.split('/'));await fs.mkdir(path.dirname(out),{recursive:true});await fs.writeFile(out,feed.text);}
 await fs.writeFile(path.join(dir,'PLAN.json'),JSON.stringify({bridge:options.bridge,next:options.next,releaseDate:analysis.releaseDate,releases:[...analysis.bridge.plan.releases,...analysis.next.plan.releases].map(release=>({tag:release.tag,platform:release.platform,files:release.assets.map(({name,size,sha512,role,arch})=>({name,size,sha512,role,arch}))})),steps:P.STEPS},null,2)+'\n');
 return dir;
}
const receiptDirs=(options,deps)=>[path.join(deps.root,options['receipts-dir']||'release/rehearsal',options.bridge+'__'+options.next),path.join(deps.root,options['handoff-dir']||'release/handoff',options.next),path.join(deps.root,options['handoff-dir']||'release/handoff',options.bridge)];
/** One receipt per machine and hop, for exactly the files being published. */
async function checkReceipts({options,deps,analysis}){
 const problems=[],from=options.from||'0.1.0-beta.10',found=[];
 for(const platform of P.PLATFORMS)for(const hop of P.HOPS){
  const bridgeFile=updateAsset(analysis.bridge,platform),nextFile=updateAsset(analysis.next,platform);
  if(!bridgeFile||!nextFile){problems.push(platform+': a file to test is missing from the plan.');continue;}
  let receipt=null;
  for(const dir of receiptDirs(options,deps)){
   for(const name of [`${platform}-hop${hop}.json`,`rehearsal-${platform}-hop${hop}.json`])try{receipt=await readJSON(path.join(dir,...[name]));break;}catch{/* next */}
   if(receipt)break;
  }
  const expect=hop===1?{platform,hop,from:{version:from},to:{version:options.bridge,sha512:bridgeFile.sha512,size:bridgeFile.size}}:{platform,hop,from:{version:options.bridge,sha512:bridgeFile.sha512},to:{version:options.next,sha512:nextFile.sha512,size:nextFile.size}};
  problems.push(...P.checkReceipt(receipt,expect));
  if(receipt)found.push(receipt);
 }
 // at least one test of the second hop went through the real address, the one the bridge release is built to ask
 if(!found.some(receipt=>receipt.hop===2&&receipt.passed===true&&String(receipt.feed||'').startsWith(P.HOST_URL+P.TESTERS_PATH)))problems.push('No hop 2 test went through the real address '+P.HOST_URL+P.TESTERS_PATH+' (a receipt whose "feed" is that address). Run one on the Windows or Linux machine with the testers opt-in (docs/launch/UPDATE_HOST.md, "Private tests"): the local feed does not prove the new address is reachable from a real install.');
 return problems;
}
function refuse(log,analysis){
 log('\nREFUSED. Nothing was uploaded or changed.\n');
 for(const problem of analysis.problems)log('  x '+problem);
 for(const warning of analysis.warnings)log('  ! '+warning);
 return 1;
}
function checklist(options){
 return `
PRIVATE TESTS (nothing public is offered to anyone; no installed app reads these documents)
  Hop 1  ${options.from||'0.1.0-beta.10'} to ${options.bridge}, through the rehearsal documents  https://update.acirabrowser.com/${P.REHEARSAL_PATH}
  Hop 2  ${options.bridge} to ${options.next}, through the testers documents                      https://update.acirabrowser.com/${P.TESTERS_PATH}
  On each machine (Mac, Windows, Linux) follow docs/launch/UPDATE_HOST.md, section "Private tests". Each test ends in a receipt:
    Mac      node qa/mac-update-delivery.mjs ... --receipt (the rig writes it)
    Windows  node scripts/rehearsal-receipt.mjs ... on the laptop, then npm run handoff:windows again to upload the receipts
    Linux    the same with npm run handoff:linux
  When all six receipts exist:  node scripts/release-publish.mjs go --bridge ${options.bridge} --next ${options.next} --publish
`;
}

/** The static files of the site, committed to docs/ of the public repository when they differ from what is there. Never deletes. */
async function site({options,deps}){
 const {log}=deps,target=TARGETS.current,files=S.staticSite();
 const {parseUpdateInfo}=require('electron-updater/out/providers/Provider');
 const problems=S.checkSite(files,{parse:(text,name)=>parseUpdateInfo(text,name,name)});
 if(problems.length){log('\nREFUSED. The site files are not right:');for(const problem of problems)log('  x '+problem);return 1;}
 const changed=[];
 for(const [name,bytes] of files){
  let live=null;
  try{live=Buffer.from(JSON.parse(await deps.gh(['api',`repos/${target.repo}/contents/${target.dir}/${name}?ref=${target.branch}`])).content,'base64');}catch(error){if(!notFound(error))throw error;}
  if(!live||!live.equals(bytes))changed.push(name);
 }
 if(!changed.length){log('The static files of the site are already in '+target.repo+' '+target.dir+'/.');return 0;}
 log('Would commit to '+target.repo+' ('+target.branch+', folder '+target.dir+'/): '+changed.join(', ')+'.');
 if(!options.publish){log('\nDRY RUN OK. Nothing was changed. Add --publish to commit them (this does not turn Pages on or touch DNS).');return 0;}
 if(!(await confirm(deps,options,'Commit the static files of update.acirabrowser.com to '+target.repo+'?','update.acirabrowser.com')))return 1;
 const info=JSON.parse(await deps.gh(['api',`repos/${target.repo}`]));
 if(info.private!==false)throw Error(target.repo+' is not public.');
 const sha=await commitFeed({gh:deps.gh,repo:target.repo,branch:target.branch,dir:target.dir,files:changed.map(name=>({file:name,text:files.get(name).toString('utf8')})),message:'Site: the static files of update.acirabrowser.com'});
 log('Committed '+sha+'. Pages is not turned on by this; the steps are in docs/launch/UPDATE_HOST.md.');return 0;
}

async function prepare({options,deps}){
 const {log}=deps,publishing=Boolean(options.publish);
 if(publishing&&await frozenNow(deps)&&!options['emergency-legacy-feed'])throw Error('The GitHub feed is frozen ('+FROZEN_FILE+'). The bridge release is written once.');
 let state=await loadState(options,deps);
 const releaseDate=state.releaseDate||(publishing?deps.now().toISOString():null);
 const analysis=await analyze({options,deps,publishing,releaseDate});
 if(!analysis.ok)return refuse(log,analysis);
 const review=await writeReviewFolder({analysis,options,deps});
 log('\n=== '+options.bridge+' (bridge: GitHub feed, hidden from the website, never offered to new visitors) ===');
 describePlan({...analysis.bridge.plan,feeds:analysis.documents.legacy},{log,review});
 log('\n=== '+options.next+' (update.acirabrowser.com, hidden until unhold) ===');
 describePlan({...analysis.next.plan,feeds:analysis.documents.host},{log,review});
 for(const warning of analysis.warnings)log('  ! '+warning);
 if(!publishing){log('\nDRY RUN OK. Nothing was uploaded or changed. Run the same command with --publish to upload both releases hidden and write the rehearsal and testers documents.');log(checklist(options));return 0;}
 if(!(await confirm(deps,options,'Upload '+options.bridge+' and '+options.next+' (hidden) and write the rehearsal and testers documents?',options.bridge+' '+options.next))){log('Nothing changed.');return 1;}
 state.releaseDate=analysis.releaseDate;
 try{
  log('\n--- W1: '+options.bridge+' uploaded hidden ---');
  await publishPlan({plan:{...analysis.bridge.plan,feeds:[]},deps,options:{}});
  log('\n--- W2: '+options.next+' uploaded hidden ---');
  await publishPlan({plan:{...analysis.next.plan,feeds:[]},deps,options:{}});
  state.done.collect=state.done.verify=state.done.held=true;state.tags={bridge:analysis.bridge.plan.releases.map(release=>release.tag),next:analysis.next.plan.releases.map(release=>release.tag)};
  await saveState(options,deps,state);
  log('\n--- W3: the rehearsal and testers documents ---');
  const feeds=await withBefore([...analysis.documents.rehearsal,...analysis.documents.testers],{deps,target:TARGETS.current,authoritative:true});
  const plan=feedOnly(analysis.next,TARGETS.current,feeds);
  await publishPlan({plan,deps,options:{}});
  if(!(await waitForFeed({plan,fetch:deps.fetch,log,sleep:deps.sleep})))log('  ! the public address has not shown them yet; wait before testing.');
  state.done.rehearsal=true;state.digests=digestOf(analysis.documents);
  await saveState(options,deps,state);
 }catch(error){await saveState(options,deps,state);log('\nSTOPPED: '+error.message);for(const line of error.recovery||[])log('  - '+line);log('Running the same command again resumes: it reuses what is there and checks every file by downloading it.');return 1;}
 log('\nPREPARED. Both releases are uploaded and hidden; the rehearsal and testers documents are live (nobody reads them but your test copies).');
 log(checklist(options));
 return 0;
}

async function go({options,deps}){
 const {log}=deps;
 const state=await loadState(options,deps);
 if(!options.publish)throw Error('go writes live files: add --publish (it asks you to type both versions).');
 const blocked=P.blockedBy(state,'host');if(blocked)throw Error(blocked+' Run prepare --publish first.');
 if(state.done.host&&state.done.bridge){log('W5 and W6 are already done. Next: unhold, then widen (docs/launch/UPDATE_HOST.md).');return 0;}
 if(!state.done.bridge&&await frozenNow(deps)&&!options['emergency-legacy-feed'])throw Error('The GitHub feed is frozen ('+FROZEN_FILE+'). The bridge release is written once.');
 // after W5 only the GitHub side is left: the next release is live, so only the bridge release is planned again
 const resuming=Boolean(state.done.host);
 const analysis=await analyze({options,deps,publishing:true,releaseDate:state.releaseDate,skipNext:resuming});
 if(!analysis.ok)return refuse(log,analysis);
 // what is about to be written is what was tested
 const now=digestOf(analysis.documents),wanted=Object.fromEntries(Object.entries(state.digests).filter(([key])=>!resuming||key.startsWith('legacy:')));
 const changed=Object.keys(now).filter(key=>now[key]!==wanted[key]);
 if(changed.length||Object.keys(wanted).length!==Object.keys(now).length){log('\nREFUSED. The planned documents are not the ones that were tested ('+(changed.slice(0,4).join(', ')||'a different set of files')+'). A file or a version changed after prepare: run prepare --publish and test again.');return 1;}
 if(!resuming){
  const receiptProblems=await checkReceipts({options,deps,analysis});
  if(receiptProblems.length){log('\nREFUSED. The private tests are not all done:\n');for(const problem of receiptProblems)log('  x '+problem);return 1;}
 }
 state.done.tests=true;
 for(const warning of analysis.warnings)log('  ! '+warning);
 if(!(await confirm(deps,options,resuming?'Write '+options.bridge+' to the GitHub feed at '+P.BRIDGE_ROLLOUT+'% (update.acirabrowser.com already has '+options.next+')?':'All six private tests passed. Write '+options.next+' to update.acirabrowser.com, then '+options.bridge+' to the GitHub feed at '+P.BRIDGE_ROLLOUT+'%?',options.bridge+' '+options.next))){log('Nothing changed.');return 1;}
 try{
  if(!state.done.host){
   log('\n--- W5: update.acirabrowser.com gets '+options.next+' ---');
   const plan={...analysis.next.plan,feeds:analysis.documents.host};
   state.hostFiles=plan.feeds.map(feed=>feed.file);state.hostBefore=Object.fromEntries(plan.feeds.map(feed=>[feed.file,feed.beforeText||null]));
   await publishPlan({plan,deps,options:{}});
   if(!(await waitForFeed({plan,fetch:deps.fetch,log,sleep:deps.sleep})))throw Error('The public address does not serve the new documents yet. Run go again in a few minutes: nothing else was written.');
   state.done.host=true;await saveState(options,deps,state);
  }else log('\nW5 is already done.');
  if(!state.done.bridge){
   log('\n--- W6: the GitHub feed gets '+options.bridge+' at '+P.BRIDGE_ROLLOUT+'% (the last time it is written) ---');
   const plan={...analysis.bridge.plan,feeds:analysis.documents.legacy};
   await publishPlan({plan,deps,options:{}});
   if(!(await waitForFeed({plan,fetch:deps.fetch,log,sleep:deps.sleep})))throw Error('raw.githubusercontent.com does not serve the new documents yet (it caches for up to 5 minutes). Run go again: it will not write twice.');
   state.done.bridge=true;await saveState(options,deps,state);
  }else log('W6 is already done.');
 }catch(error){await saveState(options,deps,state);log('\nSTOPPED: '+error.message);for(const line of error.recovery||[])log('  - '+line);return 1;}
 log(`
DONE. ${options.next} is on update.acirabrowser.com; ${options.bridge} is on the GitHub feed at ${P.BRIDGE_ROLLOUT}% (about one in ten installs of beta.1 to beta.10, at their next check).
Next, in this order:
  W7  your own real installs: pin them into the ${P.BRIDGE_ROLLOUT}% (node scripts/update-tester.mjs pin --profile <folder>), then watch beta.10 reach ${options.bridge} and ${options.next}.
  W8  node scripts/release-publish.mjs unhold --bridge ${options.bridge} --next ${options.next} --publish    (the website offers ${options.next})
  then a day at ${P.BRIDGE_ROLLOUT}%:  widen --percent 50 --which bridge,  a day later widen --percent 100, then freeze after seven quiet days.`);
 return 0;
}

async function unhold({options,deps}){
 const {log}=deps,state=await loadState(options,deps);
 if(!options.publish)throw Error('unhold changes a live release: add --publish.');
 const blocked=P.blockedBy(state,'unhold');if(blocked)throw Error(blocked);
 if(!(await confirm(deps,options,options.next+' becomes visible on the website (its download buttons).',options.next))){log('Nothing changed.');return 1;}
 const slug=TARGETS.current.repo;
 for(const tag of state.tags?.next||[]){
  const view=JSON.parse(await deps.gh(['release','view',tag,'--repo',slug,'--json','body']));
  if(!view.body.includes(MARKER)){log('  '+tag+' is already visible.');continue;}
  const file=path.join(await fs.mkdtemp(path.join(os.tmpdir(),'acira-unhold-')),'notes.md');
  await fs.writeFile(file,view.body.split('\n').filter(line=>line.trim()!==MARKER).join('\n').replace(/^\n+/,''));
  await deps.gh(['release','edit',tag,'--repo',slug,'--notes-file',file]);log('  unhid '+tag);
 }
 state.done.unhold=true;await saveState(options,deps,state);
 log('\nDONE. The website lists '+options.next+' (it refreshes from GitHub at most every ten minutes). '+options.bridge+' stays hidden: its body keeps the marker for good.');
 return 0;
}

/** widen, halt, resume, pace: the same documents edited in each place with the same wait. */
async function feedChange({options,deps}){
 const {log}=deps,which=options.which||(options.command==='pace'?'next':'both');
 const parts=[];
 if(['bridge','both'].includes(which))parts.push({version:options.bridge,target:TARGETS.legacy});
 if(['next','both'].includes(which))parts.push({version:options.next,target:TARGETS.current});
 if(!parts.length)throw Error('--which is bridge, next or both.');
 const flags={widen:{widen:options.percent},halt:{halt:true},resume:{'resume-rollout':true,...(options.percent?{rollout:options.percent}:{})},pace:{pace:options.seconds}}[options.command];
 if(options.command==='widen'&&!options.percent)throw Error('widen needs --percent <n>.');
 if(options.command==='pace'&&!options.seconds)throw Error('pace needs --seconds <600..86400|clear>.');
 const frozen=await frozenNow(deps);
 const skipped=parts.filter(part=>part.target.name==='legacy'&&frozen&&!options['emergency-legacy-feed']);
 for(const part of skipped)log('Skipped '+part.version+': the GitHub feed is frozen ('+FROZEN_FILE+'). Use --emergency-legacy-feed for a one-off.');
 const active=parts.filter(part=>!skipped.includes(part)),plans=[];
 for(const {version,target} of active){
  const result=await planFeedChange({...flags,version,publish:Boolean(options.publish)},{...deps,target,withLinux:true});
  if(!result.ok){log('\nREFUSED ('+target.name+' '+version+'). Nothing was changed.\n');for(const problem of result.problems)log('  x '+problem);return 1;}
  describePlan(result.plan,{log});plans.push(result);
 }
 if(!options.publish){log('\nDRY RUN OK. Nothing was changed. Add --publish to do it.');return 0;}
 if(!plans.length){log('\nNothing to do.');return 0;}
 if(!(await confirm(deps,options,options.command.toUpperCase()+' '+active.map(part=>part.version).join(' and ')+'?',active.map(part=>part.version).join(' '))))return 1;
 for(const result of plans){
  try{
   const state=await publishPlan({plan:result.plan,deps,options:{}});
   if(state.feedCommit&&!(await waitForFeed({plan:result.plan,fetch:deps.fetch,log,sleep:deps.sleep})))log('  ! committed, but the public copy has not refreshed yet.');
  }catch(error){log('\nSTOPPED: '+error.message);return 1;}
 }
 log('\nDONE.');
 return 0;
}

/** Undo W5 while nobody has been sent the bridge release yet: restores the documents as they were (or removes them). */
async function rollbackHost({options,deps}){
 const {log}=deps,state=await loadState(options,deps);
 if(!options.publish)throw Error('rollback-host changes the live site: add --publish.');
 if(state.done.bridge)throw Error('The GitHub feed already has '+options.bridge+', so beta.11 copies exist in public: use halt --which next instead. Deleting a document they have already read leaves them with the frozen GitHub feed only.');
 if(!state.done.host||!state.hostFiles)throw Error('W5 was not done, nothing to roll back.');
 if(!(await confirm(deps,options,'Remove '+options.next+'\'s documents from update.acirabrowser.com?',options.next)))return 1;
 const files=state.hostFiles.map(file=>({file,text:state.hostBefore[file]??null}));
 const sha=await commitFeed({gh:deps.gh,repo:TARGETS.current.repo,branch:TARGETS.current.branch,dir:TARGETS.current.dir,files,message:'Site: take '+options.next+' back out (before the bridge release)'});
 state.done.host=false;await saveState(options,deps,state);log('Committed '+sha+'. update.acirabrowser.com no longer offers '+options.next+'.');
 return 0;
}

async function freeze({options,deps}){
 const {log}=deps,documents=[];
 for(const platform of U.ALL_PLATFORMS)for(const file of U.feedFiles('beta',platform)){
  const live=await readLive({deps,file,authoritative:false,target:TARGETS.legacy});
  if(live.error)throw Error('Could not read the live GitHub feed '+file+' ('+live.error+').');
  if(live.version===null)continue;
  if(live.version!==options.bridge)throw Error('The GitHub feed '+file+' offers '+live.version+', not '+options.bridge+'. Freeze only when the bridge release is the last thing written.');
  const {percentage,halted}=U.rolloutOf(live.doc);
  if(halted||percentage!==100)throw Error('The GitHub feed '+file+' is '+U.describeRollout(live.doc)+'. Widen it to 100 first (widen --percent 100 --which bridge), then freeze.');
  documents.push({file,text:live.text});
 }
 if(!documents.length)throw Error('No live document offers '+options.bridge+'.');
 // also the Stable placeholders and every file the documents name
 for(const file of ['latest-mac.yml','latest.yml','linux/latest-linux.yml']){const live=await readLive({deps,file,authoritative:false,target:TARGETS.legacy});if(live.text)documents.push({file,text:live.text});}
 const manifest=P.frozenManifest({documents,generatedAt:deps.now().toISOString()});
 const out=path.join(deps.root,FROZEN_FILE);
 await fs.mkdir(path.dirname(out),{recursive:true});await fs.writeFile(out,JSON.stringify(manifest,null,2)+'\n');
 const state=await loadState(options,deps);state.done.freeze=true;await saveState(options,deps,state);
 log('Wrote '+out+' ('+manifest.entries.length+' entries). Commit it. From now on this tool refuses to write the GitHub feed, and `check` compares it with what is live.');
 return 0;
}

async function seal({options,deps}){
 const {log}=deps,state=await loadState(options,deps);
 if(TARGETS.legacy.repo===TARGETS.current.repo)throw Error('The next releases live in the same repository as the GitHub feed ('+TARGETS.legacy.repo+'): archiving it would stop update.acirabrowser.com being written. Start a new repository first (update-targets.json "currentRepo").');
 if(!state.done.freeze||!(await frozenNow(deps)))throw Error('Freeze first (the frozen set is recorded and committed).');
 if(!options.publish)throw Error('seal changes a live repository: add --publish.');
 if(!(await confirm(deps,options,'Archive '+TARGETS.legacy.repo+' (read-only for good; downloads and raw URLs keep working)?',TARGETS.legacy.repo)))return 1;
 await deps.gh(['api','-X','PATCH','repos/'+TARGETS.legacy.repo,'-F','archived=true']);
 state.done.seal=true;await saveState(options,deps,state);log('Archived '+TARGETS.legacy.repo+'.');return 0;
}

/** The live documents and files against the frozen set, and the new host against the GitHub feed. Returns the problems. */
export async function checkFeeds({deps,options}){
 const problems=[],live={documents:new Map(),assets:new Map()};
 for(const platform of U.ALL_PLATFORMS)for(const file of U.feedFiles('stable',platform)){
  const doc=await readLive({deps,file,authoritative:false,target:TARGETS.legacy});
  if(doc.text)live.documents.set(file,doc.text);
 }
 const manifestFile=path.join(deps.root,FROZEN_FILE);
 if(await exists(manifestFile)){
  const manifest=await readJSON(manifestFile);
  for(const entry of manifest.entries.filter(item=>item.kind!=='document')){
   try{const response=await deps.fetch(entry.url,{redirect:'follow',method:'HEAD'});await response.body?.cancel?.();live.assets.set(entry.url,{ok:response.ok,size:Number(response.headers.get('content-length'))||undefined});}catch{live.assets.set(entry.url,{ok:false});}
  }
  problems.push(...P.checkFrozen(manifest,live));
 }
 // the new host parses, and every file it names answers
 for(const platform of U.ALL_PLATFORMS)for(const file of U.feedFiles('beta',platform)){
  const doc=await readLive({deps,file,authoritative:false,target:TARGETS.current});
  if(doc.error)problems.push('update.acirabrowser.com/'+file+': '+doc.error);
 }
 return problems;
}
async function check({options,deps}){
 const problems=await checkFeeds({deps,options});
 if(problems.length){deps.log('\nPROBLEMS:\n');for(const problem of problems)deps.log('  x '+problem);return 1;}
 deps.log('The live documents and the frozen set agree.');return 0;
}
async function status({options,deps}){
 const state=await loadState(options,deps);
 deps.log('Run '+options.bridge+' + '+options.next+(state.releaseDate?'  (planned '+state.releaseDate+')':''));
 for(const step of P.STEPS)deps.log('  '+(state.done[step.key]?'[x]':'[ ]')+' '+step.key.padEnd(10)+' '+(step.write?'(live) ':'       ')+step.what);
 const next=P.nextStep(state);deps.log(next?'\nNext: '+next.key+' - '+next.what:'\nAll steps are done.');
 return 0;
}

export async function main(argv=process.argv.slice(2),overrides={}){
 if(!argv.length||argv[0]==='--help'||argv[0]==='help'){console.log(HELP);return 0;}
 const options=parseArguments(argv);
 if(!COMMANDS.includes(options.command))throw Error('Unknown command '+options.command+'.\n\n'+HELP);
 if(!['site','check'].includes(options.command)&&(!options.bridge||!options.next))throw Error('Say both releases: --bridge 0.1.0-beta.11 --next 0.1.0-beta.12\n\n'+HELP);
 const deps=makeDeps(options,overrides);
 const table={site,prepare,go,unhold,widen:feedChange,halt:feedChange,resume:feedChange,pace:feedChange,'rollback-host':rollbackHost,freeze,seal,check,status};
 return table[options.command]({options,deps});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main().then(code=>{process.exitCode=code;},error=>{console.error(error.message);process.exitCode=1;});
}
