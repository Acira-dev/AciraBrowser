'use strict';
const fs=require('node:fs/promises'),{createReadStream}=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const {publicFeedConfig}=require('../update-feed.cjs');
const FEED={...publicFeedConfig(),updaterCacheDirName:'acira-browser-updater'};
const yaml=values=>Object.entries(values).map(([key,value])=>key+': '+JSON.stringify(value)).join('\n')+'\n';
async function writeMacUpdateConfig(resources,{feedURL=process.env.ACIRA_MAC_UPDATE_FEED_URL||process.env.ACIRA_UPDATE_FEED_URL}={}){await fs.writeFile(path.join(resources,'app-update.yml'),yaml({...publicFeedConfig(feedURL),updaterCacheDirName:FEED.updaterCacheDirName}));}
async function writeMacUpdateFeed({output,version,zip,arch,artifacts,releaseDate=new Date().toISOString()}){
 if(!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version)||(!artifacts&&!['arm64','x64'].includes(arch)))throw Error('Invalid Mac update identity.');
 const selected=artifacts||[{zip,arch}],seen=new Set(),files=[];
 if(!Array.isArray(selected)||!selected.length||selected.length>2)throw Error('A Mac feed needs one artifact per supported architecture.');
 for(const item of selected){
  const file=path.basename(item.zip);if(!['arm64','x64'].includes(item.arch)||seen.has(item.arch)||path.dirname(path.resolve(item.zip))!==path.resolve(output)||!file.includes('-'+item.arch+'-')||!file.endsWith('.zip'))throw Error('Mac update ZIP must be a unique architecture-labelled artifact in the output directory.');
  seen.add(item.arch);const size=(await fs.stat(item.zip)).size,hash=createHash('sha512');for await(const bytes of createReadStream(item.zip))hash.update(bytes);files.push({url:file,sha512:hash.digest('base64'),size});
 }
 const info={version,files,path:files[0].url,sha512:files[0].sha512,releaseDate,minimumSystemVersion:'22.0.0'};
 // JSON is a YAML subset and is read by the same electron-updater YAML parser.
 const name=(version.includes('-')?'beta':'latest')+'-mac.yml',target=path.join(output,name);
 await fs.writeFile(target,JSON.stringify(info,null,2)+'\n');return {file:target,zip:zip||selected[0].zip,sha512:files[0].sha512,size:files[0].size,channel:version.includes('-')?'beta':'stable',arch,architectures:[...seen]};
}
module.exports={FEED,publicFeedConfig,writeMacUpdateConfig,writeMacUpdateFeed};
