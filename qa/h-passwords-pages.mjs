// Stream H QA: in-page passwords in the real app, against LOCAL fake sites with FAKE credentials only. One Electron instance, ≤3 tabs,
// bounded waits, closed in finally. node qa/h-passwords-pages.mjs [--shots dir]   (D_VISIBLE=1 for a visible window)
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {startApp,poll,sleep} from './d-harness.mjs';
const shots=process.argv.includes('--shots')?process.argv[process.argv.indexOf('--shots')+1]:null;
const check=(ok,label)=>{console.log(`${ok?'ok  ':'FAIL'} ${label}`);if(!ok)process.exitCode=1;};
const GOOD='Correct-Pass-1!',NEWER='Newer-Pass-2!';
const page=(body,script='')=>`<!doctype html><meta charset=utf-8><title>Fake site</title><body style="font:16px system-ui;padding:40px">${body}<script>${script}</script>`;
const form=(action,fields,extra='')=>`<form method="post" action="${action}" id="f">${fields}<button type="submit" id="go">Go</button></form>${extra}`;
const login=(error='')=>page(`<h1>Sign in</h1>${error?`<p id="err">${error}</p>`:''}${form('/login','<p><input id="u" name="user" autocomplete="username"></p><p><input id="p" name="pw" type="password" autocomplete="current-password"></p>')}`);
let crossPort=0;
const server=http.createServer((req,res)=>{
 const send=(html,status=200)=>{res.writeHead(status,{'content-type':'text/html'});res.end(html);};
 const redirect=to=>{res.writeHead(302,{location:to});res.end();};
 if(req.method==='POST'){let body='';req.on('data',c=>body+=c);req.on('end',()=>{const f=new URLSearchParams(body);
  if(req.url==='/login')return (f.get('user')==='ada'&&[GOOD,NEWER].includes(f.get('pw')))?redirect('/home'):send(login('Wrong user name or password.'));
  if(req.url==='/api'){res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({ok:f.get('user')==='ada'&&[GOOD,NEWER].includes(f.get('pw'))}));}
  if(req.url==='/signup'||req.url==='/change')return redirect('/home');
  if(req.url==='/user')return redirect('/pass');
  if(req.url==='/pass')return redirect('/home');
  send('?',404);});return;}
 if(req.url==='/login')return send(login());
 if(req.url==='/user')return send(page(`<h1>Sign in</h1>${form('/user','<p><input id="u" name="identifier" autocomplete="username"></p>')}`));
 if(req.url==='/pass')return send(page(`<h1>Welcome back</h1>${form('/pass','<p><input id="p" name="pw" type="password" autocomplete="current-password"></p>')}`));
 if(req.url==='/home')return send(page('<h1>Welcome</h1><p>Signed in.</p>'));
 if(req.url==='/spa')return send(page('<h1>SPA sign in</h1><div id="box"><p id="msg"></p><p><input id="u" name="user" autocomplete="username"></p><p><input id="p" name="pw" type="password" autocomplete="current-password"></p><button id="go" type="button">Sign in</button></div>',
  `go.onclick=async()=>{const r=await fetch('/api',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({user:u.value,pw:p.value})});const j=await r.json();if(j.ok)box.innerHTML='<h1>Welcome back</h1>';else msg.textContent='Wrong user name or password.';}`));
 if(req.url==='/signup')return send(page(`<h1>Create account</h1>${form('/signup','<p><input id="u" name="email" type="email" autocomplete="username"></p><p><input id="p" name="pw" type="password" autocomplete="new-password"></p><p><input id="c" name="pw2" type="password" autocomplete="new-password"></p>')}`));
 if(req.url==='/change')return send(page(`<h1>Change password</h1>${form('/change','<p><input id="o" name="old" type="password" autocomplete="current-password"></p><p><input id="p" name="pw" type="password" autocomplete="new-password"></p><p><input id="c" name="pw2" type="password" autocomplete="new-password"></p>')}`));
 if(req.url==='/frame')return send(page(`<h1>Embedded sign in</h1><iframe id="x" src="http://localhost:${crossPort}/login" width="500" height="260"></iframe>`));
 send('not found',404);
});
const cross=http.createServer((req,res)=>{res.writeHead(200,{'content-type':'text/html'});res.end(login());});
await new Promise(r=>server.listen(0,'127.0.0.1',r));await new Promise(r=>cross.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;crossPort=cross.address().port;
const root=path.resolve(`.qa-profiles/h-pwp-${Date.now()}`);await fs.mkdir(root,{recursive:true});
let t;
async function shot(name){if(!shots)return;await fs.mkdir(shots,{recursive:true});await sleep(350);const png=await t.main(async({BaseWindow,desktopCapturer})=>{const w=BaseWindow.getAllWindows()[0];w.focus();for(const v of w.contentView.children)try{v.webContents.invalidate();}catch{}await new Promise(r=>setTimeout(r,300));const [cw,ch]=w.getSize();const sources=await desktopCapturer.getSources({types:['window'],thumbnailSize:{width:cw,height:ch}});const s=sources.find(x=>x.id===w.getMediaSourceId());return s?s.thumbnail.toPNG().toString('base64'):'';});if(png)await fs.writeFile(path.join(shots,`${name}.png`),Buffer.from(png,'base64'));
 const own=await t.main(async({BaseWindow})=>{const w=BaseWindow.getAllWindows()[0];const v=w.contentView.children.find(c=>{try{return c.webContents.getURL().endsWith('prompt-frame.html')&&c.getVisible();}catch{return false;}});if(!v)return '';const img=await v.webContents.capturePage();return img.toPNG().toString('base64');});
 if(own)await fs.writeFile(path.join(shots,`${name}-frame.png`),Buffer.from(own,'base64'));}
try{
 t=await startApp({root,env:{ACIRA_PASSWORDS_TEST_GATE:'allow'}});
 const uiScale=Number(process.env.H_PW_SCALE||100)/100;// H_PW_SCALE=125 reruns everything at 125% interface scale
 if(uiScale!==1){await t.act({type:'settings.update',patch:{interfaceScale:uiScale*100}});await sleep(800);}
 const api=r=>t.ui.evaluate(r=>window.acira.passwords(r),r).then(x=>x.passwords);
 const frameUi=()=>t.context.pages().find(p=>{try{return p.url().endsWith('prompt-frame.html');}catch{return false;}});
 const frameState=async()=>{const f=frameUi();if(!f)return {mode:'none'};try{return await f.evaluate(()=>{const shown=id=>{const el=document.getElementById(id);return !el.hidden&&el.getBoundingClientRect().height>0&&getComputedStyle(el).display!=='none';};return ({panel:shown('panel'),list:shown('list'),save:shown('save'),title:document.getElementById('titleText').textContent,host:document.getElementById('host').textContent,user:document.getElementById('user').textContent,pass:document.getElementById('pass').textContent,rows:[...document.querySelectorAll('.row')].map(r=>r.textContent),primary:document.getElementById('primary').textContent});});}catch{return {mode:'none'};}};
 const frameVisible=()=>t.main(({BaseWindow})=>{const w=BaseWindow.getAllWindows()[0];return w.contentView.children.some(v=>{try{return v.webContents.getURL().endsWith('prompt-frame.html')&&v.getVisible()&&v.getBounds().width>0;}catch{return false;}});});
 const waitFrame=(label,test,ms=8000)=>poll(frameState,test,label,ms);
 const open=async url=>{const home=(await t.state()).activeTabId;await t.act({type:'tab.navigate',tabId:home,url});const p=await t.waitWeb(u=>u===url||u.startsWith(url));await sleep(900);return p;};
 const type=async(p,sel,text)=>{await p.click(sel);await p.keyboard.type(text,{delay:8});};
 const quiet=async(label)=>{await sleep(2600);const s=await frameState();check(!(s.panel&&(s.save||s.list))&&!(await frameVisible()),label);};
 const waitList=async(label)=>{await waitFrame(label,s=>s.list&&s.rows?.length>0);};

 // 1. A failed sign-in never prompts.
 let p=await open(`${base}/login`);
 await type(p,'#u','ada');await type(p,'#p','Wrong-pass-0!');await p.click('#go');
 await poll(()=>p.evaluate(()=>document.getElementById('err')?.textContent||''),v=>/Wrong/.test(v),'error page shown',8000);
 await quiet('a failed sign-in shows no prompt');
 // 2. A real sign-in: offer to save.
 p=await t.waitWeb(u=>u.startsWith(`${base}/login`));
 await type(p,'#u','ada');await type(p,'#p',GOOD);await p.click('#go');
 const save=await waitFrame('save prompt',s=>s.save&&/Save password/.test(s.title),12000);
 check(save.host==='127.0.0.1:'+new URL(base).port&&save.user==='ada'&&/^•+$/.test(save.pass),`prompt names the site and user, password masked (${save.host} / ${save.user} / ${save.pass})`);
 check(!JSON.stringify(save).includes(GOOD),'the frame never receives the password');
 check(await frameVisible(),'the prompt view is on screen');
 {// Anchored like Chrome's: under the right end of the address field, 4px below it, right edges lined up.
  const field=await t.ui.evaluate(()=>{const b=document.querySelector('.address-field').getBoundingClientRect();return {x:b.left,y:b.top,width:b.width,height:b.height};}).then(r=>({x:r.x*uiScale,y:r.y*uiScale,width:r.width*uiScale,height:r.height*uiScale}));
  const box=await t.main(({BaseWindow})=>{const w=BaseWindow.getAllWindows()[0];const v=w.contentView.children.find(c=>{try{return c.webContents.getURL().endsWith('prompt-frame.html')&&c.getVisible();}catch{return false;}});return v?v.getBounds():null;});
  check(Boolean(box)&&Math.abs(box.y-(field.y+field.height+4))<=2&&Math.abs((box.x+box.width)-(field.x+field.width))<=2,'the save prompt hangs under the right end of the address field ('+JSON.stringify({field,box})+')');
 }await poll(()=>frameUi().evaluate(()=>getComputedStyle(document.getElementById('panel')).opacity),v=>v==='1','prompt fully visible',4000);check(true,'the prompt finishes its enter animation (opacity 1)');await shot('passwords-save-prompt');
 await frameUi().locator('#primary').click();
 await poll(()=>api({type:'passwords.list'}).then(r=>r.items.length),n=>n===1,'saved',6000);check(true,'Save stores the login');
 await poll(frameVisible,v=>!v,'prompt closed',4000);
 // 3. Suggestions on the same site, filled only on a click in Acira's list.
 p=await open(`${base}/login`);
 await p.click('#u');await waitList('suggestion list');
 check((await frameState()).rows[0]?.includes('ada'),'focus on the username shows the saved login');await shot('passwords-suggestions');
 check((await p.inputValue('#p'))===''&&(await p.inputValue('#u'))==='','nothing filled until the user picks it');
 await frameUi().locator('.row').first().click();
 await poll(()=>p.inputValue('#p'),v=>v===GOOD,'filled',5000);check((await p.inputValue('#u'))==='ada','a click fills username and password');
 check(!(await p.evaluate(()=>document.documentElement.outerHTML)).includes(GOOD),'the password is a field value only, never in page markup');
 check(!(await frameVisible()),'the list closes after filling');
 // 4. Keyboard path.
 p=await open(`${base}/login`);await p.click('#p');await waitList('list on password focus');
 await p.keyboard.press('ArrowDown');await poll(async()=>(await frameState()).rows?.length&&await frameUi().locator('.row[data-active]').count(),n=>n===1,'row highlighted',4000);
 await p.keyboard.press('Enter');await poll(()=>p.inputValue('#p'),v=>v===GOOD,'filled by keyboard',5000);check(true,'ArrowDown + Enter fills');
 p=await open(`${base}/login`);await p.click('#u');await waitList('list again');await p.keyboard.press('Escape');await poll(frameVisible,v=>!v,'Escape closes',4000);check(true,'Escape closes the list');
 // 5. A changed password offers Update.
 await t.act({type:'settings.update',patch:{appearance:'dark'}});await sleep(600);
 p=await open(`${base}/login`);await type(p,'#u','ada');await type(p,'#p',NEWER);await p.click('#go');
 const update=await waitFrame('update prompt',s=>s.save&&/Update password/.test(s.title),12000);check(update.primary==='Update','a different password for a saved user offers Update');
 await poll(()=>frameUi().evaluate(()=>getComputedStyle(document.getElementById('panel')).opacity),v=>v==='1','dark prompt visible',4000);await shot('passwords-update-prompt-dark');
 await frameUi().locator('#primary').click();await t.act({type:'settings.update',patch:{appearance:'light'}});
 await poll(async()=>{const l=await api({type:'passwords.list'});return l.items.length===1&&(await api({type:'passwords.reveal',id:l.items[0].id})).password===NEWER;},Boolean,'updated in place',6000);check(true,'Update replaces the saved password (still one login)');
 // 6. Single-page sign-in.
 p=await open(`${base}/spa`);await type(p,'#u','ada');await type(p,'#p','Wrong-pass-0!');await p.click('#go');await poll(()=>p.evaluate(()=>document.getElementById('msg')?.textContent||''),v=>/Wrong/.test(v),'spa error',6000);
 await quiet('SPA failure: no prompt');
 await p.click('#p');await p.keyboard.press('Control+A');await p.keyboard.type(GOOD,{delay:8});await p.click('#go');
 // existing login with the same password: silent. With NEWER stored, GOOD differs -> update offer.
 await waitFrame('SPA success -> update offer',s=>s.save&&/Update/.test(s.title),12000);check(true,'SPA success (form disappears) offers Update for the changed password');await frameUi().locator('#close').click();
 // 7. Sign-up: strong password suggestion fills both fields; the prompt follows.
 const before=(await api({type:'passwords.list'})).items.length;
 p=await open(`${base}/signup`);await p.click('#p');await waitFrame('generator row',s=>s.list&&s.rows?.some(r=>/strong password/.test(r)));check(true,'new-password field offers a strong password');await shot('passwords-generate');
 await frameUi().locator('.row').first().click();
 await poll(()=>p.inputValue('#p'),v=>v.length===20,'generated',5000);const gen=await p.inputValue('#p');check((await p.inputValue('#c'))===gen,'the same password fills the confirm field');
 await type(p,'#u','newbie@example.test');await p.click('#go');
 await waitFrame('save prompt for signup',s=>s.save&&/Save password/.test(s.title),12000);await frameUi().locator('#primary').click();
 await poll(()=>api({type:'passwords.list'}).then(r=>r.items.length),n=>n===before+1,'signup saved',6000);
 const created=(await api({type:'passwords.list'})).items.find(i=>i.username==='newbie@example.test');check(Boolean(created),'the generated password was saved for the new account');
 // 8. Change password form: update the saved login.
 p=await open(`${base}/change`);await type(p,'#o','x-old-1');await type(p,'#p','Changed-3-Strong!');await type(p,'#c','Changed-3-Strong!');await p.click('#go');
 await waitFrame('change prompt',s=>s.save,12000);check(true,'change-password submits are noticed');await frameUi().locator('#close').click();
 // 8b. Username-first sign-in (user name page, then password page): the saved login carries the first page's username.
 p=await open(`${base}/user`);await type(p,'#u','grace@fake.test');await p.click('#go');await p.waitForURL(u=>u.pathname==='/pass',{timeout:8000});await type(p,'#p','Second-Step-4!');await p.click('#go');
 const stepSave=await waitFrame('username-first prompt',s=>s.save&&/Save password/.test(s.title),12000);check(stepSave.user==='grace@fake.test','username-first: the prompt carries the username typed on the previous page');
 await frameUi().locator('#primary').click();await poll(async()=>(await api({type:'passwords.list'})).items.some(i=>i.username==='grace@fake.test'),v=>v,'username-first saved',6000);check(true,'username-first sign-in saved with its username');
 p=await open(`${base}/user`);await type(p,'#u','grace@fake.test');await p.click('#go');await p.waitForURL(u=>u.pathname==='/pass',{timeout:8000});await p.click('#p');await waitList('password page offers the typed account');
 check((await frameState()).rows.length===1&&/grace@fake.test/.test((await frameState()).rows[0]),'the password page offers only the account just typed');await p.keyboard.press('Escape');
 // 9. Never for this site (on another origin spelling: localhost).
 const alt=base.replace('127.0.0.1','localhost');
 p=await open(`${alt}/login`);await type(p,'#u','ada');await type(p,'#p',GOOD);await p.click('#go');
 await waitFrame('prompt on localhost',s=>s.save,12000);await frameUi().locator('#never').click();
 await poll(frameVisible,v=>!v,'never closes',4000);
 p=await open(`${alt}/login`);await type(p,'#u','ada');await type(p,'#p',GOOD);await p.click('#go');await quiet('after Never, no more prompts for that site');
 check((await api({type:'passwords.list'})).never.some(n=>n.origin===alt),'the site is in the never-saved list');
 // 10. Cross-origin iframe: nothing offered, nothing captured.
 const n0=(await api({type:'passwords.list'})).items.length;
 p=await open(`${base}/frame`);const inner=p.frames().find(f=>f.url().includes(`localhost:${crossPort}`));
 if(inner){await inner.click('#u');await p.keyboard.type('ada',{delay:8});await inner.click('#p');await p.keyboard.type(GOOD,{delay:8});await inner.click('#go');}
 await quiet('a sign-in form inside a cross-origin iframe is ignored');check((await api({type:'passwords.list'})).items.length===n0,'nothing saved from the iframe');
 // 11. The setting off: no prompts.
 await api({type:'passwords.settings',enabled:false});p=await open(`${base}/login`);await type(p,'#u','ada');await type(p,'#p',NEWER);await p.click('#go');await quiet('offer to save switched off: no prompt');await api({type:'passwords.settings',enabled:true});
 // 12. Private windows get nothing.
 await t.ui.evaluate(()=>window.acira.openWindow('private'));
 const priv=await poll(()=>t.context.pages().find(x=>{try{return x.url()==='acira-browser-ui://ui/index.html'&&x!==t.ui;}catch{return false;}}),Boolean,'private window',10000);
 await poll(()=>priv.evaluate(()=>Boolean(window.acira?.getSnapshot)),Boolean,'private ready');
 const ps=await priv.evaluate(()=>window.acira.getSnapshot());await priv.evaluate(async([id,url])=>{await window.acira.dispatch({type:'tab.navigate',tabId:id,url});},[ps.activeTabId,`${base}/login`]);
 const pp=await poll(()=>t.context.pages().find(x=>{try{return x.url().startsWith(`${base}/login`)&&x!==p;}catch{return false;}}),Boolean,'private page',10000).catch(()=>null);
 if(pp){await sleep(900);await pp.click('#u');await sleep(1500);}
 check(!(await frameVisible()),'private windows never show suggestions or prompts');
}finally{if(t)await t.close();server.close();cross.close();}
