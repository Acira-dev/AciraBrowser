'use strict';
// Beta.11 asks update.acirabrowser.com first and the frozen GitHub feed only when the first gives no usable answer (desktop/browser-services/update-feeds.cjs,
// update-hosts.cjs). These tests are the rules of docs/launch/UPDATE_HOST.md, one by one, with electron-updater's own GenericProvider underneath.
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const hosts=require('../desktop/browser-services/update-hosts.cjs');
const {readChannel,usableDocument,lowerThan,highestOf,withoutStagingId,createFeedProviderClass,PRIMARY_WITHIN}=require('../desktop/browser-services/update-feeds.cjs');

const NEW='https://update.acirabrowser.com/',GITHUB='https://raw.githubusercontent.com/Acira-dev/AciraBrowserUpdates/main/feed/';
const doc=(version,extra={})=>JSON.stringify({version,files:[{url:'A.zip',sha512:'x',size:1}],...extra});
const feeds=[{name:'primary',url:NEW},{name:'fallback',url:GITHUB}];
/** request(): answers by URL from a table of {text} | {error} | {hang}; records what was asked. */
function table(map){
 const asked=[];
 const request=async(url)=>{
  asked.push(url);const entry=map[url];
  if(!entry)throw Object.assign(new Error('HTTP 404'),{code:'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND'});
  if(entry.hang)return new Promise(()=>{});
  if(entry.error)throw entry.error;
  return entry.text;
 };
 return {asked,request};
}
const read=(map,extra={})=>{const t=table(map);return readChannel({feeds,channelFile:'beta-mac.yml',request:t.request,parse:text=>JSON.parse(text),current:'0.1.0-beta.11',primaryWithin:60,fallbackWithin:60,...extra}).then(result=>({...result,asked:t.asked}),error=>{error.asked=t.asked;throw error;});
};

test('the addresses: the new host first, then its GitHub twin; Linux and testers keep their folder; any other address is asked alone', () => {
  assert.deepEqual(hosts.feedsFor({primary:NEW}), [{name:'primary',url:NEW},{name:'fallback',url:GITHUB}]);
  assert.deepEqual(hosts.feedsFor({primary:NEW+'linux/'}), [{name:'primary',url:NEW+'linux/'},{name:'fallback',url:GITHUB+'linux/'}]);
  assert.deepEqual(hosts.feedsFor({primary:NEW.slice(0,-1)}), hosts.feedsFor({primary:NEW}), 'a missing trailing slash is added');
  assert.deepEqual(hosts.feedsFor({primary:NEW,testers:true}), [{name:'testers',url:NEW+'testers/'}], 'testers: that folder alone, never GitHub');
  assert.deepEqual(hosts.feedsFor({primary:NEW+'linux/',testers:true}), [{name:'testers',url:NEW+'testers/linux/'}]);
  assert.deepEqual(hosts.feedsFor({primary:GITHUB}), [{name:'primary',url:GITHUB}], 'a build that names GitHub asks GitHub alone');
  assert.deepEqual(hosts.feedsFor({primary:GITHUB,testers:true}), [{name:'primary',url:GITHUB}], 'the testers flag only means the testers folder of the new host');
  assert.deepEqual(hosts.feedsFor({primary:'http://127.0.0.1:8080/'}), [{name:'primary',url:'http://127.0.0.1:8080/'}]);
  assert.deepEqual(hosts.feedsFor({primary:null}), []);
  assert.deepEqual(hosts.feedsFor({primary:'file:///etc/passwd'}), []);
  assert.equal(hosts.fallbackFor('https://example.com/'), null);
});

