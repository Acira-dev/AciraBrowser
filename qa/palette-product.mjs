import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';import {createRequire} from 'node:module';import {build} from 'esbuild';import {chromium} from 'playwright';
const dir=path.resolve('docs/design/color-research/production-qa');fs.mkdirSync(dir,{recursive:true});
// Bundle the actual renderer and stylesheet graph without touching dist, desktop
// runtime files, a running server, native windows, or the user's preview profile.
const result=await build({entryPoints:['src/main.tsx'],bundle:true,write:false,outdir:dir,entryNames:'renderer',minify:true,format:'iife',platform:'browser',define:{'import.meta.env.DEV':'true','process.env.NODE_ENV':'"production"'},plugins:[{name:'public-assets',setup(b){b.onResolve({filter:/^\//},args=>({path:args.path,external:true}));}}]});
const asset=value=>pathToFileURL(path.resolve('public',value.replace(/^\//,''))).href;
for(const output of result.outputFiles){let value=output.text;if(output.path.endsWith('.css'))value=value.replace(/url\((['"]?)(\/[^)'"\s]+)\1\)/g,(_m,_q,p)=>`url("${asset(p)}")`);else value=value.replace(/(["'])((?:\/|\.\/)(?:workspace-coast\.png|acira-[a-z.-]+|fonts\/[a-zA-Z0-9.-]+|frost-grain\.svg))\1/g,(_m,q,p)=>q+asset(p)+q);fs.writeFileSync(output.path,value);}
fs.writeFileSync(path.join(dir,'renderer.html'),'<!doctype html><html><meta charset="utf-8"><link rel="stylesheet" href="renderer.css"><body><div id="root"></div><script src="renderer.js"></script></body></html>');
await build({entryPoints:['src/ui/theme.ts'],bundle:true,platform:'node',format:'cjs',outfile:path.join(dir,'theme.cjs')});
await build({entryPoints:['src/ui/colorMath.ts'],bundle:true,platform:'node',format:'cjs',outfile:path.join(dir,'math.cjs')});
await build({entryPoints:['src/runtime/appearancePalettes.ts'],bundle:true,platform:'node',format:'cjs',outfile:path.join(dir,'palettes.cjs')});
if(process.argv.includes('--bundle-only')){console.log('Updated isolated renderer bundle; no acceptance checks run.');process.exit(0);}
const require=createRequire(import.meta.url),{themeTokens,studyFinish,tabViewerTokens}=require(path.join(dir,'theme.cjs')),{appearancePalettes}=require(path.join(dir,'palettes.cjs')),{contrast,compositeColor}=require(path.join(dir,'math.cjs'));
const checks=[],record=(name,pass,detail)=>{checks.push({name,pass,...detail});assert.ok(pass,name+': '+JSON.stringify(detail))};
record('CSS rgb is measured as its real ink',contrast('rgb(37 38 43)','#ffffff')===contrast('#25262b','#ffffff'));
assert.throws(()=>contrast('rgba(255,255,255,.5)','#000000'),/Composite/);record('raw alpha contrast is rejected',true);
record('sRGB composition is explicit',compositeColor('rgba(255,255,255,.5)','#000000')==='#808080');
const pairs=[],configurations=[],accessibilityGaps=[],chromeBackingBounds=[];const custom=[];for(const tint of ['#000000','#ffffff','#808080','#ffff00','#00ffff','#ff00ff','#ff0000','#0000ff'])for(const accent of ['#000000','#ffffff','#ffff00'])custom.push({name:'Custom',tint,accent});
for(const p of [...appearancePalettes,...custom])for(const dark of [false,true])for(const highContrast of [false,true])for(const opaque of [false,true]){
 const s={colorPreset:p.name,browserTint:p.tint,accentColor:p.accent,reducedTransparency:opaque},t=themeTokens(s,dark,highContrast),key=[p.name,p.tint,p.accent,dark,highContrast,opaque];
 configurations.push(key);assert.equal(t['--finish'],p.name);assert.equal(studyFinish(s,dark,highContrast,opaque)['--input-fill'],t['--input-fill']);
 const content=['--sheet','--raised','--overlay','--input-fill','--input-hover','--sheet-alt','--hover','--pressed-fill','--selection-bg'];
 const add=(role,bg,min)=>{const ratio=contrast(t[role],t[bg]);pairs.push({key,role,bg,foreground:t[role],background:t[bg],ratio,minimum:min,pass:ratio>=min});};
 for(const bg of content){add('--text-primary',bg,4.5);add('--text-secondary',bg,4.5);add('--ed-icon',bg,3);}
 for(const bg of ['--sheet','--input-fill','--input-hover','--raised','--overlay']){if(highContrast)add('--input-edge',bg,3);else {const ratio=contrast(t['--input-edge'],t[bg]);if(ratio<3)accessibilityGaps.push({key,role:'soft resting field edge',bg,ratio,criterion:'1.4.11 if the boundary is essential',qualification:'Latest user-selected soft hairline does not independently meet 3:1. No conformance claim; high-contrast strong edge remains.'});}add('--input-edge-strong',bg,3);add('--focus-ring',bg,3);}
 add('--text-placeholder','--input-fill',4.5);add('--text-placeholder','--input-hover',4.5);
 for(const bg of ['--primary','--primary-hover','--primary-pressed'])add('--on-primary',bg,4.5);
 for(const bg of ['--ed-chrome','--chrome-sheet','--chrome-hover','--chrome-pressed','--chrome-selection-bg']){add('--chrome-text-secondary',bg,4.5);add('--chrome-focus-ring',bg,3);}
 for(const role of Object.keys(t).filter(x=>x.startsWith('--tab-group-')&&x!=='--tab-group-none'))for(const bg of ['--ed-chrome','--chrome-selection-bg','--chrome-sheet'])add(role,bg,3);
 // Navigation lines sit on chrome/address/page, never a pressed toolbar button.
 for(const bg of ['--ed-chrome','--chrome-sheet','--sheet','--input-fill'])add('--navigation-progress-core',bg,3);
 for(const status of ['danger','warning','success','info','private']){add(`--${status}-text`,`--${status}-fill`,4.5);add(`--${status}-edge`,'--input-fill',3);}
 for(const backing of ['#000000','#ffffff']){const bg=compositeColor(t['--glass'],backing);for(const role of ['--popup-ink','--popup-muted','--popup-danger','--popup-warning','--popup-success']){const ratio=contrast(t[role],bg);pairs.push({key,role,backing,foreground:t[role],background:bg,ratio,minimum:4.5,pass:ratio>=4.5});}}
 for(const backing of ['#000000','#ffffff']){const native=compositeColor(`rgb(${t['--native-material-tint-rgb']} / ${t['--material-opacity']})`,backing);for(const role of ['--native-popup-ink','--native-popup-muted','--native-popup-danger','--native-popup-warning','--native-popup-success']){const ratio=contrast(t[role],native);pairs.push({key,role,backing,foreground:t[role],background:native,ratio,minimum:4.5,pass:ratio>=4.5});}}
 const viewer=tabViewerTokens(s,dark);assert.equal(viewer['--popup-selection-fg'],viewer['--text-primary']);
 if(!opaque&&!highContrast)for(const backing of ['#000000','#ffffff'])for(const alpha of [.66,.54]){const bg=compositeColor(`rgba(${require(path.join(dir,'math.cjs')).rgb(t['--ed-chrome']).join(',')},${alpha})`,backing);chromeBackingBounds.push({key,backing,alpha,foreground:t['--chrome-text-secondary'],composed:bg,ratio:contrast(t['--chrome-text-secondary'],bg),qualification:'DOM veil over a uniform synthetic backing; actual native acrylic processing is not represented. Some extremes cannot share one readable ink.'});}
}
const failures=pairs.filter(x=>!x.pass);record('actual product token pairs',failures.length===0,{configurations:configurations.length,pairs:pairs.length,failures:failures.slice(0,8)});
const overrideChecks=[];for(const p of appearancePalettes)for(const dark of [false,true])for(const glassOpacity of [60,88])for(const colors of [{surfaceColor:'#ffffff',sidebarColor:'#000000',tabColor:'#ffff00'},{surfaceColor:'#000000',sidebarColor:'#ff00ff',tabColor:'#00ffff'}]){
 const t=themeTokens({colorPreset:p.name,browserTint:p.tint,accentColor:p.accent,glassOpacity,...colors},dark),key=[p.name,dark,glassOpacity,colors];
 assert.equal(Number(t['--material-opacity']),glassOpacity/100);
 for(const [fg,bg,min]of [['--text-placeholder','--input-fill',4.5],['--text-primary','--sheet',4.5],['--chrome-text-secondary','--sidebar-selection-bg',4.5],['--chrome-text-secondary','--tab-selection-bg',4.5],['--focus-ring','--input-fill',3]])overrideChecks.push({key,fg,bg,ratio:contrast(t[fg],t[bg]),minimum:min,pass:contrast(t[fg],t[bg])>=min});
 for(const backing of ['#000000','#ffffff']){const local=compositeColor(t['--glass'],backing),native=compositeColor(`rgb(${t['--native-material-tint-rgb']} / ${t['--material-opacity']})`,backing);for(const [fg,bg]of [['--popup-muted',local],['--native-popup-muted',native]])overrideChecks.push({key,fg,bg,ratio:contrast(t[fg],bg),minimum:4.5,pass:contrast(t[fg],bg)>=4.5});}
}
record('custom surface/section colors and opacity endpoints',overrideChecks.every(x=>x.pass),{pairs:overrideChecks.length,failures:overrideChecks.filter(x=>!x.pass).slice(0,5)});
for(const [value,expected]of [[-30,.6],[200,1],[NaN,.64]])record('material opacity clamps imported values',Number(themeTokens({colorPreset:'Porcelain',browserTint:'#f8fbff',accentColor:'#1769c2',glassOpacity:value},false)['--material-opacity'])===expected,{value:String(value),expected});
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}),context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
const cssRecords=[];
try{
 await page.goto(pathToFileURL(path.join(dir,'renderer.html')).href+'?qa=1');await page.waitForFunction(()=>Boolean(window.__acira));await page.locator('.ed-search-glass input').waitFor();
 const configure=async(p,appearance,opaque=false)=>{await page.evaluate(({p,appearance,opaque})=>window.__acira.dispatch({type:'settings.update',patch:{colorPreset:p.name,browserTint:p.tint,accentColor:p.accent,appearance,reducedTransparency:opaque,reducedMotion:true}}),{p,appearance,opaque});await page.waitForFunction(({name,appearance,opaque})=>{const s=window.__acira.getState().settings;return document.querySelector('.app').dataset.finish===name&&s.appearance===appearance&&s.reducedTransparency===opaque},{name:p.name,appearance,opaque});await page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>a.constructor.name==='CSSTransition').map(a=>a.finished.catch(()=>{}))));};
 const ink=async(selector,pseudo)=>page.locator(selector).first().evaluate((el,pseudo)=>{const s=getComputedStyle(el,pseudo);return{color:s.color,background:s.backgroundColor,border:s.borderColor,borderWidth:s.borderWidth,outline:s.outline,shadow:s.boxShadow,opacity:s.opacity,rect:JSON.stringify(el.getBoundingClientRect().toJSON())}},pseudo);
 for(const p of appearancePalettes)for(const mode of ['light','dark'])for(const opaque of [false,true]){
  await configure(p,mode,opaque);await page.locator('.ed-search-glass input').fill('');await page.locator('.ed-workspace').click({position:{x:2,y:2}});
  const tokens=themeTokens({colorPreset:p.name,browserTint:p.tint,accentColor:p.accent,reducedTransparency:opaque},mode==='dark');
  const rest=await ink('.ed-search-glass'),placeholder=await ink('.ed-search-glass input','::placeholder'),bg=rest.background;
  record('workspace placeholder actual CSS',contrast(placeholder.color,bg)>=4.5,{finish:p.name,mode,opaque,foreground:placeholder.color,background:bg});
  record('workspace soft hairline actual CSS (visual target, not WCAG)',contrast(rest.border,bg)>=1.15,{finish:p.name,mode,opaque,edge:rest.border,bg,ratio:contrast(rest.border,bg)});
  await page.locator('.ed-search-glass').hover();const hover=await ink('.ed-search-glass');record('workspace hover placeholder actual CSS',contrast(placeholder.color,hover.background)>=4.5,{finish:p.name,mode,opaque});
  await page.locator('.ed-search-glass input').focus();const focus=await ink('.ed-search-glass');record('workspace persistent focus ring',focus.outline.includes('solid 2px'),{finish:p.name,mode,opaque,outline:focus.outline});
  await page.locator('.ed-search-glass input').fill('example.com');const submit=await ink('.ed-submit');record('enabled submit actual CSS',contrast(submit.color,submit.background)>=4.5,{finish:p.name,mode,opaque});
  cssRecords.push({finish:p.name,mode,opaque,rest,placeholder,hover,focus,submit});
 }
 await configure(appearancePalettes.find(x=>x.name==='Burgundy'),'light');await page.locator('.ed-workspace').click({position:{x:2,y:2}});await page.screenshot({path:path.join(dir,'workspace-burgundy.png')});
 const corners=await page.locator('.ed-search-glass').evaluate(el=>({supported:CSS.supports('corner-shape','superellipse(1.15)'),computed:getComputedStyle(el).cornerShape,height:el.getBoundingClientRect().height}));record('DOM corner trial preserves field height and fallback',corners.height===48&&(!corners.supported||corners.computed.includes('superellipse(1.15)')),{corners});
 const currentRow=page.locator('.ed-rail-button[aria-current=page]').first();const selectedStyle=await currentRow.evaluate(el=>{const s=getComputedStyle(el);return{border:s.borderWidth,shadow:s.boxShadow,background:s.backgroundColor,ink:s.color}});record('sidebar selection has no card border or shadow',selectedStyle.border==='0px'&&selectedStyle.shadow==='none',selectedStyle);await page.keyboard.press('Tab');await currentRow.focus();record('sidebar keyboard focus remains separate',(await ink('.ed-rail-button[aria-current=page]')).outline.includes('solid 2px'));
 const brand=page.locator('.ed-rail-brand>.ed-rail-button').first(),settlePaint=()=>page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>a.constructor.name==='CSSTransition').map(a=>a.finished.catch(()=>{}))));
 for(const acrylic of [false,true]){await page.evaluate(acrylic=>{if(acrylic)document.documentElement.dataset.material='acrylic';else delete document.documentElement.dataset.material;},acrylic);await brand.hover();await settlePaint();record('brand pointer hover has no background tile',(await ink('.ed-rail-brand>.ed-rail-button')).background==='rgba(0, 0, 0, 0)',{acrylic});}
 await page.evaluate(()=>delete document.documentElement.dataset.material);await page.keyboard.press('Tab');await brand.focus();record('brand keyboard focus remains visible',(await ink('.ed-rail-brand>.ed-rail-button')).outline.includes('solid 2px'));await page.locator('.ed-rail nav .ed-rail-button').first().hover();await settlePaint();record('ordinary sidebar pointer feedback survives',(await ink('.ed-rail nav .ed-rail-button')).background!=='rgba(0, 0, 0, 0)');
 await page.evaluate(()=>window.__acira.dispatch({type:'tab.group.create',tabId:window.__acira.getState().activeTabId,name:'Palette QA group',color:'blue'}));await page.locator('.tab-group-label').first().waitFor();
 for(const p of [appearancePalettes.find(x=>x.name==='Porcelain'),appearancePalettes.find(x=>x.name==='Burgundy')])for(const mode of ['light','dark']){
  await configure(p,mode);const label=page.locator('.tab-group-label').first(),c=themeTokens({colorPreset:p.name,browserTint:p.tint,accentColor:p.accent},mode==='dark'),tray=await ink('.tab-group-tray'),fg=await ink('.tab-group-label');
  const bg=compositeColor(tray.background,c['--ed-chrome']);record('actual group label on tonal tray',contrast(fg.color,bg)>=4.5,{finish:p.name,mode,foreground:fg.color,background:bg});
  await page.keyboard.press('Tab');await label.focus();const focus=await ink('.tab-group-label');record('group focus has one outline and no stacked shadow',focus.outline.includes('solid 2px')&&focus.shadow==='none',{finish:p.name,mode,outline:focus.outline,shadow:focus.shadow});
 }
 // Real settings component via the product's local runtime, not a specimen DOM.
 await page.evaluate(()=>window.__acira.dispatch({type:'tab.new',url:'acira://settings'}));await page.getByRole('textbox',{name:'Search settings'}).waitFor();
 for(const name of ['Porcelain','Burgundy','Ocean Blue','Natural Titanium'])for(const mode of ['light','dark'])for(const opaque of [false,true]){
  const p=appearancePalettes.find(x=>x.name===name);await configure(p,mode,opaque);const input=page.getByRole('textbox',{name:'Search settings'});await input.fill('');
  for(const focused of [false,true]){if(focused)await input.focus();else await page.getByRole('heading',{name:'Appearance',exact:true}).click();const inner=await ink('.bs-search-input'),wrapper=await ink('.bs-toolbar>label'),ph=await ink('.bs-search-input','::placeholder');record('settings one paint owner',inner.background==='rgba(0, 0, 0, 0)'&&inner.shadow==='none'&&inner.borderWidth==='0px',{finish:name,mode,opaque,focused,inner});record('settings placeholder actual CSS',contrast(ph.color,wrapper.background)>=4.5,{finish:name,mode,opaque,focused,foreground:ph.color,background:wrapper.background});if(focused)record('settings wrapper focus ring',wrapper.outline.includes('solid 2px'),{finish:name,mode,opaque});}
 }
 await configure(appearancePalettes.find(x=>x.name==='Porcelain'),'dark');await page.screenshot({path:path.join(dir,'settings-porcelain-dark.png')});
 for(const name of ['Porcelain','Burgundy','Ocean Blue','Natural Titanium'])for(const mode of ['light','dark'])for(const opaque of [false,true]){
  await configure(appearancePalettes.find(x=>x.name===name),mode,opaque);await page.getByRole('button',{name:'Acira menu',exact:true}).filter({visible:true}).first().click();await page.locator('.acira-popup-surface .popup-material').waitFor();
  const material=await ink('.acira-popup-surface .popup-material'),row=await ink('.acira-popup-surface .menu-row');
  for(const backing of ['#000000','#ffffff']){const composed=compositeColor(material.background,backing);record('actual menu text over glass bound',contrast(row.color,composed)>=4.5,{finish:name,mode,opaque,backing,foreground:row.color,background:composed});}
  record('ordinary and opaque material are distinct',opaque?!material.background.startsWith('rgba'):material.background.startsWith('rgba'),{finish:name,mode,opaque,background:material.background});
  await page.keyboard.press('Escape');await page.locator('.acira-popup-surface').waitFor({state:'detached'});
 }
 await page.emulateMedia({forcedColors:'active'});const search=page.getByRole('textbox',{name:'Search settings'});await search.focus();record('forced colors wrapper focus persists',(await ink('.bs-toolbar>label')).outline.includes('solid 2px'));await page.emulateMedia({forcedColors:'none',contrast:'more'});record('actual app responds to increased contrast',await page.locator('.app').evaluate(el=>el.classList.contains('opaque-glass')));
 record('renderer has no script errors',errors.length===0,{errors});
}finally{
 const files=['src/ui/theme.ts','src/ui/semanticColors.ts','src/ui/colorMath.ts','src/frost-preview.css','src/styles/popup-material.css','src/features/browser-settings.css','src/App.tsx','src/features/BrowserSettings.tsx','src/features/FrostWorkspace.tsx'];
 fs.writeFileSync(path.join(dir,'results.json'),JSON.stringify({checkedAt:new Date().toISOString(),qualification:'Actual product resolver, CSS graph and React renderer in isolated web fallback with synthetic local state. Not native Electron/material/DPI acceptance; no personal or live-preview profile. Soft resting edges are intentional user direction; conditional SC 1.4.11 gaps are explicit, not passes.',browser:browser.version(),bundle:fs.readdirSync(dir).filter(p=>p.endsWith('.js')||p.endsWith('.css')).map(p=>({path:p,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,p))).digest('hex')})),source:files.map(path=>({path,sha256:crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex')})),checks,failures:checks.filter(x=>!x.pass),tokenPairCount:pairs.length,tokenPairFailures:failures,overrideChecks,accessibilityGaps,chromeBackingBounds,cssRecords,errors},null,2));
 await browser.close();
}
console.log(JSON.stringify({tokenConfigurations:configurations.length,tokenPairs:pairs.length,UIAndMathChecks:checks.length,failures:checks.filter(x=>!x.pass).length,errors}));
