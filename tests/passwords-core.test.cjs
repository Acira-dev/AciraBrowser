'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const crypto=require('node:crypto');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {classify,normalizeOrigin,siteOf}=require('../desktop/passwords/origin-match.cjs');
const {createVault,VaultError}=require('../desktop/passwords/vault.cjs');
const csv=require('../desktop/passwords/csv.cjs');
const {assess,reuseCounts}=require('../desktop/passwords/strength.cjs');
const {generate,LOWER,UPPER,DIGITS,SYMBOLS}=require('../desktop/passwords/generator.cjs');
const {createGate,windowsVerifier,testSwitchesAllowed,platformVerifier}=require('../desktop/passwords/gate.cjs');

test('Mac password verification waits for the native device-owner decision and fails closed',async()=>{
 let accept,reason,prompts=0;
 const verify=platformVerifier({platform:'darwin',env:{},macAuthentication:{verify:message=>{prompts++;reason=message;return new Promise(resolve=>{accept=resolve;});}}});
 let finished=false;const pending=verify('reveal').then(result=>{finished=true;return result;});
 await Promise.resolve();assert.equal(finished,false);assert.equal(prompts,1);assert.match(reason,/Show a saved password/);
 accept({ok:true,method:'device-owner'});assert.deepEqual(await pending,{ok:true,method:'device-owner'});
 const absent=platformVerifier({platform:'darwin',env:{},macAuthentication:{verify:async()=>({ok:false,code:'unavailable'})}});
 assert.equal((await absent('copy')).code,'unavailable');assert.match((await absent('export')).message,/not available|isn’t available/);
 const refused=platformVerifier({platform:'darwin',env:{},macAuthentication:{verify:async()=>({ok:false,code:'cancelled'})}});
 assert.equal((await refused('edit')).ok,false);
 assert.equal((await platformVerifier({platform:'darwin',env:{},macAuthentication:{verify:async()=>{throw Error('native failure')}}})('delete')).ok,false);
 assert.equal((await platformVerifier({platform:'linux',env:{}})('copy')).code,'unavailable');
});

