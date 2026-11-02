'use strict';
// Password content script, registered for every frame of a profile session (session.registerPreloadScript) and active only in
// the MAIN frame of http(s) pages. It runs in Electron's isolated world: page scripts can't see its variables or its IPC.
//  - It observes sign-in forms (real user actions only) and tells the main process what was submitted; it never decides what to
//    save, which origin a login belongs to, or what to fill: the origin comes from the browser process, the fill from main.
//  - It reports focus on username/password fields so main can show the suggestion list (a separate native view).
//  - It fills fields when main says so, using the native value setter + input/change events so frameworks notice.
// Heuristics follow Chromium's form parsing in spirit: a visible <input type=password> defines a sign-in form; the username is
// the closest preceding visible text/email/tel field (autocomplete=username and name/id hints win); one password field is a
// sign-in, two (or autocomplete=new-password) a sign-up, three a change-password form.
const {ipcRenderer}=require('electron');

if(process.isMainFrame&&/^https?:$/.test(location.protocol)){
 const docId=Math.random().toString(36).slice(2)+Date.now().toString(36),bornAt=Date.now();let settledAt=document.readyState==='complete'?bornAt:0;
 const ids=new WeakMap(),elements=new Map();let counter=0,open=false,lastSubmit=0,sentFocusAt=0,quietUntil=0;
 const MAX_USER=512,MAX_PASSWORD=1024;
 const send=(channel,payload)=>{try{ipcRenderer.send(channel,{docId,...payload});}catch{}};
 const idOf=el=>{let id=ids.get(el);if(!id){id=`f${++counter}`;ids.set(el,id);elements.set(id,new WeakRef(el));if(elements.size>400)for(const [key,ref] of elements){if(!ref.deref())elements.delete(key);if(elements.size<=300)break;}}return id;};
 const byId=id=>elements.get(id)?.deref()||null;
 const tokens=el=>String(el.getAttribute('autocomplete')||'').toLowerCase().split(/\s+/).filter(Boolean);
 const visible=el=>{
  if(!el||!el.isConnected||el.disabled)return false;
  const rect=el.getBoundingClientRect();if(rect.width<2||rect.height<2)return false;
  const style=getComputedStyle(el);return style.visibility!=='hidden'&&style.display!=='none'&&style.opacity!=='0';
 };
 const isInput=el=>el instanceof HTMLInputElement;
 const isPassword=el=>isInput(el)&&el.type==='password';
 const isTextLike=el=>isInput(el)&&['text','email','tel',''].includes(el.type)&&!el.readOnly;
 const scopeOf=el=>el.form||el.closest('form')||document.body;
 const passwordsIn=scope=>[...scope.querySelectorAll('input[type=password]')].filter(visible);
 const follows=(a,b)=>Boolean(a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING);
 const HINT=/user|login|email|account|phone|identifier|signin/i;
 function usernameFor(password){
  const scope=scopeOf(password),candidates=[...scope.querySelectorAll('input')].filter(el=>isTextLike(el)&&visible(el)&&follows(el,password));
  if(!candidates.length)return null;
  const hinted=candidates.filter(el=>tokens(el).includes('username')||tokens(el).includes('email')||HINT.test(`${el.name} ${el.id}`));
  return (hinted.length?hinted:candidates).at(-1);
 }
 /** {kind, passwords, current, fresh, username} for the sign-in form that contains this password field. */
 function analyze(password){
  const scope=scopeOf(password),passwords=passwordsIn(scope),fresh=passwords.filter(el=>tokens(el).includes('new-password'));
  let kind='login',current=passwords[0],next=[];
  if(passwords.length>=3){kind='change';current=passwords[0];next=passwords.slice(1,3);}
  else if(passwords.length===2||fresh.length){kind=passwords.length===2&&!fresh.length&&tokens(passwords[0]).includes('current-password')?'change':'signup';current=kind==='change'?passwords[0]:null;next=kind==='change'?[passwords[1]]:(fresh.length?fresh:passwords);}
  return {kind,passwords,current,fresh:next,username:usernameFor(passwords[0])};
 }
 const rectOf=el=>{const r=el.getBoundingClientRect();return {x:r.left,y:r.top,width:r.width,height:r.height};};
 function describe(el){
  if(isPassword(el)){
   const info=analyze(el),isNew=info.fresh.includes(el);
   return {role:isNew?'new-password':'password',kind:info.kind,fieldId:idOf(el),usernameId:info.username?idOf(info.username):'',passwordIds:info.passwords.map(idOf),freshIds:info.fresh.map(idOf),rect:rectOf(el)};
  }
  if(isTextLike(el)){
   const scope=scopeOf(el),password=passwordsIn(scope).find(p=>follows(el,p));
   if(!password||usernameFor(password)!==el)return null;
   const info=analyze(password);
   return {role:'username',kind:info.kind,fieldId:idOf(el),usernameId:idOf(el),passwordIds:info.passwords.map(idOf),freshIds:info.fresh.map(idOf),rect:rectOf(el)};
  }
  return null;
 }
 const announce=el=>{const info=el&&describe(el);if(!info)return;const now=Date.now();if(now<quietUntil||now-sentFocusAt<80)return;sentFocusAt=now;send('acira:pw-focus',info);};

 // --- what the user submitted ---------------------------------------------------------------------------------------
 function snapshot(scope){
  const passwords=passwordsIn(scope);if(!passwords.length)return null;
  const info=analyze(passwords[0]),username=info.username?info.username.value.trim():'';
  let password='',previous='';
  if(info.kind==='login')password=info.current.value;
  else if(info.kind==='signup'){const [a,b]=info.fresh;password=a.value;if(b&&b.value!==password)return null;}
  else{previous=info.current.value;const [a,b]=info.fresh;password=a.value;if(b&&b.value!==password)return null;}
  if(!password||password.length>MAX_PASSWORD||username.length>MAX_USER)return null;
  return {kind:info.kind,username,password,hadPrevious:Boolean(previous),passwords:info.passwords};
 }
 function submitted(scope){
  const now=Date.now();if(now-lastSubmit<700)return;
  // A real user gesture must be recent: a page calling requestSubmit() by itself never produces a prompt.
  if(!(navigator.userActivation&&navigator.userActivation.isActive))return;
  const shot=snapshot(scope);if(!shot)return;lastSubmit=now;
  send('acira:pw-submit',{kind:shot.kind,username:shot.username,password:shot.password,hadPrevious:shot.hadPrevious});
  watchForm(shot.passwords);
 }
 // Username-first sign-ins (Google, Microsoft): the first page asks only for the username, the next for the password. The username step
 // is reported (main keeps it in memory for this tab and origin for a few minutes) so the password page can be saved with it.
 // Only a lone visible field that names itself a username, email or phone counts; search boxes and forms with other inputs never do.
 let lastStep=0;
 function usernameStep(scope){
  if(Date.now()-lastStep<700||passwordsIn(scope).length||!(navigator.userActivation&&navigator.userActivation.isActive))return;
  const fields=[...scope.querySelectorAll('input')].filter(el=>isTextLike(el)&&visible(el));
  if(fields.length!==1)return;
  const field=fields[0];if(field.type==='search'||field.closest('[role=search],search'))return;
  if(!(field.type==='email'||tokens(field).includes('username')||tokens(field).includes('email')||HINT.test(`${field.name} ${field.id}`)))return;
  const username=field.value.trim();if(!username||username.length>MAX_USER)return;
  lastStep=Date.now();send('acira:pw-username',{username});
 }
 /** Single-page sign-ins: the form disappearing is the success signal; staying visible is failure. */
 function watchForm(fields){
  const started=Date.now(),timer=setInterval(()=>{
   const gone=fields.every(el=>!el.isConnected||!visible(el));
   if(gone){clearInterval(timer);send('acira:pw-form-gone',{});}
   else if(Date.now()-started>5000){clearInterval(timer);send('acira:pw-form-stays',{});}
  },250);
 }
 addEventListener('submit',event=>{if(!event.isTrusted)return;const form=event.target;if(form instanceof HTMLFormElement){if(passwordsIn(form).length)submitted(form);else usernameStep(form);}},true);
 addEventListener('click',event=>{
  if(!event.isTrusted||event.button!==0)return;
  const target=event.target instanceof Element?event.target.closest('button,input[type=submit],input[type=button],a[role=button],[role=button]'):null;
  if(target){const scope=target.closest('form')||document.body;if(passwordsIn(scope).some(p=>p.value))setTimeout(()=>submitted(scope),0);else setTimeout(()=>usernameStep(scope),0);}
  const field=event.target instanceof Element?event.target.closest('input'):null;if(field&&field===document.activeElement)announce(field);
 },true);
 addEventListener('keydown',event=>{
  if(!event.isTrusted)return;
  if(open&&['ArrowDown','ArrowUp','Enter','Escape'].includes(event.key)&&!event.shiftKey&&!event.altKey&&!event.ctrlKey&&!event.metaKey){event.preventDefault();event.stopImmediatePropagation();send('acira:pw-key',{key:event.key});return;}
  if(event.key==='ArrowDown'&&!open&&document.activeElement&&describe(document.activeElement))announce(document.activeElement);
  if(event.key==='Enter'&&!event.target.form){if(isPassword(event.target))setTimeout(()=>submitted(document.body),0);else if(isTextLike(event.target))setTimeout(()=>usernameStep(document.body),0);}
 },true);

 // --- suggestion list triggers --------------------------------------------------------------------------------------
 addEventListener('focusin',event=>{if(event.target instanceof Element&&event.isTrusted!==false)announce(event.target);},true);
 addEventListener('mousedown',event=>{if(event.isTrusted&&open)send('acira:pw-dismiss',{});},true);
 addEventListener('input',event=>{if(event.isTrusted&&open)send('acira:pw-dismiss',{});},true);
 addEventListener('scroll',()=>{if(open)send('acira:pw-dismiss',{});},true);
 addEventListener('resize',()=>{if(open)send('acira:pw-dismiss',{});});

 // --- main -> page --------------------------------------------------------------------------------------------------
 function setValue(el,value){
  if(!isInput(el)||!el.isConnected||el.disabled||el.readOnly||typeof value!=='string'||value.length>MAX_PASSWORD)return false;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);
  el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return true;
 }
 ipcRenderer.on('acira:pw-fill',(_event,message)=>{
  if(!message||message.docId!==docId)return;
  const user=message.usernameId?byId(message.usernameId):null;
  if(user&&typeof message.username==='string'&&isTextLike(user))setValue(user,message.username);
  if(typeof message.password==='string')for(const id of Array.isArray(message.passwordIds)?message.passwordIds.slice(0,4):[]){const el=byId(id);if(el&&isPassword(el))setValue(el,message.password);}
  quietUntil=Date.now()+600;// moving focus to the filled field must not reopen the list
  const last=message.passwordIds&&byId(message.passwordIds.at(-1));if(last)try{last.focus({preventScroll:true});}catch{}
 });
 ipcRenderer.on('acira:pw-open',(_event,message)=>{if(message&&message.docId===docId)open=Boolean(message.open);});
 // After a submit, main probes the page every few hundred ms: a different document id than the one that submitted means the browser
 // navigated, and the answer says whether a sign-in form is still showing (success or failure). No chatter unless main asks.
 addEventListener('load',()=>{settledAt=Date.now();},{once:true});
 ipcRenderer.on('acira:pw-probe',()=>{
  const active=document.activeElement;
  // A document that only just finished loading may still be drawing its form: answer "not yet" for the first second.
  send('acira:pw-ready',{passwordFields:!settledAt||Date.now()-settledAt<800?-1:passwordsIn(document.body).length,typing:Boolean(active&&active!==document.body&&(/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)||active.isContentEditable))});
 });
}
