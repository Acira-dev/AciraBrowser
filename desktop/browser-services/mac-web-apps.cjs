'use strict';
const fs=require('node:fs'),path=require('node:path');
const quote=value=>"'"+String(value).replace(/'/g,"'\\''")+"'";
const xml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const validId=id=>/^[a-f0-9]{20}$/.test(id);
function ownsShortcut(root,target,id){
 try{if(!validId(id)||path.dirname(path.resolve(target))!==path.resolve(root)||!target.endsWith('.app'))return false;const st=fs.lstatSync(target);if(!st.isDirectory()||st.isSymbolicLink())return false;const record=JSON.parse(fs.readFileSync(path.join(target,'Contents/Resources/acira-web-app.json'),'utf8'));return record.schema===1&&record.id===id;}catch{return false;}
}
function removeShortcut(root,target,id){if(!ownsShortcut(root,target,id))return false;fs.rmSync(target,{recursive:true});return true;}
function writeShortcut({root,item,executable,packaged,mainFile,testProfile}){
 if(!validId(item.id)||!path.isAbsolute(executable))throw Error('Invalid Mac web app identity.');
 fs.mkdirSync(root,{recursive:true});
 const label=(item.name.replace(/[/:\0-\x1f\x7f]/g,'').replace(/^\.+|[. ]+$/g,'').trim()||'Acira app').slice(0,60);
 let target=path.join(root,label+'.app');for(let n=2;fs.existsSync(target)&&!ownsShortcut(root,target,item.id);n++){if(n>100)throw Error('No available app name.');target=path.join(root,label+' ('+n+').app');}
 const stage=fs.mkdtempSync(path.join(root,'.acira-web-app-')),bundle=path.join(stage,path.basename(target)),contents=path.join(bundle,'Contents'),resources=path.join(contents,'Resources');
 try{
  fs.mkdirSync(path.join(contents,'MacOS'),{recursive:true});fs.mkdirSync(resources);
  const browserBundle=path.dirname(path.dirname(path.dirname(executable)));
  if(packaged&&!browserBundle.endsWith('.app'))throw Error('The Acira browser bundle could not be found.');
  const command=packaged?['/usr/bin/open','-n','-a',browserBundle,'--args','--acira-app='+item.id]:[executable,mainFile,'--acira-app='+item.id];
  if(!packaged&&(!mainFile||!path.isAbsolute(mainFile)))throw Error('Development launcher requires its exact main file.');
  const env=testProfile?'ACIRA_BROWSER_TEST_DATA='+quote(testProfile)+' ':'';
  fs.writeFileSync(path.join(contents,'MacOS','AciraWebApp'),'#!/bin/sh\n'+(env?'export '+env.trim()+'\n':'')+'exec '+command.map(quote).join(' ')+'\n',{mode:0o755});
  let icon=false;if(item.iconPng)try{const png=fs.readFileSync(item.iconPng),head=Buffer.alloc(16);head.write('icns',0);head.writeUInt32BE(png.length+16,4);head.write('ic08',8);head.writeUInt32BE(png.length+8,12);fs.writeFileSync(path.join(resources,'WebApp.icns'),Buffer.concat([head,png]));icon=true;}catch{}
  const values={CFBundleExecutable:'AciraWebApp',CFBundleIdentifier:'computer.acira.webapp.'+item.id,CFBundleName:item.name,CFBundleDisplayName:item.name,CFBundlePackageType:'APPL',CFBundleVersion:'1',...(icon?{CFBundleIconFile:'WebApp.icns'}:{})};
  fs.writeFileSync(path.join(contents,'Info.plist'),'<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>'+Object.entries(values).map(([key,value])=>'<key>'+key+'</key><string>'+xml(value)+'</string>').join('')+'<key>LSUIElement</key><true/></dict></plist>\n');
  fs.writeFileSync(path.join(resources,'acira-web-app.json'),JSON.stringify({schema:1,id:item.id}));
  const previous=path.join(stage,'previous.app');let moved=false;
  if(fs.existsSync(target)){fs.renameSync(target,previous);moved=true;}
  try{fs.renameSync(bundle,target);}catch(error){if(moved)fs.renameSync(previous,target);throw error;}
  return target;
 }finally{fs.rmSync(stage,{recursive:true,force:true});}
}
module.exports={writeShortcut,removeShortcut,ownsShortcut};
