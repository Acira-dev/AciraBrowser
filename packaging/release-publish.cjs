'use strict';
// The pure rules behind scripts/release-publish.mjs, the one command that turns three finished builds (Mac, Windows, Linux) into the bridge release
// (beta.11, the last write to the GitHub feed) and the release after it (beta.12, the first on update.acirabrowser.com). Nothing here touches the network,
// gh or the disk beyond what it is handed, so tests/release-publish.test.cjs runs every rule anywhere. The story and the exact order of writes are in
// docs/launch/UPDATE_HOST.md.
const {createHash}=require('node:crypto');
const U=require('./update-publish.cjs');
const {HOST_URL,GITHUB_FEED_URL,TESTERS_PATH,REHEARSAL_PATH}=require('../desktop/browser-services/update-hosts.cjs');

const BRIDGE_ROLLOUT=10;        // beta.11 is offered to 10% of the installs that read the GitHub feed first, then widened
const NEXT_CHECK_SECONDS=900;   // beta.12's documents ask beta.11 and later to look again every 15 minutes (the app keeps it between 10 minutes and 24 hours)
const PLATFORMS=['mac','windows','linux'];
const HOPS=[1,2]; // 1: beta.10 to the bridge, through a GitHub-shaped feed. 2: the bridge to the next release, through update.acirabrowser.com
const MAC_ARCHES=['arm64','x64'];

/** The order the writes happen in. Nothing later runs before everything earlier is done (state in release/publish-state/), and every step says what it changes. */
const STEPS=Object.freeze([
 {key:'collect',   write:false,what:'bring the Windows and Linux builds from their private releases; find the Mac builds'},
 {key:'verify',    write:false,what:'check every file, hash, signature, version and update address; plan every document'},
 {key:'held',      write:true, what:'W1/W2: upload both releases hidden from the website; download every file back and compare'},
 {key:'rehearsal', write:true, what:'W3: the rehearsal and testers documents (nobody reads them but the founder\'s test copies)'},
 {key:'tests',     write:false,what:'the founder\'s private tests; one receipt per machine and hop, bound to the exact files'},
 {key:'host',      write:true, what:'W5: update.acirabrowser.com gets the next release; waits until the public address serves it'},
 {key:'bridge',    write:true, what:'W6: the GitHub feed gets the bridge release at 10%; waits until the public address serves it'},
 {key:'real',      write:false,what:'W7: the founder\'s own real installs go beta.10, bridge, next on the real network'},
 {key:'unhold',    write:true, what:'W8: the next release becomes visible on the website; the bridge release stays hidden for good'},
 {key:'soak',      write:false,what:'a day at 10%, then --widen 50, a day, --widen 100'},
 {key:'freeze',    write:false,what:'after seven quiet days: record the frozen set; the tool refuses the GitHub feed from then on'},
 {key:'seal',      write:true, what:'once the chain is proven: archive the old repository (only when the next releases live in another one)'},
]);
const stepIndex=key=>STEPS.findIndex(step=>step.key===key);

const sha=(algorithm,bytes,encoding)=>createHash(algorithm).update(bytes).digest(encoding);
const sha256Text=text=>sha('sha256',text,'hex');

// --- the record each machine hands over ---
const HEX40=/^[0-9a-f]{40}$/;
/**
 * Problems with a HANDOFF.json (scripts/handoff.mjs wrote it on the Windows or Linux machine) against the files next to it.
 * files: Map(name -> {sha256, sha512, size}) computed here from the bytes; hostIsPrimary: the update address inside the build is the new host.
 */
