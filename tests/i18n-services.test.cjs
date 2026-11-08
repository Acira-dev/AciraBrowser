'use strict';
// Service copy (protection summary, page warnings, threat pages, dialogs) exists in every language, keeps every parameter, and follows the language it is given.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const i18n=require('../desktop/i18n.cjs'),tx=require('../desktop/browser-services/tx.cjs');
const LOCALES=['en','es','fr','de','pt-BR','it','ja','zh-CN'];
const use=locale=>tx.setTranslator({t:(id,params)=>{i18n.setMainLocale(locale,'en-US');return i18n.tm(id,params);},locale:()=>i18n.setMainLocale(locale,'en-US')});
const {protectionSummary}=require('../desktop/browser-services/protection-summary.cjs'),risk=require('../desktop/browser-services/page-risk.cjs'),gate=require('../desktop/browser-services/threat-gate.cjs');
const summaryInput=extra=>({network:{engine:{},current:{gpc:true,dns:{mode:'secure',servers:['1.1.1.1']}}},filterLists:{updatedAt:Date.parse('2026-10-20'),automatic:true,refreshIntervalDays:4},antiTracking:{rows:[],settings:{phishingLists:true},stats:{threats:{state:'active',lists:[{entries:392000}]}}},safeBrowsing:{state:'ready'},cookieBanners:true,aiContent:true,metrics:{enabled:true},...extra});
const catalog=name=>JSON.parse(fs.readFileSync(path.join(__dirname,'../src/i18n',name+'.json'),'utf8'));
test.after(()=>tx.setTranslator(null));

