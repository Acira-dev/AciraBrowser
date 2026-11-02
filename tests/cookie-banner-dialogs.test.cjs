'use strict';
// Hiding cookie banners must never hide or unlock a site's own dialogs, and must never leave a page that cannot scroll.
// A reviewer turned protection off because "the log-in button in Reddit" and other dialogs were blocked. In the frame script (content-filter-preload.cjs) a cookie rule
// that matched any element (EasyList Cookie's `.grecaptcha-badge`, on Reddit and most sign-in pages) kept a "veil and scroll lock" clean-up running for the page's whole
// life: a picture viewer or a dimmed layer that a sign-in form arrives in was hidden as a "veil", the site's scroll lock under its dialog was released, a cover video's
// tint and bild.de's menu were hidden; and Sourcepoint's lock (bild.de, welt.de, faz.net, spiegel.de) was never seen, so those pages could not scroll at all.
// Runs the real frame script in hidden Electron windows against tests/fixtures/cookie-banners/page.html with the real cookie lists, clicking as a person would.
const {test}=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),path=require('node:path'),fs=require('node:fs');
const electron=(()=>{try{const value=require('electron');return typeof value==='string'&&fs.existsSync(value)?value:null;}catch{return null;}})();
const CASES=[
 {name:'sign-in',case:'sign-in',steps:[{at:6000,name:'before'},{at:6500,click:'#login'},{at:11500,name:'after'}]},
 {name:'sign-in-early',case:'sign-in',steps:[{at:1500,click:'#login'},{at:7500,name:'after'}]},
 {name:'sign-in-slow',case:'sign-in-slow',steps:[{at:1500,click:'#login'},{at:7500,name:'after'}]},
 {name:'sign-in-slow-first',case:'sign-in-slow',steps:[{at:0,click:'#login'},{at:7000,name:'after'}]},
 {name:'lightbox',case:'lightbox',steps:[{at:1500,click:'#photo'},{at:7500,name:'after'}]},
 {name:'lightbox-first',case:'lightbox',steps:[{at:0,click:'#photo'},{at:7000,name:'after'}]},
 {name:'shadow-lightbox',case:'shadow-lightbox',steps:[{at:1500,click:'#photo'},{at:7500,name:'after'}]},
 {name:'hero',case:'hero',steps:[{at:6500,name:'after'}]},
 {name:'sourcepoint',case:'sourcepoint',steps:[{at:6500,name:'after'}]},
 {name:'wall',case:'wall',steps:[{at:6000,name:'unlocked'},{at:6500,click:'#open'},{at:8000,name:'dialog'},{at:8500,click:'#close'},{at:10000,name:'closed'}]},
 {name:'wall-stuck',case:'wall-stuck',steps:[{at:7500,name:'after'}]},
 {name:'consent-page',case:'consent-page',steps:[{at:7500,name:'after'}]},
 {name:'sourcepoint-later',case:'sourcepoint',steps:[{at:10000,name:'after'}]},
 {name:'shadow-page',case:'shadow-page',steps:[{at:7500,name:'after'}]},
 {name:'answer-first',case:'hero',delay:true,steps:[{at:1500,name:'waiting'},{at:6500,name:'after'}]}
];
let results=null,problem=null;
if(electron){
 const env={...process.env,ELECTRON_ENABLE_LOGGING:'0'};delete env.ELECTRON_RUN_AS_NODE;
 const run=spawnSync(electron,[path.join(__dirname,'fixtures','cookie-banners','run.cjs'),JSON.stringify(CASES)],{encoding:'utf8',timeout:90000,env});
 const line=(run.stdout||'').split(/\r?\n/).find(text=>text.startsWith('RESULT '));
 if(line)results=Object.fromEntries(JSON.parse(line.slice(7)).map(item=>[item.name,item.steps]));else problem=((run.stdout||'')+(run.stderr||'')).split(/\r?\n/).filter(text=>!/^\[\d+:/.test(text)).join('\n').slice(0,600)||'electron produced no result';
}
const skip=!electron?'electron binary not available':false;
test('fixture run finished',{skip},()=>{assert.ok(results,problem);assert.equal(Object.keys(results).length,CASES.length);});
test('a sign-in dialog opened after the page settled stays, with its dimmed backdrop and the site\'s own scroll lock',{skip},()=>{
 const {before,after}=results['sign-in'];
 assert.equal(before.badge,false,'the cookie list is at work: EasyList Cookie hides the reCAPTCHA badge');
 assert.equal(after.dialog,true,'the dialog');assert.equal(after.backdrop,true,'its backdrop is not a veil');assert.equal(after.locked,true,'the page stays still under the dialog: '+after.bodyOverflow);assert.equal(after.marked,0);
});
test('a sign-in dialog opened while a hidden banner is still being watched stays too',{skip},()=>{
 const {after}=results['sign-in-early'];
 assert.equal(after.dialog,true);assert.equal(after.backdrop,true);assert.equal(after.locked,true,'site lock: '+after.bodyOverflow);assert.equal(after.marked,0);assert.equal(after.badge,false,'no banner comes back');
});
for(const name of ['sign-in-slow','sign-in-slow-first'])test(`a dimmed layer that shows a spinner and then receives the sign-in form is never hidden (${name==='sign-in-slow'?'clicked while a hidden banner is watched':'clicked before the banner was found'})`,{skip},()=>{
 const {after}=results[name];
 assert.equal(after.backdrop,true,'the layer');assert.equal(after.dialog,true,'the form inside it');assert.equal(after.locked,true,'site lock: '+after.bodyOverflow);assert.equal(after.marked,0);
});
for(const name of ['lightbox','lightbox-first','shadow-lightbox'])test(`a picture viewer (a dark window-sized layer with only a picture in it) stays (${name})`,{skip},()=>{
 const {after}=results[name];
 assert.equal(after.dialog,true);assert.equal(after.locked,true,'site lock: '+after.bodyOverflow);assert.equal(after.marked,0);assert.equal(after.badge,false,'the site\'s own dialog does not bring the banners back');
});
test('a cover video\'s tint is part of the page, not a veil, while the cookie banner is hidden',{skip},()=>{
 const {after}=results.hero;
 assert.equal(after.banner,false,'banner hidden');assert.equal(after.tint,true,'tint kept');assert.equal(after.marked,0);
});
test('Sourcepoint\'s message is hidden and its lock let go: the page scrolls (bild.de, welt.de, faz.net, spiegel.de)',{skip},()=>{
 const {after}=results.sourcepoint;
 assert.equal(after.sourcepoint,false);assert.equal(after.locked,false,`body ${after.bodyPosition}, overflow ${after.bodyOverflow}`);assert.notEqual(after.bodyPosition,'fixed');
});
test('a consent manager\'s veil and lock go with its banner; the site\'s own dialog later still holds the page, and the release comes back when it closes',{skip},()=>{
 const {unlocked,dialog,closed}=results.wall;
 assert.equal(unlocked.banner,false);assert.equal(unlocked.veil,false,'veil hidden');assert.equal(unlocked.locked,false,'page scrolls: '+unlocked.bodyOverflow);
 assert.equal(dialog.dialog,true);assert.equal(dialog.locked,true,'the site\'s lock holds under its dialog: '+dialog.bodyOverflow);
 assert.equal(closed.dialog,false);assert.equal(closed.locked,false,'scrolls again after the dialog closed: '+closed.bodyOverflow);
});
test('a lock that cannot be let go gives the banner back, so the person can answer it',{skip},()=>{
 const {after}=results['wall-stuck'];
 assert.equal(after.banner,true,'the banner is back');assert.equal(after.veil,true);
});
test('a consent page that has nothing else on it (derstandard.at/consent/tcf/) keeps its banner, so the person can choose',{skip},()=>{
 assert.equal(results['consent-page'].after.sourcepoint,true,'the message is back');
 assert.equal(results['sourcepoint-later'].after.sourcepoint,false,'a page with content keeps its message hidden after the watch');
 assert.equal(results['shadow-page'].after.banner,false,'a page drawn in a shadow tree is not empty: its banner stays hidden');
});
test('with answering on too, hiding waits so the banner can be answered first, then hides what is left',{skip},()=>{
 const {waiting,after}=results['answer-first'];
 assert.equal(waiting.banner,true,'still shown while it can be answered');assert.equal(after.banner,false,'hidden after the wait');
});
test('the release outranks a site\'s lock rule, and after the person acts only what already held the page is the banner\'s',()=>{
 const source=fs.readFileSync(path.join(__dirname,'..','desktop','browser-services','content-filter-preload.cjs'),'utf8');
 assert.match(source,/:root:not\(#acira-u\):not\(#acira-u\)>body:not\(#acira-u\)\{overflow-y:auto!important\}/);
 assert.match(source,/veil&&held\(veil\)&&count<4/);assert.match(source,/\(!inputAt\|\|lockedAtInput\)&&scrollLocked\(\)/);
 assert.match(source,/addEventListener\(type,onInput,\{capture:true,passive:true\}\)/);
 assert.doesNotMatch(source,/querySelectorAll\('body \*'\)/,'no walk over the whole page to find a veil');
});
