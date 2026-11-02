'use strict';
// Certificate revocation and intermediate fetches in Tor (TOR_HARDENING.md §1, OCSP / CRL). What the packet rig proved on 28 Oct 2026
// (qa/r9-tor-packets.mjs: no Acira process asked Windows for an OCSP/CRL/AIA host, no browser socket left 127.0.0.1, Chromium's
// verifier is its own built-in one with online revocation off) only holds while nothing turns those on. These guards keep it so.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
function sources(dir,out=[]){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory()){if(!/^(chromium-api|node_modules|vendor)$/.test(entry.name))sources(file,out);}else if(/\.(c|m)?js$/.test(entry.name)&&!/\.gen\.cjs$|^i18n\.cjs$|^runtime\.cjs$/.test(entry.name))out.push(file);}return out;}

test('nothing turns on online revocation checks, a Windows verifier, or certificate fetches outside the session',()=>{
 const offenders=[];
 for(const file of sources(path.join(root,'desktop'))){
  const text=fs.readFileSync(file,'utf8');
  // Chromium switches/features that would make the verifier fetch OCSP or CRLs, or hand verification to Windows' CryptoAPI.
  if(/enable-online-revocation|require-online-revocation|OnlineRevocation|RevocationChecking|CertVerifyProcWin|ChromeRootStoreUsed|crlset/i.test(text))offenders.push(path.relative(root,file));
 }
 assert.deepEqual(offenders,[],'online revocation or the OS verifier would fetch outside Tor (packet rig: qa/r9-tor-packets.mjs)');
});

test('the one certificate hook keeps Chromium’s own verdict, so nothing is weakened in Tor sessions',()=>{
 const {createConnectionInfo,USE_ENGINE_RESULT}=require('../desktop/browser-services/connection-info.cjs');
 assert.equal(USE_ENGINE_RESULT,-3,'-3 = use the result Chromium computed');
 let proc=null;const session={setCertificateVerifyProc:fn=>{proc=fn;}};
 createConnectionInfo().attach(session);
 let verdict=null;proc({hostname:'x.example',certificate:{},verificationResult:'net::ERR_CERT_REVOKED',errorCode:-117},v=>{verdict=v;});
 assert.equal(verdict,-3,'a revoked or otherwise failing certificate stays failing');
});

test('CNAME uncloaking never asks the system DNS server about a Tor page’s hosts (Node’s resolver bypasses Tor and Windows’ DNS client)',()=>{
 // qa/r9-tor-dns-calls.mjs, 28 Oct: before this guard a Tor tab's subresource host (www.torproject.org) went to c-ares → the router's port 53.
 const text=fs.readFileSync(path.join(root,'desktop/content-blocking.cjs'),'utf8').replace(/\r\n/g,'\n');
 const body=text.slice(text.indexOf('const cnameRequest=session=>details=>{'),text.indexOf('const decide=cname=>'));
 assert.match(body,/if\(session\.__aciraTor\|\|session\[Symbol\.for\('acira\.tor\.session'\)\]\)return \{\};/,'a Tor session returns before any DNS question');
 // The mode read may use the effective mode an extension's proxy sets (P6); what matters is the default '' and the return.
 assert.match(body,/let mode='';try\{[^}]*proxy\.status\(session\)[^}]*\}catch\{\}if\(mode!=='system'&&mode!=='direct'\)return \{\};/,'an unreadable proxy record means "don’t ask", never "system"');
 assert.ok(body.indexOf('session.__aciraTor')<body.indexOf('proxy.status(session)'),'the Tor check comes first');
});

test('AIA (missing intermediate) fetches ride Tor: they are the Tor session’s own requests, through its relay, on a circuit of their own in a Tor window',()=>{
 const isolation=fs.readFileSync(path.join(root,'desktop/browser-services/tor-isolation.cjs'),'utf8');
 // Since the 29 Oct review, anonymous claimants count as parties of their own (somebody()), so any claim isolates an unclaimed stream.
 assert.match(isolation,/relay\.shared\|\|sites\.size(?:>1)?\)return \{site:ISOLATED/,'an unclaimed stream (an AIA fetch has no page request) never rides a site’s circuit in a Tor window');
 const engineFeatures=fs.readFileSync(path.join(root,'desktop/browser-services/engine-features.cjs'),'utf8');
 assert.doesNotMatch(engineFeatures,/disable-features[^\n]*CertVerifierBuiltin/i);
});
