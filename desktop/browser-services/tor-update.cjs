'use strict';
// Tor engine updates (stream N). Tor releases security fixes often; the engine shipped in the installer would otherwise only
// move with Acira releases. When automatic updates are on, the first Tor start of the week asks Tor Project's update feed for the
// current Tor Browser release; a newer Windows Expert Bundle is downloaded from dist.torproject.org, its detached signature is
// verified in-app against the pinned Tor Browser Developers signing keys (tor-openpgp.cjs, no gpg), tor.exe is unpacked into
// <userData>/tor/engine/<version>/ and recorded with its SHA-256. It is used the next time Tor starts with no Tor window open.
// Anything that fails (offline, unknown signer, bad signature, tor.exe that won't run) leaves the bundled engine in use.
// The only host contacted is Tor Project's (aus1/dist.torproject.org), and always through Tor (the engine's fetch, tor-engine.cjs):
// a direct request the moment a Tor tab opens would tell the network that this computer uses Tor. Without a fetcher nothing is sent.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFile}=require('node:child_process'),{gunzipSync}=require('node:zlib');
const {verifyDetached}=require('./tor-openpgp.cjs');
const manifest=require('./tor-engine/tor-version.json');
const macTor=require('./tor-mac.cjs');
const linuxTor=require('./tor-linux.cjs');

const WEEK=7*24*3600*1000,MAX_ARCHIVE=90*1024*1024;
const versionParts=value=>String(value).split('.').map(part=>Number(part)||0);
const newer=(a,b)=>{const x=versionParts(a),y=versionParts(b);for(let i=0;i<Math.max(x.length,y.length);i++){const d=(x[i]||0)-(y[i]||0);if(d)return d>0;}return false;};
const sha256=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');

