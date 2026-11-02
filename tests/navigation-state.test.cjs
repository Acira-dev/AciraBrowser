'use strict';
// A page whose body cannot be decoded (Content-Encoding: gzip on data that is not gzip) commits and then fails. The failure was dropped as "after
// the commit", so the tab showed its address over a blank page with no error. Other late failures keep the page that was already shown.
const test=require('node:test'),assert=require('node:assert/strict');
const {NavigationState}=require('../desktop/navigation-state.cjs');

test('a failure before the commit is the page failing',()=>{
 const state=new NavigationState();state.start('https://a.example/x');
 assert.equal(state.fail('https://a.example/x',-105,true),true);assert.equal(state.phase,'failed');
});

test('a body that cannot be decoded fails the page even though it committed first',()=>{
 const state=new NavigationState();state.start('https://a.example/gz');state.commit('https://a.example/gz');
 assert.equal(state.fail('https://a.example/gz',-330,true),true);assert.equal(state.phase,'failed');
});

test('other failures after the commit keep the page that was shown',()=>{
 for(const code of [-324,-354,-101,-100]){
  const state=new NavigationState();state.start('https://a.example/p');state.commit('https://a.example/p');
  assert.equal(state.fail('https://a.example/p',code,true),false,String(code));assert.equal(state.phase,'committed');
 }
});

test('a late decoding failure of another address or another frame is ignored; cancelled loads never fail',()=>{
 const state=new NavigationState();state.start('https://a.example/new');state.commit('https://a.example/new');
 assert.equal(state.fail('https://a.example/old',-330,true),false);
 assert.equal(state.fail('https://a.example/new',-330,false),false);
 assert.equal(state.fail('https://a.example/new',-3,true),false);
});

test('main names the failure Electron reports without a name',()=>{
 const main=require('node:fs').readFileSync(require('node:path').join(__dirname,'../desktop/main.cjs'),'utf8');
 assert.ok(main.includes("if(code===-330&&!description)description='ERR_CONTENT_DECODING_FAILED'"));
});
