'use strict';
const fs=require('node:fs'),path=require('node:path');
const {createStorageCore}=require('./ext-api/storage/sync-core.cjs');

// chrome.storage.sync is unusable from content scripts in this engine ("sync" is not available in this instance of Chrome), while
// extension pages and service workers get Acira's own sync area (ext-api/storage-renderer.cjs). Extensions such as Vimium, SponsorBlock
// and Return YouTube Dislike read their settings through sync from their content scripts and stop working without it.
// For packages Acira itself unpacked (Chrome Web Store installs and updates; never a folder the user chose), one small script is put first in
// every content-script entry that runs in the isolated world. It is generated from the same sync-core as the pages' package: sync is the
// extension's own sync area (one reserved key inside its native local store, Chrome's quotas and errors, hidden from storage.local), the
// content script sees the same data as the rest of the extension, and storage.onChanged reports areaName "sync" for it.
// The same script gives content scripts chrome.extension.inIncognitoContext, which Chrome provides there and this engine does not (Calendly's
// content scripts read it on every page and stopped, so its sidebar never opened). It is false: the script cannot tell a private tab from an
// ordinary one, so in a private tab with "Allow in private tabs" on it says false where Chrome says true.
// Store packages get the current script again at every start (restore in extension-manager.cjs), so installed ones pick up changes here.
const SHIM_NAME='acira-storage-sync-shim.js';
const SHIM_SOURCE=`// Added by Acira: chrome.storage.sync is not available to content scripts in this browser; this is the extension's sync area (extension-shims.cjs).
(function(){try{var core=(${createStorageCore.toString()})();core.installContentScript(self.chrome);}catch(e){}})();
(function(){try{var c=self.chrome;if(!c)return;if(!c.extension)c.extension={};if(c.extension.inIncognitoContext===undefined)c.extension.inIncognitoContext=false;}catch(e){}})();
`;

function readJson(file){return JSON.parse(fs.readFileSync(file,'utf8').replace(/^﻿/,''));}

/** Returns true when the manifest was changed. Idempotent; never touches a package without the storage permission. */
function applyStorageSyncShim(folder){
 const manifestPath=path.join(folder,'manifest.json');let manifest;
 try{manifest=readJson(manifestPath);}catch{return false;}
 const permissions=[...(manifest.permissions||[]),...(manifest.optional_permissions||[])];
 if(!permissions.includes('storage')||!Array.isArray(manifest.content_scripts))return false;
 let changed=false;
 for(const script of manifest.content_scripts){
  if(!script||script.world==='MAIN'||!Array.isArray(script.js)||!script.js.length||script.js.includes(SHIM_NAME))continue;
  script.js.unshift(SHIM_NAME);changed=true;
 }
 if(!changed){
  // A package shimmed by an older Acira (storage.sync = storage.local) gets the current script: sync is now its own area.
  const file=path.join(folder,SHIM_NAME);let current=null;
  try{current=fs.readFileSync(file,'utf8');}catch{return false;}
  if(current===SHIM_SOURCE)return false;
  fs.writeFileSync(file,SHIM_SOURCE);return true;
 }
 fs.writeFileSync(path.join(folder,SHIM_NAME),SHIM_SOURCE);
 fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2));
 return true;
}

module.exports={applyStorageSyncShim,SHIM_NAME,SHIM_SOURCE};