function checkHandoff(handoff,{platform,version,files,acceptUnsignedHost=false}){
 const problems=[],name=platform[0].toUpperCase()+platform.slice(1);
 if(!handoff||typeof handoff!=='object')return [name+': HANDOFF.json is missing or unreadable.'];
 if(handoff.schema!==1)problems.push(name+': HANDOFF.json has schema '+handoff.schema+', expected 1.');
 if(handoff.platform!==platform)problems.push(name+': HANDOFF.json is for '+handoff.platform+'.');
 if(handoff.version!==version)problems.push(name+': HANDOFF.json is version '+handoff.version+', not '+version+'.');
 if(!HEX40.test(String(handoff.commit)))problems.push(name+': HANDOFF.json has no full source commit.');
 const listed=new Map((handoff.files||[]).map(file=>[file.name,file]));
 for(const [file,actual] of files){
  const recorded=listed.get(file);
  if(!recorded){if(!/^(HANDOFF|SHA256SUMS|BUILD-INFO|rehearsal-)/.test(file)&&!/^(latest|beta)(-linux)?\.yml$/.test(file))problems.push(name+': '+file+' is in the folder but not in HANDOFF.json.');continue;}
  if(recorded.sha512!==actual.sha512||recorded.size!==actual.size||(recorded.sha256&&recorded.sha256!==actual.sha256))problems.push(name+': '+file+' is not the file the '+name+' machine recorded (hash or size differs): it was replaced or damaged after the build.');
 }
 for(const [file] of listed)if(!files.has(file))problems.push(name+': HANDOFF.json lists '+file+', which was not handed over.');
 const config=handoff.updateConfig;
 if(!config||!U.ALLOWED_FEEDS.map(base=>platform==='linux'?base+'linux/':base).includes(config.url))problems.push(name+': the update address inside the build ('+(config&&config.url)+') is not one of ours.');
 const newHost=Boolean(config&&String(config.url).startsWith(HOST_URL));
 if(newHost&&!acceptUnsignedHost){
  // The SHA-512 in the feed is the only integrity check on Windows and Linux; whoever controls the feed host controls their updates (PLAN.md section 4.3).
  if(platform==='windows'&&!(handoff.signing?.authenticode==='valid'&&config.publisherName&&handoff.signing.subject))problems.push('Windows: this build asks update.acirabrowser.com first, but it is not Authenticode-signed with its publisher named in app-update.yml. Sign it (Azure Artifact Signing), or release it with --accept-unsigned-host and accept that whoever controls that address controls Windows updates.');
  if(platform==='linux')problems.push('Linux: this build asks update.acirabrowser.com first and Linux has no signature check on updates. Release it with --accept-unsigned-host to accept that.');
 }
 return problems;
}

// --- the receipt of one private test ---
const BY_EYE={
 mac:['updatePopupAndNotesRead','tabsWorkspaceSettingsBack'],
 windows:['noSetupWindow','reopenedWithinTwoMinutes','tabsBack','noSecurityOrAntivirusPrompt'],
 linux:['relaunched','tabsBack'],
};
/** What a receipt (scripts/rehearsal-receipt.mjs, or the Mac rig) has to say. expect: {platform, hop, from:{version}, to:{version, sha512}} */
function checkReceipt(receipt,expect){
 const label=expect.platform+' hop '+expect.hop+': ';
 if(!receipt||typeof receipt!=='object')return [label+'no receipt.'];
 const problems=[];
 if(receipt.schema!==1)problems.push(label+'receipt schema '+receipt.schema+', expected 1.');
 if(receipt.platform!==expect.platform||receipt.hop!==expect.hop)problems.push(label+'the receipt is for '+receipt.platform+' hop '+receipt.hop+'.');
 if(receipt.passed!==true)problems.push(label+'the test did not pass.');
 if(receipt.from?.version!==expect.from.version)problems.push(label+'it started from '+receipt.from?.version+', not '+expect.from.version+'.');
 if(receipt.to?.version!==expect.to.version)problems.push(label+'it ended on '+receipt.to?.version+', not '+expect.to.version+'.');
 if(receipt.to?.sha512!==expect.to.sha512)problems.push(label+'it tested another file than the one being published (SHA-512 differs). Rebuilt since? Test again.');
 if(expect.from.sha512&&receipt.from?.sha512!==expect.from.sha512)problems.push(label+'it started from another build than the one being published as the bridge.');
 if(receipt.automatic?.documentFetched!==true||!(receipt.automatic?.fileBytesServed>0))problems.push(label+'the feed server did not see the app read the document and fetch the file ('+(receipt.automatic?.documentFetched?'':'no document; ')+(receipt.automatic?.fileBytesServed||0)+' bytes of the file).');
 if(receipt.automatic?.installedVersion!==expect.to.version)problems.push(label+'the app that was updated reports '+receipt.automatic?.installedVersion+', not '+expect.to.version+'.');
 for(const key of BY_EYE[expect.platform])if(receipt.byEye?.[key]!==true)problems.push(label+'"'+key+'" was not confirmed by eye.');
 return problems;
}

// --- documents ---
/** The same planned feed entries under another folder of the site (testers/ or rehearsal/): rewritten freely, read only by the founder's test copies. */
function underFolder(feeds,folder,{staging=false}={}){
 return feeds.map(feed=>{
  const doc=U.parseFeed(feed.text);
  const next=staging?doc:U.withRollout(doc,100);
  return {platform:feed.platform,file:folder+feed.file,text:U.serializeFeed(next),version:feed.version,before:null,beforeText:'',rewrite:true};
 });
}
/** The next release's documents for the root of the site: everyone, and a pace for the first day. */
function hostDocuments(feeds,{seconds=NEXT_CHECK_SECONDS}={}){
 return feeds.map(feed=>({...feed,text:U.serializeFeed(U.withNextCheck(U.withRollout(U.parseFeed(feed.text),100),seconds))}));
}
/** The bridge release's documents as the GitHub feed gets them: the first stage of the rollout. */
function bridgeDocuments(feeds,{percentage=BRIDGE_ROLLOUT}={}){
 return feeds.map(feed=>({...feed,text:U.serializeFeed(U.withRollout(U.frozenDoc(U.parseFeed(feed.text)),percentage))}));
}
/** Two documents are the same offer when only the pace and the share differ (used to prove that what is written is what was tested). */
const sameOffer=(a,b)=>{const norm=text=>{const doc=U.frozenDoc(typeof text==='string'?U.parseFeed(text):text);return JSON.stringify(doc);};return norm(a)===norm(b);};

