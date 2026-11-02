const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');
const {writeShortcut,removeShortcut,ownsShortcut}=require('../desktop/browser-services/mac-web-apps.cjs');
test('Mac web-app launcher preserves its exact app ID and profile, treats hostile titles/paths as data, and has a valid native plist',t=>{
 if(process.platform==='win32')return t.skip('POSIX launcher');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'acira-web-launcher-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const apps=path.join(root,'Applications'),out=path.join(root,'reply.json'),entry=path.join(root,"entry '$; .cjs");
 fs.writeFileSync(entry,`require('node:fs').writeFileSync(${JSON.stringify(out)},JSON.stringify({args:process.argv.slice(2),profile:process.env.ACIRA_BROWSER_TEST_DATA}));`);
 const item={id:'0123456789abcdef0123',name:"Own '& <app> $(touch SHOULD_NOT_EXIST)"},profile=path.join(root,"profile ' safe");
 const wrapper=writeShortcut({root:apps,item,executable:process.execPath,mainFile:entry,packaged:false,testProfile:profile});
 if(process.platform==='darwin')execFileSync('/usr/bin/plutil',['-lint',path.join(wrapper,'Contents/Info.plist')]);
 execFileSync('/bin/sh',[path.join(wrapper,'Contents/MacOS/AciraWebApp')]);assert.deepEqual(JSON.parse(fs.readFileSync(out,'utf8')),{args:['--acira-app='+item.id],profile});assert.equal(fs.existsSync('SHOULD_NOT_EXIST'),false);assert(ownsShortcut(apps,wrapper,item.id));
 assert.equal(removeShortcut(root,wrapper,item.id),false,'outside-root removal is refused');assert.equal(removeShortcut(apps,wrapper,'f'.repeat(20)),false,'another app identity is refused');assert.equal(removeShortcut(apps,wrapper,item.id),true);assert.equal(fs.existsSync(wrapper),false);
});
test('a colliding user application survives install and a failed replacement restores the previous launcher',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'acira-web-rollback-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const unowned=path.join(root,'Site.app');fs.mkdirSync(unowned);fs.writeFileSync(path.join(unowned,'personal.txt'),'keep');
 const options={root,item:{id:'a'.repeat(20),name:'Site'},executable:'/owned/Acira Browser.app/Contents/MacOS/AciraBrowser',packaged:true};const wrapper=writeShortcut(options);assert.equal(path.basename(wrapper),'Site (2).app');assert.equal(fs.readFileSync(path.join(unowned,'personal.txt'),'utf8'),'keep');
 const before=fs.readFileSync(path.join(wrapper,'Contents/MacOS/AciraWebApp'),'utf8'),rename=fs.renameSync;
 fs.renameSync=function(from,to){if(from!==wrapper&&to===wrapper&&!from.endsWith('previous.app'))throw Error('Owned replacement failure');return rename(from,to)};
 try{assert.throws(()=>writeShortcut(options),/Owned replacement failure/);}finally{fs.renameSync=rename;}
 assert.equal(fs.readFileSync(path.join(wrapper,'Contents/MacOS/AciraWebApp'),'utf8'),before);assert.equal(fs.readFileSync(path.join(unowned,'personal.txt'),'utf8'),'keep');
});
