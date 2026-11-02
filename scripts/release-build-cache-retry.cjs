'use strict';
const path=require('node:path');
function createCacheRename(rename,cache,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))){
 const prefix=path.resolve(cache)+path.sep;
 return async(from,to)=>{const source=path.resolve(String(from)),target=path.resolve(String(to)),scoped=source.startsWith(prefix)&&target.startsWith(prefix)&&source.endsWith('.tmp')&&target===source.slice(0,-4)&&path.dirname(source)===path.dirname(target);for(let attempt=0;;attempt++){try{return await rename(from,to);}catch(error){if(!scoped||!['EPERM','EBUSY'].includes(error.code)||attempt>=24)throw error;await wait(500);}}};
}
if(process.env.ACIRA_BUILD_CACHE_RENAME_RETRY==='1'&&process.env.ELECTRON_BUILDER_CACHE){const fs=require('node:fs/promises');fs.rename=createCacheRename(fs.rename.bind(fs),process.env.ELECTRON_BUILDER_CACHE);}
module.exports={createCacheRename};
