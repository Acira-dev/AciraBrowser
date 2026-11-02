const {test}=require('node:test'),assert=require('node:assert/strict');
const {createWebsiteLanguages,checkedLanguages}=require('../desktop/browser-services/website-languages.cjs');
function fixture(system=['en-US','ar-SA']){
 const policies=new Map(),calls=[],database={policy:id=>policies.get(id),setPolicy:(id,_site,value)=>policies.set(id,structuredClone(value)),transaction:run=>run()};
 const service=createWebsiteLanguages({database,systemLanguages:()=>system}),session=()=>({getUserAgent:()=> 'original Chromium UA',setUserAgent:(ua,languages)=>calls.push({ua,languages})});
 return {policies,calls,service,session,database};
}
test('system default preserves native language reduction with a valid preference fallback',()=>{
 const f=fixture(),s=f.session();assert.deepEqual(f.service.attach(s,'a').current,['en-US','ar-SA']);
 assert.deepEqual(f.calls,[],'do not expand the native default request header to the full system list');
 for(const system of [[],['bad_value']]){const g=fixture(system);assert.deepEqual(g.service.attach(g.session(),'a').current,['en-US']);}
});
test('per-profile preference persists, keeps other policy fields, and requires restart',()=>{
 const f=fixture(),a=f.session(),b=f.session();f.policies.set('a',{blocking:false});
 f.service.attach(a,'a');f.service.attach(b,'b');let result=f.service.set(a,['en-us']);
 assert.deepEqual(result.choice,['en-US']);assert.equal(result.restartRequired,true);
 assert.deepEqual(result.current,['en-US','ar-SA']);assert.deepEqual(f.policies.get('a'),{blocking:false,websiteLanguages:['en-US']});
 assert.equal(f.service.status(b).choice,null);assert.equal(f.calls.length,0,'existing WebContents not silently reconfigured');
 const restarted=createWebsiteLanguages({database:f.database,systemLanguages:()=>['en-US','ar-SA']});
 result=restarted.attach(f.session(),'a');assert.deepEqual(result.current,['en-US']);assert.equal(result.restartRequired,false);
 assert.deepEqual(f.calls,[{ua:'original Chromium UA',languages:'en-US'}],'an explicit preference preserves the original UA');
 assert.equal(f.service.set(a,null).choice,null);assert.equal(f.policies.get('a').blocking,false);
});
test('private inherited preference is memory-only and Tor always keeps English',()=>{
 const f=fixture();f.policies.set('a',{websiteLanguages:['fr']});const p=f.session(),tor=f.session();
 assert.deepEqual(f.service.attach(p,'private-a',{privateMode:true,inheritProfileId:'a'}).current,['fr']);
 assert.deepEqual(f.service.attach(tor,'private-tor',{privateMode:true,tor:true,inheritProfileId:'a'}).current,['en-US','en']);
 for(const s of [p,tor])assert.throws(()=>f.service.set(s,['de']),/ordinary profile/);
 assert.equal(f.policies.size,1);assert.deepEqual(f.policies.get('a').websiteLanguages,['fr']);
});
test('website language boundary rejects malformed/injected input and unknown session owners',()=>{
 for(const input of [[],{},'en',['en\r\nX-Header: injected'],['en_US'],['english-language-!'],Array(9).fill('en')])assert.throws(()=>checkedLanguages(input));
 assert.deepEqual(checkedLanguages(['en-us','en-US','fr']),['en-US','fr']);
 const f=fixture(),s=f.session();assert.throws(()=>f.service.status(s),/not ready/);f.service.attach(s,'a');assert.throws(()=>f.service.attach(s,'b'),/owner/);
});

test('page languages equal what the session sends: first system language by default, the saved choice, Tor English',()=>{
 const f=fixture(),a=f.session(),t=f.session(),p=f.session();
 assert.deepEqual(f.service.pageLanguages(a),['en-US'],'before attach: only the first system language');
 f.service.attach(a,'a');assert.deepEqual(f.service.pageLanguages(a),['en-US'],'the second OS language (ar-SA) is not exposed by default');
 assert.deepEqual(fixture(['ar-SA','en-US']).service.pageLanguages(f.session()),['ar-SA'],'an Arabic-first system keeps Arabic first');
 f.service.set(a,['fr','en']);assert.deepEqual(f.service.pageLanguages(a),['en-US'],'a new choice waits for restart, like the header');
 f.policies.set('b',{websiteLanguages:['fr','en']});const b=f.session();f.service.attach(b,'b');assert.deepEqual(f.service.pageLanguages(b),['fr','en']);
 f.service.attach(t,'private-tor',{privateMode:true,tor:true,inheritProfileId:'b'});assert.deepEqual(f.service.pageLanguages(t),['en-US','en']);
 f.service.attach(p,'private-b',{privateMode:true,inheritProfileId:'b'});assert.deepEqual(f.service.pageLanguages(p),['fr','en']);
});