test('app-update.yml: the url is read from the JSON-string form the packagers write and from plain YAML', () => {
  assert.equal(hosts.feedUrlFromConfig('provider: "generic"\nurl: "https://update.acirabrowser.com/"\nupdaterCacheDirName: "acira-browser-updater"\n'), NEW);
  assert.equal(hosts.feedUrlFromConfig("provider: generic\nurl: https://update.acirabrowser.com/linux/\n"), NEW+'linux/');
  assert.equal(hosts.feedUrlFromConfig('provider: github\nowner: x\n'), null);
  assert.equal(hosts.feedUrlFromConfig(null), null);
});

test('versions order as the updater orders them: beta.9 < beta.10 < beta.11 < beta.11.1 < beta.12 < 0.1.0 < 0.2.0 < 1.0.0', () => {
  const order=['0.1.0-beta.9','0.1.0-beta.10','0.1.0-beta.11','0.1.0-beta.11.1','0.1.0-beta.12','0.1.0-beta.13','0.1.0','0.2.0','1.0.0'];
  const semver=require('semver');
  for (let i=0;i<order.length;i++) for (let j=0;j<order.length;j++) {
    assert.equal(lowerThan(order[i],order[j]), i<j, order[i]+' < '+order[j]);
    assert.equal(lowerThan(order[i],order[j]), semver.lt(order[i],order[j]), 'the same answer as electron-updater (semver)');
  }
  assert.equal(highestOf('0.1.0-beta.11','0.1.0-beta.12'),'0.1.0-beta.12');assert.equal(highestOf(null,'0.1.0-beta.12'),'0.1.0-beta.12');assert.equal(highestOf('x',null),null);
});

test('what is a usable document: an object with a valid version and a files list or a path; the placeholder 0.0.0 with no files is usable', () => {
  assert.equal(usableDocument({version:'0.1.0-beta.12',files:[{url:'a',sha512:'b',size:1}]}), true);
  assert.equal(usableDocument({version:'0.0.0',files:[]}), true);
  assert.equal(usableDocument({version:'0.1.0',path:'a.exe'}), true);
  for (const bad of [null,undefined,'<html>nope</html>',42,[],{},{version:'soon',files:[]},{version:'0.1.0'},{files:[]},{version:7,files:[]}]) assert.equal(usableDocument(bad), false, JSON.stringify(bad));
});

test('rule 1 and 2: a usable answer from the new address is final, whatever it says; the fallback is not asked', async () => {
  for (const [label,text] of [['an update',doc('0.1.0-beta.12')],['nothing new',doc('0.1.0-beta.11')],['an older build (a rollback)',doc('0.1.0-beta.9')],['a halt',doc('0.1.0-beta.12',{stagingPercentage:0})],['the placeholder',JSON.stringify({version:'0.0.0',files:[]})]]) {
    const result=await read({[NEW+'beta-mac.yml']:{text},[GITHUB+'beta-mac.yml']:{text:doc('0.1.0-beta.99')}});
    assert.equal(result.feed.name,'primary',label);assert.deepEqual(result.asked,[NEW+'beta-mac.yml'],label+': GitHub is not asked');
  }
});

test('rule 1: every kind of "no usable document" goes on to the fallback, and a newer fallback answer is taken', async () => {
  const newer={[GITHUB+'beta-mac.yml']:{text:doc('0.1.0-beta.13')}};
  const cases={
    'connection refused':{error:Object.assign(new Error('net::ERR_CONNECTION_REFUSED'),{code:'ERR_CONNECTION_REFUSED'})},
    'DNS failure':{error:new Error('net::ERR_NAME_NOT_RESOLVED')},
    'certificate error':{error:new Error('net::ERR_CERT_AUTHORITY_INVALID')},
    '503':{error:Object.assign(new Error('HTTP 503'),{statusCode:503})},
    '404':null,
    'an HTML page':{text:'<!doctype html><title>Site not found</title>'},
    'garbage YAML':{text:':\n  - [unclosed'},
    'a number':{text:'12'},
    'no version':{text:JSON.stringify({files:[{url:'a',sha512:'b',size:1}]})},
    'a version that is not one':{text:JSON.stringify({version:'next',files:[]})},
    'an empty body':{text:''},
    'silence':{hang:true},
  };
  for (const [label,entry] of Object.entries(cases)) {
    const map={...newer};if(entry)map[NEW+'beta-mac.yml']=entry;
    const result=await read(map,{parse:text=>require('js-yaml').load(text)});
    assert.equal(result.feed.name,'fallback',label);assert.equal(result.info.version,'0.1.0-beta.13',label);assert.deepEqual(result.asked,[NEW+'beta-mac.yml',GITHUB+'beta-mac.yml'],label);
  }
});

