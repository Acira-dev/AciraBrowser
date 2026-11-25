'use strict';
// Where downloads go. Default matches other browsers: save straight into the Downloads folder (never overwriting,
// never running anything); the person can choose another folder or ask for a Save dialog every time.
const fs=require('node:fs'),path=require('node:path');

/** A file name is at most 255 bytes, and the download also needs room for " (9999)" and Chromium's ".crdownload": a longer name made the download fail at once. */
const NAME_BYTES=255-Buffer.byteLength(' (9999)')-Buffer.byteLength('.crdownload');
function fitName(stem,extension,units=Infinity){
 const room=Math.max(1,NAME_BYTES-Buffer.byteLength(extension)),limit=Math.max(1,units-extension.length);let kept='';
 for(const character of stem){if(Buffer.byteLength(kept+character)>room||kept.length+character.length>limit)break;kept+=character;}
 return kept||'download';
}
/** Windows without long-path support (off by default, even on Windows 11) cannot create a file whose whole path is 260 characters or more (MAX_PATH, the end mark included).
 *  A name that fits the file system's 255 bytes can still be too long in a deep folder, and the download then fails at once; Chrome shortens such a name to fit. The room a
 *  name has there: 259, less the folder, its separator, " (9999)" and Chromium's ".crdownload" (never below 24, so a very deep folder still gets a usable name). */
const windowsNameUnits=(folder,platform=process.platform)=>platform==='win32'?Math.max(24,259-String(folder).length-1-' (9999)'.length-'.crdownload'.length):Infinity;

/** Windows treats CON, PRN, AUX, NUL, COM1-9, LPT1-9 and CLOCK$ as devices, with or without an extension ("aux.pdf", "NUL.tar.gz"): a file made under such a name opens the device,
 *  and the download fails or is written nowhere. Chromium's own file names put an underscore in front ("_aux.pdf"); so does this. Other systems keep the name. */
const RESERVED_ON_WINDOWS=/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9]|clock\$)(?=\.|$)/i;
const deviceSafe=(name,platform=process.platform)=>platform==='win32'&&RESERVED_ON_WINDOWS.test(name)?'_'+name:name;

/** The extension a copy's number goes in front of. A compressed tar keeps its two parts together ("archive.tar.gz" -> "archive (1).tar.gz", as Chrome names it), not "archive.tar (1).gz", which no archive tool opens as a tar. Chrome's rule: the last part is a common compression suffix and the part before it is a short extension of 1 to 4 characters. */
const COMPRESSION=/^\.(?:gz|xz|bz2|bz|z|zst|lz|lzma)$/i;
function extensionOf(name){
 const last=path.extname(name);
 if(!last||!COMPRESSION.test(last))return last;
 const inner=path.extname(name.slice(0,-last.length));
 return inner.length>=2&&inner.length<=5&&!/\s/.test(inner)?inner+last:last;
}

