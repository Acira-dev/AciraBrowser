import test from 'node:test';import assert from 'node:assert/strict';
import {createInitialState,reduceBrowser,persistedSnapshot,restoreSnapshot} from '../src/runtime/core';
import {zoomOrigin,normalizeOriginZooms} from '../src/runtime/sessionState';
import {magnifyBy,panMagnify,NO_MAGNIFY,MAGNIFY_MAX} from '../src/ui/pageMagnifyMath';
import type {BrowserAction,BrowserSnapshot} from '../src/runtime/types';
// Zoom on Acira's own pages (Settings, Bookmarks, the new tab...) follows a website's: the same steps, a level remembered per page and
// shared by every tab on it, a pinch that magnifies without changing the level. The pages are drawn by the interface, so the
// reducer keeps their level the way it keeps a site's, and ui/pageMagnify keeps the pinch.
const run=(s:BrowserSnapshot,...actions:BrowserAction[])=>actions.reduce(reduceBrowser,s);
const zoomEvent=(tabId:string,zoom:number):BrowserAction=>({type:'browser.event',event:{type:'state',tabId,zoom}});
const open=(s:BrowserSnapshot,url:string,privacy?:'private')=>{const before=new Set(s.tabs.map(t=>t.id)),next=run(s,{type:'tab.new',url,...(privacy?{privacy}:{})} as BrowserAction);return {state:next,tab:next.tabs.find(t=>!before.has(t.id))!};};
const zoomOf=(s:BrowserSnapshot,id:string)=>s.tabs.find(t=>t.id===id)!.zoom;
const profile=(s:BrowserSnapshot)=>s.activeBrowserProfileId;

test('an Acira page is remembered by its own address, a website by its origin, anything else not at all',()=>{
 assert.equal(zoomOrigin('acira://settings'),'acira://settings');
 assert.equal(zoomOrigin('acira://new'),'acira://new');
 assert.equal(zoomOrigin('https://www.youtube.com/watch?v=1'),'https://www.youtube.com');
 for(const odd of ['','about:blank','file:///etc/passwd','acira://','acira://settings/appearance','acira://Settings','acira://a b','javascript:alert(1)'])assert.equal(zoomOrigin(odd),null,odd);
});

test('zooming a page remembers the level for that page only, as a site does',()=>{
 let {state,tab}=open(createInitialState(),'acira://settings');
 state=run(state,zoomEvent(tab.id,150));
 assert.equal(zoomOf(state,tab.id),150);assert.equal(state.originZooms[profile(state)]['acira://settings'],150);
 state=run(state,{type:'tab.navigate',tabId:tab.id,url:'acira://bookmarks'});
 assert.equal(zoomOf(state,tab.id),100,'Bookmarks has its own level');
 state=run(state,zoomEvent(tab.id,75),{type:'tab.navigate',tabId:tab.id,url:'acira://settings'});
 assert.equal(zoomOf(state,tab.id),150,'Settings comes back at its level');
 const second=open(state,'acira://settings');
 assert.equal(zoomOf(second.state,second.tab.id),150,'a new tab on Settings opens at its level');
 const downloads=open(second.state,'acira://downloads');assert.equal(zoomOf(downloads.state,downloads.tab.id),100,'a page nobody zoomed opens at 100%');
});

test('every tab on the same Acira page follows its level, other pages and sites do not',()=>{
 let state=createInitialState();
 const a=open(state,'acira://settings');state=a.state;const b=open(state,'acira://settings');state=b.state;
 const site=open(state,'https://example.com/');state=site.state;const bm=open(state,'acira://bookmarks');state=bm.state;
 state=run(state,zoomEvent(b.tab.id,200));
 assert.equal(zoomOf(state,a.tab.id),200);assert.equal(zoomOf(state,b.tab.id),200);
 assert.equal(zoomOf(state,site.tab.id),100);assert.equal(zoomOf(state,bm.tab.id),100);
 assert.deepEqual(state.originZooms[profile(state)],{'acira://settings':200});
});

test('a website zoom does not follow the tab to an Acira page, and the page level does not follow it to a website',()=>{
 let {state,tab}=open(createInitialState(),'https://example.com/');
 state=run(state,zoomEvent(tab.id,175));
 state=run(state,{type:'tab.navigate',tabId:tab.id,url:'acira://history'});
 assert.equal(zoomOf(state,tab.id),100,'History is not zoomed by the site the tab came from');
 state=run(state,zoomEvent(tab.id,125),{type:'tab.navigate',tabId:tab.id,url:'https://example.com/'});
 assert.equal(zoomOf(state,tab.id),175,'the site is back at its level');
 assert.deepEqual(state.originZooms[profile(state)],{'https://example.com':175,'acira://history':125});
});