test('rule 3: a fallback answer that is not newer than the running version fails the check (nothing is pulled, nothing says "current")', async () => {
  for (const version of ['0.1.0-beta.11','0.1.0-beta.10','0.1.0-beta.9','0.0.0']) {
    await assert.rejects(read({[GITHUB+'beta-mac.yml']:{text:doc(version)}}), error => error.code==='ERR_UPDATE_FEEDS_UNAVAILABLE' && /nothing newer was found/.test(error.message) && error.failures.length===2, version);
  }
  // frozen GitHub says beta.11 while beta.12 runs: not newer
  await assert.rejects(read({[GITHUB+'beta-mac.yml']:{text:doc('0.1.0-beta.11')}},{current:'0.1.0-beta.12'}), error => error.code==='ERR_UPDATE_FEEDS_UNAVAILABLE');
  // newer than the running version but not newer than an update this computer already holds (the floor): not accepted
  await assert.rejects(read({[GITHUB+'beta-mac.yml']:{text:doc('0.1.0-beta.13')}},{floor:()=>'0.1.0-beta.13'}), error => error.code==='ERR_UPDATE_FEEDS_UNAVAILABLE', 'an update already waiting is not "found" again from the old feed');
  await assert.rejects(read({[GITHUB+'beta-mac.yml']:{text:doc('0.1.0-beta.13')}},{floor:()=>'0.1.0-beta.14'}), error => error.code==='ERR_UPDATE_FEEDS_UNAVAILABLE');
  const ok=await read({[GITHUB+'beta-mac.yml']:{text:doc('0.1.0-beta.13')}},{floor:()=>'0.1.0-beta.12'});assert.equal(ok.info.version,'0.1.0-beta.13','strictly newer than both is taken');
  // and a four-part emergency version is newer than beta.11 and older than beta.12
  assert.equal((await read({[GITHUB+'beta-mac.yml']:{text:doc('0.1.0-beta.11.1')}})).info.version,'0.1.0-beta.11.1');
});

test('both addresses failing is one failure with the first reason; one address alone throws its own error untouched', async () => {
  await assert.rejects(read({[NEW+'beta-mac.yml']:{error:new Error('net::ERR_INTERNET_DISCONNECTED')},[GITHUB+'beta-mac.yml']:{error:new Error('net::ERR_INTERNET_DISCONNECTED')}}), error => error.code==='ERR_UPDATE_FEEDS_UNAVAILABLE' && /ERR_INTERNET_DISCONNECTED/.test(error.message));
  const own=Object.assign(new Error('HTTP 404'),{code:'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND'});
  await assert.rejects(readChannel({feeds:[feeds[0]],channelFile:'beta.yml',request:async()=>{throw own;},parse:JSON.parse,current:'1.0.0'}), error => error===own);
});

test('a silent address is given up after its time, its request is cancelled, and the next address is asked', async () => {
  let cancelled=0;const started=Date.now();
  const result=await readChannel({feeds,channelFile:'beta.yml',current:'0.1.0-beta.11',primaryWithin:40,fallbackWithin:200,parse:JSON.parse,makeToken:()=>({cancel:()=>{cancelled++;}}),
    request:async(url)=>url.startsWith(NEW)?new Promise(()=>{}):doc('0.1.0-beta.12')});
  assert.equal(result.feed.name,'fallback');assert.equal(cancelled,1);assert.ok(Date.now()-started<2000);
  assert.equal(PRIMARY_WITHIN,15000,'15 seconds for the first address in the app');
});

