// Measures popup heights in the real app (isolated profile, bounded). Writes evidence under qa/artifacts; the fixture tests/popup-heights.json is updated by hand from result.json.
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {startApp,httpFixture,sleep,poll} from './d-harness.mjs';
import {popupContentHeight,popupNaturalHeight} from '../src/ui/popup.ts';

const historical=JSON.parse(await fs.readFile('tests/popup-heights.json','utf8'));
const appSource=await fs.readFile('src/App.tsx','utf8'),switcherSource=await fs.readFile('src/components/sidebar/TabSwitcher.tsx','utf8');
const appMeasureLine=appSource.split(/\r?\n/).findIndex(line=>line.includes('heightCallback.current?.(Math.ceil(naturalContentHeight(content)'));
const switcherMeasureLine=switcherSource.split(/\r?\n/).findIndex(line=>line.includes('onNaturalHeight(Math.ceil(node.scrollHeight))'));
const appMeasureText=appSource.split(/\r?\n/)[appMeasureLine],switcherMeasureText=switcherSource.split(/\r?\n/)[switcherMeasureLine];
const allowanceMatch=appMeasureText?.match(/\(kind === 'find' \? (\d+) : (\d+)\)/);
if(!allowanceMatch||Number(allowanceMatch[1])!==0||Number(allowanceMatch[2])!==2||switcherMeasureLine<0)throw Error('Production measurement recipe changed; inspect it before adopting an allowance.');
const lineIdentity=(file,line,text)=>({file,line:line+1,normalizedLineSha256:createHash('sha256').update(text).digest('hex'),text});
const measurementContract={fixtureMetric:'native overlay.contentHeight',rawMetric:'intrinsic DOM CSS height, unchanged',browserPopup:lineIdentity('src/App.tsx',appMeasureLine,appMeasureText),switcher:lineIdentity('src/components/sidebar/TabSwitcher.tsx',switcherMeasureLine,switcherMeasureText),allowance:{find:Number(allowanceMatch[1]),browserPopup:Number(allowanceMatch[2]),switcher:0},assertion:'native contentHeight equals popupContentHeight(kind, ceil(raw DOM height + component allowance)); estimator compares to native contentHeight, tolerance 1px',inputRoute:'own native webContents.sendInputEvent for shortcuts; tab.navigate and input.fill are fixture setup, not keyboard navigation/typing coverage'};
if(process.argv.includes('--plan')){console.log(JSON.stringify({requiredCases:historical.map(({kind,label,state})=>({kind,label,state})),measurementContract,supplemental:[{kind:'toolbar-context',label:'Acira page unavailable bookmark'}],expectedMinutes:'2–4, bounded to 6',fixtureWrites:false,toleranceCssPx:1,nativeLaunched:false},null,2));process.exit(0);}
const startedAt=new Date().toISOString(),runId=startedAt.replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8);
const root=path.resolve('.qa-profiles','b-popup-heights-'+runId),out=path.resolve('qa/artifacts/popup-heights',runId);
await fs.mkdir(out,{recursive:true});
const digest=async file=>{const hash=createHash('sha256');for await(const bytes of createReadStream(file))hash.update(bytes);return hash.digest('hex');};
const identities=[];
for(const file of ['qa/b-popup-heights.mjs','src/ui/popup.ts','tests/popup-heights.json','desktop/main.cjs','desktop/runtime.cjs','dist/index.html'])try{identities.push({path:path.resolve(file),sha256:await digest(file)});}catch(error){identities.push({path:path.resolve(file),error:error.message});}
try{for(const name of (await fs.readdir('dist/assets')).filter(name=>/\.(?:js|css)$/.test(name)).sort()){const file=path.join('dist/assets',name);identities.push({path:path.resolve(file),sha256:await digest(file)});}}catch(error){identities.push({path:path.resolve('dist/assets'),error:error.message});}
const manifest={schema:1,runId,startedAt,root,requestedExecutable:process.env.D_APP_EXE?path.resolve(process.env.D_APP_EXE):null,identities,measurementContract,requiredCases:historical.map(({kind,label,state})=>({kind,label,state})),estimator:'workspace src/ui/popup.ts; source attribution only, not assumed identical to packaged target',frameObservation:'rAF DOM visibility in an offscreen overlay; not physical display/compositor presentation',toleranceCssPx:1,fixtureWrites:false,windowPolicy:'own process initially hidden, nonfocusable offscreen showInactive'};
await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx'});
let app,fx,base,actualTarget,fatal;
const results=[],failures=[],deadline=Date.now()+6*60*1000;
const bounded=async(promise,label,ms=10000)=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+' timed out')),ms);})]);}finally{clearTimeout(timer);}};
const overlay=()=>app.context.pages().find(p=>{try{return p.url().includes('view=overlay');}catch{return false;}});
const inspect=(fn,arg)=>bounded(overlay().evaluate(fn,arg),'overlay inspection');
const layout=()=>bounded(app.ui.evaluate(()=>window.acira.getBrowserLayout()),'layout');
try{
  fx=await httpFixture((_req,res)=>{res.setHeader('content-type','text/html');res.end('<!doctype html><title>Local page</title><body style="font:16px system-ui;background:#fff"><h1>Local fixture</h1></body>');});base=`http://127.0.0.1:${fx.port}/`;
  app=await startApp({root,skipSetup:true,env:{ACIRA_BROWSER_TEST_HIDDEN:'1',ACIRA_PASSWORDS_TEST_GATE:'allow'}});
  app.context.setDefaultTimeout(5000);
  await app.ui.locator('.setup-dialog').waitFor({state:'hidden',timeout:5000});
  for(const name of ['act','state','svc','cmd','main']){const original=app[name];app[name]=(...args)=>bounded(original(...args),name);}
  actualTarget=await bounded(app.main(({BaseWindow,app})=>{for(const w of BaseWindow.getAllWindows()){w.setFocusable(false);w.setIgnoreMouseEvents(true);}const w=BaseWindow.getAllWindows()[0];w.setBounds({x:-20000,y:-20000,width:1280,height:1100});w.showInactive();return {pid:process.pid,executable:app.getPath('exe'),appPath:app.getAppPath(),version:app.getVersion(),electron:process.versions.electron,chrome:process.versions.chrome,bounds:w.getBounds(),focused:w.isFocused()};}),'owned window setup');
  const targetHashes=[];for(const file of [actualTarget.executable,actualTarget.appPath])try{if((await fs.stat(file)).isFile())targetHashes.push({path:file,sha256:await digest(file)});}catch(error){targetHashes.push({path:file,error:error.message});}
  await fs.writeFile(path.join(out,'target.json'),JSON.stringify({actualTarget,targetHashes,fixture:{root,base}},null,2),{flag:'wx'});
  await app.act({type:'settings.update',patch:{onboardingComplete:true,language:'en',appearance:'light',interfaceScale:100,verticalTabs:false,toolbarLayout:'expanded',tabViewerDensity:'comfortable'}});
  await app.act({type:'tab.new',url:base+'a'});await app.waitWeb(base+'a');await sleep(800);
  for(const q of ['b','c','d'])await app.act({type:'tab.new',url:base+q,background:true});
  await poll(overlay,Boolean,'overlay renderer',20000);
  await inspect(()=>{
    let frame=0,until=0,start=0;const frames=[];
    const sample=()=>{
      const sheet=document.querySelector('.sheet-popup'),popup=sheet?.querySelector('.browser-popup'),switcher=sheet?.querySelector('.tab-switcher'),node=popup||switcher;if(!node||!sheet)return null;
      const kind=popup?[...popup.classList].find(c=>c.startsWith('popup-content-'))?.slice(14):'switcher',style=getComputedStyle(node),body=node.querySelector('.popup-body-content');let intrinsic=node.scrollHeight;
      if(body){const prior=body.hasAttribute('data-measuring');body.setAttribute('data-measuring','');const bodyHeight=body.scrollHeight;if(!prior)body.removeAttribute('data-measuring');const fixed=[...node.children].filter(child=>!child.matches('.scroll-region')&&getComputedStyle(child).display!=='none'&&!['absolute','fixed'].includes(getComputedStyle(child).position)).reduce((n,child)=>n+child.offsetHeight,0);intrinsic=Math.ceil(bodyHeight+fixed+parseFloat(style.paddingTop)+parseFloat(style.paddingBottom)+parseFloat(style.borderTopWidth)+parseFloat(style.borderBottomWidth));}
      const scroll=node.querySelector('.popup-scroll')||switcher,visibility=getComputedStyle(sheet),plane=sheet.querySelector('.popup-sheet-plane'),planeStyle=plane&&getComputedStyle(plane);
      return {t:Math.round(performance.now()-start),kind,shown:visibility.visibility!=='hidden'&&visibility.display!=='none'&&Number(visibility.opacity)>0&&(!planeStyle||Number(planeStyle.opacity)>0),surfaceHeight:sheet.offsetHeight,popupHeight:node.offsetHeight,intrinsic,scrollHeight:scroll?.scrollHeight,scrollClientHeight:scroll?.clientHeight,viewport:[innerWidth,innerHeight],density:node.dataset.density||'full',pending:!!node.querySelector('[data-popup-pending]'),bodyHeight:body?.scrollHeight};
    };
    const tick=()=>{const row=sample();if(row&&frames.length<180)frames.push(row);if(performance.now()<until&&frames.length<180)frame=requestAnimationFrame(tick);};
    window.__heightProbe={frames,sample,reset(){cancelAnimationFrame(frame);frames.length=0;start=performance.now();until=start+2400;frame=requestAnimationFrame(tick);},stop(){cancelAnimationFrame(frame);}};
  });
  await app.ui.evaluate(()=>{window.__layouts=[];window.__stopHeightLayouts=window.acira.subscribeLayout(next=>{const o=next?.overlay;if(o&&window.__layouts.length<300)window.__layouts.push({t:performance.now(),kind:o.kind,contentHeight:o.contentHeight,height:o.bounds.height});});});
  const close=async()=>{const open=(await layout())?.overlay;if(open)await app.ui.evaluate(id=>window.acira.closeOverlay(id),open.id);await sleep(280);};
  const reset=async()=>{await inspect(()=>window.__heightProbe.reset());await app.ui.evaluate(()=>{window.__layouts.length=0;});};
  const recent=()=>inspect(()=>{try{return JSON.parse(localStorage.getItem('acira-palette-recent')||'[]').length;}catch{return 0;}});
  let switched=false,parentKind;
  async function measure(kind,label,open,targetUrl){
    if(Date.now()>deadline)throw Error('Six-minute probe budget exhausted');
    await close();await reset();switched=false;parentKind=undefined;
    try{
      await bounded(open(),kind+' open action');
      await poll(async()=>(await layout())?.overlay?.kind===kind,Boolean,kind+' open',5000);
      await sleep(800);
      const settled=(await layout())?.overlay;if(!settled||settled.kind!==kind)throw Error('popup closed before inspection');
      const snapshot=await app.state(),active=snapshot.tabs.find(t=>t.id===snapshot.activeTabId),target=targetUrl&&snapshot.tabs.find(t=>t.url===targetUrl);
      const state={tabs:snapshot.tabs.length,web:active?.contentKind==='web',bookmarks:snapshot.bookmarks.length,downloads:snapshot.downloads.length,profiles:snapshot.browserProfiles.length,workspaces:(snapshot.workspaces||[]).filter(w=>w.browserProfileId===snapshot.activeBrowserProfileId).length,recent:kind==='palette'?await recent():0,...(target?{target:target.contentKind}:{}),...(parentKind?{parent:parentKind}:{}),...((snapshot.workspaces||[]).some(w=>w.id===snapshot.activeWorkspaceId&&w.secured&&!w.unlocked)?{locked:true}:{})};
      const frames=(await inspect(()=>window.__heightProbe.frames)).filter(f=>f.kind===kind&&f.shown),layouts=(await app.ui.evaluate(()=>window.__layouts)).filter(l=>l.kind===kind),dom=await inspect(()=>window.__heightProbe.sample());
      if(!dom||dom.kind!==kind)throw Error('no intrinsic DOM sample');
      const sourceEstimate=popupNaturalHeight(kind,snapshot,{recent:state.recent,target,parent:parentKind}),domIntrinsicHeight=dom.intrinsic,productionAllowance=kind==='switcher'?measurementContract.allowance.switcher:kind==='find'?measurementContract.allowance.find:measurementContract.allowance.browserPopup,expectedNativeContentHeight=popupContentHeight(kind,Math.ceil(domIntrinsicHeight+productionAllowance)),nativeContentHeight=settled.contentHeight,overflow=(dom.scrollHeight||0)-(dom.scrollClientHeight||0);
      const shownHeights=[...new Set(frames.map(f=>f.surfaceHeight))],targets=[...new Set(layouts.map(l=>l.height))];
      const expected=historical.find(item=>item.kind===kind&&item.label===label),stateMatches=!expected||Object.entries(expected.state).every(([key,value])=>state[key]===value);
      const uiCondition=await inspect(()=>{const root=document.querySelector('.sheet-popup .browser-popup');if(!root)return {component:'TabSwitcher'};const rows=[...root.querySelectorAll('.menu-row,.acira-menu-row')].filter(node=>!node.closest('[aria-hidden=true]'));return {component:'BrowserPopup',menuRowCount:rows.length,menuRows:rows.map(node=>node.textContent.trim().replace(/\s+/g,' ').slice(0,140)),separatorCount:root.querySelectorAll('hr').length,toolbarItemCount:root.querySelectorAll('.toolbar-customize-list>.toolbar-customize-row').length};});
      const row={kind,label,state,stateMatches,uiCondition,targetCondition:target?{index:snapshot.tabs.findIndex(tab=>tab.id===target.id),active:target.id===snapshot.activeTabId,pinned:target.pinned,privacy:target.privacy,group:target.group,hasUnpinnedLeft:snapshot.tabs.slice(0,snapshot.tabs.findIndex(tab=>tab.id===target.id)).some(tab=>!tab.pinned),hasUnpinnedRight:snapshot.tabs.slice(snapshot.tabs.findIndex(tab=>tab.id===target.id)+1).some(tab=>!tab.pinned)}:null,sourceEstimate,domIntrinsicHeight,productionAllowance,expectedNativeContentHeight,nativeContentHeight,fixtureMeasuredHeight:nativeContentHeight,fixtureMetric:measurementContract.fixtureMetric,nativeDescriptor:settled,dom,switched,firstShown:frames[0]||null,shownHeights,layoutHeights:targets,overflow,frames,layouts};results.push(row);
      const capture=`${String(results.length).padStart(2,'0')}-${kind}.png`;
      try{const png=await app.main(async({webContents})=>{const wc=webContents.getAllWebContents().find(w=>w.getURL().includes('view=overlay'));return(await wc.capturePage()).toPNG().toString('base64');});await fs.writeFile(path.join(out,capture),Buffer.from(png,'base64'),{flag:'wx'});row.capture={file:capture,layer:'native overlay webContents; frame trace is DOM-observed, not a compositor timing claim'};}catch(error){row.captureError=error.message;failures.push(`${kind} (${label}): native capture unavailable: ${error.message}`);}
      await fs.writeFile(path.join(out,`${String(results.length).padStart(2,'0')}-${kind}.json`),JSON.stringify(row,null,2),{flag:'wx'});
      console.log(JSON.stringify({kind,label,state,sourceEstimate,domIntrinsicHeight,productionAllowance,expectedNativeContentHeight,nativeContentHeight,firstShown:row.firstShown?.surfaceHeight,shownHeights,overflow}));
      if(!stateMatches)failures.push(`${kind} (${label}): actual state differs from required historical state`);
      if(Math.abs(popupContentHeight(kind,sourceEstimate)-nativeContentHeight)>1)failures.push(`${kind} (${label}): source estimate ${sourceEstimate}, native contentHeight ${nativeContentHeight}`);
      if(Math.abs(nativeContentHeight-expectedNativeContentHeight)>1)failures.push(`${kind} (${label}): native contentHeight ${nativeContentHeight}, expected DOM ${domIntrinsicHeight} + production allowance ${productionAllowance} => ${expectedNativeContentHeight}`);
      if(!frames.length)failures.push(`${kind} (${label}): no DOM-visible offscreen frame observed`);
      if(!switched&&frames.length&&Math.abs(frames[0].surfaceHeight-dom.surfaceHeight)>1)failures.push(`${kind} (${label}): first shown ${frames[0].surfaceHeight}, final ${dom.surfaceHeight}`);
      if(!switched&&shownHeights.length!==1)failures.push(`${kind} (${label}): shown heights ${shownHeights.join(' -> ')||'none'}`);
      if(switched&&targets.length!==1)failures.push(`${kind} (${label}): moved toward ${targets.join(' then ')||'no layout event'}`);
      if(overflow>1&&domIntrinsicHeight+productionAllowance<=settled.bounds.height+1)failures.push(`${kind} (${label}): unexpected intrinsic overflow ${overflow}px despite available space`);
    }catch(error){failures.push(`${kind} (${label}): ${error.message}`);await fs.writeFile(path.join(out,`failure-${String(failures.length).padStart(2,'0')}.json`),JSON.stringify({kind,label,error:{message:error.message,stack:error.stack}},null,2),{flag:'wx'});}
  }
  const click = selector => app.ui.locator(selector).filter({visible: true}).first().click();
  const fromPopup = async (parent, text) => { await poll(async () => (await layout())?.overlay?.kind === parent, Boolean, parent, 5000); await sleep(300); await reset(); switched = true; parentKind = parent; await overlay().locator('.menu-row', {hasText: text}).first().click(); };
  const menuRow = async text => { await click('[aria-label="Acira menu"]'); await fromPopup('menu', text); };
  const contextMenu = (selector, x, y) => app.ui.evaluate(([s, cx, cy]) => { const n = [...document.querySelectorAll(s)].find(e => e.checkVisibility()); const r = n.getBoundingClientRect(); n.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, cancelable: true, clientX: cx ?? r.x + r.width / 2, clientY: cy ?? r.y + r.height / 2, button: 2})); }, [selector, x, y]);
  const tabMenu = async url => { const tab = (await app.state()).tabs.find(t => t.url === url); await contextMenu(`.browser-tab[data-tab-id="${tab.id}"]`); };
  // Ctrl+Tab through the page's own input path, Control held while the switcher is measured.
  const keys = (events,target='page') => app.main(({BaseWindow}, {events,target}) => { const collect=node=>[node,...(node.children||[]).flatMap(collect)],views=collect(BaseWindow.getAllWindows()[0].contentView),view=target==='overlay'?views.find(v=>v.webContents?.getURL?.().includes('view=overlay')):views.find(v=>v.getVisible?.()&&/^https?:/.test(v.webContents?.getURL?.()||''))||views.find(v=>v.webContents?.getURL?.()==='acira-browser-ui://ui/index.html');if(!view)throw Error('Own native input target unavailable: '+target);view.webContents.focus();for(const event of events)view.webContents.sendInputEvent(event); }, {events,target});
  const shortcut=(key,modifiers=[],target='page')=>{const names={control:'Control',shift:'Shift',alt:'Alt'},events=[];for(let i=0;i<modifiers.length;i++)events.push({type:'keyDown',keyCode:names[modifiers[i]],modifiers:modifiers.slice(0,i+1)});events.push({type:'keyDown',keyCode:key,modifiers},{type:'keyUp',keyCode:key,modifiers});for(let i=modifiers.length-1;i>=0;i--)events.push({type:'keyUp',keyCode:names[modifiers[i]],modifiers:modifiers.slice(0,i)});return keys(events,target);};
  const switcher = () => keys([{type: 'keyDown', keyCode: 'Control', modifiers: ['control']}, {type: 'keyDown', keyCode: 'Tab', modifiers: ['control']}, {type: 'keyUp', keyCode: 'Tab', modifiers: ['control']}]);
  const releaseControl = () => keys([{type: 'keyUp', keyCode: 'Control', modifiers: []}]);
  const go = async url => { await close(); await app.act({type:'tab.navigate',url}); await poll(async()=>{const state=await app.state(),tab=state.tabs.find(t=>t.id===state.activeTabId);return tab?.url===url&&!tab.loading;},Boolean,'fixture navigation '+url,10000); await sleep(800); };
  const common = async label => {
    await measure('menu', label, () => click('[aria-label="Acira menu"]'));
    await measure('tabs', label, () => shortcut('T',['alt']));
    await measure('palette', label, () => shortcut('K',['control','shift']));
    await measure('security', label, () => click('[aria-label="Page information"]'));
    await measure('bookmarks', label, () => menuRow('Bookmarks'));
    await measure('downloads', label, () => menuRow('Downloads'));
  };
  // 1. Five tabs (a new tab and four pages), nothing saved yet: the first-run state.
  await common('5 tabs');
  await measure('more-tools', '5 tabs', () => menuRow('More tools'));
  // Ctrl+Tab defaults to Next tab (G); the switcher opens in Recent mode, a choice kept in the chrome view's storage.
  await app.ui.evaluate(() => { localStorage.setItem('acira-ctrl-tab-mode', JSON.stringify('recent')); window.dispatchEvent(new Event('acira-ctrl-tab-mode')); });
  await measure('switcher', '5 tabs', switcher); await releaseControl(); await sleep(400);
  const select = async url => app.act({type: 'tab.select', id: (await app.state()).tabs.find(t => t.url === url).id});
  await select(base + 'a'); await sleep(400);
  await measure('extensions', '5 tabs', async () => { await menuRow('More tools'); await fromPopup('more-tools', 'Extensions'); });
  await measure('toolbar-context', '5 tabs', () => contextMenu('.browser-toolbar', 230, 50));
  await measure('customize-toolbar', '5 tabs', async () => { await contextMenu('.browser-toolbar', 230, 50); await fromPopup('toolbar-context', 'Customize toolbar'); });
  await measure('tab-context', 'web tab', () => tabMenu(base + 'b'), base + 'b');
  await measure('tab-context', 'Acira tab', () => tabMenu('acira://new'), 'acira://new');
  await measure('strip-context', '5 tabs', () => contextMenu('.tabs-strip', 1100, 16));
  await measure('find', '5 tabs', () => shortcut('F',['control']));
  await measure('zoom', '5 tabs', () => shortcut('=',['control']));
  await close(); await shortcut('0',['control']);
  await go(base + 'star');
  await measure('bookmark-edit', 'new bookmark', () => click('[aria-label="Bookmark this page"]'));
  // 2. Nine tabs, three bookmarks, one recent command.
  for (const q of ['e', 'f', 'g', 'h']) await app.act({type: 'tab.new', url: base + q, background: true});
  for (const q of ['b1', 'b2']) await app.act({type: 'bookmark.toggle', url: base + q});
  await close(); await shortcut('K',['control','shift']); await sleep(500); await overlay().locator('.popup-search input').fill('Reload'); await sleep(250); await shortcut('Enter',[],'overlay'); await sleep(900);
  await common('9 tabs');
  await measure('switcher', '9 tabs', switcher); await releaseControl(); await sleep(400);
  // 3. An Acira page: no site information, no page actions, no "Bookmark this page".
  await close(); await app.act({type: 'tab.new', url: 'acira://history'}); await sleep(1200); await common('Acira page');
  await measure('toolbar-context', 'Acira page unavailable bookmark', () => contextMenu('.browser-toolbar', 230, 50));
  for (const q of ['b3', 'b4', 'b5']) await app.act({type: 'bookmark.toggle', url: base + q});
  await measure('bookmarks', 'Acira page, 6 bookmarks', () => menuRow('Bookmarks'));
  // 4. Profiles live in the sidebar.
  await app.act({type: 'settings.update', patch: {verticalTabs: true}}); await app.act({type: 'ui.update', patch: {workspaceOpen: true, webWorkspaceOpen: true}}); await sleep(900);
  await measure('profile', 'sidebar', () => app.ui.evaluate(() => { const button = document.querySelector('.sb-foot-profile, [aria-label$="Switch profile"]'); if (!button) throw new Error('no profile button'); button.click(); }));
  await app.act({type: 'settings.update', patch: {verticalTabs: false}}); await sleep(600);
  // 5. One tab and no recent commands: the palette lists what it can do (capped; it scrolls).
  await close(); await app.act({type: 'tab.close.others', id: (await app.state()).activeTabId});
  await overlay().evaluate(() => localStorage.removeItem('acira-palette-recent')); await sleep(600);
  await measure('tabs', '1 tab', () => shortcut('T',['alt']));
  await measure('palette', '1 tab', () => shortcut('K',['control','shift']));
  // Recently closed with six closed tabs, and a split group's menu: both heights are constant, so they are measured here at the end
  // where opening, closing and splitting tabs cannot change an earlier case's state.
  await close(); for (const q of ['r1','r2','r3','r4','r5','r6']) await app.act({type:'tab.new',url:base+q,background:true}); await sleep(600);
  for (const tab of (await app.state()).tabs.filter(t=>/\/r\d$/.test(t.url))) await app.act({type:'tab.close',id:tab.id}); await sleep(600);
  await measure('recent-closed', '6 recently closed tabs', () => menuRow('Recently closed'));
  await close(); await app.act({type:'tab.new',url:base+'s1',background:true}); await sleep(600);
  { const st = await app.state(); await app.act({type:'split.open',tabIds:st.tabs.slice(0,2).map(t=>t.id)}); await app.act({type:'tab.select',id:st.tabs.find(t=>t.url.endsWith('/s1')).id}); } await sleep(900);
  await measure('split-context', 'split of two tabs', () => contextMenu('.split-group-parent'));
  // R4-48: the workspace popover, the profile panel with its Workspaces section, and the new-workspace sheet, with three workspaces.
  await close(); await app.act({type:'workspace.create',name:'Work'}); await app.act({type:'workspace.create',name:'Study'}); await sleep(800);
  const openKind = kind => async () => app.cmd({type:'ui',tabId:(await app.state()).activeTabId,action:'open',kind});
  await measure('workspace-menu', '3 workspaces', openKind('workspace-menu'));
  await measure('profile', '3 workspaces', openKind('profile'));
  await measure('workspace-edit', 'new', openKind('workspace-edit'));
  // R3-38: the switcher of a locked workspace (Study made secured through the test gate, then locked): Unlock in place of Rename / Icon and color / Delete.
  await close(); { const study=(await app.state()).workspaces.find(w=>w.name==='Study'); const made=await bounded(app.ui.evaluate(id=>window.acira.secured({type:'enable',id}),study.id),'secure Study'); if(!made?.ok)throw Error('Study could not be secured: '+JSON.stringify(made)); await app.act({type:'workspace.lock',id:study.id}); await poll(async()=>(await app.state()).workspaces.find(w=>w.id===study.id&&w.secured&&!w.unlocked),Boolean,'Study locked',6000); await sleep(900); }
  await measure('workspace-menu', '3 workspaces, newest locked', openKind('workspace-menu'));
}catch(error){fatal={message:error.message,stack:error.stack};failures.push(error.message);}
finally{
  if(app){try{await bounded(app.ui.evaluate(()=>window.__stopHeightLayouts?.()),'unsubscribe');await bounded(overlay()?.evaluate(()=>window.__heightProbe?.stop()),'stop sampler');}catch{}try{const ownedProcess=app.app.process();await bounded(app.close(),'owned normal close',15000);await poll(()=>ownedProcess.exitCode!==null||ownedProcess.signalCode!==null,Boolean,'owned process exited',5000);}catch(error){failures.push('owned close: '+error.message);}}
  if(fx)try{await fx.close();}catch(error){failures.push('fixture close: '+error.message);}
}
const missing=historical.filter(item=>!results.some(row=>row.kind===item.kind&&row.label===item.label&&row.stateMatches&&row.firstShown));
if(missing.length)failures.push('Required cases without intrinsic measurement and DOM-visible frames in matching states: '+missing.map(item=>item.kind+' ('+item.label+')').join(', '));
const report={schema:1,runId,status:failures.length?'failed':'passed',startedAt,finishedAt:new Date().toISOString(),out,root,actualTarget,measurementContract,results:results.map(({kind,label,state,stateMatches,domIntrinsicHeight,productionAllowance,expectedNativeContentHeight,nativeContentHeight,fixtureMeasuredHeight,sourceEstimate})=>({kind,label,state,stateMatches,domIntrinsicHeight,productionAllowance,expectedNativeContentHeight,nativeContentHeight,fixtureMeasuredHeight,sourceEstimate})),requiredCount:historical.length,missing,failures,fatal,fixtureWritten:false,toleranceCssPx:1};
await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2),{flag:'wx'});
console.log(JSON.stringify({runId,status:report.status,measured:results.length,required:historical.length,missing:missing.length,failures,artifacts:out,fixtureWritten:false}));
process.exitCode=failures.length?1:0;
