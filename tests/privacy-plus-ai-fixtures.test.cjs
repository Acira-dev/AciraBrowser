'use strict';
// Regression: with the AI filter on (the default), organic results must stay visible on every supported engine, and only the AI block and its entry points go.
// Runs the app's real frame script in a hidden Electron window against saved results pages (tests/fixtures/ai-pages):
//   bing-solar, bing-copilot-query, brave-solar are structure-only copies of real pages read on 24 Oct 2026 (text replaced by filler);
//   google-synthetic(-de), duckduckgo-synthetic follow the markup read live from those engines (they block automated browsers); bing-drift is a hostile layout.
const {test}=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),path=require('node:path'),fs=require('node:fs');
const electron=(()=>{try{const value=require('electron');return typeof value==='string'&&fs.existsSync(value)?value:null;}catch{return null;}})();
// The unbounded rule DuckDuckGo's Duck.ai button used to carry (closest form, no bounds): a hostile page that wraps everything in one form must survive it too.
const OLD_ASK_RULE={kind:'css',css:'button[data-testid="ask"]',unit:{closest:'form'},quiet:true,keep:'article[data-testid="result"]'};
const PAGE_STAYS=['header#header','input[name="q"]','nav','main','#web-root-form'];
const SPECS=[
 {file:'bing-solar.html',host:'www.bing.com',organic:'#b_results > li.b_algo',block:'#copans_container',entries:['#b-scopeListItem-copilotsearch']},
 {file:'bing-copilot-query.html',host:'www.bing.com',organic:'#b_results > li.b_algo',block:'#copans_container',entries:['#b-scopeListItem-copilotsearch']},
 {file:'bing-drift.html',host:'www.bing.com',organic:'#b_results li.b_algo',block:'#copans_container',entries:['#b-scopeListItem-copilotsearch']},
 {file:'brave-solar.html',host:'search.brave.com',organic:'#mixed-main .snippet[data-type="web"]',block:'#llm-snippet',entries:['#submit-llm-button','#primary-tabs a[href^="/ask"]']},
 {file:'google-synthetic.html',host:'www.google.com',organic:'#rso .g',block:'[data-scope-id="turn"]',entries:['a[href*="udm=50"]']},
 {file:'google-synthetic-de.html',host:'www.google.de',organic:'#rso .g',block:'[data-scope-id="turn"]',entries:['a[href*="udm=50"]']},
 {file:'duckduckgo-synthetic.html',host:'duckduckgo.com',organic:'article[data-testid="result"]',block:'[data-assist-icon-trigger]',entries:['#react-ai-button-slot','nav a[href*="&assist"]','.nav-menu__list a[href="https://duck.ai"]']},
 {file:'duckduckgo-wrapper-form.html',host:'duckduckgo.com',organic:'article[data-testid="result"]',block:'[data-assist-icon-trigger]',entries:['#react-ai-button-slot'],stay:PAGE_STAYS},
 {id:'ddg-wrapper-old-rule',file:'duckduckgo-wrapper-form.html',host:'duckduckgo.com',organic:'article[data-testid="result"]',block:'[data-assist-icon-trigger]',entries:['#react-ai-button-slot'],stay:PAGE_STAYS,rules:[OLD_ASK_RULE],custom:true},
 {id:'ddg-late-form',file:'duckduckgo-late-form.html',late:true,host:'duckduckgo.com',organic:'article[data-testid="result"]',block:'[data-assist-icon-trigger]',entries:['#react-ai-button-slot'],stay:PAGE_STAYS,custom:true},
 {id:'ddg-late-old-rule',file:'duckduckgo-late-form.html',late:true,host:'duckduckgo.com',organic:'article[data-testid="result"]',block:'[data-assist-icon-trigger]',entries:['#react-ai-button-slot'],stay:PAGE_STAYS,rules:[OLD_ASK_RULE],custom:true}
];
let results=null,problem=null;
if(electron){
 const run=spawnSync(electron,[path.join(__dirname,'fixtures','ai-pages','run.cjs'),JSON.stringify(SPECS)],{encoding:'utf8',timeout:150000,env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,ELECTRON_ENABLE_LOGGING:'0'}});
 const line=(run.stdout||'').split(/\r?\n/).find(text=>text.startsWith('RESULT '));
 if(line)results=JSON.parse(line.slice(7));else problem=((run.stdout||'')+(run.stderr||'')).split(/\r?\n/).filter(text=>!/^\[\d+:/.test(text)).join('\n').slice(0,600)||'electron produced no result';
}
const byFile=id=>results&&results.find(item=>item.id===id);
const skip=!electron?'electron binary not available':false;
test('fixture run finished',{skip},()=>{assert.ok(results,problem);assert.equal(results.length,SPECS.length);});
for(const spec of SPECS.filter(spec=>!spec.custom))test(`${spec.file}: organic results stay visible, AI block and entry points go, Show and off restore`,{skip},()=>{
 const item=byFile(spec.id||spec.file);assert.ok(item,'no result for '+spec.file);const {before,after,revealed,restored}=item;
 assert.ok(before.organicTotal>=5,'fixture has organic results');assert.equal(before.organic,before.organicTotal,'all organic results visible before');
 assert.equal(after.organic,before.organic,`organic results visible after: ${after.organic} of ${before.organic}`);
 assert.equal(after.bodyVisible,true);
 if(spec.stay)assert.equal(after.stay,after.stayTotal,`header, search box, navigation and main area stay: ${after.stay} of ${after.stayTotal}`);
 if(spec.file==='bing-drift.html'){assert.equal(after.block,before.block,'a block that holds organic results is never hidden');assert.equal(after.lines.length,0);return;}
 assert.ok(before.blockTotal>0&&before.block>0,'AI block present and visible before');assert.equal(after.block,0,'AI block hidden');
 assert.equal(after.lines.length,1,'one quiet line');assert.match(after.lines[0],/^AI answer hidden · Show$/);
 assert.equal(after.entries,0,'AI entry points hidden');
 assert.ok(revealed&&revealed.block>0&&revealed.lines.length===0,'Show brings the answer back');assert.equal(revealed.organic,before.organic);
 assert.equal(restored.block,before.block,'turning the filter off restores everything');assert.equal(restored.entries,before.entries);assert.equal(restored.organic,before.organic);assert.equal(restored.lines.length,0);
});
// DuckDuckGo-shaped pages whose whole page sits in one form (R3 feature proof: one load with AI-free on came up completely blank). The old unbounded rule
// (closest form) must be survivable: the structural guard refuses a form that holds the search box, the main area or the results, and a block hidden while the
// page was still loading is given back once the page fills in.
test('DuckDuckGo wrapped in one form: the old closest-form rule leaves the page whole',{skip},()=>{
 const item=byFile('ddg-wrapper-old-rule');assert.ok(item);const {before,after}=item;
 assert.ok(before.organicTotal>=5);assert.equal(after.organic,before.organic,'results stay');assert.equal(after.stay,after.stayTotal,'header, search box, navigation, main and the form itself stay');assert.equal(after.bodyVisible,true);
});
for(const id of ['ddg-late-form','ddg-late-old-rule'])test(`DuckDuckGo that renders after the scan (${id}): the page is never left blank`,{skip},()=>{
 const item=byFile(id);assert.ok(item);const {after}=item;
 assert.ok(after.organicTotal>=5,'page filled in');assert.equal(after.organic,after.organicTotal,'every result visible');
 assert.equal(after.stay,after.stayTotal,`header, search box, navigation, main and the form stay: ${after.stay} of ${after.stayTotal}`);assert.equal(after.bodyVisible,true);
 if(id==='ddg-late-form')assert.equal(after.block,0,'the Search Assist answer still goes');
});
test('a result that links to duck.ai survives, and unrelated hosts get no rules',{skip},()=>{
 const item=byFile('duckduckgo-synthetic.html');assert.equal(item.after.organic,9,'8 results plus the one about duck.ai');
});
