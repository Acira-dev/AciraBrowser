'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{getNativeDocumentIdentity,getNativeDocumentKey,observeNativeDocumentKey}=require('../desktop/browser-services/native-document-key.cjs');
function page(session={}){let dead=false;const wc=Object.assign(new EventEmitter(),{session,isDestroyed:()=>dead});return {wc,navigate:(main=true)=>wc.emit('did-start-navigation',{isMainFrame:main},'https://same.example/',false,main),destroy:()=>{dead=true;wc.emit('destroyed');}};}
test('one native WC authority is stable across consumers; separate native contents never share a document key',()=>{
 const a=page(),b=page(a.wc.session),first=getNativeDocumentIdentity(a.wc);assert.equal(getNativeDocumentKey(a.wc),first.documentKey);assert.notEqual(getNativeDocumentKey(b.wc),first.documentKey);assert.equal(a.wc.listenerCount('did-start-navigation'),1);const modulePath=require.resolve('../desktop/browser-services/native-document-key.cjs'),original=require.cache[modulePath];delete require.cache[modulePath];const reloaded=require(modulePath);require.cache[modulePath]=original;assert.equal(reloaded.getNativeDocumentKey(a.wc),first.documentKey);assert.equal(reloaded.getNativeDocumentIdentity(a.wc).lifetime,first.lifetime);assert.equal(a.wc.listenerCount('did-start-navigation'),1);assert.equal(Object.keys(a.wc).some(key=>key.includes('document-identity')),false);
});
test('same-URL main navigation advances both shared generation and never-reused key; child frames leave them unchanged',()=>{
 const a=page(),first=getNativeDocumentIdentity(a.wc);a.navigate(false);assert.equal(getNativeDocumentKey(a.wc),first.documentKey);a.navigate();const next=getNativeDocumentIdentity(a.wc);assert.equal(next.generation,first.generation+1);assert.notEqual(next.documentKey,first.documentKey);assert.equal(next.lifetime,first.lifetime);a.navigate();const third=getNativeDocumentIdentity(a.wc);assert.equal(third.generation,first.generation+2);assert.notEqual(third.documentKey,next.documentKey);assert.notEqual(third.documentKey,first.documentKey);
});
test('trusted snapshot observers read the already-advanced authority, tolerate other observer failure and unsubscribe idempotently',()=>{
 const a=page(),seen=[];observeNativeDocumentKey(a.wc,()=>{throw new Error('fixture subscriber failure');});const stop=observeNativeDocumentKey(a.wc,key=>seen.push({key,current:getNativeDocumentKey(a.wc)}));a.navigate();assert.equal(seen.length,1);assert.equal(seen[0].key,seen[0].current);stop();stop();a.navigate();assert.equal(seen.length,1);
});
test('native destruction clears identity and observers rather than reviving a private document',()=>{
 const a=page();let observed=0;observeNativeDocumentKey(a.wc,()=>observed++);a.destroy();assert.throws(()=>getNativeDocumentKey(a.wc),/unavailable/);a.navigate();assert.equal(observed,0);const state=a.wc[Symbol.for('acira.native.document-identity-v1')];assert.equal(state.key,null);assert.equal(state.session,null);assert.equal(state.observers.size,0);
});
test('unknown native session lifetime or corrupted authority never becomes a new trusted token',()=>{
 const a=page();getNativeDocumentKey(a.wc);a.wc.session={};assert.throws(()=>getNativeDocumentKey(a.wc),/invalid/);const b=page();Object.defineProperty(b.wc,Symbol.for('acira.native.document-identity-v1'),{value:{version:99}});assert.throws(()=>getNativeDocumentIdentity(b.wc),/invalid/);assert.throws(()=>getNativeDocumentKey({isDestroyed:()=>false}),/unavailable/);
});
