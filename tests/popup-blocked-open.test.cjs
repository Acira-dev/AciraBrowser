'use strict';
// A refused window is never a dead end: "Pop-up blocked · Open" (a window the page asked for without a click or key press) and "Pop-up ad blocked. · Open" (a window
// the pop-up ad rules refused) both carry an Open action that puts the address in a new tab beside the page, in its profile and privacy. Only web addresses get it.
// Founder, 2 Nov 2026: pop-ups opened by a click (sign-in windows) always open; only those without a gesture are blocked, and the blocked one can be opened.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','desktop','main.cjs'),'utf8');
const helper=source.match(/const blockedPopupOpen=\(c,tabId,entry,url\)=>\{.*?\};(?=const popupGate=)/s)?.[0];
const blockedPopupOpen=helper&&new Function('tm',helper+'return blockedPopupOpen;')(id=>({'main.open':'Open'})[id]||id);
test('the Open action opens the refused address in a new tab beside the page, in the same profile and privacy',()=>{
 assert.ok(blockedPopupOpen,'blockedPopupOpen is defined right before the pop-up gate');
 const c={state:{tabs:[{id:'tab-1',browserProfileId:'work'}]}};
 assert.deepEqual(blockedPopupOpen(c,'tab-1',{},'https://accounts.example/sign-in?x=1'),{label:'Open',labelId:'main.open',command:{type:'tab.new',url:'https://accounts.example/sign-in?x=1',afterId:'tab-1',browserProfileId:'work'}});
 assert.deepEqual(blockedPopupOpen(c,'tab-1',{privateTab:true,privacy:'private'},'http://example.com/').command.privacy,'private','a private tab opens it privately');
 for(const url of ['javascript:alert(1)','file:///etc/passwd','about:blank','data:text/html,x','',undefined])assert.equal(blockedPopupOpen(c,'tab-1',{},url),undefined,String(url));
 assert.equal(blockedPopupOpen(c,'tab-9',{},'https://example.com/'),undefined,'an unknown tab gets no action');
});
test('both refusals carry it: the gesture gate ("Pop-up blocked", in every language) and the pop-up ad rules',()=>{
 assert.match(source,/createPopupGate\(\{onBlocked:\(wc,details\)=>\{.*?const open=blockedPopupOpen\(c,found\[0\],found\[1\],details\?\.url\);c\.toast\(tm\('main\.popupBlocked'\),\{i18n:\{id:'main\.popupBlocked'\},tone:'info',\.\.\.\(open\?\{action:open\}:\{\}\)\}\)/s);
 assert.match(source,/if\(verdict\?\.block\)\{const open=blockedPopupOpen\(\{state\},tab\.id,entry,details\.url\);dispatch\(\{type:'toast',text:tm\('main\.popupAdBlocked'\),tone:'info',\.\.\.\(open\?\{action:open\}:\{\}\)\}\);return \{action:'deny'\};\}/);
 for(const file of fs.readdirSync(path.join(__dirname,'..','src','i18n')).filter(name=>/^[a-z]{2}(-[A-Z]{2})?\.json$/.test(name))){const messages=JSON.parse(fs.readFileSync(path.join(__dirname,'..','src','i18n',file),'utf8'));assert.ok(messages['main.popupBlocked']&&messages['main.open'],file);}
});