test('Back and Forward between an Acira page and another settle on each page\'s level',()=>{
 let {state,tab}=open(createInitialState(),'acira://settings');
 state=run(state,zoomEvent(tab.id,150),{type:'tab.navigate',tabId:tab.id,url:'acira://history'},zoomEvent(tab.id,90));
 state=run(state,{type:'tab.history',direction:-1});assert.equal(zoomOf(state,tab.id),150);
 state=run(state,{type:'tab.history',direction:1});assert.equal(zoomOf(state,tab.id),90);
});

test('a private tab keeps its own Acira page zoom out of the saved table, as it does for a site',()=>{
 let state=createInitialState();
 const normal=open(state,'acira://settings');state=normal.state;const priv=open(state,'acira://settings','private');state=priv.state;
 state=run(state,zoomEvent(priv.tab.id,300));
 assert.equal(zoomOf(state,priv.tab.id),300);assert.equal(zoomOf(state,normal.tab.id),100);assert.deepEqual(state.originZooms,{});
 state=run(state,zoomEvent(normal.tab.id,125));
 assert.equal(zoomOf(state,priv.tab.id),300,'the ordinary level does not reach the private tab');
});

test('the level of an Acira page is saved and restored with the browser, and bad entries are dropped',()=>{
 let {state,tab}=open(createInitialState(),'acira://settings');
 state=run(state,zoomEvent(tab.id,200));
 const restored=restoreSnapshot(JSON.parse(JSON.stringify(persistedSnapshot(state))));
 assert.equal(restored.originZooms[profile(restored)]['acira://settings'],200);
 const clean=normalizeOriginZooms({[profile(state)]:{'acira://settings':900,'acira://x/y':150,'https://a.example':'big','https://b.example':80,'nonsense':120}},state.browserProfiles);
 assert.deepEqual(clean[profile(state)],{'acira://settings':500,'https://b.example':80});
});

test('a pinch magnifies about the fingers within the page, never past Chromium\'s 5x or below 1x',()=>{
 const box={width:1000,height:600},double=-100*Math.log(2);
 const once=magnifyBy(NO_MAGNIFY,double,{x:500,y:300},box);
 assert.ok(Math.abs(once.scale-2)<1e-9,'a delta of 100 x ln(2) doubles the page: '+once.scale);
 // the point under the fingers stays under them
 assert.ok(Math.abs((500-once.x)/once.scale-500)<1e-6&&Math.abs((300-once.y)/once.scale-300)<1e-6);
 const corner=magnifyBy(NO_MAGNIFY,double,{x:0,y:0},box);assert.deepEqual([corner.x,corner.y],[0,0],'a pinch at the corner keeps it');
 const far=magnifyBy(NO_MAGNIFY,double,{x:1000,y:600},box);assert.ok(Math.abs(far.x+1000)<1e-6&&Math.abs(far.y+600)<1e-6,'the far corner stays put');
 assert.equal(magnifyBy(once,-1000,{x:500,y:300},box).scale,MAGNIFY_MAX);
 assert.deepEqual(magnifyBy(once,+1000,{x:500,y:300},box),NO_MAGNIFY,'pinching back out clears it');
 assert.deepEqual(magnifyBy(NO_MAGNIFY,+50,{x:500,y:300},box),NO_MAGNIFY,'a page is never made smaller than itself');
});

test('a magnified page pans inside its edges and hands the rest of a scroll to the page',()=>{
 const box={width:1000,height:600},zoomed={scale:2,x:-500,y:-300};
 let moved=panMagnify(zoomed,100,50,box);
 assert.deepEqual(moved.magnify,{scale:2,x:-600,y:-350});assert.equal(moved.restX,0);assert.equal(moved.restY,0);
 moved=panMagnify(zoomed,700,-400,box);
 assert.deepEqual(moved.magnify,{scale:2,x:-1000,y:0},'stops at the right and top edges');
 assert.equal(moved.restX,200,'what the right edge could not take');assert.equal(moved.restY,-100,'what the top edge could not give');
 assert.equal(panMagnify({scale:2,x:0,y:0},0,-40,box).restY,-40,'at the top edge all of an upward scroll is the page\'s');
});
