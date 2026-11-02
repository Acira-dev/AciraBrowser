'use strict';
const {randomUUID}=require('node:crypto');
const DOCUMENT=Symbol.for('acira.native.document-identity-v1');
const validKey=value=>typeof value==='string'&&/^native-document:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
function record(wc){
 if(!wc||typeof wc.isDestroyed!=='function'||wc.isDestroyed()||!wc.session||typeof wc.on!=='function'||typeof wc.once!=='function')throw new Error('Native document identity is unavailable.');
 if(!wc[DOCUMENT]){
  const value={version:1,session:wc.session,key:'native-document:'+randomUUID(),generation:0,lifetime:Object.freeze({}),observers:new Set(),closed:false};
  Object.defineProperty(wc,DOCUMENT,{value});
  wc.on('did-start-navigation',(event,_url,_inPlace,isMainFrame)=>{
   if((event?.isMainFrame??isMainFrame)===false||value.closed)return;
   if(value.generation>=Number.MAX_SAFE_INTEGER){value.closed=true;value.key=null;value.session=null;value.observers.clear();return;}
   value.generation++;value.key='native-document:'+randomUUID();
   for(const observer of [...value.observers])try{const result=observer(value.key);result?.catch?.(()=>{});}catch{}
  });
  wc.once('destroyed',()=>{value.closed=true;value.key=null;value.session=null;value.observers.clear();});
 }
 const value=wc[DOCUMENT];if(value.version!==1||value.closed||value.session!==wc.session||!validKey(value.key)||!Number.isSafeInteger(value.generation)||value.generation<0||!value.lifetime||!(value.observers instanceof Set))throw new Error('Native document identity is invalid or no longer current.');return value;
}
/** The same native lifetime/epoch is used by readers and transient trusted UI snapshots. */
function getNativeDocumentIdentity(wc){const value=record(wc);return Object.freeze({documentKey:value.key,generation:value.generation,lifetime:value.lifetime,session:value.session});}
const getNativeDocumentKey=wc=>getNativeDocumentIdentity(wc).documentKey;
function observeNativeDocumentKey(wc,observer){if(typeof observer!=='function')throw new Error('A native document observer is required.');const value=record(wc);value.observers.add(observer);return()=>value.observers.delete(observer);}
module.exports={getNativeDocumentIdentity,getNativeDocumentKey,observeNativeDocumentKey};
