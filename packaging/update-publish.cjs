'use strict';
// The rules and the pure parts behind scripts/publish-update.mjs (no network, no gh, no Apple tools here, so tests/update-publish.test.cjs runs them anywhere).
// What a release is: one GitHub release per platform on Acira-dev/AciraBrowserUpdates (the website tells the platform from "mac" or "windows" in the tag, so a
// version is two releases, v<version>-mac-<commit> and v<version>-windows-<commit>), plus the channel documents in feed/ that installed copies read.
// Order that keeps users safe (docs/launch/PUBLIC_UPDATES.md): payloads first, verified anonymously, the channel documents last.
const path=require('node:path'),{createHash}=require('node:crypto'),{createReadStream}=require('node:fs');
const semver=require('semver');
const {DEFAULT_FEED_URL,UPDATE_REPOSITORY}=require('./update-feed.cjs');
const ARCHES=['arm64','x64'],CHANNELS=['beta','stable'],PLATFORMS=['mac','windows'];
// Versions already on people's computers. A release must be higher than all of them or nobody updates to it.
const SHIPPED=Object.freeze([
 Object.freeze({version:'0.1.0-beta.6.local.4',what:'the Mac build people installed on 1 November'}),
 Object.freeze({version:'0.1.0-beta.6',what:'the public Windows build'}),
]);
const RELEASE_VERSION=/^\d+\.\d+\.\d+(?:-beta\.\d+)?$/; // what ships; never a ".local.N" build
const WINDOWS_VERSION=/^0\.1\.\d+-beta\.\d+$/; // scripts/build-windows.mjs refuses any other version
const ASSET_NAME=/^[A-Za-z0-9][A-Za-z0-9._-]*$/; // GitHub rewrites other characters, which would break the URLs written into the feed
const NOTES_MAX=1000; // desktop/browser-services/app-updater.cjs shows at most this many characters of release notes
const RAW_FEED_BASE=DEFAULT_FEED_URL;

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
const feedFiles=(channel,platform)=>(channel==='stable'?['latest','beta']:['beta']).map(name=>name+(platform==='mac'?'-mac':'')+'.yml'); // a stable release also reaches people following the beta channel
function releaseTag({version,platform,commit}){
 if(!PLATFORMS.includes(platform))throw Error('Unknown platform '+platform+'.');
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
function releaseBody({notes,platform}){
 return (notes.markdown?notes.markdown+'\n':'')+(platform==='mac'?'The disk images (DMG) are for new installs; installed copies of Acira update themselves from the update archives.':'AciraBrowserSetup.exe is the installer; installed copies of Acira update themselves from it.')+' SHA-256 checksums are in SHA256SUMS.txt.\n';
}
/** The Mac channel document: writeMacUpdateFeed's output (relative names, hashes it computed) with absolute release URLs, a name and the notes. */
function finalizeMacFeed(baseText,{urlFor,releaseName,releaseNotes:notes}){
 const doc=JSON.parse(baseText),files=doc.files.map(file=>({...file,url:urlFor(file.url)}));
 return {version:doc.version,files,path:files[0].url,sha512:files[0].sha512,releaseDate:doc.releaseDate,minimumSystemVersion:doc.minimumSystemVersion,releaseName,...(notes?{releaseNotes:notes}:{})};
}
function windowsFeed({version,file,url,releaseDate,releaseName,releaseNotes:notes}){
 return {version,files:[{url,sha512:file.sha512,size:file.size}],path:url,sha512:file.sha512,releaseDate,releaseName,...(notes?{releaseNotes:notes}:{})};
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
  const doc=parseFeed(await response.text());
  if(!doc||typeof doc.version!=='string')return {file,error:'not a channel document'};
  return {file,version:doc.version,files:doc.files||[]};
 }catch(error){return {file,error:String(error?.message||error)};}
}
function buildInfo({version,channel,platform,commit,assets,checks,builtAt}){
 return {schema:1,product:'Acira Browser',version,channel,platform,commit,publishedAt:builtAt,checks,files:assets.map(({name,size,sha256,sha512})=>({name,size,sha256,sha512}))};
}
module.exports={ARCHES,CHANNELS,PLATFORMS,SHIPPED,RELEASE_VERSION,WINDOWS_VERSION,NOTES_MAX,RAW_FEED_BASE,UPDATE_REPOSITORY,versionProblems,newerProblems,feedFiles,releaseTag,assetUrl,describeFile,checksumsText,releaseNotes,releaseBody,finalizeMacFeed,windowsFeed,serializeFeed,parseFeed,readWithUpdater,readLiveFeed,buildInfo};
