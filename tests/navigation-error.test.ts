import test from 'node:test';
import assert from 'node:assert/strict';
import {describeDestination,formatFingerprint,navigationFailure,safeDestination} from '../src/ui/navigationFailure';
import {canOfferContinue} from '../src/ui/certificateOffer';
import {cellAt,cellPitch,figures,gridCols,gridRows,inkCount,levelAt,stillLevel,type ErrorKind} from '../src/features/errors/errorShapes';
import type {CertificateStatus} from '../src/runtime/types';

const kinds=Object.keys(figures) as ErrorKind[];

test('failures follow Chromium: code, number, heading and cause',()=>{
 const router=describeDestination('https://192.168.1.1/');
 const cert=navigationFailure('ERR_CERT_AUTHORITY_INVALID (-202)',router);
 assert.equal(cert.kind,'certificate');assert.equal(cert.code,'ERR_CERT_AUTHORITY_INVALID');assert.equal(cert.number,-202);assert.equal(cert.retryable,false);
 assert.equal(cert.title,'Your connection is not private');assert.match(cert.message,/presented a certificate that no trusted authority signed\.$/);
 assert.match(cert.detail!,/could not prove that it is 192\.168\.1\.1 because/);assert.match(cert.steps[0],/Routers and other local devices/);
 assert.match(navigationFailure('ERR_CERT_DATE_INVALID (-201)',router).message,/expired or is not yet valid/);
 assert.match(navigationFailure('ERR_CERT_DATE_INVALID (-201)',router).detail!,/date and time/);
 assert.match(navigationFailure('ERR_CERT_COMMON_NAME_INVALID (-200)',router).message,/different address/);
 assert.match(navigationFailure('ERR_CERT_REVOKED (-206)',router).message,/revoked/);
 assert.equal(navigationFailure('ERR_SSL_CLIENT_AUTH_CERT_NO_PRIVATE_KEY (-502)').kind,'blocked');
 const dns=navigationFailure('ERR_NAME_NOT_RESOLVED (-105)',describeDestination('https://nope.invalid/'));
 assert.equal(dns.title,'This site can’t be reached');assert.equal(dns.message,'nope.invalid’s server IP address could not be found.');
 const offline=navigationFailure('ERR_INTERNET_DISCONNECTED (-106)');assert.equal(offline.kind,'offline');assert.equal(offline.title,'No internet');
 const local=navigationFailure('ERR_CONNECTION_REFUSED (-102)',describeDestination('http://127.0.0.1:59997/'));
 assert.equal(local.title,'Nothing is running on 127.0.0.1:59997');
 assert.equal(navigationFailure('ERR_CONNECTION_REFUSED (-102)',describeDestination('https://example.com/')).message,'example.com refused to connect.');
 assert.equal(navigationFailure('ERR_CONNECTION_TIMED_OUT (-118)',router).message,'192.168.1.1 took too long to respond.');
 assert.equal(navigationFailure('ERR_CONNECTION_RESET (-101)').message,'The connection was reset.');
 assert.equal(navigationFailure('ERR_CONNECTION_CLOSED (-100)',router).message,'192.168.1.1 unexpectedly closed the connection.');
 assert.equal(navigationFailure('ERR_TOO_MANY_REDIRECTS (-310)',router).title,'This page isn’t working');
 assert.equal(navigationFailure('ERR_BLOCKED_BY_CLIENT (-20)',router).title,'192.168.1.1 is blocked');
 assert.equal(navigationFailure('ERR_UNSAFE_PORT (-312)').kind,'blocked');
 assert.equal(navigationFailure('ERR_SSL_PROTOCOL_ERROR (-107)').kind,'secure');
 assert.equal(navigationFailure('ERR_SSL_VERSION_OR_CIPHER_MISMATCH (-113)',router).message,'192.168.1.1 uses an unsupported protocol.');
 const other=navigationFailure('something odd');assert.equal(other.kind,'other');assert.equal(other.code,'NAVIGATION_FAILED');assert.equal(other.number,undefined);
 for(const text of ['ERR_FAILED (-2)','ERR_CERT_REVOKED (-206)','ERR_ABORTED','ERR_NAME_NOT_RESOLVED (-105)','ERR_CONNECTION_RESET (-101)','ERR_ADDRESS_UNREACHABLE (-109)','ERR_NETWORK_CHANGED (-21)','ERR_EMPTY_RESPONSE (-324)']){const failure=navigationFailure(text,router);assert.ok(failure.title.length<=48&&failure.steps.length<=3,text);assert.ok(!/!|\.\.\./.test(failure.title+failure.message),text);}
});

