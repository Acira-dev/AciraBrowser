'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{EventEmitter}=require('node:events');
const {surfacesFor,RULES,COVERAGE,AI_OVERVIEW,AI_MODE,splitSelectors}=require('../desktop/browser-services/ai-surfaces.cjs'),{createOptionalFiltering}=require('../desktop/browser-services/optional-filtering.cjs');
const {protectionSummary}=require('../desktop/browser-services/protection-summary.cjs');
test('AI surface rules apply to the real engines only, never look-alike hosts',()=>{
 for(const host of ['www.google.com','google.fr','www.google.co.uk'])assert.equal(surfacesFor(host).id,'google',host);
 assert.equal(surfacesFor('www.bing.com').id,'bing');assert.equal(surfacesFor('duckduckgo.com').id,'duckduckgo');assert.equal(surfacesFor('search.brave.com').id,'brave');
 for(const host of ['google.com.evil.example','notgoogle.com','bing.com.evil.example','brave.com','duck.ai','example.com','','localhost'])assert.equal(surfacesFor(host),null,host);
 assert.equal(COVERAGE.length,5);assert.ok(COVERAGE.slice(0,4).every(line=>/^(Google Search|Bing|DuckDuckGo|Brave Search): /.test(line)));assert.match(COVERAGE[4],/^Also, best effort: /);
 for(const [host,id] of [['www.youtube.com','youtube'],['www.reddit.com','reddit'],['www.quora.com','quora'],['stackoverflow.com','stackoverflow'],['github.com','github'],['www.amazon.com','amazon'],['www.amazon.co.uk','amazon'],['mail.google.com','workspace'],['docs.google.com','workspace'],['www.linkedin.com','linkedin'],['x.com','x'],['www.instagram.com','meta'],['outlook.live.com','m365']])assert.equal(surfacesFor(host)?.id,id,host);
 for(const host of ['github.com.evil.example','evil-amazon.com','amazon.evil.example','notx.com','myreddit.com','youtube.com.evil.example'])assert.equal(surfacesFor(host),null,host);
});
test('rules are well formed, prefer stable hooks over generated class names, and cover several languages',()=>{
 const kinds=new Set(['css','heading','text']),units=new Set(['self','closest','wrapper','results']);
 for(const rules of Object.values(RULES)){assert.ok(rules.items.length>=(['google','bing','duckduckgo','brave'].includes(rules.id)?3:1),rules.id);for(const item of rules.items){assert.ok(kinds.has(item.kind),rules.id+' kind');assert.ok(Object.keys(item.unit||{}).every(key=>units.has(key)),rules.id+' unit');if(item.kind==='css'){const bare=item.css.replace(/"[^"]*"|'[^']*'/g,'');assert.ok(!/\.(?=[A-Za-z0-9_-]*[A-Z])(?=[A-Za-z0-9_-]*[a-z])[A-Za-z0-9_-]{5,}/.test(bare),'generated class name in '+item.css);}else assert.ok(item.labels.length>0&&item.labels.every(label=>label===label.toLowerCase()&&label.trim()===label));if(!item.quiet)assert.ok(item.label,rules.id+' answers carry a name for the Show line');}}
 for(const label of ['ai overview','übersicht mit ki','aperçu ia','vista creada con ia','overview dell\'ai','visão geral criada por ia','نبذة باستخدام الذكاء الاصطناعي'])assert.ok(AI_OVERVIEW.includes(label),'live-verified '+label);
 for(const label of ['ai mode','ki-modus','mode ia','modo ia','وضع ai'])assert.ok(AI_MODE.includes(label),'live-verified '+label);
 assert.equal(new Set(AI_OVERVIEW).size,AI_OVERVIEW.length,'no duplicate labels');
 const kinds2=RULES.duckduckgo.items.map(item=>item.css||'').join(' ');assert.match(kinds2,/data-assist-icon-trigger/);assert.match(RULES.brave.items[0].css,/#llm-snippet/);assert.match(RULES.bing.items[0].css,/#copans_container/);
});
test('no rule climbs to a bare structural ancestor, and the frame script bounds every block it hides (R3: AI-free blanked a DuckDuckGo page)',()=>{
 const bare=new Set(['form','main','body','html','section','article','div','header','nav','footer','ul','ol','table','span']);
 for(const rules of Object.values(RULES))for(const item of rules.items){const closest=item.unit&&item.unit.closest;if(!closest)continue;for(const part of splitSelectors(closest))assert.ok(!bare.has(part.trim().toLowerCase()),`${rules.id}: unit closest "${part}" is unbounded`);}
 const ask=RULES.duckduckgo.items.find(item=>/data-testid="ask"/.test(item.css));assert.ok(ask,'the Duck.ai prompt rule exists');
 assert.match(ask.unit.closest,/^form:not\(\[role="search"\]\):not\(:has\(.*input\[name="q"\]/,'only a form that holds no search box');assert.match(ask.unit.closest,/article\[data-testid="result"\]/,'nor one that holds results');
 const source=fs.readFileSync(path.join(__dirname,'..','desktop','browser-services','content-filter-preload.cjs'),'utf8');
 assert.match(source,/function unsafeBlock/);assert.match(source,/if\(unsafeBlock\(target,unit\)\)return null/,'every unit kind goes through the one guard');
 assert.match(source,/function recheckAi/);assert.match(source,/applyAiRules\(\)\{let count=0;recheckAi\(\)/,'a block hidden before the page filled in is judged again');
 for(const part of ['main','article[data-testid="result"]','input[name="q"]','form[role="search"]'])assert.ok(source.includes(part),'guard names '+part);
});
test('frame options carry no AI rules until AI-free mode is on, none after a site exception, and none for other pages',()=>{
 const handlers=new Map(),policies=new Map(),session={registerPreloadScript(){}};let current='https://www.bing.com/search?q=x';
 const frame=url=>({url,isDestroyed:()=>false}),main=frame(current),wc=Object.assign(new EventEmitter(),{id:1,session,mainFrame:main,isDestroyed:()=>false,getURL:()=>current});main.framesInSubtree=[main];
 const service=createOptionalFiltering({ipcMain:{handle:(name,fn)=>handlers.set(name,fn),on(){}},database:{policy:(p,s)=>policies.get(p+'|'+s),setPolicy:(p,s,v)=>policies.set(p+'|'+s,v)},getOwner:()=>({profileId:'A'}),resolveContents:()=>wc});
 service.attach(session,'A',false,{useBefore(){}});
 const options=url=>{current=url;return handlers.get('acira:content-filter-options')({sender:wc,senderFrame:frame(url)});};
 assert.deepEqual(options('https://www.bing.com/search?q=x').aiRules,[],'off by default');service.setProfile('A',{aiContent:true});
 assert.ok(options('https://www.bing.com/search?q=x').aiRules.some(item=>/copans_container/.test(item.css||'')),'on once chosen');
 assert.equal(options('https://www.bing.com/search?q=x').aiRules.some(item=>/llm-snippet/.test(item.css||'')),false,'only this engine\'s rules');
 assert.deepEqual(options('https://example.com/').aiRules,[]);
 current='https://www.bing.com/search?q=x';service.set(wc,{aiContent:false},'site');
 assert.deepEqual(options('https://www.bing.com/search?q=x').aiRules,[],'a site exception removes the rules');
 assert.equal(service.status(wc).aiSurface,'Bing');assert.equal(service.status(wc).aiCoverage.length,5);assert.match(service.status(wc).scope,/Google Search, Bing, DuckDuckGo, Brave Search/);
 service.release(session);
});
test('frame script: one quiet line per hidden answer, silent entry points, no legacy button text',()=>{
 const source=fs.readFileSync(path.join(__dirname,'..','desktop','browser-services','content-filter-preload.cjs'),'utf8');
 assert.match(source,/hidden · /);assert.match(source,/applyAiRules/);assert.ok(!source.includes('Hidden AI section'),'v1 button text is gone');assert.ok(!source.includes('labelledAISections'),'v1 Google-only scan is gone');
 assert.match(source,/quiet/);assert.match(source,/unhide/);
});
test('protection summary: AI answers on by default, off when the profile chose so',()=>{
 const row=input=>protectionSummary({network:{},filterLists:{},...input}).rows.find(r=>r.id==='ai-content');
 assert.equal(row({}).state,'off','off by default');assert.equal(row({aiContent:false}).state,'off');assert.equal(row({aiContent:true}).state,'on');assert.match(row({aiContent:true}).detail,/Google, Bing, DuckDuckGo and Brave Search/);
});
