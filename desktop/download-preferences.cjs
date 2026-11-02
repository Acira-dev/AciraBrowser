'use strict';
// Where downloads go. Default matches other browsers: save straight into the Downloads folder (never overwriting,
// never running anything); the person can choose another folder or ask for a Save dialog every time.
const fs=require('node:fs'),path=require('node:path');

/** A file name is at most 255 bytes, and the download also needs room for " (9999)" and Chromium's ".crdownload": a longer name made the download fail at once. */
const NAME_BYTES=255-Buffer.byteLength(' (9999)')-Buffer.byteLength('.crdownload');
function fitName(stem,extension){
 const room=Math.max(1,NAME_BYTES-Buffer.byteLength(extension));let kept='';
 for(const character of stem){if(Buffer.byteLength(kept+character)>room)break;kept+=character;}
 return kept||'download';
}

function createDownloadPreferences({file,defaultFolder}){
 let value={askWhere:false,folder:''};
 try{if(fs.statSync(file).size<8192){const saved=JSON.parse(fs.readFileSync(file,'utf8'));if(typeof saved.askWhere==='boolean')value.askWhere=saved.askWhere;if(typeof saved.folder==='string'&&path.isAbsolute(saved.folder))value.folder=saved.folder;}}catch{}
 const folderUsable=folder=>{try{return path.isAbsolute(folder)&&fs.statSync(folder).isDirectory();}catch{return false;}};
 const effectiveFolder=()=>value.folder&&folderUsable(value.folder)?value.folder:defaultFolder;
 function save(){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(value));fs.renameSync(file+'.tmp',file);}
 function get(){return {askWhere:value.askWhere,folder:effectiveFolder(),defaultFolder,customFolder:!!value.folder&&folderUsable(value.folder),folderMissing:!!value.folder&&!folderUsable(value.folder)};}
 function set(patch){
  if(patch.askWhere!==undefined){if(typeof patch.askWhere!=='boolean')throw new Error('Choose whether to ask where to save each file.');value.askWhere=patch.askWhere;}
  if(patch.folder!==undefined){
   if(patch.folder===null||patch.folder==='')value.folder='';
   else{if(typeof patch.folder!=='string'||patch.folder.length>1024||!folderUsable(patch.folder))throw new Error('Choose an existing folder on this computer.');value.folder=path.resolve(patch.folder);}
  }
  save();return get();
 }
 /** Next free path in the folder: "report.pdf", then "report (1).pdf". */
 function destination(name){
  const folder=effectiveFolder();fs.mkdirSync(folder,{recursive:true});
  const safe=path.basename(String(name||'download')).replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').replace(/[. ]+$/,'')||'download';
  const extension=path.extname(safe),stem=fitName(extension?safe.slice(0,-extension.length):safe,extension);
  for(let n=0;n<10000;n++){const candidate=path.join(folder,n===0?stem+extension:`${stem} (${n})${extension}`);if(!fs.existsSync(candidate)&&!fs.existsSync(candidate+'.crdownload'))return candidate;}
  throw new Error('No free file name in the download folder.');
 }
 return {get,set,destination};
}
module.exports={createDownloadPreferences,fitName};
