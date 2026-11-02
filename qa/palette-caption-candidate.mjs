import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { spawn } from 'node:child_process';

// Reuse the frozen exact-bundle harness without changing its captured bytes.
const basePath = 'qa/palette-caption-layout.mjs', cssPath = 'docs/design/color-research/compact-caption-candidate.css';
let source = await fs.readFile(basePath, 'utf8'); const css = await fs.readFile(cssPath, 'utf8');
const favorites = process.argv.includes('--favorites');
const replace = (before, after) => { if (!source.includes(before)) throw Error('Caption harness seam changed: ' + before.slice(0, 60)); source = source.replace(before, after); };
replace('caption-layout-', 'caption-candidate-');
replace('[1400, 915, 610]', '[1400, 915, 732, 610, 600]');
if(favorites){
 replace('height: 820','height: 450');
 replace('let state = seed, layout',"localStorage.setItem('acira-new-tab:'+seed.activeBrowserProfileId,JSON.stringify({version:'palette-fixture',shortcuts:Array.from({length:12},(_,i)=>({id:'controlled-'+i,title:'Controlled favorite '+i,url:'https://favorite-'+i+'.test/',start:false,sidebar:true}))})); let state = seed, layout");
}
replace("await page.locator('.browser-shell').waitFor();", "await page.locator('.browser-shell').waitFor(); await page.evaluate(()=>document.fonts.ready); await page.addStyleTag({content:" + JSON.stringify(css) + '});');
replace("for (const mode of ['standard', 'compact', 'focus']) for (const rail of [false, true]) {", "for (const mode of ['standard', 'compact', 'focus']) for (const rail of [false, true]) for(const home of [false,true]) for(const zoom of [100,125]) {");
replace('async ({ mode, rail }) =>', 'async ({ mode, rail, home, zoom, scale }) =>');
replace("patch: { toolbarLayout: mode === 'compact' ? 'automatic' : 'expanded' }", "patch: { toolbarLayout: mode === 'compact' ? 'automatic' : 'expanded', showHome:home, interfaceScale:scale }");
replace("window.__captionQA.emit({ type: 'page-interaction'", "await window.acira.dispatch({type:'browser.event',event:{type:'state',tabId:(await window.acira.getSnapshot()).activeTabId,zoom}}); document.querySelector('.app').style.setProperty('--interface-scale',String(scale/100)); window.__captionQA.emit({ type: 'page-interaction'");
replace('}, { mode, rail });', '}, { mode, rail, home, zoom, scale:width<=610?150:width===732?125:100 });');
replace('const key = { width, mode, rail };', 'const key = { width, mode, rail, home, zoom };');
replace('parseFloat(value.captionWidth)', 'value.caption.width');
replace('const value = await page.locator', "await page.waitForFunction(({rail,home,zoom})=>{const s=window.__acira.getState(),t=s.tabs.find(t=>t.id===s.activeTabId);return t.zoom===zoom&&s.settings.showHome===home&&document.querySelector('.ed-rail').classList.contains('is-expanded')===rail;},{rail,home,zoom}); await page.waitForFunction(()=>{const p=document.querySelector('.page-area').getBoundingClientRect(),n=window.__captionQA.layout().pageBounds;return n&&Math.abs(p.left-n.x)<=1&&Math.abs(p.width-n.width)<=1;}); const value = await page.locator");
replace("captionWidth: getComputedStyle(header).getPropertyValue('--caption-width'),", "captionWidth: getComputedStyle(header).getPropertyValue('--caption-width'), addressInput: box(header.querySelector('.address-bar input')), page:box(document.querySelector('.page-area')), layout:window.__captionQA.layout(), railBox:box(document.querySelector('.ed-rail')), navLabels:[...document.querySelectorAll('.ed-rail>nav .ed-rail-label')].map(n=>({text:n.textContent,width:n.clientWidth,scroll:n.scrollWidth})),");
if(favorites){
 replace("navLabels:[...document.querySelectorAll", "footer:box(document.querySelector('.ed-rail footer')),favoriteGrid:box(document.querySelector('.ed-rail-apps')),favorites:[...document.querySelectorAll('.ed-rail-app')].map(n=>box(n)),favoriteOverflow:document.querySelector('.ed-rail-apps').scrollWidth-document.querySelector('.ed-rail-apps').clientWidth,navLabels:[...document.querySelectorAll");
 replace('const key = { width, mode, rail, home, zoom }; cases.push',"const key = { width, mode, rail, home, zoom }; if(rail){record('twelve responsive favorites retain44px targets and no horizontal overflow',value.favorites.length===12&&value.favorites.every(n=>Math.abs(n.width-44)<.5&&Math.abs(n.height-44)<.5)&&value.favoriteOverflow<=1,key);record('short-window favorite grid preserves visible footer',value.footer.bottom<=value.railBox.bottom+.5&&value.favoriteGrid.bottom<=value.footer.top+.5,key);} cases.push");
}
replace("const key = { width, mode, rail, home, zoom };", "const key = { width, mode, rail, home, zoom }; if(mode==='compact')record('address editing retains40CSSpx of actual input',value.addressInput.width>=40,{...key,inputWidth:value.addressInput.width}); record('native layout bridge follows the actual responsive page bounds',Math.abs(value.page.left-value.layout.pageBounds.x)<=1&&Math.abs(value.page.width-value.layout.pageBounds.width)<=1,key); if(rail)record('primary rail labels remain fully readable',value.navLabels.every(n=>n.scroll<=n.width+1),{...key,labels:value.navLabels});");
replace("`${width}-${mode}-${rail ? 'rail' : 'closed'}.png`", "`${width}-${mode}-${rail ? 'rail' : 'closed'}-${home?'home':'base'}-${zoom}.png`");
replace("const report = { checkedAt:", "const candidate={cssPath:"+JSON.stringify(cssPath)+",cssSha256:"+JSON.stringify(createHash('sha256').update(css).digest('hex'))+",baseHarnessSha256:"+JSON.stringify(createHash('sha256').update(await fs.readFile(basePath)).digest('hex'))+",interfaceScaleHook:'Explicit fixture token, proposed themeTokens output; not yet integrated product.'}; const report = {candidate, checkedAt:");
const oldQualification=source.match(/qualification: 'Exact verified642dist[^']*'/)?.[0]; if(!oldQualification)throw Error('Qualification seam changed'); replace(oldQualification,'qualification: '+JSON.stringify("Prospective exact CSS candidate with explicit matching scale token on verified642dist native-path renderer. Controlled native state/service bridge and immutable core reducer in headless Chrome.120states at1400/915/732/610/600CSS widths,standard/compact/Focus,rail open/closed,Home on/off,pagezoom100/125; optional favorites mode adds12fixtures/450px height. No Electron/native caption hit-target or integrated build acceptance."));
const runDir = path.resolve('docs/design/color-research/production-qa/caption-candidate-runner-' + Date.now()); await fs.mkdir(runDir, { recursive: true });
const bundle = await build({ stdin: { contents: source, resolveDir: path.resolve('qa'), loader: 'js' }, bundle: true, platform: 'node', format: 'esm', packages: 'external', write: false, plugins:[{name:'preserve-identity-module-location',setup(builder){builder.onResolve({filter:/palette-native-identity\.mjs$/},()=>({path:pathToFileURL(path.resolve('qa/palette-native-identity.mjs')).href,external:true}));}}] });
const runner = path.join(runDir, 'runner.mjs'); await fs.writeFile(runner, bundle.outputFiles[0].contents);
const child = spawn(process.execPath, [runner, ...process.argv.slice(2)], { stdio: 'inherit', windowsHide: true });
const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code)); }); process.exitCode = code ?? 1;
