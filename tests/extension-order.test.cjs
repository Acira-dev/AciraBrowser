'use strict';
// The toolbar shows the first six pinned extensions, in the order the list gives them. Electron lists extensions by id, so which ones the toolbar showed
// (and which went behind the extensions panel) was an accident of the ids, and a Reload or an Update put the extension last in the saved list.
// The list is in the order the extensions were added, and Reload / Update / Enable keep an extension's place.
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),os=require('node:os'),{createHash}=require('node:crypto');
const {createExtensionManager}=require('../desktop/browser-services/extension-manager.cjs');

// ids in the order they were added (not alphabetical): Electron's getAllExtensions() answers them by id
const ADDED=['nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','mmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmm','cccccccccccccccccccccccccccccccc'];
const manifestOf=name=>({manifest_version:3,name,version:'1.0',permissions:['storage']});

function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acira-ext-order-')),registryPath=path.join(dir,'extensions.json'),root=path.join(dir,'extension-packages',createHash('sha256').update('p').digest('hex').slice(0,8));
 const entries=ADDED.map((id,at)=>{const pkg=path.join(root,id,'v1');fs.mkdirSync(pkg,{recursive:true});fs.writeFileSync(path.join(pkg,'manifest.json'),JSON.stringify(manifestOf('Ext '+at)));
  return {id,profileId:'p',path:pkg,name:'Ext '+at,version:'1.0',permissions:['storage'],enabled:true,pinned:true,source:'Chrome Web Store',packageHash:'h'+at};});
 fs.writeFileSync(registryPath,JSON.stringify({version:2,entries}));
 const make=(id)=>({id,name:'Ext '+ADDED.indexOf(id),version:'1.0',manifest:manifestOf('Ext '+ADDED.indexOf(id))});
 let loaded=ADDED.map(make).sort((a,b)=>a.id<b.id?-1:1);
 const api={getAllExtensions:()=>loaded,loadExtension:async folder=>{const entry=entries.find(e=>folder.startsWith(path.dirname(e.path)));const again=make(entry.id);loaded=[...loaded,again].sort((a,b)=>a.id<b.id?-1:1);return again;},removeExtension:id=>{loaded=loaded.filter(e=>e.id!==id);}};
 const session={extensions:api,serviceWorkers:{getAllRunning:()=>({})}};
 const dialog={showMessageBox:async()=>({response:1})};
 const manager=createExtensionManager({getSession:()=>session,getProfiles:()=>[{id:'p',name:'Personal',partition:'persist:p'}],getWindow:()=>null,dialog,registryPath,createRuntime:()=>({})});
 return {dir,registryPath,manager,saved:()=>JSON.parse(fs.readFileSync(registryPath,'utf8')).entries.map(e=>e.id)};
}

test('the extension list is in the order the extensions were added, not Electron\'s order by id',()=>{
 const f=fixture();
 try{assert.deepEqual(f.manager.list('p').extensions.map(e=>e.id),ADDED);}
 finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});

test('Reload keeps the extension\'s place in the saved list and in the list the toolbar reads',async()=>{
 const f=fixture();
 try{
  for(const id of [ADDED[0],ADDED[2]]){
   const result=await f.manager.command({type:'reload',profileId:'p',extensionId:id});
   assert.equal(result.error,undefined);
   assert.deepEqual(f.saved(),ADDED,'saved order after reloading '+id);
   assert.deepEqual(result.extensions.map(e=>e.id),ADDED,'listed order after reloading '+id);
  }
 }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});

test('the toolbar puts its buttons in the list\'s order, whatever order the engine created them in',()=>{
 const source=fs.readFileSync(path.join(__dirname,'..','src','components','BrowserExtensionActions.tsx'),'utf8');
 assert.match(source,/rank=new Map\(target\.pinnedIds\.map\(/,'a rank per extension from the list');
 assert.match(source,/button\.style\.order!==order\)button\.style\.order=order/,'written to the button only when it differs');
});
