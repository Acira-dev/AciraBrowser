'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),path=require('node:path'),fs=require('node:fs');
const electron=(()=>{try{const value=require('electron');return typeof value==='string'&&fs.existsSync(value)?value:null;}catch{return null;}})();
let result=null,problem=null;
if(electron){const run=spawnSync(electron,[path.join(__dirname,'fixtures','tab-icons','run.cjs')],{encoding:'utf8',timeout:90000,env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,ELECTRON_ENABLE_LOGGING:'0'}});const line=(run.stdout||'').split(/\r?\n/).find(text=>text.startsWith('RESULT '));if(line)result=JSON.parse(line.slice(7));else problem=((run.stdout||'')+(run.stderr||'')).slice(0,500)||'no result';}
const skip=!electron?'electron binary not available':false;
test('tab icons come through the tab session as data URLs; non-images, huge files and failures are empty',{skip},()=>{
 assert.ok(result,problem);assert.match(result.png,/^data:image\/png;base64,/);for(const key of ['html','huge','missing','badScheme','data','dead'])assert.equal(result[key],'',key);
 assert.match(result.redirect,/^data:image\/png/,'redirects are followed');assert.equal(result.cachedNoRequest,true,'a saved profile caches by address');assert.equal(result.privateNotKept,true,'an in-memory (private) session is fetched again, never kept');assert.equal(result.cookieSent,false,'no cookies are sent for an icon');
});
test('main applies it for every window and switches DNS prefetching off for all renderers',()=>{
 const main=fs.readFileSync(path.join(__dirname,'..','desktop','main.cjs'),'utf8');
 assert.match(main,/appendSwitch\('blink-settings','dnsPrefetchingEnabled=false'\)/);assert.match(main,/tab-icons\.cjs/);assert.doesNotMatch(main,/else send\(\{favicon:icon\}\)/);
});