test('the channel file name follows the build: beta-mac.yml, beta.yml, beta-linux.yml under each address (a Linux address keeps its folder)', async () => {
  const t=table({[NEW+'linux/beta-linux.yml']:{text:doc('0.1.0-beta.12')}});
  const result=await readChannel({feeds:[{name:'primary',url:NEW+'linux/'}],channelFile:'beta-linux.yml',request:t.request,parse:JSON.parse,current:'0.1.0-beta.11'});
  assert.equal(result.info.version,'0.1.0-beta.12');assert.deepEqual(t.asked,[NEW+'linux/beta-linux.yml']);
});

// --- the electron-updater provider, with electron-updater's own GenericProvider and a stand-in for its HTTP executor ---
function provider(map,{platform='darwin',channel='beta',current='0.1.0-beta.11',floor=()=>null,feedList=feeds}={}){
  const asked=[],executor={request:async(options)=>{
    const url=options.protocol+'//'+options.hostname+(options.path||'');asked.push({url,headers:options.headers||null});
    const entry=map[url];if(!entry)throw Object.assign(new Error('HTTP 404'),{statusCode:404});if(entry.error)throw entry.error;return entry.text;}};
  const Provider=createFeedProviderClass();
  const updater={channel,currentVersion:{version:current}};
  const instance=new Provider({provider:'custom',feeds:feedList,floor,primaryWithin:200,fallbackWithin:200},updater,{executor,platform,isUseMultipleRangeRequest:true});
  return {instance,asked};
}

test('the provider: channel files follow the platform, files resolve against the address that answered, and a multi-range request is never asked for', async () => {
  const mac=provider({[NEW+'beta-mac.yml']:{text:JSON.stringify({version:'0.1.0-beta.12',files:[{url:'AciraBrowser-0.1.0-beta.12-mac-arm64-update.zip',sha512:'x',size:5}]})}});
  const info=await mac.instance.getLatestVersion();
  assert.equal(info.version,'0.1.0-beta.12');assert.equal(mac.instance.answeredBy,'primary');assert.equal(mac.instance.baseUrl.href,NEW);
  assert.equal(mac.instance.resolveFiles(info)[0].url.href,NEW+'AciraBrowser-0.1.0-beta.12-mac-arm64-update.zip','a relative name is the answering address\'s');
  assert.equal(mac.instance.isUseMultipleRangeRequest,false,'GitHub answers a multi-range request with 501: electron-updater is told not to send one');
  const windows=provider({[NEW+'beta.yml']:{text:doc('0.1.0-beta.12')}},{platform:'win32'});assert.equal((await windows.instance.getLatestVersion()).version,'0.1.0-beta.12');
  const arch=process.env.TEST_UPDATER_ARCH;process.env.TEST_UPDATER_ARCH='x64'; // electron-updater names the Linux file by the CPU: beta-linux.yml on x64
  try{const linux=provider({[NEW+'linux/beta-linux.yml']:{text:doc('0.1.0-beta.12')}},{platform:'linux',feedList:[{name:'primary',url:NEW+'linux/'}]});assert.equal((await linux.instance.getLatestVersion()).version,'0.1.0-beta.12');}
  finally{if(arch===undefined)delete process.env.TEST_UPDATER_ARCH;else process.env.TEST_UPDATER_ARCH=arch;}
  const stable=provider({[NEW+'latest-mac.yml']:{text:JSON.stringify({version:'0.0.0',files:[]})}},{channel:'latest'});assert.equal((await stable.instance.getLatestVersion()).version,'0.0.0','the Stable placeholder is read from the same place');
});

