'use strict';
// R3-45 / R3-46: AI-free mode is applied at document start, and the quiet line that replaces an AI answer lines up with the results column.
// Runs the app's real frame script (content-filter-preload.cjs) as a preload in a hidden Electron window against a Google-shaped page (fixtures/ai-pages/google-2026.html,
// structure read from a live results page on 26 Oct 2026) that adds its AI Overview at parse time, late (400 ms) or streamed (heading text arrives later).
// Every animation frame records whether any AI element (overview, AI Mode pill, AI Mode tab) was visible: it must be zero frames.
// The line's colours are measured against what paints behind it on light and dark pages, after the system appearance or the page's own theme changes under a
// line already drawn, and where the results area inherits a colour unrelated to the theme (DuckDuckGo's #222 under its dark theme, Bing's 60% black).
// The page can also change its colours with no event at all (as Windows applies an appearance change to an open page): a light check follows it, and that check
// must cost next to nothing (no per-frame loop on Google results, which drains battery on 120 Hz screens, and nothing in a hidden tab).
// The line starts at the results column also where the results area does not start at the window's edge (Bing, Brave) and on DuckDuckGo's layout, whose first links
// in a result belong to an invisible menu far to the right (fixtures/ai-pages/duckduckgo-indent.html, read live on 3 Nov 2026).
const {test}=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),path=require('node:path'),fs=require('node:fs');
const {surfacesFor,earlyStyles,splitSelectors,RULES}=require('../desktop/browser-services/ai-surfaces.cjs');
const electron=(()=>{try{const value=require('electron');return typeof value==='string'&&fs.existsSync(value)?value:null;}catch{return null;}})();
const SPECS=[
 {mode:'sync',theme:'light',reveal:true},{mode:'late',theme:'dark'},{mode:'stream',theme:'light'},{mode:'late',theme:'light'},
 {mode:'late',theme:'system',switchTo:'dark'},{mode:'sync',theme:'switch'},{mode:'sync',theme:'dark',ink:'fixed'},{mode:'sync',theme:'light',ink:'faint'},
 {mode:'sync',theme:'system',scheme:'dark',switchTo:'light'},
 {mode:'sync',theme:'cssom',wait:2200},{mode:'sync',theme:'light',probe:true},
 {mode:'sync',theme:'light',layout:'inset'},{page:'duckduckgo-indent.html',host:'duckduckgo.com'},
 {mode:'sync',theme:'light',zoom:1.5},{mode:'sync',theme:'light',layout:'inset',zoom:1.5},{page:'duckduckgo-indent.html',host:'duckduckgo.com',zoom:1.5},
 ...['opacity','offcanvas','clip','sronly','transform'].map(ghost=>({page:'duckduckgo-indent.html',host:'duckduckgo.com',ghost})),
 {mode:'sync',theme:'light',layout:'responsive',rezoom:1.5},{mode:'sync',theme:'light',dir:'rtl'},
 {mode:'sync',theme:'light',ai:false}
];
const CSSOM=SPECS.findIndex(spec=>spec.theme==='cssom'),PROBE=SPECS.findIndex(spec=>spec.probe),INSET=SPECS.findIndex(spec=>spec.layout==='inset'&&!spec.zoom),DDG=SPECS.findIndex(spec=>spec.page&&!spec.zoom&&!spec.ghost),GHOSTS=SPECS.map((spec,i)=>spec.ghost?i:-1).filter(i=>i>=0),REZOOM=SPECS.findIndex(spec=>spec.rezoom),RTL=SPECS.findIndex(spec=>spec.dir==='rtl'),
 ZOOMED=SPECS.map((spec,i)=>spec.zoom?i:-1).filter(i=>i>=0);
