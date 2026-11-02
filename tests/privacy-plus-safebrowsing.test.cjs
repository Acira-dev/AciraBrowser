'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createSafeBrowsingGate,warningPage}=require('../desktop/browser-services/safe-browsing-gate.cjs');
const decode=url=>decodeURIComponent(url.replace(/^data:text\/html;charset=utf-8,/,''));
test('Safe Browsing gate: silent without a key, warns once per flagged address, lets the user continue, fails open',async()=>{
 const shown=[];let state='off-no-key',calls=0,verdict={safe:true};
 const gate=createSafeBrowsingGate({safeBrowsing:{status:()=>({state}),checkUrl:async()=>{calls++;if(verdict==='throw')throw new Error('x');return verdict;}},show:(wc,url)=>shown.push([wc.id,url])});
 const wc={id:7},nav=url=>({resourceType:'mainFrame',method:'GET',url});
 assert.deepEqual(gate.check(nav('https://evil.example/'),wc),{});assert.equal(calls,0,'no key: no lookup at all');
 state='ready';assert.deepEqual(await gate.check(nav('https://fine.example/'),wc),{});
 assert.deepEqual(gate.check({resourceType:'script',method:'GET',url:'https://evil.example/x.js'},wc),{},'only page navigations are checked');
 assert.deepEqual(gate.check({resourceType:'mainFrame',method:'POST',url:'https://evil.example/'},wc),{},'form posts are not replayed');
 verdict={safe:false,threat:'SOCIAL_ENGINEERING'};
 assert.deepEqual(await gate.check(nav('https://evil.example/login'),wc),{cancel:true});assert.equal(shown.length,1);
 const html=decode(shown[0][1]);assert.match(html,/trick you/);assert.match(html,/https:\/\/evil\.example\/login/);assert.match(html,/Continue to site \(unsafe\)/);
 assert.deepEqual(await gate.check(nav('https://evil.example/login'),wc),{},'second visit after the warning goes through once');
 assert.deepEqual(await gate.check(nav('https://evil.example/login'),wc),{cancel:true},'then it warns again');
 verdict='throw';assert.deepEqual(await gate.check(nav('https://other.example/'),wc),{},'lookup errors fail open');
});
test('warning page escapes hostile addresses',()=>{
 const page=decode(warningPage('https://x.example/"><script>alert(1)</script>','MALWARE'));
 assert.ok(!page.includes('<script>alert(1)'),'script tag is escaped');assert.match(page,/harmful software/);
});