test('destinations never expose credentials and keep the port people typed',()=>{
 const value=describeDestination('https://user:secret@192.168.1.1:8443/admin?x=1');
 assert.equal(value.address,'https://192.168.1.1:8443/admin?x=1');assert.equal(value.hostPort,'192.168.1.1:8443');assert.equal(value.port,'8443');assert.equal(value.local,true);
 assert.equal(describeDestination('https://example.com/').port,'443');assert.equal(describeDestination('https://example.com/').local,false);
 assert.equal(describeDestination('http://[::1]:3000/').hostPort,'[::1]:3000');assert.equal(describeDestination('http://[::1]:3000/').local,true);
 assert.equal(safeDestination('not a url'),'not a url');
});

test('fingerprints are shown only when they are real SHA-256 values',()=>{
 const hex='ab'.repeat(32);assert.equal(formatFingerprint(hex),Array(32).fill('AB').join(':'));
 assert.equal(formatFingerprint('abc'),'');assert.equal(formatFingerprint(null),'');
});

const status=(over:Partial<NonNullable<CertificateStatus['failure']>>={}):CertificateStatus=>({exception:null,failure:{ticketId:'t1',url:'https://192.168.1.1/',origin:'https://192.168.1.1',host:'192.168.1.1',port:443,error:'net::ERR_CERT_AUTHORITY_INVALID',fingerprint:'ab'.repeat(32),canContinue:true,reason:'',expiresAt:2000,...over}});
test('Continue is offered only for fresh, overridable warnings on this page',()=>{
 const tabError='ERR_CERT_AUTHORITY_INVALID (-202)',url='https://192.168.1.1/';
 assert.equal(canOfferContinue(status(),tabError,url,1000),true);
 assert.equal(canOfferContinue(undefined,tabError,url,1000),false);
 assert.equal(canOfferContinue({exception:null,failure:null},tabError,url,1000),false);
 assert.equal(canOfferContinue(status({canContinue:false}),tabError,url,1000),false);
 assert.equal(canOfferContinue(status({expiresAt:900}),tabError,url,1000),false);
 assert.equal(canOfferContinue(status(),'ERR_CONNECTION_REFUSED (-102)',url,1000),false);
 assert.equal(canOfferContinue(status(),tabError,'https://192.168.1.2/',1000),false);
 assert.equal(canOfferContinue(status(),null,url,1000),false);
});

test('the figure sits on the 4px grid and its ink starts at the left edge',()=>{
 assert.equal(cellPitch,4);assert.equal((gridRows*cellPitch)%4,0);assert.ok(gridRows>=8&&gridRows<=10);
 for(const kind of kinds){
  assert.equal(figures[kind].length,gridRows,kind);for(const row of figures[kind])assert.equal(row.length,gridCols,kind);
  const firstInk=Math.min(...figures[kind].map(row=>{const index=row.search(/[^.]/);return index<0?gridCols:index;}));
  assert.equal(firstInk,0,kind+' ink touches the left edge');
  assert.ok(inkCount(kind)>=40,kind+' has a real figure');
 }
});

test('every failure kind has a distinct figure',()=>{
 const seen=new Map<string,ErrorKind>();
 for(const kind of kinds){const key=figures[kind].join('/');assert.ok(!seen.has(key),`${kind} repeats ${seen.get(key)}`);seen.set(key,kind);}
});

test('levels are stepped integers and the figure moves; the still frame is the resting figure',()=>{
 for(const kind of kinds){
  const frames=new Set<string>();
  for(const t of [0,.2,.5,.9,1.4,2,2.6,3.2]){
   let frame='';
   for(let r=0;r<gridRows;r++)for(let c=0;c<gridCols;c++){const level=levelAt(kind,t,r,c);assert.ok(Number.isInteger(level)&&level>=0&&level<=3,`${kind} ${t}: ${level}`);frame+=level;}
   frames.add(frame);
  }
  assert.ok(frames.size>2,kind+' animates');
  for(let r=0;r<gridRows;r++)for(let c=0;c<gridCols;c++)assert.equal(stillLevel(kind,r,c)>0,cellAt(kind,r,c)!=='.',kind);
 }
});

test('a body that cannot be decoded reads as an invalid response',()=>{
 const failure=navigationFailure('ERR_CONTENT_DECODING_FAILED (-330)',describeDestination('https://shop.example/'));
 assert.equal(failure.code,'ERR_CONTENT_DECODING_FAILED');assert.equal(failure.number,-330);assert.equal(failure.title,'This page isn’t working');
 assert.equal(failure.message,navigationFailure('ERR_INVALID_HTTP_RESPONSE (-370)',describeDestination('https://shop.example/')).message);
});
