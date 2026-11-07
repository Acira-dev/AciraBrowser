'use strict';
// The rules and the pure parts behind scripts/publish-update.mjs (no network, no gh, no Apple tools here, so tests/update-publish.test.cjs runs them anywhere).
// What a release is: one GitHub release per platform on Acira-dev/AciraBrowserUpdates (the website tells the platform from "mac" or "windows" in the tag, so a
// version is two releases, v<version>-mac-<commit> and v<version>-windows-<commit>), plus the channel documents in feed/ that installed copies read.
// Order that keeps users safe (docs/launch/PUBLIC_UPDATES.md): payloads first, verified anonymously, the channel documents last.
const path=require('node:path'),{createHash}=require('node:crypto'),{createReadStream}=require('node:fs');
const semver=require('semver');
const {LEGACY_FEED_URL,DEFAULT_FEED_URL,UPDATE_REPOSITORY}=require('./update-feed.cjs');
const ARCHES=['arm64','x64'],CHANNELS=['beta','stable'],PLATFORMS=['mac','windows'],ALL_PLATFORMS=[...PLATFORMS,'linux']; // PLATFORMS: what --widen/--halt touch by default; Linux joins with the bridge release (beta.11)
// Versions already on people's computers. A release must be higher than all of them or nobody updates to it.
const SHIPPED=Object.freeze([
 Object.freeze({version:'0.1.0-beta.6.local.4',what:'the Mac build people installed on 1 November'}),
 Object.freeze({version:'0.1.0-beta.6',what:'the public Windows build'}),
]);
const RELEASE_VERSION=/^\d+\.\d+\.\d+(?:-beta\.\d+)?$/; // what ships; never a ".local.N" build
const WINDOWS_VERSION=/^0\.1\.\d+-beta\.\d+$/; // scripts/build-windows.mjs refuses any other version
const ASSET_NAME=/^[A-Za-z0-9][A-Za-z0-9._-]*$/; // GitHub rewrites other characters, which would break the URLs written into the feed
const NOTES_MAX=1000; // desktop/browser-services/app-updater.cjs shows at most this many characters of release notes
const RAW_FEED_BASE=LEGACY_FEED_URL; // the GitHub raw feed: where the bridge release (beta.11) is written and read back; packaging/update-targets.cjs has both targets

