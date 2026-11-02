import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {launchPreparedNative} from './prepared-native.mjs';
import {nativePage,poll} from './native-helpers.mjs';
import {paletteNativeIdentity,paletteNativeSourceStable} from './palette-native-identity.mjs';

const out=path.resolve('qa/artifacts/palette-native-network-paint-'+Date.now());
const profile=path.resolve('.qa-profiles/palette-native-network-paint-'+Date.now());
await fs.mkdir(out,{recursive:true});
const hash=async p=>createHash('sha256').update(await fs.readFile(p)).digest('hex');
const inputs=await Promise.all(['qa/palette-native-network-paint.mjs','src/features/browser-settings.css'].map(async path=>({path,sha256:await hash(path)})));
const report={checkedAt:new Date().toISOString(),qualification:'Actual verified native product Privacy route in a fresh initialized-key disposable profile. Supported native interface zoom100/150, actual open/closed workspace rail, Burgundy dark/Porcelain light. Keyboard focus and invalid HTTP DNS endpoint submission use the real UI and native validation. No valid network preference is saved; saved/current native settings must remain unchanged. Captures are native UI webContents images, not outer-window/compositor or motion evidence.',inputs,cases:[],checks:[],errors:[]};
const record=(name,pass,detail={})=>report.checks.push({name,pass,...detail});
let app;
try{
 const identity=await paletteNativeIdentity();Object.assign(report,{snapshot:identity.snapshot,runtime:identity.runtime,runtimeGate:identity.runtimeGate,source:identity.source});
 app=await launchPreparedNative({args:[identity.entry],executablePath:identity.executable,env:{...process.env,ACIRA_QA_RUN:'1',ACIRA_BROWSER_TEST_DATA:profile,ACIRA_BROWSER_TEST_HIDDEN:'1',ACIRA_DEV:'0',ACIRA_PREVIEW_RECORD:'1'},timeout:30000});
 const ui=await nativePage(app,'acira-browser-ui://ui/index.html');ui.on('pageerror',error=>report.errors.push(error.message));
 await ui.locator('.browser-shell').waitFor();
 await ui.waitForFunction(()=>!document.querySelector('.setup-dialog')||[...document.querySelectorAll('.setup-dialog button')].some(b=>b.textContent?.trim()==='Skip setup'));
 const skip=ui.getByRole('button',{name:'Skip setup',exact:true});if(await skip.count()){await skip.evaluate(b=>b.click());await ui.locator('.setup-dialog').waitFor({state:'detached'});}
 const act=action=>ui.evaluate(action=>window.acira.dispatch(action),action);
 await act({type:'settings.update',patch:{onboardingComplete:true,reducedMotion:true}});
 report.window=await app.evaluate(({BaseWindow})=>{const w=BaseWindow.getAllWindows()[0];w.setFocusable(false);w.setIgnoreMouseEvents(true);w.setSkipTaskbar(true);w.setPosition(-20000,-20000);w.setSize(900,700);w.showInactive();return{bounds:w.getBounds(),focused:w.isFocused(),focusable:w.isFocusable()};});
 assert.equal(report.window.focused,false);assert.equal(report.window.focusable,false);
 await act({type:'tab.new',url:'acira://settings'});await ui.getByRole('textbox',{name:'Search settings'}).waitFor();
 await ui.getByRole('navigation',{name:'Settings sections'}).getByRole('button',{name:'Privacy',exact:true}).evaluate(b=>b.click());
 const panel=ui.getByRole('region',{name:'Application network privacy'}),dns=panel.getByRole('combobox',{name:'Secure DNS'});
 await poll(()=>dns.isEnabled(),Boolean,'Network preference status is ready');
 const before=(await ui.evaluate(()=>window.acira.service({type:'network.status'}))).network;
 for(const finish of [{name:'Burgundy',appearance:'dark',tint:'#4d1821',accent:'#4d1821'},{name:'Porcelain',appearance:'light',tint:'#f8fbff',accent:'#1769c2'}])for(const scale of [100,150])for(const rail of [false,true]){
  const key={finish:finish.name,appearance:finish.appearance,scale,rail};
  await act({type:'settings.update',patch:{colorPreset:finish.name,appearance:finish.appearance,browserTint:finish.tint,accentColor:finish.accent,interfaceScale:scale}});await act({type:'ui.update',patch:{workspaceOpen:rail,webWorkspaceOpen:rail}});
  await ui.getByRole('navigation',{name:'Settings sections'}).getByRole('button',{name:'About',exact:true}).evaluate(b=>b.click());await ui.getByRole('navigation',{name:'Settings sections'}).getByRole('button',{name:'Privacy',exact:true}).evaluate(b=>b.click());await poll(()=>dns.isEnabled(),Boolean,'Fresh network status is ready');await ui.waitForTimeout(220);await ui.evaluate(()=>document.fonts.ready);
  const native=await poll(()=>app.evaluate(({BaseWindow})=>{const w=BaseWindow.getAllWindows()[0],v=w.contentView.children.find(v=>v.webContents?.getURL()==='acira-browser-ui://ui/index.html');return{zoom:v.webContents.getZoomFactor(),view:v.getBounds(),window:w.getBounds()};}),v=>Math.abs(v.zoom-scale/100)<.001,'Actual native scale applied');
  await dns.selectOption('secure');const field=panel.getByRole('textbox',{name:'HTTPS DNS endpoints'});await field.waitFor();await dns.focus();await ui.keyboard.press('Tab');
  record('keyboard moves from DNS mode into endpoint field',await field.evaluate(n=>document.activeElement===n),key);
  const paint=await panel.evaluate(root=>{const main=root.closest('.bs-main'),f=root.querySelector('textarea'),s=getComputedStyle(f),box=n=>n.getBoundingClientRect().toJSON(),rgb=v=>(v.match(/[\d.]+/g)||[]).slice(0,3).map(Number),lum=v=>rgb(v).map(n=>n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4).reduce((a,n,i)=>a+n*[.2126,.7152,.0722][i],0),a=lum(s.color),b=lum(s.backgroundColor);return{width:main.clientWidth,scrollWidth:main.scrollWidth,root:box(root),field:box(f),foreground:s.color,background:s.backgroundColor,contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),outline:s.outlineStyle,outlineWidth:s.outlineWidth,devicePixelRatio,outlineColor:s.outlineColor,controls:[...root.querySelectorAll('button,input,select,textarea')].map(n=>box(n))};});
  record('native Settings has no horizontal overflow',paint.scrollWidth<=paint.width+1,key);
  record('native network controls stay within the section',paint.controls.every(b=>b.left>=paint.root.left-1&&b.right<=paint.root.right+1),key);
  record('native endpoint focus ring retains nominal2CSSpx within one device-pixel quantization',paint.outline==='solid'&&parseFloat(paint.outlineWidth)+1/paint.devicePixelRatio>=2,key);
  record('native endpoint text contrast reaches4.5',paint.contrast>=4.49,{...key,contrast:paint.contrast});
  const stem=finish.name.toLowerCase()+'-'+scale+'-'+(rail?'rail':'closed');
  const image=await app.evaluate(async({BaseWindow})=>{const v=BaseWindow.getAllWindows()[0].contentView.children.find(v=>v.webContents?.getURL()==='acira-browser-ui://ui/index.html'),img=await v.webContents.capturePage(undefined,{stayHidden:true});return{png:img.toPNG().toString('base64'),size:img.getSize()};});await fs.writeFile(path.join(out,stem+'-focus.png'),Buffer.from(image.png,'base64'));
  await field.fill('http://invalid-endpoint.example/dns-query');await ui.keyboard.press('Tab');
  const save=panel.getByRole('button',{name:'Save network preferences'});record('keyboard reaches native save action',await save.evaluate(n=>document.activeElement===n),key);await ui.keyboard.press('Enter');
  await panel.getByRole('alert').last().waitFor();
  const feedback=await panel.getByRole('alert').last().evaluate(n=>{const main=n.closest('.bs-main'),r=n.getBoundingClientRect(),m=main.getBoundingClientRect();return{text:n.textContent,focused:document.activeElement===n,visible:r.top>=m.top-1&&r.bottom<=m.bottom+1,bounds:r.toJSON(),viewport:m.toJSON()};});
  record('native validation feedback receives focus',feedback.focused,{...key});record('native validation feedback is visible after keyboard save',feedback.visible,{...key,feedback});const errorImage=await app.evaluate(async({BaseWindow})=>{const v=BaseWindow.getAllWindows()[0].contentView.children.find(v=>v.webContents?.getURL()==='acira-browser-ui://ui/index.html');return(await v.webContents.capturePage(undefined,{stayHidden:true})).toPNG().toString('base64');});await fs.writeFile(path.join(out,stem+'-error.png'),Buffer.from(errorImage,'base64'));
  record('native error copy omits internal IPC invocation prefix',!feedback.text.includes("Error invoking remote method"),{...key,text:feedback.text});
  const after=(await ui.evaluate(()=>window.acira.service({type:'network.status'}))).network;record('invalid endpoint leaves saved and active network choices unchanged',JSON.stringify(after.saved)===JSON.stringify(before.saved)&&JSON.stringify(after.current)===JSON.stringify(before.current),key);
  report.cases.push({...key,native,paint,imageSize:image.size,feedback});
  assert.equal(await app.evaluate(({BaseWindow})=>BaseWindow.getAllWindows()[0].isFocused()),false);
 }
 report.sourceStable=await paletteNativeSourceStable(identity);record('verified product remains stable',report.sourceStable);
 report.inputsStable=(await Promise.all(inputs.map(async f=>await hash(f.path)===f.sha256))).every(Boolean);record('QA and owned field paint remain stable',report.inputsStable);
}catch(error){report.errors.push(error.stack||error.message);}finally{report.failures=report.checks.filter(c=>!c.pass);await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));await app?.close();}
console.log(JSON.stringify({out,cases:report.cases.length,checks:report.checks.length,failures:report.failures.map(c=>({name:c.name,finish:c.finish,scale:c.scale,rail:c.rail})),errors:report.errors,sourceStable:report.sourceStable}));if(report.failures.length||report.errors.length)process.exitCode=1;