let results=null,problem=null;
if(electron){
 const env={...process.env,ELECTRON_ENABLE_LOGGING:'0'};delete env.ELECTRON_RUN_AS_NODE;
 const run=spawnSync(electron,[path.join(__dirname,'fixtures','ai-pages','early.cjs'),JSON.stringify(SPECS)],{encoding:'utf8',timeout:150000,env});
 const line=(run.stdout||'').split(/\r?\n/).find(text=>text.startsWith('RESULT '));
 if(line)results=JSON.parse(line.slice(7));else problem=((run.stdout||'')+(run.stderr||'')).split(/\r?\n/).filter(text=>!/^\[\d+:/.test(text)).join('\n').slice(0,600)||'electron produced no result';
}
const skip=!electron?'electron binary not available':false;
test('fixture run finished',{skip},()=>{assert.ok(results,problem);assert.equal(results.length,SPECS.length);});
for(const [index,spec] of SPECS.map((item,i)=>[i,item]).filter(([,item])=>item.ai!==false&&!item.page))test(`AI block never paints (${spec.mode}, ${spec.theme}${spec.layout?', '+spec.layout:''}): zero frames with an AI element visible, results stay`,{skip},()=>{
 const {measured}=results[index];
 assert.ok(measured.framesSeen>30,'the frame recorder ran for the whole load: '+measured.framesSeen);
 assert.equal(measured.framesWithAi,0,`AI element visible in ${measured.framesWithAi} frames, first at ${measured.firstVisibleAt} ms`);
 assert.equal(measured.aiVisibleNow,0);assert.equal(measured.organic,5,'all organic results stay');
 assert.ok(!measured.tabs.includes('AI Mode'),'the AI Mode tab is gone: '+measured.tabs.join(','));
});
test('the control (AI-free mode off) paints the AI block on every frame, so the recorder can see it',{skip},()=>{
 const {measured}=results[SPECS.length-1];
 assert.ok(measured.framesWithAi>30,'control frames with AI: '+measured.framesWithAi);assert.ok(measured.tabs.includes('AI Mode'));assert.deepEqual(measured.lines,[]);
});
test('the "AI answer hidden · Show" line lines up with the results column, is quiet, and Show has an 8px hit area',{skip},()=>{
 for(const index of [0,1,2,3]){
  const {measured}=results[index];
  assert.deepEqual(measured.lines,['AI answer hidden · Show'],'spec '+index);
  assert.ok(Math.abs(measured.textLeft-measured.resultsLeft)<=1,`text starts at ${measured.textLeft}, the results column at ${measured.resultsLeft}`);
  assert.equal(measured.fontSize,'13px');assert.equal(measured.lineHeight,'20px');assert.equal(measured.marginTop,'10px');assert.equal(measured.marginBottom,'8px');
  assert.ok(measured.buttonBox.h>=36&&measured.buttonBox.w>=16+16,'Show has 8px of hit area on every side: '+JSON.stringify(measured.buttonBox));
 }
});
test('the line reads at 4.5:1 or better on light and dark pages and after a theme switch, and Show stays an underlined link in full colour',{skip},()=>{
 for(const [index,spec] of SPECS.entries()){
  if(spec.ai===false)continue;
  const {measured}=results[index],{contrast}=measured,name=JSON.stringify(spec);
  assert.ok(contrast.text>=4.5,`${name}: the words read at ${contrast.text}:1 on rgb(${contrast.background}) in ${measured.color}`);
  assert.ok(contrast.link>=contrast.text&&contrast.link>=4.5,`${name}: Show reads at ${contrast.link}:1 in ${measured.buttonColor}`);
  assert.equal(contrast.underline,'underline',name);
 }
 const color=index=>results[index].measured.color,show=index=>results[index].measured.buttonColor;
 for(const index of [0,2,3]){assert.match(color(index),/^color\(srgb 0\.125\d* 0\.129\d* 0\.141\d* \/ 0\.62\)$/,'light, where it already reads: the page colour (#202124) at 62%, as before');assert.equal(show(index),'rgb(32, 33, 36)');}
 assert.match(color(1),/^color\(srgb 0\.74\d* 0\.75\d* 0\.77\d* \/ 0\.(6[4-9]|[7-9]\d)\)$/,'dark: the page\'s own colour (#bdc1c6), only a little stronger than 62% so it reads');assert.equal(show(1),'rgb(189, 193, 198)');
 assert.equal(show(4),'rgb(189, 193, 198)','the system turned dark after the line was drawn: it takes the page\'s dark colour');
 assert.equal(show(5),'rgb(189, 193, 198)','the page turned dark by itself after the line was drawn');
 assert.equal(show(8),'rgb(32, 33, 36)','the system turned light after the line was drawn: it takes the page\'s light colour');
 assert.equal(show(6),'rgb(255, 255, 255)','a dark page whose results inherit #222: white, as the background calls for');assert.match(color(6),/^color\(srgb 1 1 1 \/ 0\.62\)$/);
 assert.equal(show(7),'rgba(0, 0, 0, 0.6)','Bing\'s 60% black stays the page\'s own colour for Show');
});
test('a page that turns dark with no event and no DOM change (Windows) gets the line in its dark colours within a second',{skip},()=>{
 const {measured}=results[CSSOM];
 assert.equal(measured.buttonColor,'rgb(189, 193, 198)','Show takes the page\'s new colour');assert.ok(measured.contrast.text>=4.5,'the words read: '+measured.contrast.text);
});
test('the appearance check is light: no animation-frame loop and a few style reads while a line shows, nothing in a hidden tab, an immediate check when shown again',{skip},()=>{
 const {probe,measured}=results[PROBE];
 assert.ok(probe,'the probe ran');
 assert.equal(probe.visible.frames,0,'animation frames asked for in 3 s with a line on a visible page: '+probe.visible.frames);
 assert.ok(probe.visible.styles>=2&&probe.visible.styles<=12,'style reads in 3 s with a line on a visible page (a check every 750 ms): '+probe.visible.styles);
 assert.deepEqual(probe.hidden,{frames:0,styles:0,rects:0},'nothing runs while the tab is hidden');
 assert.equal(probe.whileHidden,'rgb(32, 33, 36)','a hidden tab is not recoloured');
 assert.equal(probe.shownColor,'rgb(189, 193, 198)','100 ms after the tab is shown again the line has the page\'s new dark colour');
});
test('where the line starts is not measured again and again: never in a hidden tab, at most once per 750 ms while the page keeps changing',{skip},()=>{
 const {probe}=results[PROBE];
 assert.equal(probe.hiddenChurn.rects,0,'layout reads in a hidden tab while the page changed 10 times');
 assert.ok(probe.visibleChurn.rects>=1&&probe.visibleChurn.rects<=10,'layout reads while the page changed 20 times in 2 s (2 per measurement, at most once per 750 ms): '+probe.visibleChurn.rects);
});
test('after a zoom change that crosses one of the page\'s breakpoints, the line follows the results column (no DOM change needed)',{skip},()=>{
 const {measured}=results[REZOOM];
 assert.equal(measured.resultsLeft,24,'the page moved its results column at the breakpoint');
 assert.ok(Math.abs(measured.textLeft-measured.resultsLeft)<=1,`the text starts at ${measured.textLeft}, the results column at ${measured.resultsLeft}`);
});
test('right-to-left pages (Arabic, Hebrew): the line starts at the results column on the right',{skip},()=>{
 const {measured}=results[RTL];
 assert.deepEqual(measured.lines,['AI answer hidden · Show']);
 assert.ok(measured.resultsRight>900,'the results column is on the right: '+measured.resultsRight);
 assert.ok(Math.abs(measured.textRight-measured.resultsRight)<=1,`the text ends (its start edge) at ${measured.textRight}, the results column at ${measured.resultsRight}`);
});
test('the line starts at the results column where the results area is set in from the window\'s edge, and on DuckDuckGo\'s layout, at 100% and 150%',{skip},()=>{
 for(const index of [INSET,DDG,...ZOOMED]){
  const {measured}=results[index],name=JSON.stringify(SPECS[index]);
  assert.deepEqual(measured.lines,['AI answer hidden · Show'],name);
  assert.ok(Math.abs(measured.textLeft-measured.resultsLeft)<=1,`${name}: the text starts at ${measured.textLeft}, the results column at ${measured.resultsLeft}`);
 }
 assert.equal(results[INSET].measured.resultsLeft,104,'the inset page keeps its results column where Google has it');assert.equal(results[DDG].measured.resultsLeft,110,'DuckDuckGo: the title link');
 // Only x depends on where the results area starts: the line's top, height, size, spacing and colours are the same as on the page whose results area starts at 0.
 const flush=results[0].measured,inset=results[INSET].measured;
 assert.equal(flush.textLeft,104,'Google\'s own layout: the line stays at 104px');
 for(const key of ['fontSize','lineHeight','marginTop','marginBottom','color','buttonColor','firstResultTop'])assert.equal(inset[key],flush[key],key);
 assert.deepEqual({y:inset.lineBox.y,h:inset.lineBox.h},{y:flush.lineBox.y,h:flush.lineBox.h},'same line top and height');
});
test('the results column is the first title link that is really on screen: a transparent, off-canvas, clipped, screen-reader-only or moved-away first result does not count',{skip},()=>{
 for(const index of GHOSTS){
  const {measured}=results[index],kind=SPECS[index].ghost;
  assert.deepEqual(measured.lines,['AI answer hidden · Show'],kind);assert.equal(measured.resultsLeft,110,kind);
  assert.ok(Math.abs(measured.textLeft-measured.resultsLeft)<=1,`${kind}: the text starts at ${measured.textLeft}, the visible results column at ${measured.resultsLeft}`);
 }
});
test('the indent rule: measured from the line itself once it is in the page (never from the hidden block), and DuckDuckGo\'s edge is its title link',()=>{
 const source=fs.readFileSync(path.join(__dirname,'..','desktop','browser-services','content-filter-preload.cjs'),'utf8');
 const edge=/const EDGE_LINKS='([^']+)'/.exec(source);assert.ok(edge,'resultsEdge reads one selector list');
 assert.ok(edge[1].split(',').includes('article[data-testid="result"] h2 a'),'DuckDuckGo: the title link');assert.ok(!edge[1].split(',').includes('article[data-testid="result"] a'),'not the first link of a result (its invisible "…" menu)');
 assert.match(source,/function resultsEdge\(rtl\)\{const first=document\.querySelector\(EDGE_LINKS\);[^\n]*document\.querySelectorAll\(EDGE_LINKS\)/,'the first match first, the others in order only if it is not on screen');
 assert.match(source,/function onScreen\(link\)\{[^\n]*box\.right<=0\|\|box\.left>=innerWidth[^\n]*checkVisibility\(\{opacityProperty:true,visibilityProperty:true\}\)[^\n]*clippedAway\(link\)/,'skipped: no size, outside the window, hidden, fully transparent or clipped away');
 assert.match(source,/function indent\(placeholder\)\{[^\n]*const box=placeholder\.getBoundingClientRect\(\)/,'the indent is measured from the line\'s own box');
 assert.doesNotMatch(/function makePlaceholder[^\n]*/.exec(source)[0],/getBoundingClientRect/,'nothing is measured from the block the line replaces');
 assert.match(source,/if\(placeholder\)\{if\(document\.visibilityState==='visible'\)indent\(placeholder\);tint\(placeholder\);/,'measured once the line is in the page');
 assert.match(source,/function retint\(\)\{[^\n]*realignSoon\(\)/,'and again when the page changes');assert.match(source,/function realign\(\)\{[^\n]*document\.visibilityState!=='visible'\)return;[^\n]*indent\(entry\.placeholder\)/,'never in a hidden tab');
 assert.match(source,/addEventListener\('resize',\(\)=>\{clearTimeout\(alignTimer\);alignTimer=0;realignSoon\(150\);\}/,'and once a resize or zoom change settles');
});
test('Show brings the block back and removes the line; the style sheet no longer hides it',{skip},()=>{
 const {shown}=results[0];
 assert.ok(shown,'a line to click');assert.deepEqual(shown.lines,[]);assert.ok(shown.aiVisibleNow>0,'the AI Overview is visible again');assert.equal(shown.organic,5);
});
test('style rules for AI blocks: one rule per selector, the keep guard and the shown flag are part of each',()=>{
 const css=earlyStyles(surfacesFor('www.google.com').items);
 assert.match(css,/#rcnt>div:has\(#m-x-content\):not\(:has\(#rso\)\):not\(\[data-acira-shown\]\):not\(:has\(a h3\)\)\{display:none!important\}/);
 assert.match(css,/button\[jsname="B6rgad"\]:not\(\[data-acira-shown\]\)\{display:none!important\}/);
 assert.match(css,/div\[role="listitem"\]:has\(>\*>\*>a\[href\*="udm=50"\]\)/);
 for(const rules of Object.values(RULES)){const text=earlyStyles(rules.items);for(const rule of text.split('}').filter(Boolean))assert.match(rule+'}',/^[^{]+\{display:none!important\}$/,rules.id+': '+rule);}
 assert.deepEqual(splitSelectors('a[href*="x,y"],b:has(c,d),e'),['a[href*="x,y"]','b:has(c,d)','e']);
 assert.equal(earlyStyles([{kind:'heading',labels:['x'],unit:{results:true}}]),'','a rule found by text has no style rule');
 for(const id of ['bing','duckduckgo','brave'])assert.ok(earlyStyles(RULES[id].items).length>20,id+' has style rules');
});
test('the early options are read synchronously and only for pages that have AI surfaces',()=>{
 const source=fs.readFileSync(path.join(__dirname,'..','desktop','browser-services','content-filter-preload.cjs'),'utf8');
 assert.match(source,/sendSync\('acira:ai-early'\)/);assert.match(source,/MutationObserver\(\(\)=>\{if\(dead\|\|!options\.enabled/);assert.match(source,/takeRecords\(\)/);
 assert.match(source,/data-acira-shown/);assert.match(source,/function ownText/,'control text ignores style rules inside buttons (Google\'s AI Mode pill)');
 const optional=fs.readFileSync(path.join(__dirname,'..','desktop','browser-services','optional-filtering.cjs'),'utf8');
 assert.match(optional,/ipcMain\.on\('acira:ai-early'/);assert.match(optional,/settings\(event\.sender\)\.aiContent/);
});
