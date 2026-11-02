import {_electron} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
const data=path.resolve('.qa-profiles/native-composition-probe');await fs.mkdir(data,{recursive:true});let app;
try{
 app=await _electron.launch({args:[path.resolve('desktop/main.cjs')],env:{...process.env,ACIRA_QA_RUN:'1',ACIRA_BROWSER_TEST_DATA:data,ACIRA_BROWSER_TEST_HIDDEN:'1'}});const ui=await app.firstWindow();await ui.waitForFunction(()=>Boolean(document.querySelector('.browser-shell')));
 const setup=await app.evaluate(({BaseWindow})=>{const win=BaseWindow.getAllWindows()[0];win.setFocusable(false);win.setIgnoreMouseEvents(true);win.setPosition(-20000,-20000);if(win.getBounds().x>-2000)throw new Error('Test window did not remain offscreen');win.showInactive();return {bounds:win.getBounds(),focused:win.isFocused(),source:win.getMediaSourceId()};});if(setup.focused)throw new Error('Isolated capture window unexpectedly focused');
 await ui.evaluate(()=>window.acira.browserCommand({type:'ui',action:'open',kind:'tabs',tabId:window.acira.initialSnapshot.activeTabId}));
 await ui.waitForTimeout(700);
 const capture=await app.evaluate(async({BaseWindow,desktopCapturer},file)=>{const win=BaseWindow.getAllWindows()[0],id=win.getMediaSourceId(),sources=await desktopCapturer.getSources({types:['window'],thumbnailSize:{width:1400,height:1000},fetchWindowIcons:false});const own=sources.find(item=>item.id===id);if(!own)throw new Error('Own offscreen window capture unavailable');return {image:own.thumbnail.toPNG().toString('base64'),size:own.thumbnail.getSize(),focused:win.isFocused()};},path.resolve('qa/artifacts/native-composition-baseline.png'));
 await fs.writeFile('qa/artifacts/native-composition-baseline.png',Buffer.from(capture.image,'base64'));delete capture.image;console.log(JSON.stringify({setup,capture},null,2));
}finally{await app?.close();}
