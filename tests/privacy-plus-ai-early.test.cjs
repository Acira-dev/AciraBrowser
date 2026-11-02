'use strict';
// R3-45 / R3-46: AI-free mode is applied at document start, and the quiet line that replaces an AI answer lines up with the results column.
// Runs the app's real frame script (content-filter-preload.cjs) as a preload in a hidden Electron window against a Google-shaped page (fixtures/ai-pages/google-2026.html,
// structure read from a live results page on 26 Oct 2026) that adds its AI Overview at parse time, late (400 ms) or streamed (heading text arrives later).
// Every animation frame records whether any AI element (overview, AI Mode pill, AI Mode tab) was visible: it must be zero frames.
const {test}=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),path=require('node:path'),fs=require('node:fs');
const {surfacesFor,earlyStyles,splitSelectors,RULES}=require('../desktop/browser-services/ai-surfaces.cjs');
const electron=(()=>{try{const value=require('electron');return typeof value==='string'&&fs.existsSync(value)?value:null;}catch{return null;}})();
const SPECS=[
 {mode:'sync',theme:'light',reveal:true},{mode:'late',theme:'dark'},{mode:'stream',theme:'light'},{mode:'late',theme:'light'},
 {mode:'sync',theme:'light',ai:false}
];
let results=null,problem=null;
if(electron){
 const env={...process.env,ELECTRON_ENABLE_LOGGING:'0'};delete env.ELECTRON_RUN_AS_NODE;
 const run=spawnSync(electron,[path.join(__dirname,'fixtures','ai-pages','early.cjs'),JSON.stringify(SPECS)],{encoding:'utf8',timeout:150000,env});
 const line=(run.stdout||'').split(/\r?\n/).find(text=>text.startsWith('RESULT '));
 if(line)results=JSON.parse(line.slice(7));else problem=((run.stdout||'')+(run.stderr||'')).split(/\r?\n/).filter(text=>!/^\[\d+:/.test(text)).join('\n').slice(0,600)||'electron produced no result';
}
const skip=!electron?'electron binary not available':false;
test('fixture run finished',{skip},()=>{assert.ok(results,problem);assert.equal(results.length,SPECS.length);});
for(const [index,spec] of SPECS.map((item,i)=>[i,item]).filter(([,item])=>item.ai!==false))test(`AI block never paints (${spec.mode}, ${spec.theme}): zero frames with an AI element visible, results stay`,{skip},()=>{
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
  assert.match(measured.color,/ 0\.62\)$/,'the text is the page colour at 62%: '+measured.color);
  assert.ok(measured.buttonBox.h>=36&&measured.buttonBox.w>=16+16,'Show has 8px of hit area on every side: '+JSON.stringify(measured.buttonBox));
 }
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
