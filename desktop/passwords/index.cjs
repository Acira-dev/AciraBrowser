'use strict';
const {tr}=require('./text.cjs');
// One passwords service per process (every window shares the vault, the unlock window and the import token).
const {createPasswords}=require('./passwords.cjs');
const {safeStorageKeys}=require('./vault.cjs');
const {createGate,platformVerifier,testSwitchesAllowed}=require('./gate.cjs');
let shared=null;

/**
 * What a copied password carries on Windows so clipboard history (Win+V), the cloud clipboard and clipboard monitors skip it, as KeePass
 * and 1Password do. Written in the same atomic clipboard.write as the text (a second write would replace it). Other platforms get text only.
 */
const WINDOWS_PRIVATE_FORMATS=['ExcludeClipboardContentFromMonitorProcessing','CanIncludeInClipboardHistory','CanUploadToCloudClipboard'];
function clipboardPort({clipboard,ClipboardItem,platform=process.platform}){
 return {
  writeText:text=>clipboard.writeText(text),readText:()=>clipboard.readText(),clear:()=>clipboard.clear(),
  async writeSecret(text){
   if(platform!=='win32'||typeof ClipboardItem!=='function')return clipboard.writeText(text);
   const items={'text/plain':text};
   for(const name of WINDOWS_PRIVATE_FORMATS)items[`electron application/osclipboard;format="${name}"`]=new Blob([new Uint8Array(4)]);// DWORD 0
   try{await clipboard.write([new ClipboardItem(items)]);}catch{await clipboard.writeText(text);}// never lose the copy over a format
  },
 };
}

/** Native pickers and confirmations. In an unpackaged run inside an isolated test profile only, ACIRA_PASSWORDS_TEST_FILES (JSON {open,save,confirm}) stands in for them. */
function dialogs({dialog,appDialog,env,packaged}){
 const stub=testSwitchesAllowed({env,packaged})&&env.ACIRA_PASSWORDS_TEST_FILES?(()=>{try{return JSON.parse(env.ACIRA_PASSWORDS_TEST_FILES);}catch{return null;}})():null;
 return {
  confirm:async(window,{message,detail,confirmLabel,destructive})=>{
   if(stub)return stub.confirm!==false;
   const result=await(appDialog||dialog).showMessageBox(window,{type:destructive?'warning':'question',title:tr('pw.dialog.title','Passwords'),message,detail,buttons:[tr('pw.dialog.cancel','Cancel'),confirmLabel],defaultId:0,cancelId:0});
   return result.response===1;
  },
  pickOpen:async window=>{
   if(stub)return stub.open||null;
   const result=await dialog.showOpenDialog(window,{title:tr('pw.dialog.importTitle','Import passwords'),properties:['openFile'],filters:[{name:tr('pw.dialog.filterFile','Passwords file'),extensions:['csv','txt']},{name:tr('pw.dialog.filterAll','All files'),extensions:['*']}]});
   return result.canceled||!result.filePaths[0]?null:result.filePaths[0];
  },
  pickSave:async window=>{
   if(stub)return stub.save||null;
   const result=await dialog.showSaveDialog(window,{title:tr('pw.dialog.exportDialogTitle','Export passwords'),defaultPath:'Acira Passwords.csv',filters:[{name:'CSV',extensions:['csv']}]});
   return result.canceled||!result.filePath?null:result.filePath;
  },
 };
}
/**
 * Test switch ACIRA_MASKS_TEST_ORIGINS (JSON {"simplelogin":"http://127.0.0.1:PORT",...}): the mask service talks to a local stand-in instead of the
 * real service. Like the other test switches it is read only in an unpackaged run inside an isolated test profile, and it only takes plain
 * loopback origins; an installed app ignores it whatever the environment says.
 */
function maskTestOrigins({env,packaged}){
 if(!testSwitchesAllowed({env,packaged})||!env.ACIRA_MASKS_TEST_ORIGINS)return {};
 try{
  const parsed=JSON.parse(env.ACIRA_MASKS_TEST_ORIGINS),out={};
  for(const [id,origin] of Object.entries(parsed||{})){const url=new URL(String(origin));if(url.protocol==='http:'&&(url.hostname==='127.0.0.1'||url.hostname==='localhost')&&url.pathname==='/'&&!url.username&&!url.password)out[id]=url.origin;}
  return out;
 }catch{return {};}
}
/** `packaged` is Electron's app.isPackaged; leaving it out keeps every test switch off. */
function sharedPasswords({dir,safeStorage,clipboard,ClipboardItem,dialog,appDialog,shell,systemPreferences,maskFetch=null,env=process.env,packaged}){
 return shared??=createPasswords({dir,keys:safeStorageKeys(safeStorage),gate:createGate({verify:platformVerifier({env,packaged,systemPreferences})}),clipboard:clipboardPort({clipboard,ClipboardItem}),trash:typeof shell?.trashItem==='function'?file=>shell.trashItem(file):null,maskFetch,maskOrigins:maskTestOrigins({env,packaged}),...dialogs({dialog,appDialog,env,packaged})});
}
module.exports={sharedPasswords,dialogs,clipboardPort,maskTestOrigins,WINDOWS_PRIVATE_FORMATS};