test('every service id exists in all eight catalogs with the same parameters, and no non-English text is left as English',()=>{
 const en=catalog('en'),ids=Object.keys(en).filter(id=>/^(protection|risk|threat|forget|permission|dialog|error|usage|proxyTest|connection.(done|error)|vpn|privacy.(cname|redirects|params|amp|fingerprint)|dl|ext|https|proxy.(change|message|use)|sitedata|tor)\./.test(id));
 assert.ok(ids.length>=250,'ids: '+ids.length);
 const params=text=>[...text.matchAll(/\{(\w+)(?=[,}])/g)].map(m=>m[1]).sort().join(',');
 const keep=new Set(['protection.gpc.title','protection.dns.title','permission.label.microphone','protection.phishing.google','error.tech.url','error.tech.host','error.tech.port','ext.version','ext.compatIn']); // product or technical names that read the same
 for(const locale of LOCALES.slice(1)){const c=catalog(locale);for(const id of ids){assert.ok(typeof c[id]==='string'&&c[id].length,`${locale} lacks ${id}`);assert.equal(params(c[id]),params(en[id]),`${locale} ${id} parameters`);if(!keep.has(id)&&en[id].length>14)assert.notEqual(c[id],en[id],`${locale} ${id} is still English`);}}
});
test('the protection summary, in every language, has no raw ids, keeps product names and uses the language\'s own number grouping',()=>{
 for(const locale of LOCALES){use(locale);const {rows,scope}=protectionSummary(summaryInput());
  for(const text of [scope,...rows.flatMap(row=>[row.title,row.detail])])assert.doesNotMatch(text,/\b(protection|permission|risk|threat)\.[a-zA-Z.]+/,locale+': '+text.slice(0,60));
  const phishing=rows.find(row=>row.id==='phishing-malware');assert.match(phishing.detail,/OpenPhish/);assert.match(phishing.detail,/URLhaus/);assert.match(phishing.detail,/Google/);
  assert.match(phishing.detail,locale==='de'?/392\.000/:locale==='en'||locale==='ja'||locale==='zh-CN'?/392,000/:locale==='fr'?/392[\s\u202f\u00a0]000/:locale==='es'?/392\.?000/:/392\.000/,locale+' '+phishing.detail.slice(0,160));
  assert.match(rows.find(row=>row.id==='telemetry').detail,/github\.com/);
  assert.match(rows.find(row=>row.id==='dns').detail,/1\.1\.1\.1/);}
 use('en');const english=protectionSummary(summaryInput({metrics:{enabled:false}})).rows;
 assert.equal(english.find(row=>row.id==='ads-trackers').detail,'Blocked in every window, private ones too. Lists: refreshed 2026-10-20; checked for updates every few hours.');
 assert.match(english.find(row=>row.id==='telemetry').detail,/^No analytics or crash reports are sent\./);
 use('de');assert.equal(protectionSummary(summaryInput()).rows.find(row=>row.id==='ads-trackers').title,'Werbung und Tracker');
});
test('the analytics row names every host Acira contacts on its own, and its Google line follows the build',()=>{
 // What Acira fetches by itself, read from the code: the filter lists, the phishing and malware lists, the update host (updates, reviewed sites, spelling dictionaries) and Tor's.
 const hostOf=url=>new URL(url).hostname,filters=require('../desktop/browser-services/filter-updates.cjs').SOURCES.map(item=>hostOf(item.url)),threats=require('../desktop/browser-services/threat-lists.cjs').SOURCES.map(item=>hostOf(item.urls[0]));
 const updates=hostOf(require('../desktop/browser-services/update-hosts.cjs').HOST_URL),github=hostOf(require('../desktop/browser-services/update-hosts.cjs').GITHUB_FEED_URL);
 const {loadReleaseTarget,dictionaryUrl}=require('../packaging/release-target.cjs'),dictionaries=hostOf(dictionaryUrl(loadReleaseTarget()));
 assert.equal(dictionaries,updates,'the spelling dictionaries come from the update host, not github.com');
 use('en');
 const row=extra=>protectionSummary(summaryInput({metrics:{enabled:false},...extra})).rows.find(item=>item.id==='telemetry').detail;
 const text=row({});
 for(const host of new Set([...filters,...threats,updates,github,'Tor Project']))assert.ok(text.includes(host),'the analytics row does not name '+host);
 assert.match(text,/Pull requests folder, Acira asks github\.com/);
 assert.match(text,/Never from Google\./);assert.doesNotMatch(text,/Widevine/);
 const mac=row({widevine:true});assert.match(mac,/Widevine/);assert.doesNotMatch(mac,/Never from Google/);
 // Anonymous usage on: the sentence describes the real message and no longer says it depends on a configured server
 const on=protectionSummary(summaryInput({metrics:{enabled:true,configured:true}})).rows.find(item=>item.id==='telemetry').detail;
 assert.match(on,/^Anonymous usage is on: one small message a day with a random id, the app version, your system, your language and coarse counts\./);assert.doesNotMatch(on,/When configured/);
 assert.match(on,/Pull requests folder/);
 // The same hosts in Settings › Privacy › Update lists automatically
 const lists=catalog('en')['privacy.listsDetail'];for(const host of new Set(filters))assert.ok(lists.includes(host),'Update lists automatically does not name '+host);assert.doesNotMatch(lists,/raw\.githubusercontent\.com/);
 // The Anonymous usage tooltip no longer says the server is empty
 assert.doesNotMatch(catalog('en')['help.usage'],/empty|When configured/);
 // Every language: the new sentences exist, the Pull requests line names github.com, the Google line is in the language and the listed hosts survive translation
 for(const locale of LOCALES){use(locale);const detail=protectionSummary(summaryInput({metrics:{enabled:false}})).rows.find(item=>item.id==='telemetry').detail;
  assert.match(detail,/github\.com/,locale);assert.match(detail,/update\.acirabrowser\.com/,locale);assert.match(detail,/pgl\.yoyo\.org/,locale);assert.doesNotMatch(detail,/\bprotection\.telemetry\./,locale);}
});
test('page warnings and threat pages follow the language and carry the brand and domain',()=>{
 for(const locale of LOCALES){use(locale);
  const login=risk.explain('brand-login',{brand:'PayPal',domain:'paypal.com'});assert.equal(login.kind,'lookalike');assert.match(login.title,/PayPal/);assert.match(login.title,/paypal\.com/);assert.match(login.detail,/PayPal/);
  assert.match(risk.explain('homoglyph',{brand:'Apple',domain:'apple.com'}).detail,/apple\.com/);assert.match(risk.explain('brand-subdomain',{brand:'Google',domain:'google.com'}).title,/Google/);
  const clip=risk.explain('clipboard-command');assert.equal(clip.kind,'clickfix');assert.match(clip.detail,/Win\+R/);
  for(const kind of ['phishing','malware']){const words=gate.WORDS[kind];assert.ok(words.title&&words.cause&&words.detail);assert.doesNotMatch(words.title+words.cause+words.detail,/\bthreat\./);}}
 use('fr');assert.equal(gate.WORDS.phishing.title,'Acira a bloqué une page dangereuse');use('en');assert.equal(gate.WORDS.phishing.title,'Acira blocked a dangerous page');
});