const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'acira-pw-'));
// Fake OS key wrapper: AES with a fixed device key stands in for DPAPI.
const deviceKey=crypto.createHash('sha256').update('test device').digest();
const fakeKeys=(available=true)=>({available:()=>available,wrap:buffer=>{const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',deviceKey,iv);return Buffer.concat([iv,c.update(buffer),c.final(),c.getAuthTag()]);},unwrap:blob=>{const d=crypto.createDecipheriv('aes-256-gcm',deviceKey,blob.subarray(0,12));d.setAuthTag(blob.subarray(blob.length-16));return Buffer.concat([d.update(blob.subarray(12,blob.length-16)),d.final()]);}});
const SECRETS={origin:'https://bank.example.com',username:'ada.lovelace@example.com',password:'correct-horse-Battery-staple-9!',note:'recovery code 4471-9921'};

test('origin matching: exact, port, scheme, http upgrade, never https to http',()=>{
 assert.equal(classify('https://example.com','https://example.com/login?x=1#y'),'exact');
 assert.equal(classify('https://example.com:443','https://example.com'),'exact');
 assert.equal(classify('https://EXAMPLE.com','https://example.com/'),'exact');
 assert.equal(classify('https://example.com','https://example.com:8443/'),null,'different port');
 assert.equal(classify('http://example.com','https://example.com/'),'upgrade','http saved, https page');
 assert.equal(classify('https://example.com','http://example.com/'),null,'https saved is never offered on http');
 assert.equal(classify('http://example.com:8080','https://example.com/'),null);
 assert.equal(classify('https://example.com','https://evil.com/example.com'),null);
 assert.equal(classify('https://example.com','https://example.com.evil.com/'),null);
 assert.equal(classify('https://example.com','https://notexample.com/'),null);
 for(const bad of ['file:///C:/x','data:text/html,x','javascript:alert(1)','acira://settings','about:blank','https://u:p@example.com/','',null,undefined,42])assert.equal(classify('https://example.com',bad),null);
 assert.equal(classify('ftp://example.com','https://example.com'),null);
});

test('origin matching: same registrable domain is a separate "site" match, honouring private suffixes',()=>{
 assert.equal(classify('https://www.example.com','https://login.example.com/'),'site');
 assert.equal(classify('https://accounts.google.com','https://mail.google.com/'),'site');
 assert.equal(classify('https://a.github.io','https://b.github.io/'),null,'github.io is a private suffix');
 assert.equal(classify('https://a.blogspot.com','https://b.blogspot.com/'),null);
 assert.equal(classify('https://shop.example.co.uk','https://www.example.co.uk/'),'site');
 assert.equal(classify('https://example.co.uk','https://other.co.uk/'),null);
 assert.equal(classify('http://www.example.com','http://login.example.com/'),null,'site match needs https on both sides');
 assert.equal(classify('https://www.example.com','http://login.example.com/'),null);
 assert.equal(classify('https://192.168.1.5','https://192.168.1.6/'),null,'no site match for IP addresses');
 assert.equal(classify('https://localhost:3000','https://localhost:3001/'),null);
 assert.equal(classify('https://intranet','https://wiki/'),null,'single-label hosts');
 assert.equal(siteOf('a.b.example.com'),'example.com');
 assert.equal(normalizeOrigin('https://example.com/a/b?c#d'),'https://example.com');
});

test('vault: round trip, nothing readable on disk, survives a restart',()=>{
 const dir=tmp(),vault=createVault({dir,keys:fakeKeys()});
 const saved=vault.save('profile-personal',SECRETS);assert.equal(saved.created,true);
 assert.deepEqual(vault.list('profile-personal').map(e=>[e.origin,e.username]),[[SECRETS.origin,SECRETS.username]]);
 assert.equal('password' in vault.list('profile-personal')[0],false,'listing carries no secrets');
 assert.equal(vault.get('profile-personal',saved.id).password,SECRETS.password);
 for(const name of fs.readdirSync(dir)){const bytes=fs.readFileSync(path.join(dir,name)).toString('latin1');for(const secret of [SECRETS.origin,'bank.example.com',SECRETS.username,'lovelace',SECRETS.password,'Battery',SECRETS.note,'4471'])assert.equal(bytes.includes(secret),false,`${name} must not contain ${secret}`);}
 const again=createVault({dir,keys:fakeKeys()});
 assert.equal(again.get('profile-personal',saved.id).password,SECRETS.password);
 assert.equal(again.status('profile-personal').count,1);
});

test('vault: same site and username updates in place; dedupe and edits',()=>{
 const vault=createVault({dir:tmp(),keys:fakeKeys()}),p='profile-personal';
 const a=vault.save(p,SECRETS);
 assert.deepEqual(vault.save(p,SECRETS),{id:a.id,created:false,changed:false},'identical save changes nothing');
 const changed=vault.save(p,{...SECRETS,password:'another-Strong-one-77#'});assert.deepEqual([changed.id,changed.created,changed.changed],[a.id,false,true]);
 assert.equal(vault.get(p,a.id).password,'another-Strong-one-77#');assert.equal(vault.list(p).length,1);
 const b=vault.save(p,{...SECRETS,username:'someone.else'});assert.equal(b.created,true);
 assert.throws(()=>vault.update(p,b.id,{username:SECRETS.username}),e=>e.code==='duplicate');
 vault.update(p,b.id,{username:'renamed',note:'n'});assert.equal(vault.get(p,b.id).username,'renamed');assert.equal(vault.get(p,b.id).note,'n');
 vault.update(p,b.id,{origin:'https://other.example.org/path'});assert.equal(vault.get(p,b.id).origin,'https://other.example.org');
 vault.remove(p,b.id);assert.equal(vault.list(p).length,1);assert.throws(()=>vault.get(p,b.id),e=>e.code==='missing');
});

test('vault: validation rejects bad input with fixed messages that never echo secrets',()=>{
 const vault=createVault({dir:tmp(),keys:fakeKeys()}),p='profile-personal',seen=[];
 const attempts=[{...SECRETS,origin:'ftp://x.test'},{...SECRETS,origin:'https://u:pw@x.test'},{...SECRETS,password:''},{...SECRETS,password:'x'.repeat(2000)},{...SECRETS,username:'u'.repeat(600)},{...SECRETS,note:'n'.repeat(5000)},{...SECRETS,password:'a\u0000b'},{...SECRETS,username:{}}];
 for(const bad of attempts)try{vault.save(p,bad);assert.fail('should reject');}catch(error){assert.ok(error instanceof VaultError);seen.push(error.message,error.code);}
 for(const text of seen)for(const secret of [SECRETS.password,SECRETS.username,'bank.example.com','pw@'])assert.equal(String(text).includes(secret),false,'error text leaks a value');
 assert.throws(()=>vault.list('../evil'),e=>e.code==='invalid');assert.throws(()=>vault.list(''),e=>e.code==='invalid');
});

test('vault: a tampered record is skipped and counted; the rest still opens',()=>{
 const dir=tmp(),p='profile-personal',vault=createVault({dir,keys:fakeKeys()});
 const a=vault.save(p,SECRETS),b=vault.save(p,{...SECRETS,username:'second'});
 const file=path.join(dir,`${p}.vault.json`),raw=JSON.parse(fs.readFileSync(file,'utf8'));
 const target=raw.records.find(r=>r.id===a.id);const ct=Buffer.from(target.ct,'base64');ct[0]^=1;target.ct=ct.toString('base64');
 fs.writeFileSync(file,JSON.stringify(raw));
 const reopened=createVault({dir,keys:fakeKeys()}),status=reopened.status(p);
 assert.equal(status.ok,true);assert.equal(status.count,1);assert.equal(status.unreadable,1);
 assert.equal(reopened.get(p,b.id).username,'second');assert.throws(()=>reopened.get(p,a.id),e=>e instanceof VaultError);
 assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).records.length,2,'the broken record is kept, not deleted');
});

test('vault: records are bound to their id and profile',()=>{
 const dir=tmp(),vault=createVault({dir,keys:fakeKeys()});
 const a=vault.save('profile-a',SECRETS),b=vault.save('profile-a',{...SECRETS,username:'other'});
 const fileA=path.join(dir,'profile-a.vault.json'),raw=JSON.parse(fs.readFileSync(fileA,'utf8'));
 const [ra,rb]=[raw.records.find(r=>r.id===a.id),raw.records.find(r=>r.id===b.id)];
 [ra.iv,rb.iv]=[rb.iv,ra.iv];[ra.tag,rb.tag]=[rb.tag,ra.tag];[ra.ct,rb.ct]=[rb.ct,ra.ct];// ciphertext swapped between ids
 fs.writeFileSync(fileA,JSON.stringify(raw));
 const swapped=createVault({dir,keys:fakeKeys()});assert.equal(swapped.status('profile-a').count,0);assert.equal(swapped.status('profile-a').unreadable,2);
 // A profile's file copied under another profile's name is refused, never opened with the other identity.
 const dir2=tmp(),v2=createVault({dir:dir2,keys:fakeKeys()});v2.save('profile-a',SECRETS);
 fs.copyFileSync(path.join(dir2,'profile-a.vault.json'),path.join(dir2,'profile-b.vault.json'));
 const reopened=createVault({dir:dir2,keys:fakeKeys()});assert.equal(reopened.status('profile-b').ok,false);assert.equal(reopened.status('profile-b').code,'corrupt');
 assert.equal(reopened.status('profile-a').count,1);
});

test('vault: never creates a new key over existing records; no plaintext fallback',()=>{
 const dir=tmp(),p='profile-personal',vault=createVault({dir,keys:fakeKeys()});vault.save(p,SECRETS);
 const before=fs.readFileSync(path.join(dir,`${p}.vault.json`),'utf8');
 fs.rmSync(path.join(dir,'master.key'));
 const lost=createVault({dir,keys:fakeKeys()});
 assert.equal(lost.status(p).ok,false);assert.equal(lost.status(p).code,'key-missing');
 assert.throws(()=>lost.save(p,SECRETS),e=>e.code==='key-missing');
 assert.equal(fs.existsSync(path.join(dir,'master.key')),false,'no replacement key was written');
 assert.equal(fs.readFileSync(path.join(dir,`${p}.vault.json`),'utf8'),before,'records untouched');
 // A wrapped key from another Windows account cannot be unwrapped: unreadable, nothing overwritten.
 const dir2=tmp(),v2=createVault({dir:dir2,keys:fakeKeys()});v2.save(p,SECRETS);
 const other=createVault({dir:dir2,keys:{available:()=>true,wrap:b=>b,unwrap:()=>{throw new Error('wrong account');}}});
 assert.equal(other.status(p).ok,false);assert.equal(other.status(p).code,'key-unreadable');
 // Secure storage unavailable: refuses to store anything.
 const off=createVault({dir:tmp(),keys:fakeKeys(false)});assert.throws(()=>off.save(p,SECRETS),e=>e.code==='unavailable');assert.equal(off.status(p).available,false);
});

test('vault: a corrupt file is never overwritten; the previous generation (.bak) is used',()=>{
 const dir=tmp(),p='profile-personal',vault=createVault({dir,keys:fakeKeys()});
 vault.save(p,SECRETS);vault.save(p,{...SECRETS,username:'second'});
 const file=path.join(dir,`${p}.vault.json`);fs.writeFileSync(file,'{ not json');
 const recovered=createVault({dir,keys:fakeKeys()});assert.equal(recovered.status(p).ok,true,'.bak holds the previous generation');assert.equal(recovered.status(p).count,1);
 fs.writeFileSync(`${file}.bak`,'garbage');
 const dead=createVault({dir,keys:fakeKeys()});assert.equal(dead.status(p).code,'corrupt');assert.throws(()=>dead.save(p,SECRETS),e=>e.code==='corrupt');
 assert.equal(fs.readFileSync(file,'utf8'),'{ not json','nothing was written over it');
});

test('vault: never-for-this-site, matching, and profile removal',()=>{
 const dir=tmp(),vault=createVault({dir,keys:fakeKeys()}),p='profile-personal';
 assert.equal(vault.isNever(p,'https://shop.example.com/cart'),false);
 const never=vault.addNever(p,'https://shop.example.com/x');assert.equal(never.created,true);assert.equal(vault.addNever(p,'https://shop.example.com').created,false);
 assert.equal(vault.isNever(p,'https://shop.example.com/cart'),true);assert.equal(vault.isNever(p,'https://other.example.com'),false);
 assert.deepEqual(vault.never(p).map(e=>e.origin),['https://shop.example.com']);assert.equal(vault.list(p).length,0,'never entries are not logins');
 vault.removeNever(p,never.id);assert.equal(vault.isNever(p,'https://shop.example.com'),false);
 vault.save(p,{...SECRETS,origin:'https://www.example.com',username:'a'});vault.save(p,{...SECRETS,origin:'https://login.example.com',username:'b'});vault.save(p,{...SECRETS,origin:'http://example.org',username:'c'});vault.save(p,{...SECRETS,origin:'https://example.net',username:'d'});
 assert.deepEqual(vault.match(p,'https://login.example.com/').map(e=>[e.username,e.match]),[['b','exact'],['a','site']]);
 assert.deepEqual(vault.match(p,'https://example.org/').map(e=>[e.username,e.match]),[['c','upgrade']]);
 assert.deepEqual(vault.match(p,'http://example.org/').map(e=>e.match),['exact']);
 assert.deepEqual(vault.match(p,'https://evil.test/'),[]);assert.equal(vault.match(p,'https://login.example.com/').every(e=>!('password' in e)),true);
 assert.equal(vault.secret(p,vault.match(p,'https://example.net')[0].id).password,SECRETS.password);
 vault.save('profile-two',SECRETS);vault.removeProfile(p);
 assert.equal(fs.existsSync(path.join(dir,`${p}.vault.json`)),false);assert.equal(vault.list('profile-two').length,1,'other profiles untouched');
});

test('csv: parses what Chrome, Edge, Brave and others export, and round-trips awkward passwords',()=>{
 const chrome='name,url,username,password,note\r\nexample.com,https://example.com/login,ada,"p,a""ss",\r\nmail,https://mail.example.com,bob@x.test,secret,"line1\nline2"\r\n';
 const parsed=csv.parseLogins(chrome);assert.equal(parsed.entries.length,2);
 assert.deepEqual(parsed.entries[0],{origin:'https://example.com',username:'ada',password:'p,a"ss',note:''});
 assert.equal(parsed.entries[1].note,'line1\nline2');
 const edge=csv.parseLogins('name,url,username,password\nx,https://x.test,u,p\n');assert.equal(edge.entries[0].password,'p');
 const bitwarden=csv.parseLogins('\uFEFFfolder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\n,,login,Site,hello,,,https://b.test/,u,pw,\n');assert.deepEqual([bitwarden.entries[0].origin,bitwarden.entries[0].password,bitwarden.entries[0].note],['https://b.test','pw','hello']);
 const awkward=[{origin:'https://a.test',username:'u1',password:' lead,trail ',note:'multi\r\nline "quoted"'},{origin:'https://b.test',username:'',password:'=cmd|\' /C calc\'!A0',note:''},{origin:'https://c.test',username:'ü ñ 日本',password:'🔑,"x"',note:''}];
 const round=csv.parseLogins(csv.exportLogins(awkward));
 assert.deepEqual(round.entries.map(e=>e.password),awkward.map(e=>e.password));assert.deepEqual(round.entries.map(e=>e.username),awkward.map(e=>e.username));assert.equal(round.entries[0].note,awkward[0].note);
 assert.match(csv.exportLogins([{origin:'https://www.example.com',username:'u',password:'p',note:''}]).split('\r\n')[1],/^example\.com,https:\/\/www\.example\.com,u,p,$/);
});

test('csv: bad rows are counted, not imported; bad files are refused with plain messages',()=>{
 const text='name,url,username,password,note\nA,javascript:alert(1),u,p,\nA2,javascript:1,u,p,\nB,file:///etc/passwd,u,p,\nC,https://ok.test,u,,\nD,example.org,u,p,\nE,https://u:x@bad.test,u,p,\nF,https://ok2.test,u,pw,\n';
 const parsed=csv.parseLogins(text);
 assert.deepEqual(parsed.entries.map(e=>e.origin),['https://example.org','https://ok2.test'],'a bare host gets https; the rest are rejected');
 assert.equal(parsed.skipped,5);
 assert.throws(()=>csv.parseLogins('hello\nworld'),/doesn’t look like a passwords file/);assert.throws(()=>csv.parseLogins('name,url\n'),/no passwords|doesn’t look/);
 assert.throws(()=>csv.parseLogins('x'.repeat(9*1024*1024)),/larger than 8 MB/);
 const many='name,url,username,password\n'+'a,https://x.test,u,p\n'.repeat(20500);assert.throws(()=>csv.parseLogins(many),/Too many rows/);
 const long=csv.parseLogins(`name,url,username,password\nx,https://x.test,u,${'p'.repeat(2000)}\n`);assert.equal(long.entries.length,0);assert.equal(long.reasons.tooLong,1);
 assert.deepEqual(csv.parseCsv('a,b\r\n\r\nc,d'),[['a','b'],['c','d']]);
});

test('strength: weak, fair and strong, and local reuse detection',()=>{
 for(const weak of ['123456','password','Password1','qwerty123','abcd','aaaaaaaaaaaa','letmein'])assert.equal(assess({password:weak}).label,'weak',weak);
 assert.equal(assess({password:'ada.lovelace99',username:'ada.lovelace@example.com'}).label,'weak','contains the username');
 assert.equal(assess({password:'examplesecret42',origin:'https://example.com'}).reasons.includes('contains-site'),true);
 assert.equal(assess({password:'Tr0ub4dor&3x'}).label==='strong'||assess({password:'Tr0ub4dor&3x'}).label==='fair',true);
 assert.equal(assess({password:generate()}).label,'strong');
 assert.equal(assess({password:''}).label,'weak');
 const counts=reuseCounts([{id:'1',password:'same-one'},{id:'2',password:'same-one'},{id:'3',password:'unique'},{id:'4',password:'same-one'},{id:'5',password:''}]);
 assert.deepEqual([...counts.entries()].sort(),[['1',2],['2',2],['4',2]]);
 assert.equal(counts.has('3'),false);
});

test('generator: strong, every class, no look-alikes, unbiased and unique',()=>{
 const seen=new Set();
 for(let i=0;i<300;i++){const value=generate();seen.add(value);assert.equal(value.length,20);
  assert.ok(/[a-z]/.test(value)&&/[A-Z]/.test(value)&&/\d/.test(value)&&/[^A-Za-z0-9]/.test(value),value);
  assert.equal(/[0OIl1]/.test(value),false,'no look-alike characters');}
 assert.equal(seen.size,300);
 assert.equal(generate({length:5}).length,12,'minimum 12');assert.equal(generate({length:500}).length,64,'maximum 64');
 const plain=generate({symbols:false});assert.equal(/[^A-Za-z0-9]/.test(plain),false);
 let calls=0;const value=generate({randomInt:max=>{calls++;return max-1;}});assert.ok(calls>=20);assert.equal(typeof value,'string');
 for(const set of [LOWER,UPPER,DIGITS,SYMBOLS])assert.equal(new Set(set).size,set.length);
 // chi-square sanity: a million-free quick check that no class dominates
 const counts={lower:0,upper:0,digit:0,symbol:0};for(let i=0;i<500;i++)for(const ch of generate()){if(/[a-z]/.test(ch))counts.lower++;else if(/[A-Z]/.test(ch))counts.upper++;else if(/\d/.test(ch))counts.digit++;else counts.symbol++;}
 const total=500*20;assert.ok(counts.lower/total>.25&&counts.lower/total<.45,JSON.stringify(counts));assert.ok(counts.symbol/total>.1&&counts.symbol/total<.35,JSON.stringify(counts));
});

test('gate: one prompt, a short unlock window, then locked; failures never unlock',async()=>{
 let clock=1000,prompts=0;const verifies=[];
 const gate=createGate({now:()=>clock,windowMs:60000,verify:async reason=>{prompts++;verifies.push(reason);await new Promise(r=>setImmediate(r));return {ok:true,method:'hello'};}});
 const [a,b]=await Promise.all([gate.ensure('reveal'),gate.ensure('copy')]);assert.equal(a.ok&&b.ok,true);assert.equal(prompts,1,'a prompt in flight is shared');
 assert.equal((await gate.ensure('copy')).method,'cached');assert.equal(prompts,1);
 clock+=59000;assert.equal(gate.unlocked,true);clock+=2000;assert.equal(gate.unlocked,false);
 await gate.ensure('export');assert.equal(prompts,2);assert.deepEqual(verifies,['reveal','export']);
 gate.lock();assert.equal(gate.unlocked,false);
 const deny=createGate({now:()=>clock,verify:async()=>({ok:false,code:'cancelled'})});assert.equal((await deny.ensure('reveal')).ok,false);assert.equal(deny.unlocked,false);
 const boom=createGate({now:()=>clock,verify:async()=>{throw new Error('boom');}});assert.equal((await boom.ensure('reveal')).ok,false);assert.equal(boom.unlocked,false);
});

test('gate: Windows verifier — Hello, credential fallback, and every failure is a refusal',async()=>{
 const calls=[],helper='C:\\Users\\me\\AppData\\Local\\Programs\\Acira Browser\\resources\\acira-verify.exe';
 const exec=outputs=>(file,args,options,callback)=>{const call={file,args,options,input:null};calls.push(call);const next=outputs.shift();setImmediate(()=>callback(next.error||null,next.stdout||''));return {stdin:{on(){},end(text){call.input=text;}}};};
 const base={platform:'win32',env:{SystemRoot:'C:\\Windows',ACIRA_STARTUP_TRACE:'C:\\trace.json'},helper,window:()=>null};
 assert.deepEqual(await windowsVerifier({...base,exec:exec([{stdout:'result:Verified\r\n'}])})('reveal'),{ok:true,method:'hello'});
 const call=calls[0];assert.equal(call.file,helper,'Acira\'s own signed helper, never powershell.exe');
 assert.deepEqual(call.args,['hello','0'],'the job and the window, nothing else on the command line');
 assert.equal(call.options.windowsHide,true);assert.equal(call.input,'Show a saved password in Acira','the message travels on standard input');
 assert.equal(Object.keys(call.options.env).some(name=>/^ACIRA_/.test(name)),false,'Acira\'s own ACIRA_ variables stay out of the helper\'s environment');assert.equal(call.options.env.SystemRoot,'C:\\Windows','the rest of Acira\'s environment is passed on');
 assert.equal((await windowsVerifier({...base,exec:exec([{stdout:'result:Canceled'}])})('copy')).code,'cancelled');
 assert.equal((await windowsVerifier({...base,exec:exec([{stdout:'result:RetriesExhausted'}])})('copy')).code,'failed');
 assert.equal((await windowsVerifier({...base,exec:exec([{stdout:'result:DeviceBusy'}])})('copy')).code,'failed');
 assert.equal((await windowsVerifier({...base,exec:exec([{stdout:'garbage'}])})('copy')).ok,false);
 assert.equal((await windowsVerifier({...base,exec:exec([{error:Object.assign(new Error('x'),{killed:true})}])})('copy')).code,'timeout');
 assert.equal((await windowsVerifier({...base,exec:exec([{stdout:'timeout'}])})('copy')).code,'timeout','the helper cancelled a prompt left open too long');
 // a helper that is missing or blocked (an antivirus quarantine) is a refusal, and so is one that cannot be found at all
 calls.length=0;assert.equal((await windowsVerifier({...base,exec:exec([{error:Object.assign(new Error('spawn ENOENT'),{code:'ENOENT',syscall:'spawn x.exe'})}])})('copy')).code,'failed');assert.equal(calls.length,1,'a helper that cannot start is not asked again for the password prompt');
 assert.equal((await windowsVerifier({...base,helper:null,exec:()=>assert.fail('nothing to start')})('copy')).code,'failed');
 assert.equal((await windowsVerifier({...base,exec:(f,a,o,cb)=>{throw new Error('spawn failed');}})('copy')).ok,false);
 calls.length=0;
 const fallback=await windowsVerifier({...base,exec:exec([{stdout:'unavailable:NotConfiguredForUser'},{stdout:'result:Verified'}])})('export');
 assert.deepEqual(fallback,{ok:true,method:'credential'});assert.equal(calls.length,2);
 assert.deepEqual(calls.map(c=>c.args[0]),['hello','password']);assert.equal(calls[1].input,'Export your Acira passwords');
 for(const hello of ['unavailable:DeviceNotPresent','unavailable:NoApi','unavailable:DeviceBusy','result:NotConfiguredForUser','result:DeviceNotPresent','result:DisabledByPolicy','error','']){
  calls.length=0;
  assert.equal((await windowsVerifier({...base,exec:exec([{stdout:hello},{stdout:'result:Verified'}])})('export')).method,'credential',(hello||'no answer (the helper ended without writing one)')+' offers the password prompt');
  assert.equal(calls.length,2);
 }
 assert.equal((await windowsVerifier({...base,exec:exec([{stdout:'unavailable:DeviceNotPresent'},{stdout:'result:Failed'}])})('export')).code,'failed','a wrong password');
 assert.equal((await windowsVerifier({...base,exec:exec([{stdout:'unavailable:DeviceNotPresent'},{stdout:'result:Canceled'}])})('export')).code,'cancelled');
 assert.equal((await windowsVerifier({...base,exec:exec([{stdout:'unavailable:DeviceNotPresent'},{stdout:'garbage'}])})('export')).code,'unavailable');
 assert.equal((await windowsVerifier({...base,exec:exec([{stdout:'unavailable:DeviceNotPresent'},{stdout:'unavailable:NoPassword'}])})('export')).code,'unavailable','an account without a password: set up Hello or a password');
 assert.equal((await windowsVerifier({...base,exec:exec([{stdout:'unavailable:DeviceNotPresent'},{stdout:'error'}])})('export')).code,'unavailable');
 assert.equal((await windowsVerifier({...base,exec:exec([{stdout:'unavailable:DeviceNotPresent'},{error:Object.assign(new Error('x'),{killed:true})}])})('export')).code,'timeout');
 assert.equal((await windowsVerifier({platform:'linux',env:{},exec:exec([])})('reveal')).code,'unavailable');
 // The test switch is ignored outside an unpackaged run in an isolated test profile.
 assert.equal((await windowsVerifier({...base,packaged:false,env:{ACIRA_PASSWORDS_TEST_GATE:'allow'},exec:exec([{stdout:'result:Canceled'}])})('reveal')).ok,false);
 assert.equal((await windowsVerifier({platform:'win32',packaged:false,env:{ACIRA_PASSWORDS_TEST_GATE:'allow',ACIRA_BROWSER_TEST_DATA:'x'},exec:exec([])})('reveal')).ok,true);
 assert.equal((await windowsVerifier({platform:'win32',packaged:false,env:{ACIRA_PASSWORDS_TEST_GATE:'deny',ACIRA_BROWSER_TEST_DATA:'x'},exec:exec([])})('reveal')).ok,false);
 // Installed app: the switch is dead even with the isolated-profile variable set, and a caller that forgets the flag fails closed.
 const env={ACIRA_PASSWORDS_TEST_GATE:'allow',ACIRA_BROWSER_TEST_DATA:'x'};
 for(const packaged of [true,undefined]){
  calls.length=0;
  const result=await windowsVerifier({platform:'win32',packaged,env,helper,window:()=>null,exec:exec([{stdout:'result:Canceled'}])})('reveal');
  assert.equal(result.ok,false);assert.equal(result.code,'cancelled');assert.equal(calls.length,1,'the real Windows prompt ran instead of the switch');
 }
 assert.equal(testSwitchesAllowed({env,packaged:false}),true);
 assert.equal(testSwitchesAllowed({env,packaged:true}),false);
 assert.equal(testSwitchesAllowed({env}),false);
 assert.equal(testSwitchesAllowed({env:{},packaged:false}),false);
});

test('gate: the Windows prompt is parented to the Acira window, which is enabled again if the helper is stopped with the prompt up',async()=>{
 const handle=Buffer.alloc(8);handle.writeBigUInt64LE(0x1a2b3cn);
 let enabled=true;const win={isDestroyed:()=>false,isEnabled:()=>enabled,setEnabled:value=>{enabled=value;},getNativeWindowHandle:()=>handle};
 const seen=[];
 const exec=(file,args,options,callback)=>{seen.push(args);enabled=false;setImmediate(()=>callback(Object.assign(new Error('killed'),{killed:true}),''));return {stdin:{on(){},end(){}}};};
 const result=await windowsVerifier({platform:'win32',env:{},helper:'C:\\acira\\resources\\acira-verify.exe',window:()=>win,exec})('secured');
 assert.equal(result.code,'timeout');assert.deepEqual(seen,[['hello',String(0x1a2b3c)]]);
 assert.equal(enabled,true,'the window the prompt disabled is usable again');
 // a window that was already disabled (another modal of Acira's own) is left as it was
 enabled=false;const keep=(file,args,options,callback)=>{setImmediate(()=>callback(null,'result:Verified'));return {stdin:{on(){},end(){}}};};
 assert.equal((await windowsVerifier({platform:'win32',env:{},helper:'C:\\acira\\resources\\acira-verify.exe',window:()=>win,exec:keep})('secured')).ok,true);
 assert.equal(enabled,false);
});

test('gate: with no window from the caller, the prompt goes in front of Acira\'s focused BaseWindow (the real lookup), and the asking window wins',async()=>{
 // Electron 44 as it behaves with Acira's windows: they are BaseWindows, which BrowserWindow's lists leave out.
 const id=require.resolve('electron'),saved=require.cache[id];
 const handle=value=>{const bytes=Buffer.alloc(8);bytes.writeBigUInt64LE(BigInt(value));return bytes;};
 const make=value=>({enabled:true,isDestroyed:()=>false,isVisible:()=>true,isEnabled(){return this.enabled;},setEnabled(on){this.enabled=on;},getNativeWindowHandle:()=>handle(value)});
 const focused=make(0x2a0c4),other=make(0x51e08),seen=[];
 require.cache[id]={id,filename:id,loaded:true,exports:{BaseWindow:{getFocusedWindow:()=>focused,getAllWindows:()=>[other,focused]},BrowserWindow:{getFocusedWindow:()=>null,getAllWindows:()=>[]}}};
 try{
  const exec=(file,args,options,callback)=>{seen.push(args);setImmediate(()=>callback(null,'result:Verified'));return {stdin:{on(){},end(){}}};};
  const verify=windowsVerifier({platform:'win32',env:{},helper:'C:\\A\\resources\\acira-verify.exe',exec});
  assert.equal((await createGate({verify,windowMs:0}).ensure('tor')).ok,true);
  assert.deepEqual(seen.pop(),['hello',String(0x2a0c4)],'saved Tor items: the focused Acira window');
  assert.equal((await createGate({verify,windowMs:0}).ensure('reveal',other)).ok,true);
  assert.deepEqual(seen.pop(),['hello',String(0x51e08)],'a saved password: the window that asked');
  // No focused window: a visible one.
  require.cache[id].exports.BaseWindow.getFocusedWindow=()=>null;
  await verify('secured');assert.deepEqual(seen.pop(),['hello',String(0x51e08)]);
  // The re-enable after a stopped prompt reaches the real window too.
  require.cache[id].exports.BaseWindow.getFocusedWindow=()=>focused;
  const stopped=(file,args,options,callback)=>{focused.enabled=false;setImmediate(()=>callback(Object.assign(new Error('killed'),{killed:true}),''));return {stdin:{on(){},end(){}}};};
  assert.equal((await windowsVerifier({platform:'win32',env:{},helper:'C:\\A\\resources\\acira-verify.exe',exec:stopped})('secured')).code,'timeout');
  assert.equal(focused.enabled,true,'the Acira window is usable again after the 90 s stop');
 }finally{if(saved)require.cache[id]=saved;else delete require.cache[id];}
});

test('installed Mac password verification ignores test bypass switches and still requires native verification',async()=>{
 const env={ACIRA_PASSWORDS_TEST_GATE:'allow',ACIRA_BROWSER_TEST_DATA:'isolated-test'};
 for(const packaged of [true,undefined])assert.equal((await platformVerifier({platform:'darwin',env,packaged,macAuthentication:{verify:async()=>({ok:false,code:'cancelled'})}})('reveal')).ok,false);
 assert.equal((await platformVerifier({platform:'darwin',env,packaged:false})('reveal')).ok,true);
 assert.equal((await platformVerifier({platform:'darwin',env:{ACIRA_PASSWORDS_TEST_GATE:'allow'},packaged:false,macAuthentication:{verify:async()=>({ok:false,code:'cancelled'})}})('reveal')).ok,false);
});
