// Stream H QA: Settings > Passwords in the real app, fake data only. One Electron instance, bounded steps, closed in finally.
// The OS gate and file pickers are stood in for by ACIRA_PASSWORDS_TEST_GATE / ACIRA_PASSWORDS_TEST_FILES, which only work inside an
// isolated test profile. The real Windows Hello / CredUI dialog needs a manual check (docs/launch/USER_CHECKS.md).
// node qa/h-passwords-settings.mjs [--shots dir]   (D_VISIBLE=1 for a visible window)
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp,poll,sleep} from './d-harness.mjs';
const shots=process.argv.includes('--shots')?process.argv[process.argv.indexOf('--shots')+1]:null;
const check=(ok,label)=>{console.log(`${ok?'ok  ':'FAIL'} ${label}`);if(!ok)process.exitCode=1;};
const root=path.resolve(`.qa-profiles/h-pw-${Date.now()}`);await fs.mkdir(root,{recursive:true});
const csvIn=path.join(root,'chrome-export.csv'),csvOut=path.join(root,'acira-export.csv');
await fs.writeFile(csvIn,'name,url,username,password,note\r\nacme,https://acme.test,pat@acme.test,Imp0rted-Strong-pw-77!,\r\nolive,https://olive.test,olive,hunter22,\r\nbad,javascript:1,x,y,\r\n');
const pwEnv={ACIRA_PASSWORDS_TEST_GATE:'allow',ACIRA_PASSWORDS_TEST_FILES:JSON.stringify({open:csvIn,save:csvOut,confirm:true})};
let t;
async function shot(name){if(!shots)return;await fs.mkdir(shots,{recursive:true});await sleep(350);await t.ui.screenshot({path:path.join(shots,`${name}.png`),scale:'css'});}
try{
 t=await startApp({root,env:pwEnv});
 const api=r=>t.ui.evaluate(r=>window.acira.passwords(r),r).then(x=>x.passwords);
 const SAME='Shared-Password-1!aZ';
 await api({type:'passwords.save',origin:'https://bank.example.test',username:'ada@example.test',password:SAME,note:'fake note'});
 await api({type:'passwords.save',origin:'https://shop.example.test',username:'ada',password:SAME});
 await api({type:'passwords.save',origin:'https://forum.example.test',username:'ada',password:'123456'});
 await api({type:'passwords.save',origin:'https://mail.example.test',username:'ada',password:'x9$Kd!2Lq8#vWm4Rt'});
 const files=await fs.readdir(path.join(root,'passwords'));check(files.some(f=>f.endsWith('.vault.json'))&&files.includes('master.key'),'vault files created under userData/passwords');
 const raw=await fs.readFile(path.join(root,'passwords',files.find(f=>f.endsWith('.vault.json'))),'latin1');
 check(!raw.includes('example.test')&&!raw.includes(SAME)&&!raw.includes('ada@'),'nothing readable in the vault file');
 await t.act({type:'tab.new',url:'acira://settings'});await sleep(1500);
 await t.ui.locator('.bs-sidebar nav button',{hasText:'Passwords'}).first().click();await sleep(700);
 await poll(()=>t.ui.locator('.pw-item').count(),n=>n===4,'four rows',8000);check(true,'Settings > Passwords lists four saved logins');
 check((await t.ui.locator('.pw-chip',{hasText:'Weak'}).count())>=1&&(await t.ui.locator('.pw-chip',{hasText:'Reused'}).count())===2,'weak and reused chips (local check)');
 check(/1 weak · 2 reused/.test(await t.ui.locator('.pw-summary').textContent()),'summary line');
 check(!(await t.ui.locator('.pw-page, .bs-main, body').first().innerHTML()).includes(SAME),'no password anywhere in the page DOM');
 await shot('settings-passwords-list');
 await t.ui.getByLabel('Search passwords').fill('shop');check((await t.ui.locator('.pw-item').count())===1,'search filters');await t.ui.getByLabel('Search passwords').fill('');
 // Open, show (gated), copy (main-process clipboard), edit, delete.
 const row=t.ui.locator('.pw-item',{hasText:'bank.example.test'});await row.getByRole('button',{name:'Open'}).click();
 const editor=row.locator('.pw-editor');await editor.waitFor();
 check((await editor.locator('input[type=password]').inputValue())==='••••••••••••','password masked on open; not fetched yet');
 await editor.getByRole('button',{name:'Show'}).click();await poll(()=>editor.locator('input').nth(2).inputValue(),v=>v===SAME,'shown after the gate');check(true,'Show asks the gate, then reveals the real password');
 await shot('settings-passwords-open');
 await editor.getByRole('button',{name:'Copy',exact:true}).click();
 const clip=await poll(()=>t.main(({clipboard})=>clipboard.readText()),v=>v===SAME,'clipboard');check(clip===SAME,'Copy puts the password on the clipboard from the main process');
 if(process.platform==='win32'){
  const {execFileSync}=await import('node:child_process');
  const formats=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-STA','-Command','Add-Type -AssemblyName System.Windows.Forms;[System.Windows.Forms.Clipboard]::GetDataObject().GetFormats() -join ","'],{encoding:'utf8',timeout:20000,windowsHide:true});
  check(/ExcludeClipboardContentFromMonitorProcessing/.test(formats)&&/CanIncludeInClipboardHistory/.test(formats)&&/CanUploadToCloudClipboard/.test(formats),'the copied password is marked to stay out of clipboard history (Win+V) and the cloud clipboard');
 }
 await t.main(({clipboard})=>clipboard.clear());
 await editor.getByRole('button',{name:'Edit'}).click();
 await editor.locator('input').nth(2).fill('Changed-By-Qa-5!pQ');await editor.getByRole('button',{name:'Save',exact:true}).click();
 await poll(()=>api({type:'passwords.list'}).then(r=>r.items.length),n=>n===4,'saved');
 const id=(await api({type:'passwords.list'})).items.find(i=>i.host==='bank.example.test').id;
 check((await api({type:'passwords.reveal',id})).password==='Changed-By-Qa-5!pQ','edit saved the new password');
 await sleep(300);const forum=t.ui.locator('.pw-item',{hasText:'forum.example.test'});await forum.getByRole('button',{name:'Open'}).click();
 await forum.getByRole('button',{name:'Delete…'}).click();await forum.getByRole('button',{name:'Delete password'}).click();
 await poll(()=>t.ui.locator('.pw-item').count(),n=>n===3,'deleted');check(true,'delete (two-step) removes the item');
 // Add with the generator.
 await t.ui.getByRole('button',{name:'Add password'}).click();const add=t.ui.locator('.pw-editor').first();
 await add.locator('input').nth(0).fill('https://new.example.test');await add.locator('input').nth(1).fill('newuser');await add.getByRole('button',{name:'Suggest'}).click();
 const generated=await poll(()=>add.locator('input').nth(2).inputValue(),v=>v.length===20,'generated',5000).catch(()=>'');check(generated.length===20,'Suggest fills a 20-character password');
 await add.getByRole('button',{name:'Save password'}).click();await poll(()=>t.ui.locator('.pw-item').count(),n=>n===4,'added');check(true,'add saves a new login');
 // CSV import (preview, apply), export.
 await t.ui.getByRole('button',{name:'Import…'}).click();await t.ui.locator('.pw-preview').waitFor({timeout:8000});
 const text=await t.ui.locator('.pw-preview').textContent();check(/chrome-export\.csv: 2 new/.test(text)&&/1 skipped/.test(text),`import preview: ${text.trim()}`);
 await shot('settings-passwords-import');
 await t.ui.locator('.pw-preview').getByRole('button',{name:'Import',exact:true}).click();await poll(()=>t.ui.locator('.pw-item').count(),n=>n===6,'imported');check(true,'import adds the two valid rows');
 check((await api({type:'passwords.list'})).items.some(i=>i.host==='acme.test'),'imported login is in the vault');
 await t.ui.getByRole('button',{name:'Delete the file'}).click();await poll(()=>fs.access(csvIn).then(()=>false,()=>true),Boolean,'source deleted');check(true,'the plain-text source file can be deleted after import');
 await t.ui.getByRole('button',{name:'Export…'}).click();await poll(()=>fs.access(csvOut).then(()=>true,()=>false),Boolean,'export written',8000);
 const exported=await fs.readFile(csvOut,'utf8');check(/^name,url,username,password,note/.test(exported)&&exported.includes('Changed-By-Qa-5!pQ')&&exported.includes('Imp0rted-Strong-pw-77!'),'export is a Chrome-style CSV with every password');
 await shot('settings-passwords-after');
 // Delete all (gate + confirm).
 await t.ui.getByRole('button',{name:'Delete all…'}).click();await t.ui.getByRole('button',{name:'Delete all',exact:true}).click();
 await poll(()=>t.ui.locator('.pw-item').count(),n=>n===0,'all deleted');check(true,'delete all empties the vault');
 await shot('settings-passwords-empty');
 // Private window: nothing available.
 await t.ui.evaluate(()=>window.acira.openWindow('private'));
 const priv=await poll(()=>t.context.pages().find(p=>{try{return p.url()==='acira-browser-ui://ui/index.html'&&p!==t.ui;}catch{return false;}}),Boolean,'private window',10000);
 await poll(()=>priv.evaluate(()=>Boolean(window.acira?.passwords)),Boolean,'private ready');
 check((await priv.evaluate(()=>window.acira.passwords({type:'passwords.list'}))).passwords.private===true,'private windows get no password features');
}finally{if(t)await t.close();}
