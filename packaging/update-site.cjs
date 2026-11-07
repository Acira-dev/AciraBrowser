'use strict';
// The static site behind update.acirabrowser.com (GitHub Pages, folder docs/ of the public updates repository). packaging/update-site/site/ holds the parts
// that never change (the CNAME, .nojekyll, a plain index and 404 page, robots.txt, the Stable placeholders); the release tool writes the channel documents
// beside them: the real ones in the root (beta.12 on), the founder's own testers copy in testers/, and the bridge rehearsal in rehearsal/.
// checkSite() is what "the site is right" means, so the same rules run before every write (scripts/update-site.mjs check, release-publish.mjs) and in tests.
// Nothing here writes anywhere but the folder it is given.
const fs=require('node:fs'),path=require('node:path');
const SITE_DIR=path.join(__dirname,'update-site','site');
const CNAME='update.acirabrowser.com';
const DOCUMENTS=Object.freeze(['latest.yml','beta.yml','latest-mac.yml','beta-mac.yml','linux/latest-linux.yml','linux/beta-linux.yml']);
const FOLDERS=Object.freeze(['','testers/','rehearsal/']);
const STATIC=Object.freeze(['.nojekyll','404.html','CNAME','index.html','robots.txt','latest.yml','latest-mac.yml','linux/latest-linux.yml']);
const MAX_FILE=200*1024,MAX_TOTAL=2*1024*1024;

/** Every path the site may hold. Anything else (an installer, a script, a stray file) is a problem. */
const allowedPaths=()=>new Set([...STATIC,...FOLDERS.flatMap(folder=>DOCUMENTS.map(name=>folder+name))]);
/** All files under dir as Map<posix path, Buffer>. */
function listSite(dir){
 const files=new Map();
 const walk=(folder,prefix)=>{for(const entry of fs.readdirSync(folder,{withFileTypes:true})){
  const full=path.join(folder,entry.name),name=prefix+entry.name;
  if(entry.isDirectory())walk(full,name+'/');else if(entry.isFile())files.set(name,fs.readFileSync(full));else throw Error(name+' is not a plain file.');
 }};
 if(fs.existsSync(dir))walk(dir,'');
 return files;
}
const staticSite=()=>listSite(SITE_DIR);
/** The problems with a site (a Map of path to bytes); empty when it is right. parse(text) reads a document like an installed app (electron-updater's reader). */
function checkSite(files,{parse}={}){
 const problems=[],allowed=allowedPaths();
 const {usableDocument}=require('../desktop/browser-services/update-feeds.cjs');
 let total=0;
 for(const [name,bytes] of files){
  total+=bytes.length;
  if(!allowed.has(name))problems.push(name+' does not belong on the update site (allowed: the static files and the channel documents in the root, testers/ and rehearsal/).');
  if(bytes.length>MAX_FILE)problems.push(name+' is '+bytes.length+' bytes; a channel document is a few KB.');
 }
 if(total>MAX_TOTAL)problems.push('The site is '+total+' bytes; it should be tiny.');
 if(files.has('CNAME')&&files.get('CNAME').toString('utf8').trim()!==CNAME)problems.push('CNAME must say '+CNAME+'.');
 if(!files.has('CNAME'))problems.push('CNAME is missing: Pages would forget the domain.');
 if(!files.has('.nojekyll'))problems.push('.nojekyll is missing: Pages would run the files through Jekyll.');
 for(const name of ['index.html','404.html']){
  const html=files.get(name)?.toString('utf8');
  if(html===undefined){problems.push(name+' is missing.');continue;}
  if(/<script|<iframe|<link[^>]+href=["']?https?:|\bsrc=["']?https?:/i.test(html))problems.push(name+' loads something: the update site has no scripts and no outside resources.');
  for(const url of html.match(/https?:\/\/[^\s"'<>)]+/g)||[])if(!/^https:\/\/acirabrowser\.com\/?$/.test(url))problems.push(name+' links to '+url+'; only https://acirabrowser.com/ is expected.');
 }
 for(const name of DOCUMENTS.filter(doc=>doc.startsWith('latest')))if(!files.has(name)&&!files.has(name.replace(/^latest/,'beta')))problems.push(name+' is missing: a copy on Stable would get a 404.');
 for(const [name,bytes] of files){
  if(!/\.yml$/.test(name))continue;
  let doc=null;
  try{doc=parse?parse(bytes.toString('utf8'),name):JSON.parse(bytes.toString('utf8'));}catch(error){problems.push(name+' cannot be read as a channel document: '+String(error.message).split('\n')[0]);continue;}
  if(!usableDocument(doc)){problems.push(name+' is not a usable channel document (a valid version and a files list).');continue;}
  for(const file of doc.files||[]){
   if(!/^https:\/\/[^\s]+$/.test(String(file.url)))problems.push(name+': file '+file.url+' is not an https address (the update files are on GitHub Releases).');
   if(typeof file.sha512!=='string'||!/^[A-Za-z0-9+/]{86}==$/.test(file.sha512))problems.push(name+': '+file.url+' has no valid SHA-512.');
   if(!Number.isSafeInteger(file.size)||file.size<=0)problems.push(name+': '+file.url+' has no size.');
  }
  if(doc.version!=='0.0.0'&&!(doc.files||[]).length&&!doc.path)problems.push(name+' offers '+doc.version+' with no files.');
 }
 return problems;
}
/** Writes the static files into dir (never deletes anything). Returns the paths written. */
function writeStatic(dir){
 const written=[];
 for(const [name,bytes] of staticSite()){const target=path.join(dir,...name.split('/'));fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);written.push(name);}
 return written;
}
module.exports={SITE_DIR,CNAME,DOCUMENTS,FOLDERS,STATIC,allowedPaths,listSite,staticSite,checkSite,writeStatic};
