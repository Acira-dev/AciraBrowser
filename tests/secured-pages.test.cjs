'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const {createSecuredPages} = require('../desktop/secured-pages.cjs');
const turn = () => new Promise(resolve => setImmediate(resolve));
function fixture(overrides = {}) {
  const events = [], wc = {closed:false, isDestroyed(){return this.closed;}, isAudioMuted:()=>false, setAudioMuted:on=>events.push(['muted',on]), close(){this.closed=true;events.push('closed');}};
  const entry = {privacy:'secured', securedWorkspaceId:'s', loadedURL:'https://private.test', view:{webContents:wc,setVisible:on=>events.push(['visible',on])}};
  const pages = new Map([['t',entry]]);
  const store = createSecuredPages({pages,detach:()=>events.push('detached'),attach:()=>events.push('attached'),conceal:()=>events.push('concealed'),suspend:async()=>events.push('frozen'),resume:async()=>events.push('resumed'),ready:()=>events.push('ready'),...overrides});
  const locked = {tabs:[],workspaces:[{id:'s',secured:true}]};
  const opened = {tabs:[{id:'t',privacy:'secured',workspaceId:'s',url:entry.loadedURL}],workspaces:[{id:'s',secured:true,unlocked:true}]};
  return {store,pages,entry,events,wc,locked,opened};
}
test('locking detaches and removes routing before suspending; unlock returns the identical live document',async()=>{
  const f=fixture();f.store.reconcile(f.locked);
  assert.equal(f.pages.size,0);assert.equal(f.wc.closed,false);assert.equal(f.entry.securedLocked,true);
  assert.deepEqual(f.events.slice(0,3),['concealed',['visible',false],'detached']);
  await turn();assert.ok(f.events.includes('frozen'));
  f.store.reconcile(f.opened);assert.equal(f.pages.get('t'),f.entry);assert.equal(f.entry.securedRestoring,true);
  await turn();assert.equal(f.entry.securedLocked,false);assert.deepEqual(f.events.slice(-2),['resumed','ready']);
  f.store.dispose();
});
test('unlock during suspension cannot show the page early; a relock invalidates that resume',async()=>{
  let complete;const f=fixture({suspend:()=>new Promise(resolve=>{complete=resolve;})});
  f.store.reconcile(f.locked);await turn();f.store.reconcile(f.opened);f.store.reconcile(f.locked);
  complete();await turn();assert.equal(f.pages.size,0);assert.equal(f.entry.securedLocked,true);assert.ok(!f.events.includes('ready'));
  f.store.dispose();assert.equal(f.wc.closed,true);
});
test('workspace removal and window disposal close retained documents',async()=>{
  for(const remove of [true,false]){const f=fixture();f.store.reconcile(f.locked);await turn();if(remove)f.store.reconcile({tabs:[],workspaces:[]});else f.store.dispose();assert.equal(f.wc.closed,true);}
});
test('a changed restored URL cannot receive a different retained document; captures close through normal removal',()=>{
  const f=fixture();f.store.reconcile(f.locked);f.opened.tabs[0].url='https://changed.test';f.store.reconcile(f.opened);assert.equal(f.pages.size,0);assert.equal(f.wc.closed,true);
  const capture=fixture();capture.entry.capture=['microphone'];capture.store.reconcile(capture.locked);assert.equal(capture.pages.size,1,'the main removal closes a capturing page');assert.ok(capture.events.includes('concealed'));
});