function versionProblems(version,channel){
 if(!CHANNELS.includes(channel))return ['The channel must be beta or stable.'];
 if(!semver.valid(version))return ['"'+version+'" is not a version.'];
 if(!RELEASE_VERSION.test(version))return [version+' is not a release version (a local build such as 0.1.0-beta.6.local.4 never goes to users). Use the plain package.json version, for example 0.1.0-beta.7.'];
 if(channel==='beta'&&!semver.prerelease(version))return ['The beta channel carries pre-release versions (0.1.0-beta.N); '+version+' is a stable version, so use --channel stable.'];
 if(channel==='stable'&&semver.prerelease(version))return ['The stable channel carries plain versions; '+version+' is a pre-release, so use --channel beta.'];
 return [];
}
/** references: [{label, version}], the versions this one has to beat. A null version (nothing to compare) is skipped by the caller. */
function newerProblems(version,references){
 return references.filter(reference=>reference.version&&semver.valid(reference.version)&&!semver.gt(version,reference.version)).map(reference=>version+' is not newer than '+reference.version+' ('+reference.label+'); an installed copy only updates to a higher version.');
}
const feedFiles=(channel,platform)=>(channel==='stable'?['latest','beta']:['beta']).map(name=>platform==='linux'?'linux/'+name+'-linux.yml':name+(platform==='mac'?'-mac':'')+'.yml'); // a stable release also reaches people following the beta channel
function releaseTag({version,platform,commit}){
 if(!ALL_PLATFORMS.includes(platform))throw Error('Unknown platform '+platform+'.');
 if(!/^[0-9a-f]{7,40}$/.test(String(commit)))throw Error('A release tag needs the build commit (7 to 40 hex characters), got '+commit+'.');
 return 'v'+version+'-'+platform+'-'+commit.slice(0,8);
}
function assetUrl(tag,name,repo=UPDATE_REPOSITORY){
 if(!ASSET_NAME.test(name))throw Error('The file name "'+name+'" would be renamed by GitHub, so the feed could not name it.');
 return 'https://github.com/'+repo+'/releases/download/'+tag+'/'+name;
}
async function describeFile(file){
 const sha256=createHash('sha256'),sha512=createHash('sha512');let size=0;
 for await(const bytes of createReadStream(file)){sha256.update(bytes);sha512.update(bytes);size+=bytes.length;}
 return {name:path.basename(file),path:file,size,sha256:sha256.digest('hex'),sha512:sha512.digest('base64')};
}
const checksumsText=assets=>assets.filter(asset=>asset.sha256).slice().sort((a,b)=>a.name<b.name?-1:1).map(asset=>asset.sha256+'  '+asset.name).join('\n')+'\n';
/** The notes people read: "What's new" bullets for the release page (the website lists exactly those), plain bullets for the in-app popup. */
function releaseNotes(raw){
 const source=String(raw||'').replace(/\r\n?/g,'\n').trim();
 if(!source)return {markdown:'',plain:''};
 const part=/^#{1,4}[ \t]*What's new[ \t]*$([\s\S]*?)(?=^#{1,4}[ \t]|(?![\s\S]))/im.exec(source),lines=text=>text.split('\n').map(line=>line.trim()).filter(Boolean);
 const bullet=line=>/^[-*]\s+/.test(line)?'- '+line.replace(/^[-*]\s+/,''):'- '+line;
 if(part)return {markdown:source+'\n',plain:lines(part[1]).filter(line=>/^[-*]\s+/.test(line)).map(bullet).join('\n')};
 const bullets=lines(source).filter(line=>!/^#{1,6}\s/.test(line)).map(bullet);
 return {markdown:"## What's new\n"+bullets.join('\n')+'\n',plain:bullets.join('\n')};
}
// A release carries this line in its body while it must not appear on the website's download page: from the upload until the founder says it is time
// (beta.12), and for good on the bridge release (beta.11, which new visitors are never offered). The website skips a release whose body has it.
const HIDDEN_MARKER='<!-- acira:hidden -->';
const INSTALL_LINE={mac:'The disk images (DMG) are for new installs; installed copies of Acira update themselves from the update archives.',windows:'AciraBrowserSetup.exe is the installer; installed copies of Acira update themselves from it.',linux:'The AppImage is the program and AciraBrowser-Linux-SetupFiles.zip installs it (Install-Acira.sh); installed copies of Acira update themselves from the AppImage.'};
function releaseBody({notes,platform,hidden=false}){
 return (hidden?HIDDEN_MARKER+'\n':'')+(notes.markdown?notes.markdown+'\n':'')+INSTALL_LINE[platform]+' SHA-256 checksums are in SHA256SUMS.txt.\n';
}
/** The Mac channel document: writeMacUpdateFeed's output (relative names, hashes it computed) with absolute release URLs, a name and the notes. */
function finalizeMacFeed(baseText,{urlFor,releaseName,releaseNotes:notes}){
 const doc=JSON.parse(baseText),files=doc.files.map(file=>({...file,url:urlFor(file.url)}));
 return {version:doc.version,files,path:files[0].url,sha512:files[0].sha512,releaseDate:doc.releaseDate,minimumSystemVersion:doc.minimumSystemVersion,releaseName,...(notes?{releaseNotes:notes}:{})};
}
function windowsFeed({version,file,url,releaseDate,releaseName,releaseNotes:notes,previousBlockMaps=[]}){
 return {version,files:[{url,sha512:file.sha512,size:file.size}],path:url,sha512:file.sha512,releaseDate,releaseName,...(notes?{releaseNotes:notes}:{}),...(previousBlockMaps.length?{previousBlockMaps}:{})};
}
/** The Linux channel document: one AppImage (the same shape as the Windows one, without blockmaps). */
function linuxFeed({version,file,url,releaseDate,releaseName,releaseNotes:notes}){
 return {version,files:[{url,sha512:file.sha512,size:file.size}],path:url,sha512:file.sha512,releaseDate,releaseName,...(notes?{releaseNotes:notes}:{})};
}
/** How soon installs on beta.11 and later should look again (seconds; the app keeps it between 10 minutes and 24 hours). Older builds ignore the field. */
const withNextCheck=(doc,seconds)=>{
 if(!Number.isInteger(seconds)||seconds<600||seconds>86400)throw Error('nextCheckSeconds is a whole number from 600 to 86400.');
 return {...doc,nextCheckSeconds:seconds};
};
/** A bridge document in its frozen form: offered to everyone, no staging, no halt note, no pace. */
const frozenDoc=doc=>{const next={...doc};delete next.stagingPercentage;delete next.halted;delete next.nextCheckSeconds;return next;};
/** The addresses an app-update.yml of a new build may name (the new host, or the frozen GitHub feed for an old-style build). */
const ALLOWED_FEEDS=Object.freeze([DEFAULT_FEED_URL,LEGACY_FEED_URL]);
const BLOCKMAPS_KEPT=6;
/** Where earlier Windows setups' blockmaps are, newest first: the live channel documents' own setups (their URL + .blockmap) and the notes they carried.
 *  An installed Acira downloads only what changed since its own setup (desktop/browser-services/app-updater.cjs), which needs its own version's
 *  blockmap; electron-updater's guess at that URL (the new one with the version swapped) misses releases tagged with their commit, as these are.
 *  The app checks each one against the setup it has, so a missing or wrong entry only means a whole download. */
function previousBlockMaps(live,{version,kept=BLOCKMAPS_KEPT}){
 const list=[],seen=new Set([version]);
 const add=(entryVersion,url)=>{if(typeof entryVersion!=='string'||typeof url!=='string'||seen.has(entryVersion)||!/^https:\/\//.test(url))return;seen.add(entryVersion);list.push({version:entryVersion,url});};
 for(const doc of live){const setup=(doc.files||[]).find(file=>/\.exe$/i.test(String(file?.url||'')));if(setup)add(doc.version,setup.url+'.blockmap');}
 for(const doc of live)for(const entry of doc.previousBlockMaps||[])add(entry?.version,entry?.url);
 return list.slice(0,kept);
}
/** A setup's blockmap, as the installed app reads it (desktop/browser-services/update-download.cjs): it must describe exactly this setup (offset 0, sizes
 *  adding up to the setup's size), or every copy that updates from it falls back to downloading the whole setup. Throws with the reason. */
function checkBlockMap(raw,{size}){
 const {readBlockMap,blockMapSize}=require('../desktop/browser-services/update-download.cjs');
 let map;try{map=readBlockMap(raw);}catch{throw Error('it is not a blockmap (gzipped JSON with one file, as electron-builder writes it)');}
 if(map.files[0].offset!==0)throw Error('it starts '+map.files[0].offset+' bytes into the file, so it is not the whole setup\'s blockmap');
 if(blockMapSize(map)!==size)throw Error('it describes a file of '+blockMapSize(map)+' bytes, not this '+size+'-byte setup: it belongs to another build');
 return map;
}
// Staged rollout, the way electron-updater does it (AppUpdater.isStagingMatch): an installed copy makes a random id once (<userData>/.updaterId) and is
// offered the document's version only when that id falls below stagingPercentage. No field means everyone, and the same copy gets the same answer at
// every check, so raising the percentage only ever adds people. 0 offers it to nobody: that is a halt. `halted` records when and from what percentage, so
// --resume-rollout can put it back; electron-updater ignores the field.
/** --rollout and --widen take a whole percentage from 1 to 100. */
function parsePercent(value,flag){
 const number=Number(value);
 if(!/^\d{1,3}$/.test(String(value))||number<1||number>100)throw Error(flag+' takes a whole percentage from 1 to 100, not '+value+'.');
 return number;
}
/** {percentage, halted, before}: who a channel document reaches now. before is the percentage a halt recorded (null when unknown). */
function rolloutOf(doc){
 const raw=doc?.stagingPercentage,parsed=raw==null?100:Number.parseInt(raw,10),percentage=Number.isNaN(parsed)?100:Math.max(0,Math.min(100,parsed));
 const before=doc?.halted&&Number.isInteger(doc.halted.percentage)&&doc.halted.percentage>=1&&doc.halted.percentage<=100?doc.halted.percentage:null;
 return {percentage,halted:percentage===0,before};
}
const describeRollout=doc=>{const {percentage,halted}=rolloutOf(doc);return halted?'halted (offered to nobody)':percentage===100?'offered to every install':'offered to '+percentage+'% of installs';};
/** The document offered to `percentage` of installs (100: the field goes, which electron-updater reads as everyone). Clears a halt. */
function withRollout(doc,percentage){
 const next={...doc};delete next.halted;
 if(percentage===100)delete next.stagingPercentage;else next.stagingPercentage=percentage;
 return next;
}
const haltDoc=(doc,{at})=>({...doc,stagingPercentage:0,halted:{at,percentage:rolloutOf(doc).percentage}});
/** The architecture of a Mac update ZIP named in a channel document, or null. */
const macArchOf=url=>/-mac-(arm64|x64)-update\.zip$/.exec(String(url||''))?.[1]||null;
/** The release tag in a public release download URL, or null. */
const tagOf=url=>/\/releases\/download\/([^/]+)\/[^/]+$/.exec(String(url||''))?.[1]||null;
/** A live Mac document with one more architecture's ZIP. path and sha512 (electron-updater's old single-file fields) keep naming the first file. */
const addMacFiles=(doc,files)=>({...doc,files:[...doc.files,...files]});
/** Line diff of two small documents (before, after): '  ' unchanged, '- ' removed, '+ ' added. Enough for a feed document of a few dozen lines. */
function lineDiff(before,after){
 const a=String(before||'').replace(/\n$/,'').split('\n').filter((line,index,all)=>all.length>1||line),b=String(after||'').replace(/\n$/,'').split('\n');
 const rows=a.length+1,cols=b.length+1,lcs=Array.from({length:rows},()=>new Array(cols).fill(0));
 for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--)lcs[i][j]=a[i]===b[j]?lcs[i+1][j+1]+1:Math.max(lcs[i+1][j],lcs[i][j+1]);
 const out=[];let i=0,j=0;
 while(i<a.length||j<b.length){
  if(i<a.length&&j<b.length&&a[i]===b[j]){out.push('  '+a[i]);i++;j++;}
  else if(i<a.length&&(j===b.length||lcs[i+1][j]>=lcs[i][j+1])){out.push('- '+a[i]);i++;} // what goes, then what comes
  else{out.push('+ '+b[j]);j++;}
 }
 return out;
}
/** A line diff with only `context` unchanged lines kept around each change; longer unchanged runs become one "… N unchanged lines" line. */
function foldDiff(lines,context=2){
 const near=lines.map((line,index)=>!line.startsWith('  ')||lines.slice(Math.max(0,index-context),index+context+1).some(other=>!other.startsWith('  ')));
 const out=[];let skipped=0;
 for(let index=0;index<lines.length;index++){
  if(near[index]){if(skipped)out.push('  … '+skipped+' unchanged line'+(skipped===1?'':'s'));skipped=0;out.push(lines[index]);}
  else skipped++;
 }
 if(skipped)out.push('  … '+skipped+' unchanged line'+(skipped===1?'':'s'));
 return out;
}
const serializeFeed=doc=>JSON.stringify(doc,null,2)+'\n'; // JSON is YAML, and the public documents already use it
function parseFeed(text){try{return JSON.parse(text);}catch{return require('js-yaml').load(text);}}
/** Reads a feed document the way an installed app does (the real electron-updater parser). Throws if it is not a valid channel document. */
function readWithUpdater(text,{file,baseUrl=RAW_FEED_BASE}){
 const {parseUpdateInfo,resolveFiles}=require('electron-updater/out/providers/Provider'),base=new URL(baseUrl),info=parseUpdateInfo(text,file,base);
 return {info,files:resolveFiles(info,base)};
}
/** What the live feed offers: {version, files} or {version:null} when the file does not exist yet, or {error} when it could not be read. */
async function readLiveFeed({fetch,file,baseUrl=RAW_FEED_BASE}){
 try{
  const response=await fetch(new URL(file,baseUrl).href,{headers:{'cache-control':'no-cache'}});
  if(response.status===404)return {file,version:null,files:[]};
  if(!response.ok)return {file,error:'HTTP '+response.status};
  const text=await response.text(),doc=parseFeed(text);
  if(!doc||typeof doc.version!=='string')return {file,error:'not a channel document'};
  return {file,version:doc.version,files:doc.files||[],previousBlockMaps:Array.isArray(doc.previousBlockMaps)?doc.previousBlockMaps:[],doc,text};
 }catch(error){return {file,error:String(error?.message||error)};}
}
/** BUILD-INFO.json: what was published and what was checked. Only what the inputs decide (no clock), so a run that resumes after a failure
 *  produces the same bytes as the one that uploaded it, and the anonymous byte check of the file already on the release passes. */
function buildInfo({version,channel,platform,commit,assets,checks}){
 return {schema:2,product:'Acira Browser',version,channel,platform,commit,checks,files:assets.map(({name,size,sha256,sha512})=>({name,size,sha256,sha512}))};
}
module.exports={ARCHES,CHANNELS,PLATFORMS,ALL_PLATFORMS,HIDDEN_MARKER,ALLOWED_FEEDS,linuxFeed,withNextCheck,frozenDoc,SHIPPED,RELEASE_VERSION,WINDOWS_VERSION,NOTES_MAX,RAW_FEED_BASE,UPDATE_REPOSITORY,versionProblems,newerProblems,feedFiles,releaseTag,assetUrl,describeFile,checksumsText,releaseNotes,releaseBody,finalizeMacFeed,windowsFeed,previousBlockMaps,checkBlockMap,parsePercent,rolloutOf,describeRollout,withRollout,haltDoc,macArchOf,tagOf,addMacFiles,lineDiff,foldDiff,serializeFeed,parseFeed,readWithUpdater,readLiveFeed,buildInfo};
