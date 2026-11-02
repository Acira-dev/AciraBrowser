import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createInitialState,reduceBrowser} from '../src/runtime/core';
import {mediaTabs,mediaToggle} from '../src/ui/mediaRows';
import {tabCardHost} from '../src/runtime/tabCard';
import type {BrowserAction,BrowserSnapshot} from '../src/runtime/types';

const apply=(s:BrowserSnapshot,...actions:BrowserAction[])=>actions.reduce(reduceBrowser,s);
const three=()=>{let s=createInitialState();s=apply(s,{type:'tab.new',url:'https://one.test/'},{type:'tab.new',url:'https://two.test/'},{type:'tab.new',url:'https://three.test/'});return s;};
const set=(s:BrowserSnapshot,id:string,media:'playing'|'paused'|null)=>apply(s,{type:'browser.event',event:{type:'state',tabId:id,media}});

test('every tab playing or paused from the sidebar has a row, in tab order, so a row never jumps when its tab is paused',()=>{
  let s=three();const [, a, b, c]=s.tabs.map(t=>t.id);
  assert.deepEqual(mediaTabs(s),[]);
  s=set(s,c,'playing');s=set(s,a,'playing');
  assert.deepEqual(mediaTabs(s).map(t=>t.id),[a,c],'tab order, not the order they started');
  s=set(s,a,'paused');assert.deepEqual(mediaTabs(s).map(t=>t.id),[a,c],'pausing keeps the place');
  s=set(s,b,'playing');assert.deepEqual(mediaTabs(s).map(t=>t.id),[a,b,c],'several at once');
  s=set(s,a,null);s=set(s,b,null);s=set(s,c,null);assert.deepEqual(mediaTabs(s),[]);
});

test('the play/pause button pauses a playing tab and plays a paused one', () => {
  assert.deepEqual(mediaToggle({id:'t',media:'playing'}),{type:'media',tabId:'t',action:'pause'});
  assert.deepEqual(mediaToggle({id:'t',media:'paused'}),{type:'media',tabId:'t',action:'play'});
});

test('the row names the tab as the person named it, over its site', () => {
  let s=three();const id=s.tabs.at(-1)!.id;
  s=apply(s,{type:'browser.event',event:{type:'state',tabId:id,url:'https://www.three.test/watch?v=1',title:'A long video title',loading:false}},{type:'tab.rename',id,title:'Lecture 4'});
  const tab=s.tabs.find(t=>t.id===id)!;
  assert.equal(tabCardHost(tab.url),'three.test');
  const source=readFileSync(new URL('../src/components/sidebar/SidebarMedia.tsx',import.meta.url),'utf8');
  assert.match(source,/tabDisplayTitle\(tab\)/);assert.match(source,/tabCardHost\(tab\.url\)/);
});

test('the row is wired: jump to the tab, play or pause, mute; above the footer; on the list motion; with every word in the catalog', () => {
  const read=(path:string)=>readFileSync(new URL(path,import.meta.url),'utf8');
  const row=read('../src/components/sidebar/SidebarMedia.tsx'),sidebar=read('../src/components/sidebar/AciraSidebar.tsx'),css=read('../src/components/sidebar/sidebar-media.css'),en=JSON.parse(read('../src/i18n/en.json')) as Record<string,string>;
  assert.match(row,/type: 'tab\.select', id: tab\.id/);assert.match(row,/runtime\.browserCommand\(mediaToggle\(tab\)\)/);assert.match(row,/type: 'tab\.mute', id: tab\.id, muted: true/,'the volume slider mutes at 0 and from its glyph (tests/media-volume.test.ts)');
  assert.match(row,/useListMotion\(list/);assert.match(row,/animateSpring\(el/);
  assert.ok(sidebar.indexOf('<SidebarMedia')>0&&sidebar.indexOf('<SidebarMedia')<sidebar.indexOf('<SidebarFooter state'),'the media block sits right above the footer');
  for(const id of ['sidebarmedia.play','sidebarmedia.pause','sidebarmedia.region','app.muteTab','app.unmuteTab','rewindpage.goToTab'])assert.equal(typeof en[id],'string',id);
  assert.match(css,/height:46px/);assert.match(css,/max-height:min\(154px/,'three rows, then it scrolls');assert.match(css,/outline:2px solid var\(--sb-ring\)/);
  assert.doesNotMatch(css,/#[0-9a-fA-F]{3,8}\b/,'no hard-coded colours');
});

test('R4-31: the cards keep 8px from the sidebar edges, 14px of air under them, and the rule above them shows only when the list runs into them', () => {
  const read=(path:string)=>readFileSync(new URL(path,import.meta.url),'utf8');
  const row=read('../src/components/sidebar/SidebarMedia.tsx'),css=read('../src/components/sidebar/sidebar-media.css');
  assert.match(css,/\.sb-media\{position:relative;flex:none;padding:8px 8px 14px\}/);
  assert.match(css,/\.sb-media::before\{[^}]*opacity:0/,'no rule by default');
  assert.match(css,/\.sb-media\[data-divider\]::before\{opacity:1\}/);
  assert.match(row,/data-divider=\{touches \|\| undefined\}/);assert.match(row,/scroll\.scrollHeight > scroll\.clientHeight \+ 1 \|\| free < CLEAR/);
});
