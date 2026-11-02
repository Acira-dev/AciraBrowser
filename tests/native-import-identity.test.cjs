'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {readProfileIdentity,hexColor,initialOf}=require('../desktop/browser-services/import-profile-identity.cjs');
const {createImporter}=require('../desktop/imports.cjs');

const fakeImage=({empty=false,width=200,height=100}={})=>({createFromPath:file=>({isEmpty:()=>empty,getSize:()=>({width,height}),resize:size=>({toDataURL:()=>`data:image/png;base64,${Buffer.from(`${size.width}x${size.height}`).toString('base64')}`}),toDataURL:()=>`data:image/png;base64,${Buffer.from(`${width}x${height}`).toString('base64')}`,file})});
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'acira-import-identity-'));

test('Chromium signed ARGB integers become #rrggbb; zero means unset',()=>{
 assert.equal(hexColor(-14575885),'#2196f3');          // 0xFF2196F3 stored as a signed int
 assert.equal(hexColor(0xff336699),'#336699');
 assert.equal(hexColor(0),undefined);assert.equal(hexColor('#fff'),undefined);assert.equal(hexColor(1.5),undefined);
});

test('initial comes from the account name, then profile name, then email',()=>{
 assert.equal(initialOf('Åsa Berg','Person 1'),'Å');assert.equal(initialOf(undefined,'work'),'W');assert.equal(initialOf('  ','','4chan@x.test'),'4');assert.equal(initialOf(undefined,undefined,undefined),'?');
});

test('identity prefers the account picture and keeps colour, initial, name and email',()=>{
 const dir=tmp();fs.writeFileSync(path.join(dir,'Google Profile Picture.png'),Buffer.alloc(2000,1));
 const entry={name:'Personal',user_name:'ada@example.test',gaia_name:'Ada Lovelace',gaia_picture_file_name:'Google Profile Picture.png',profile_highlight_color:-14575885,default_avatar_fill_color:-1,default_avatar_stroke_color:-16777216,avatar_icon:'chrome://theme/IDR_PROFILE_AVATAR_26'};
 const identity=readProfileIdentity({entry,location:dir,fallbackName:'Default',nativeImage:fakeImage()});
 assert.equal(identity.email,'ada@example.test');assert.equal(identity.accountName,'Ada Lovelace');assert.equal(identity.initial,'A');assert.equal(identity.color,'#2196f3');assert.equal(identity.strokeColor,'#000000');assert.equal(identity.fillColor,'#ffffff');assert.equal(identity.avatarIndex,26);
 assert.match(identity.picture,/^data:image\/png;base64,/);assert.equal(Buffer.from(identity.picture.split(',')[1],'base64').toString(),'64x32','large pictures are shrunk to 64px on the long side');
 fs.rmSync(dir,{recursive:true,force:true});
});

test('without a picture the profile colour and initial are enough; nothing throws on odd data',()=>{
 const dir=tmp();
 const none=readProfileIdentity({entry:{name:'Work',default_avatar_fill_color:-65536},location:dir,fallbackName:'Profile 1',nativeImage:fakeImage()});
 assert.deepEqual([none.picture,none.color,none.initial],[undefined,'#ff0000','W']);
 for(const entry of [undefined,null,'x',[],{gaia_picture_file_name:'../../secret.png'},{gaia_picture_file_name:'missing.png'},{name:7,user_name:{}}]){
  const result=readProfileIdentity({entry,location:dir,fallbackName:'Default',nativeImage:fakeImage()});assert.equal(result.picture,undefined);assert.ok(result.initial);
 }
 assert.equal(readProfileIdentity({entry:{gaia_picture_file_name:'x.png'},location:dir,fallbackName:'D'}).picture,undefined,'no image toolkit, no picture');
 fs.rmSync(dir,{recursive:true,force:true});
});

test('picture files outside the profile folder, oversized or empty images are ignored',()=>{
 const dir=tmp(),outside=tmp();fs.writeFileSync(path.join(outside,'p.png'),Buffer.alloc(100));fs.writeFileSync(path.join(dir,'big.png'),Buffer.alloc(2*1024*1024));fs.writeFileSync(path.join(dir,'empty.png'),Buffer.alloc(100));
 assert.equal(readProfileIdentity({entry:{gaia_picture_file_name:path.join(outside,'p.png')},location:dir,fallbackName:'D',nativeImage:fakeImage()}).picture,undefined);
 assert.equal(readProfileIdentity({entry:{gaia_picture_file_name:'big.png'},location:dir,fallbackName:'D',nativeImage:fakeImage()}).picture,undefined);
 assert.equal(readProfileIdentity({entry:{gaia_picture_file_name:'empty.png'},location:dir,fallbackName:'D',nativeImage:fakeImage({empty:true})}).picture,undefined);
 fs.rmSync(dir,{recursive:true,force:true});fs.rmSync(outside,{recursive:true,force:true});
});

test('discover lists each Chromium profile with its identity and never exposes the folder',()=>{
 const root=tmp(),profile=path.join(root,'Profile 2');fs.mkdirSync(path.join(root,'Default'));fs.mkdirSync(profile);
 fs.writeFileSync(path.join(root,'Default','Bookmarks'),'{}');fs.writeFileSync(path.join(profile,'Bookmarks'),'{}');fs.writeFileSync(path.join(profile,'Google Profile Picture.png'),Buffer.alloc(500,2));
 fs.writeFileSync(path.join(root,'Local State'),JSON.stringify({profile:{info_cache:{Default:{name:'Personal',user_name:'me@example.test',profile_highlight_color:-14575885},'Profile 2':{name:'Studio',gaia_name:'Grace Hopper',user_name:'grace@example.test',gaia_picture_file_name:'Google Profile Picture.png'}}}}));
 const importer=createImporter({database:{},getState:()=>({}),commit(){},dialog:{},getWindow(){},roots:[['Chrome',root]],nativeImage:fakeImage({width:40,height:40})});
 const sources=importer.discover();assert.equal(sources.length,2);
 const personal=sources.find(s=>s.name==='Personal'),studio=sources.find(s=>s.name==='Studio');
 assert.deepEqual([personal.email,personal.color,personal.initial,personal.picture],['me@example.test','#2196f3','P',undefined]);
 assert.deepEqual([studio.accountName,studio.initial,/^data:image\/png/.test(studio.picture)],['Grace Hopper','G',true]);
 for(const source of sources)assert.equal(JSON.stringify(source).includes(root.replaceAll('\\','\\\\')),false,'the on-disk location never leaves main');
 fs.rmSync(root,{recursive:true,force:true});
});