test('proxy test messages and VPN provider notes follow the language',async()=>{
 const {checkProxy}=require('../desktop/browser-services/proxy-check.cjs'),vpn=require('../desktop/browser-services/vpn-detect.cjs');
 use('en');const english=await checkProxy({scheme:'http',host:'127.0.0.1',port:1},{timeoutMs:300});assert.match(english.message,/Nothing is listening at 127.0.0.1:1./);
 use('de');assert.match((await checkProxy({scheme:'http',host:'127.0.0.1',port:1},{timeoutMs:300})).message,/nimmt kein Dienst Verbindungen an/);
 for(const locale of LOCALES){use(locale);const notes=vpn.localizedProviders();assert.deepEqual(notes.map(item=>item.id),['mullvad','proton','ivpn']);for(const item of notes){assert.doesNotMatch(item.note,/^vpn./);assert.match(item.note,/Cure53|Securitum/);}}
 use('en');assert.equal(vpn.localizedProviders()[0].note,vpn.PROVIDERS[0].note,'English matches the audited English text');
});

test('privacy rows, download and Tor texts follow the language and keep their numbers',()=>{
 const {privacyPlusRows}=require('../desktop/browser-services/privacy-plus.cjs');
 const settings={cnameUncloaking:true,skipTrackingRedirects:false,stripTrackingParams:true,deAmp:true,fingerprint:'strict'};
 const stats={cname:{cloaked:3},navigation:{stripped:1,deAmped:2}};
 use('en');let rows=privacyPlusRows(settings,stats);
 assert.equal(rows[0].detail,'Blocks trackers disguised as part of a site (CNAME cloaking). Caught 3 so far this session.');assert.equal(rows[1].detail,'Off. Links go through tracking redirectors first.');
 assert.match(rows[2].detail,/Cleaned 1 link so far this session\.$/);assert.match(rows[3].detail,/Opened 2 original pages so far this session\.$/);assert.match(rows[4].detail,/^Strict\./);
 for(const locale of LOCALES.slice(1)){use(locale);rows=privacyPlusRows(settings,stats);for(const row of rows){assert.doesNotMatch(row.title+row.detail,/\b(privacy|dl|ext|tor)\.[a-zA-Z.]+/,locale);assert.ok(row.detail.length>8,locale);}assert.match(rows[0].detail,/3/,locale);assert.match(rows[0].detail,/CNAME/,locale);assert.match(rows[2].detail,/fbclid/,locale);}
 for(const locale of LOCALES.slice(1)){use(locale);for(const id of ['dl.started','dl.done','dl.failed']){assert.match(i18n.tm(id,{name:'file.zip'}),/file\.zip/,locale+' '+id);}assert.match(i18n.tm('https.detail',{origin:'http://x.test',followup:'F'}),/http:\/\/x\.test/,locale);assert.match(i18n.tm('ext.reviewDetail',{profile:'P',access:'ACCESS',notes:''}),/ACCESS/,locale);}
 use('de');assert.equal(tx.t('permission.allow'),'Erlauben');
});