/** Next free path in the folder: "report.pdf", then "report (1).pdf". taken(path) adds names the caller has handed out but whose file isn't on disk yet. */
function nextFreePath(folder,name,taken=()=>false,platform=process.platform){
 fs.mkdirSync(folder,{recursive:true});
 const safe=deviceSafe(path.basename(String(name||'download')).replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').replace(/[. ]+$/,'')||'download',platform);
 const extension=extensionOf(safe),stem=fitName(extension?safe.slice(0,-extension.length):safe,extension,windowsNameUnits(folder,platform));
 for(let n=0;n<10000;n++){const candidate=path.join(folder,n===0?stem+extension:`${stem} (${n})${extension}`);if(!fs.existsSync(candidate)&&!fs.existsSync(candidate+'.crdownload')&&!taken(candidate))return candidate;}
 throw new Error('No free file name in the download folder.');
}

function createDownloadPreferences({file,defaultFolder}){
 let value={askWhere:false,folder:'',offerFiles:true,offerFilesPrivate:false,lastSaveFolder:'',screenshotFolder:''};/* Beta 14 (D2): the folder the last Save dialog of a save the person started was answered in (never from a private or Tor window): the next one starts there. Not a setting: nothing in Settings changes it. */const listeners=new Set();/* Easy Files (Beta 14): offer recent files when a site asks for one, in normal windows (on) and in private windows (off). */
 // a damaged file is kept aside before the defaults can be saved over it (atomic-file.cjs readJsonFile)
 const saved=require('./atomic-file.cjs').readJsonFile(file,{maxBytes:8191});
 if(saved){if(typeof saved.askWhere==='boolean')value.askWhere=saved.askWhere;if(typeof saved.offerFiles==='boolean')value.offerFiles=saved.offerFiles;if(typeof saved.offerFilesPrivate==='boolean')value.offerFilesPrivate=saved.offerFilesPrivate;if(typeof saved.folder==='string'&&path.isAbsolute(saved.folder))value.folder=saved.folder;if(typeof saved.lastSaveFolder==='string'&&path.isAbsolute(saved.lastSaveFolder))value.lastSaveFolder=saved.lastSaveFolder;if(typeof saved.screenshotFolder==='string'&&path.isAbsolute(saved.screenshotFolder))value.screenshotFolder=saved.screenshotFolder;}
 const folderUsable=folder=>{try{return path.isAbsolute(folder)&&fs.statSync(folder).isDirectory();}catch{return false;}};
 const effectiveFolder=()=>value.folder&&folderUsable(value.folder)?value.folder:defaultFolder;
 function save(){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(value));fs.renameSync(file+'.tmp',file);}
 function get(){return {screenshotFolder:value.screenshotFolder&&folderUsable(value.screenshotFolder)?value.screenshotFolder:'',screenshotFolderMissing:!!value.screenshotFolder&&!folderUsable(value.screenshotFolder),askWhere:value.askWhere,offerFiles:value.offerFiles,offerFilesPrivate:value.offerFilesPrivate,folder:effectiveFolder(),defaultFolder,customFolder:!!value.folder&&folderUsable(value.folder),folderMissing:!!value.folder&&!folderUsable(value.folder)};}
 function set(patch){
  if(patch.askWhere!==undefined){if(typeof patch.askWhere!=='boolean')throw new Error('Choose whether to ask where to save each file.');value.askWhere=patch.askWhere;}
  for(const key of ['offerFiles','offerFilesPrivate'])if(patch[key]!==undefined){if(typeof patch[key]!=='boolean')throw new Error('Choose whether to offer recent files.');value[key]=patch[key];}
  if(patch.folder!==undefined){
   if(patch.folder===null||patch.folder==='')value.folder='';
   else{if(typeof patch.folder!=='string'||patch.folder.length>1024||!folderUsable(patch.folder))throw new Error('Choose an existing folder on this computer.');value.folder=path.resolve(patch.folder);}
  }
  /* Beta 14 (D3): the screenshots folder; empty (null) means "ask each time" */
  if(patch.screenshotFolder!==undefined){
   if(patch.screenshotFolder===null||patch.screenshotFolder==='')value.screenshotFolder='';
   else{if(typeof patch.screenshotFolder!=='string'||patch.screenshotFolder.length>1024||!folderUsable(patch.screenshotFolder))throw new Error('Choose an existing folder on this computer.');value.screenshotFolder=path.resolve(patch.screenshotFolder);}
  }
  save();const next=get();for(const listener of [...listeners])try{listener(next);}catch{/* a listener never stops a save */}return next;
 }
 /** Where the next Save dialog of a save the person started opens: the folder the last one was answered in, while it still exists, else ''. */
 function lastSaveFolder(){return value.lastSaveFolder&&folderUsable(value.lastSaveFolder)?value.lastSaveFolder:'';}
 /** The Save dialog of a save the person started was answered in this folder: the next one starts there (only an existing folder; kept across restarts). */
 function rememberSaveFolder(folder){if(typeof folder!=='string'||!folderUsable(folder))return false;const resolved=path.resolve(folder);if(resolved===value.lastSaveFolder)return true;value.lastSaveFolder=resolved;try{save();}catch{/* a folder that cannot be remembered is only forgotten */}return true;}
 function destination(name,{taken}={}){return nextFreePath(effectiveFolder(),name,taken);}
 /** Easy Files listens for the two switches. Returns the way to stop listening. */function onChange(listener){listeners.add(listener);return()=>listeners.delete(listener);}
 return {get,set,destination,lastSaveFolder,rememberSaveFolder,onChange};
}
module.exports={createDownloadPreferences,fitName,nextFreePath,deviceSafe,windowsNameUnits,extensionOf};