// --- the frozen set ---
/** Everything the GitHub feed and the bridge release must never lose or change: the documents (in their frozen form), every file they name, and every blockmap they point at. */
function frozenManifest({documents,generatedAt}){
 const entries=[],seen=new Set();
 const add=entry=>{if(!seen.has(entry.key)){seen.add(entry.key);entries.push(entry);}};
 for(const {file,text} of documents){
  const doc=U.frozenDoc(U.parseFeed(text));
  add({key:'doc:'+file,kind:'document',path:'feed/'+file,sha256:sha256Text(U.serializeFeed(doc))});
  for(const f of doc.files||[])add({key:'asset:'+f.url,kind:'asset',url:f.url,sha512:f.sha512,size:f.size});
  for(const b of doc.previousBlockMaps||[])add({key:'blockmap:'+b.url,kind:'blockmap',url:b.url,version:b.version});
 }
 return {schema:1,generatedAt,note:'Never delete or rename any of this: copies of Acira from beta.1 to beta.10 read the GitHub feed, and beta.11 falls back to it. docs/launch/UPDATE_HOST.md.',entries};
}
/** Problems found comparing a manifest with what is live. live: {documents: Map(file -> text), assets: Map(url -> {ok,size})} */
function checkFrozen(manifest,live){
 const problems=[];
 for(const entry of manifest.entries){
  if(entry.kind==='document'){
   const file=entry.path.replace(/^feed\//,''),text=live.documents.get(file);
   if(text===undefined)problems.push('The frozen document '+entry.path+' is missing.');
   else{let hash=null;try{hash=sha256Text(U.serializeFeed(U.frozenDoc(U.parseFeed(text))));}catch{/* unreadable */}if(hash!==entry.sha256)problems.push('The frozen document '+entry.path+' has changed.');}
  }else{
   const found=live.assets.get(entry.url);
   if(!found||!found.ok)problems.push('The frozen '+entry.kind+' '+entry.url+' no longer answers.');
   else if(entry.kind==='asset'&&Number.isFinite(entry.size)&&found.size!==undefined&&found.size!==entry.size)problems.push('The frozen file '+entry.url+' has another size ('+found.size+', expected '+entry.size+').');
  }
 }
 return problems;
}

// --- is the next release really the bridge release plus its version number? ---
/** changed: the names git diff --name-only lists between the two commits; versionOnly: whether package.json (and the lock) differ only in "version" lines. */
function nextIsBridgePlusBump({changed,versionOnly}){
 const allowed=new Set(['package.json','package-lock.json']);
 const extra=changed.filter(file=>!allowed.has(file));
 if(extra.length)return ['The next release is not the bridge release plus its version number: it also changes '+extra.slice(0,5).join(', ')+(extra.length>5?' and '+(extra.length-5)+' more':'')+'. A fix found while testing goes into a rebuilt bridge release (and the next one on top of it), or waits for the release after.'];
 if(!versionOnly)return ['package.json or package-lock.json changes more than the version number between the two builds.'];
 return [];
}

// --- the state of a run, kept so every step can be run again ---
const emptyState=({bridge,next})=>({schema:1,bridge,next,done:{},releaseDate:null,digests:{}});
const stateName=({bridge,next})=>bridge+'__'+next+'.json';
/** The step that may run now: the first that is not done. */
function nextStep(state){return STEPS.find(step=>!state.done[step.key])||null;}
/** A step may run only when every step before it has been done, except the ones a person does and the tool checks itself: "tests" (go reads the six receipts), "real" and
 *  "soak" (the founder's own installs and a day at 10%). Returns the reason it may not, or null. */
function blockedBy(state,key){
 const index=stepIndex(key);
 for(let i=0;i<index;i++)if(!state.done[STEPS[i].key]&&!['tests','real','soak'].includes(STEPS[i].key))return 'Step "'+STEPS[i].key+'" ('+STEPS[i].what+') is not done yet.';
 return null;
}

module.exports={BRIDGE_ROLLOUT,NEXT_CHECK_SECONDS,PLATFORMS,HOPS,MAC_ARCHES,STEPS,BY_EYE,TESTERS_PATH,REHEARSAL_PATH,GITHUB_FEED_URL,HOST_URL,stepIndex,sha256Text,checkHandoff,checkReceipt,underFolder,hostDocuments,bridgeDocuments,sameOffer,frozenManifest,checkFrozen,nextIsBridgePlusBump,emptyState,stateName,nextStep,blockedBy};