/** Regular files of a (gzipped) ustar archive, by path. */
function untar(buffer){
 const files=new Map();let longName=null;
 for(let offset=0;offset+512<=buffer.length;){
  const header=buffer.subarray(offset,offset+512);if(header.every(byte=>byte===0))break;
  const text=(start,end)=>header.subarray(start,end).toString('utf8').replace(/\0.*$/s,'');
  const size=parseInt(text(124,136).trim()||'0',8),type=String.fromCharCode(header[156]||48),prefix=text(345,500),name=longName||(prefix?prefix+'/'+text(0,100):text(0,100));
  const body=buffer.subarray(offset+512,offset+512+size);longName=null;
  if(type==='L')longName=body.toString('utf8').replace(/\0.*$/s,'');else if(type==='0'||type==='\0')files.set(name.replace(/^\.\//,''),Buffer.from(body));
  offset+=512+Math.ceil(size/512)*512;
 }
 return files;
}
const runVersion=file=>new Promise(resolve=>execFile(file,['--version'],{timeout:10000,windowsHide:true,...(process.platform==='linux'?{env:linuxTor.nativeEnvironment(file)}:{})},(error,stdout)=>resolve(error?null:/Tor version (\S+?)\.?\s/.exec(String(stdout))?.[1]||null)));
async function download(url,{limit=MAX_ARCHIVE,timeout=180000,fetcher=fetch}={}){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
 try{const response=await fetcher(url,{signal:controller.signal,redirect:'follow',credentials:'omit'});if(!response.ok)throw new Error('HTTP '+response.status);
  const length=Number(response.headers.get('content-length')||0);if(length>limit)throw new Error('Download is larger than expected.');
  const buffer=Buffer.from(await response.arrayBuffer());if(buffer.length>limit)throw new Error('Download is larger than expected.');return buffer;}
 finally{clearTimeout(timer);}
}

const NO_FETCH=()=>Promise.reject(new Error('Tor updates go through Tor; no Tor connection was given.'));
function createTorUpdater({userData,platform=process.platform,arch=process.arch,fetcher=NO_FETCH,now=()=>Date.now(),log=()=>{},feedUrl=platform==='darwin'?(macTor.spec(arch)?.updateFeed||manifest.updateFeed):platform==='linux'?(linuxTor.spec(arch)?.updateFeed||manifest.updateFeed):manifest.updateFeed,bundled=platform==='linux'?linuxTor.manifest.torBrowserVersion:manifest.torBrowserVersion,run=runVersion}={}){
 if(!userData)throw new Error('The updater needs a data folder.');
 const root=path.join(userData,'tor'),engineRoot=path.join(root,'engine'),file=path.join(root,'update.json');
 let record={auto:true,lastChecked:0,installed:null,latest:null,error:null},running=null,state='idle';
 try{record={...record,...JSON.parse(fs.readFileSync(file,'utf8'))};}catch{}
 const save=()=>{try{fs.mkdirSync(root,{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(record));fs.renameSync(file+'.tmp',file);}catch(error){log('Tor update record not saved: '+error.message);}};
 const current=()=>record.installed&&newer(record.installed.version,bundled)?record.installed:null;
 const status=()=>({auto:record.auto,state,current:current()?.version||bundled,tor:current()?.tor||(platform==='linux'?linuxTor.manifest.tor:manifest.tor),latest:record.latest,lastChecked:record.lastChecked,updatePending:Boolean(current()),error:record.error});
 /** The updated engine, if there is one and its file is still the one that was verified. Verified again at launch by the engine. */
 function updated(){const c=current();if(!c)return null;const exe=path.join(engineRoot,c.version,platform!=='win32'?'tor':'tor.exe');try{if(platform==='darwin'||platform==='linux'){const native=(platform==='linux'?linuxTor.readLinuxTor:macTor.readMacTor)(exe,{arch,pinned:false});return native&&native.sha256===c.sha256&&Object.entries(native.companions).every(([name,digest])=>c.companions?.[name]===digest)?{file:exe,sha256:c.sha256,companions:c.companions,version:c.version}:null;}return fs.statSync(exe).isFile()?{file:exe,sha256:c.sha256,version:c.version}:null;}catch{return null;}}
 async function install(version){
  const target=platform==='darwin'?'macos-'+(arch==='arm64'?'aarch64':arch==='x64'?'x86_64':'unsupported'):platform==='linux'?(arch==='x64'?'linux-x86_64':'linux-unsupported'):'windows-x86_64';if(target.endsWith('unsupported'))throw Error('Unsupported Tor architecture.');const name=`tor-expert-bundle-${target}-${version}.tar.gz`,base=`https://dist.torproject.org/torbrowser/${version}/${name}`;
  state='downloading';
  const archive=await download(base,{fetcher}),signature=await download(base+'.asc',{limit:64*1024,timeout:30000,fetcher});
  if(!verifyDetached(archive,signature))throw new Error('The release is not signed by a Tor Browser Developers key Acira knows. Not installed.');
  const files=untar(gunzipSync(archive)),exe=files.get(platform!=='win32'?'tor/tor':'tor/tor.exe');if(!exe||exe.length<1e6)throw new Error('The release has no Tor executable.');
  const dir=path.join(engineRoot,version+'.part');fs.rmSync(dir,{recursive:true,force:true});fs.mkdirSync(dir,{recursive:true});
  let native;if(platform==='darwin')native=await macTor.prepareMacTor({files,directory:dir,arch,version,archiveSha256:sha256(archive),pinned:false});else if(platform==='linux')native=linuxTor.prepareLinuxTor({files,directory:dir,arch,version,archiveSha256:sha256(archive),pinned:false});else{fs.writeFileSync(path.join(dir,'tor.exe'),exe);const licence=files.get('docs/tor.txt');if(licence)fs.writeFileSync(path.join(dir,'LICENSE.tor.txt'),licence);}
  const tor=await run(path.join(dir,platform!=='win32'?'tor':'tor.exe'));if(!tor){fs.rmSync(dir,{recursive:true,force:true});throw new Error('The new tor.exe did not run.');}
  const finalDir=path.join(engineRoot,version);fs.rmSync(finalDir,{recursive:true,force:true});fs.renameSync(dir,finalDir);
  record.installed={version,tor,sha256:native?.files.tor||sha256(exe),...(native?{companions:platform==='linux'?Object.fromEntries(linuxTor.LIBRARIES.map(name=>[name,native.files[name]])):{'libevent-2.1.7.dylib':native.files['libevent-2.1.7.dylib']}}:{}),installedAt:now()};
  for(const old of fs.readdirSync(engineRoot))if(old!==version)fs.rmSync(path.join(engineRoot,old),{recursive:true,force:true});
 }
 /** Looks for a newer release (at most weekly unless forced) and installs it. Never throws; the result is in status(). */
 function check({force=false}={}){
  if(running)return running;
  if(!force&&(!record.auto||now()-record.lastChecked<WEEK))return Promise.resolve(status());
  running=(async()=>{
   state='checking';record.error=null;
   try{
    const feed=JSON.parse((await download(feedUrl,{limit:256*1024,timeout:20000,fetcher})).toString('utf8')),latest=String(feed.version||'');
    if(!/^\d+(\.\d+){1,3}$/.test(latest))throw new Error('Unreadable update feed.');
    record.latest=latest;record.lastChecked=now();
    if(newer(latest,current()?.version||bundled))await install(latest);
   }catch(error){record.error=String(error.message||error).slice(0,200);record.lastChecked=now();log('Tor update: '+record.error);}
   state='idle';save();return status();
  })().finally(()=>{running=null;});
  return running;
 }
 return {status,updated,check,setAuto(value){record.auto=Boolean(value);save();return status();}};
}
module.exports={createTorUpdater,untar,newer};