test('the provider: after a fallback answer the files resolve against GitHub; the next check starts at the new address again (nothing is remembered)', async () => {
  const t=provider({[GITHUB+'beta-mac.yml']:{text:JSON.stringify({version:'0.1.0-beta.13',files:[{url:'Z.zip',sha512:'x',size:1}]})}});
  const info=await t.instance.getLatestVersion();
  assert.equal(t.instance.answeredBy,'fallback');assert.equal(t.instance.resolveFiles(info)[0].url.href,GITHUB+'Z.zip');
  assert.deepEqual(t.asked.map(item=>item.url),[NEW+'beta-mac.yml',GITHUB+'beta-mac.yml']);
  t.asked.length=0;await t.instance.getLatestVersion();assert.equal(t.asked[0].url,NEW+'beta-mac.yml','the new address is asked first again');
  // and the fallback cannot withdraw anything
  const frozen=provider({[GITHUB+'beta-mac.yml']:{text:doc('0.1.0-beta.11')}},{current:'0.1.0-beta.12'});
  await assert.rejects(frozen.instance.getLatestVersion(),error=>error.code==='ERR_UPDATE_FEEDS_UNAVAILABLE');
});

test('the provider never sends the install\'s staging id: the host learns no stable id, the share is decided on this computer', async () => {
  assert.deepEqual(withoutStagingId({'x-user-staging-id':'abc','accept':'*/*'}),{accept:'*/*'});
  assert.equal(withoutStagingId({'X-User-Staging-Id':'abc'}),null);
  assert.equal(withoutStagingId(null),null);
  const t=provider({[NEW+'beta-mac.yml']:{text:doc('0.1.0-beta.12')}});
  t.instance.setRequestHeaders({'x-user-staging-id':'3a8c0a5e-0000-4000-8000-000000000000'});
  await t.instance.getLatestVersion();
  assert.ok(!t.asked.some(item=>item.headers&&Object.keys(item.headers).some(key=>key.toLowerCase()==='x-user-staging-id')),'no request carried it');
});

test('the provider needs at least one address', () => {
  const Provider=createFeedProviderClass();
  assert.throws(()=>new Provider({provider:'custom',feeds:[]},{},{executor:{},platform:'darwin'}),/empty/);
});

// --- a real HTTP server: a refused connection, a 503 and a slow answer, read with node's fetch ---
test('over HTTP: a dead first address, a 503, an HTML page and silence all end at the fallback', async () => {
  const modes={ok:(res)=>res.end(doc('0.1.0-beta.12')),r503:(res)=>{res.statusCode=503;res.end('busy');},html:(res)=>res.end('<html>parked</html>'),slow:()=>{}};
  const servers=[];let mode='ok';
  const first=http.createServer((req,res)=>modes[mode](res)),second=http.createServer((req,res)=>res.end(doc('0.1.0-beta.13')));
  for (const server of [first,second]) {await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));servers.push(server);}
  const a=`http://127.0.0.1:${first.address().port}/`,b=`http://127.0.0.1:${second.address().port}/`;
  const ask=(primaryWithin=5000)=>readChannel({feeds:[{name:'primary',url:a},{name:'fallback',url:b}],channelFile:'beta.yml',current:'0.1.0-beta.11',primaryWithin,fallbackWithin:1000,parse:text=>{try{return JSON.parse(text);}catch{return null;}},
    request:async(url,token)=>{const controller=new AbortController();if(token)token.cancel=()=>controller.abort();const response=await fetch(url,{signal:controller.signal});if(!response.ok)throw new Error('HTTP '+response.status);return response.text();},makeToken:()=>({})});
  try {
    mode='ok';assert.equal((await ask()).feed.name,'primary');
    for (mode of ['r503','html']) assert.equal((await ask()).feed.name,'fallback',mode);
    mode='slow';assert.equal((await ask(150)).feed.name,'fallback','silence');
    await new Promise(resolve=>first.close(resolve));
    assert.equal((await ask()).feed.name,'fallback','connection refused');
  } finally { for (const server of servers) {server.closeAllConnections?.();server.close();} }
});
