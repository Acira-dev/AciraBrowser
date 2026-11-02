// Remaining M visual gaps. Run only with the coordinator's exclusive native QA lease.
// One visible app, <= 5 tabs, isolated APPDATA/LOCALAPPDATA, bounded operations, watchdog/finally.
// Usage: node qa/m-gap-audit.mjs [1|1.5] [artifact-directory]
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';
import {broadSweep} from './m-broad-sweep.mjs';

const scale = Number(process.argv[2] || 1);
if (![1, 1.5].includes(scale)) throw Error('Use scale 1 or 1.5');
const stamp = Date.now(), out = path.resolve(process.argv[3] || 'qa/artifacts/m-gap-audit');
const root = path.resolve(`.qa-profiles/m-gap-${scale}-${stamp}`);
const roaming = path.join(root, 'fixtures', 'roaming'), local = path.join(root, 'fixtures', 'local');
await Promise.all([out, roaming, local].map(p => fs.mkdir(p, {recursive: true})));
const edge = await fs.readFile('qa/m-edge-scan.js', 'utf8');
const clip = await fs.readFile('qa/m-clip-scan.js', 'utf8');
const stage=process.env.M_AUDIT_STAGE||'all';
const report = {scale, stage, root, checks: [], errors: [], complete: false};
const fx = await httpFixture((req, res) => {
  res.setHeader('content-type', 'text/html');
  res.end('<!doctype html><title>Visual QA fixture</title><body style="margin:40px;background:#e6e6e6;color:#151515;font:16px sans-serif">Acira visual QA fixture</body>');
});
const base = `http://127.0.0.1:${fx.port}`;
let harness, watchdog;
const write = () => fs.writeFile(path.join(out, `report-${scale}${stage==='all'?'':'-'+stage}.json`), JSON.stringify(report, null, 2));
try {
  process.env.D_VISIBLE = '1';
  harness = await startApp({root, args: [`--force-device-scale-factor=${scale}`, '--disable-features=CalculateNativeWinOcclusion'], env: {APPDATA: roaming, LOCALAPPDATA: local, ACIRA_TEST_APP_DIALOG: '1'}});
  const h = harness;
  // Install before Settings reads Tor status and creates its shared service.
  if(stage!=='proxy'||process.env.M_TOR_PROOF)await h.main((_,modulePath)=>{
    const require=process.mainModule.require('node:module').createRequire(modulePath);
    const mod=require('./browser-services/tor-window.cjs'),original=mod.createTorWindows;
    const status={state:'error',progress:50,socksPort:0,version:'0.4.9.14',firstConnection:true,error:{code:'unreachable',title:'Can’t reach the Tor network',detail:'Your network may block Tor. Check your connection and try again.'}};
    mod.createTorWindows=options=>{const service=original(options);Object.assign(service.engine,{status:()=>status,onStatus:()=>()=>{},acquire:()=>()=>Promise.resolve(),retry:()=>{},newIdentity:async()=>({delayed:false})});if(service.updater)service.updater.check=async()=>service.updater.status();return service;};
  },path.resolve('desktop/main.cjs'));
  const deadline=Date.now()+7*60000;
  watchdog = setTimeout(() => { report.errors.push('7 minute watchdog expired'); void write(); void h.close(); }, 7 * 60000);
  watchdog.unref();
  const mainWindow = async (maximize = false) => h.main(({BaseWindow}, maximize) => {
    const win = BaseWindow.getAllWindows().filter(w => !w.isDestroyed()).sort((a,b) => b.getBounds().width-a.getBounds().width)[0];
    if (maximize) win.maximize();
    else { win.unmaximize(); win.setBounds({x:40,y:40,width:900,height:600}); }
    win.show(); win.focus(); return win.getBounds();
  }, maximize);
  const overlay = async selector => poll(async () => {
    for (const p of h.context.pages()) if (p.url().includes('view=overlay') && await p.locator(selector).count()) return p;
  }, Boolean, `overlay ${selector}`, 7000);
  const dismiss = async () => { for (const p of h.context.pages()) if (p.url().includes('acira-browser-ui:')) await p.keyboard.press('Escape').catch(() => {}); await sleep(180); };
  const capture = async (name, dialog = false) => {
    const png = await h.main(async ({BaseWindow,desktopCapturer,screen}, dialog) => {
      const wins = BaseWindow.getAllWindows().filter(w => w.isVisible());
      const win = dialog ? wins.find(w => w.getBounds().width < 700) : wins.sort((a,b) => b.getBounds().width-a.getBounds().width)[0];
      if (!win) throw Error('No visible capture window');
      const b = win.getBounds(), factor = screen.getDisplayMatching(b).scaleFactor;
      const sources = await desktopCapturer.getSources({types:['window'],thumbnailSize:{width:Math.round(b.width*factor),height:Math.round(b.height*factor)}});
      const source = sources.find(s => s.id === win.getMediaSourceId());
      if ((!source || source.thumbnail.isEmpty()) && dialog) {const view=win.contentView.children.find(v=>v.webContents?.getURL().includes('native-dialog.html'));if(view)return (await view.webContents.capturePage()).toPNG().toString('base64');}
      if (!source || source.thumbnail.isEmpty()) throw Error('Native pixel capture unavailable');
      return source.thumbnail.toPNG().toString('base64');
    }, dialog);
    const file = `${name}.png`; await fs.writeFile(path.join(out,file),Buffer.from(png,'base64')); return file;
  };
  const scan = async (page, name, selector, dialog = false, save = true) => {
    await page.evaluate(edge);
    const item = {name, url:page.url(), edge:await page.evaluate(() => window.__edge.static()), clip:await page.evaluate(clip)};
    item.geometry = await page.evaluate(selector => {
      const nodes = [...document.querySelectorAll(selector)];
      return nodes.map(e => { const r=e.getBoundingClientRect(),c=getComputedStyle(e); return {class:e.className,text:e.textContent?.trim().slice(0,120),rect:[r.x,r.y,r.width,r.height],color:c.color,background:c.backgroundColor,fontSize:c.fontSize,lineHeight:c.lineHeight}; });
    }, selector);
    if(save)item.screenshot=await capture(name,dialog);
    report.checks.push(item); console.log('scan',name); if(save)await write(); return item;
  };
  await mainWindow();
  await h.act({type:'tab.new',url:base+'/page'});
  const web = await h.waitWeb(base+'/page');
  await poll(() => web.title(), t => t === 'Visual QA fixture', 'fixture loaded');
  const tabId = (await h.state()).activeTabId;
  // The invalid link exercises the real validation error without downloading or installing anything.
  if(stage==='all')for (const theme of ['light','dark']) {
    await h.act({type:'settings.update',patch:{appearance:theme,interfaceScale:100,verticalTabs:false}}); await sleep(550);
    for (const size of ['small','max']) {
      await mainWindow(size==='max'); await sleep(400);
      const name = suffix => `${scale}-${theme}-${size}-${suffix}`;
      await h.cmd({type:'zoom',tabId,zoom:125});
      await h.ui.locator('.address-zoom-indicator').click();
      const zoom = await overlay('.zoom-feedback');
      await zoom.locator('.zoom-feedback').hover();
      await sleep(300); await scan(zoom,name('zoom'),'.zoom-feedback,.zoom-feedback button'); await dismiss();
      if(await h.ui.getByRole('button',{name:'Extensions',exact:true}).count())await h.ui.getByRole('button',{name:'Extensions',exact:true}).click();
      else {await h.ui.getByRole('button',{name:'More toolbar buttons',exact:true}).click();const overflow=await overlay('.popup-content-toolbar-overflow');await overflow.getByRole('button',{name:'Extensions',exact:true}).click();}
      const ext = await overlay('.extension-panel');
      await sleep(350);
      await ext.locator('summary').filter({hasText:'Add from a Web Store link…'}).first().click();
      await ext.getByRole('textbox',{name:'Chrome Web Store link',exact:true}).fill('not-a-store-link');
      await ext.getByRole('button',{name:'Add',exact:true}).click();
      await ext.locator('[role=alert]').waitFor(); await sleep(300);
      await scan(ext,name('extension-error'),'.extension-panel-note,.extension-panel-form'); await dismiss();
      // Esc denies this once, so the next theme/size exercises the same prompt again.
      const answer = web.evaluate(() => Notification.requestPermission());
      const dialog = await poll(() => h.context.pages().find(p => p.url().includes('native-dialog.html')),Boolean,'permission renderer');
      await poll(() => h.main(({BaseWindow}) => BaseWindow.getAllWindows().some(w => w.isVisible() && w.getBounds().width < 700)),Boolean,'permission native window');
      await poll(() => dialog.getByRole('button',{name:'Block',exact:true}).isVisible(),Boolean,'permission visible');
      await sleep(180); await scan(dialog,name('permission'),'h1,p,button',true);
      await dialog.keyboard.press('Escape'); await answer;
      await h.act({type:'settings.update',patch:{verticalTabs:true}}); await sleep(450);
      if (!(await h.state()).tabGroups.length) await h.act({type:'tab.group.create',tabId,name:'Research',color:'blue'});
      await sleep(350); await h.ui.locator('.sb-group-header').hover();
      await scan(h.ui,name('sidebar-group'),'.sb-group-name,.sb-group-header>.sb-tab-icon,.sb-tab-title,.sb-zone-label');
      await h.act({type:'settings.update',patch:{verticalTabs:false}}); await sleep(350);
    }
  }
  // A refused local proxy is deterministic and covers the previously blank error-page regression.
  if(stage==='all'||stage==='proxy'){
  await h.main(({dialog})=>{dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});});
  const setProxy=async choice=>{let done=false;const pending=h.svc({type:'proxy.set',choice}).finally(()=>{done=true;});pending.catch(()=>{});for(let i=0;i<100&&!done;i++){const dialog=h.context.pages().find(p=>p.url().includes('native-dialog.html'));if(dialog){const confirm=dialog.getByRole('button',{name:'Use this proxy',exact:true});if(await confirm.count())await confirm.click({timeout:1000}).catch(()=>{});}await sleep(50);}if(!done)throw Error('QA proxy confirmation did not finish');return pending;};
  await setProxy({mode:'fixed_servers',server:{scheme:'http',host:'127.0.0.1',port:9},bypassHosts:[]});
  await h.act({type:'tab.new',url:'http://m-proxy-failure.invalid/visual-qa'});
  await poll(async () => {const s=await h.state();return s.tabs.find(t => t.id===s.activeTabId)?.error;},e => /PROXY/.test(e||''),'proxy failed',15000);
  for (const theme of ['light','dark']) {
    await h.act({type:'settings.update',patch:{appearance:theme}}); await mainWindow(); await sleep(450);
    await h.ui.locator('.navigation-error').waitFor(); await scan(h.ui,`${scale}-${theme}-small-proxy${stage==='proxy'?'-after':''}`,'.ne-title,.ne-message,.ne-tech,.ne-actions');
  }
  await setProxy({mode:'direct'});
  if(stage==='proxy'){
    await h.act({type:'tab.new',url:'acira://settings'});await sleep(500);
    for(const theme of ['light','dark']){
      await h.act({type:'settings.update',patch:{appearance:theme}});await mainWindow();await sleep(300);
      await h.ui.locator('.bs-sidebar nav').getByRole('button',{name:'Privacy',exact:true}).click();await sleep(350);
      const provider=h.ui.locator('.bs-main button').filter({hasText:'Mullvad VPN'}).first();await provider.scrollIntoViewIfNeeded();
      await h.ui.keyboard.press('Tab');await provider.focus();await sleep(100);
      await scan(h.ui,`${scale}-${theme}-small-vpn-after`,'.st-control button');
      report.checks.at(-1).focus=await h.ui.evaluate(()=>window.__edge.focus());
      await h.ui.locator('.bs-sidebar nav').getByRole('button',{name:'Search',exact:true}).click();await sleep(350);
      await h.ui.locator('.nc-engine .nc-link').first().hover();await scan(h.ui,`${scale}-${theme}-small-search-action-after`,'.nc-engine .nc-link');
    }
  }
  }
  if(stage==='all'||stage==='broad')await broadSweep({h,scale,report,scan,capture,write,mainWindow,sleep,deadline:deadline-30000});
  // Visual fixture only: retain the real Tor session/sentinel and UI, but inject a failed engine.
  // This neither launches tor.exe nor claims real Tor connectivity (owned by the functional QA worker).
  if(stage!=='proxy'||process.env.M_TOR_PROOF){
  await h.act({type:'tab.new',privacy:'tor'});
  await poll(() => h.ui.locator('.tor-panel').count(),Boolean,'Tor visual fixture');
  for (const theme of ['light','dark']) {
    await h.act({type:'settings.update',patch:{appearance:theme}}); await mainWindow(); await sleep(450);
    await h.ui.mouse.move(2,2);await sleep(150);
    if(stage==='contrast'){
      await scan(h.ui,`${scale}-${theme}-small-tor-contrast-after`,'.tor-panel .acira-menu-sub,.tor-panel .tor-pop-note');
      const contrast=await h.ui.evaluate(()=>{
        const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d',{willReadFrequently:true});
        const rgba=v=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=v;ctx.fillRect(0,0,1,1);const p=ctx.getImageData(0,0,1,1).data;return[p[0],p[1],p[2],p[3]/255];};
        const blend=(a,b)=>[0,1,2].map(i=>a[i]*a[3]+b[i]*(1-a[3]));
        const lum=c=>c.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
        return [...document.querySelectorAll('.tor-panel .acira-menu-sub,.tor-panel>.tor-pop-note')].map(e=>{let bg=[255,255,255];const parents=[];for(let q=e;q;q=q.parentElement)parents.unshift(q);for(const p of parents)bg=blend(rgba(getComputedStyle(p).backgroundColor),bg);const fg=blend(rgba(getComputedStyle(e).color),bg),a=lum(fg),b=lum(bg),r=e.getBoundingClientRect();return{text:e.textContent.trim(),ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),foreground:fg,background:bg,rect:[r.x,r.y,r.width,r.height]};});
      });
      report.checks.at(-1).contrast=contrast;if(!contrast.length||contrast.some(x=>x.ratio<4.5))throw Error(`Tor page contrast failed: ${JSON.stringify(contrast)}`);continue;
    }
    await scan(h.ui,`${scale}-${theme}-small-${stage==='tor'?'tor-page-after':'tor-error-fixture'}`,'.tor-panel h1,.tor-panel h2,.tor-panel p,.tor-panel button');
    if(stage==='tor'){
      const chip=h.ui.locator('.tor-chip');await chip.hover();await sleep(700);
      await scan(h.ui,`${scale}-${theme}-small-tor-tooltip-after`,'.t-tip[role=tooltip]');
      const contained=await h.ui.evaluate(()=>{const e=document.querySelector('.t-tip[role=tooltip]');if(!e)return false;const b=e.getBoundingClientRect(),r=document.createRange();r.selectNodeContents(e);return [...r.getClientRects()].every(r=>r.left>=b.left+7.5&&r.right<=b.right-7.5)&&b.left>=0&&b.right<=innerWidth;});
      if(!contained)throw Error('Tor tooltip text was not contained');
      await h.ui.mouse.move(2,2);const original=await chip.getAttribute('title');
      const long='Unbroken'+ 'X'.repeat(1000);await chip.evaluate((e,title)=>{e.title=title;},long);await chip.hover();await sleep(700);
      const fallback={nativeTitleRestored:await chip.getAttribute('title')===long,visibleAciraTooltips:await h.ui.locator('.t-tip[role=tooltip]').count()};
      if(!fallback.nativeTitleRestored||fallback.visibleAciraTooltips)throw Error('Overlong tooltip did not use existing native-title fallback');
      report.checks.push({name:`${scale}-${theme}-unbroken-tooltip-fallback`,...fallback});
      await h.ui.mouse.move(2,2);await chip.evaluate(e=>{e.title='Open a new tab · Ctrl+T';});await chip.hover();await sleep(700);
      await scan(h.ui,`${scale}-${theme}-small-shortcut-tooltip-after`,'.t-tip[role=tooltip],.t-tip[role=tooltip] kbd');
      const height=await h.ui.locator('.t-tip[role=tooltip]').evaluate(e=>e.getBoundingClientRect().height);if(height!==24)throw Error(`Ordinary tooltip height changed: ${height}`);
      await h.ui.mouse.move(2,2);await chip.evaluate((e,title)=>{e.title=title||'';},original);
    }
    await h.ui.locator('.tor-chip').click(); const tor = await overlay('.tor-popover');
    await sleep(300); await scan(tor,`${scale}-${theme}-small-tor-panel-fixture`,'.tor-popover,.tor-popover p,.tor-popover button'); await dismiss();
  }
  }
  report.complete = true;
} catch (error) { report.errors.push(String(error.stack||error)); process.exitCode = 1; }
finally { clearTimeout(watchdog); await harness?.close().catch(()=>{}); await fx.close(); await write(); }
console.log(JSON.stringify({scale,complete:report.complete,checks:report.checks.length,errors:report.errors}));
