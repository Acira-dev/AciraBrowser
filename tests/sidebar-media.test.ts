import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createInitialState,reduceBrowser} from '../src/runtime/core';
import {mediaToggle} from '../src/ui/mediaRows';
import {orderCards,mainMediaTab} from '../src/ui/nowPlaying';
import {tabCardHost} from '../src/runtime/tabCard';
import type {BrowserAction,BrowserSnapshot} from '../src/runtime/types';

const apply=(s:BrowserSnapshot,...actions:BrowserAction[])=>actions.reduce(reduceBrowser,s);
const three=()=>{let s=createInitialState();s=apply(s,{type:'tab.new',url:'https://one.test/'},{type:'tab.new',url:'https://two.test/'},{type:'tab.new',url:'https://three.test/'});return s;};
const set=(s:BrowserSnapshot,id:string,media:'playing'|'paused'|null)=>apply(s,{type:'browser.event',event:{type:'state',tabId:id,media}});

test('every tab playing or paused from the sidebar has a card: the main one (the latest to begin) first, the rest in tab order',()=>{
  let s=three();const [, a, b, c]=s.tabs.map(t=>t.id);
  assert.deepEqual(orderCards(s.tabs),[]);
  const at=(id:string,media:'playing'|'paused'|null,mediaAt?:number)=>apply(s,{type:'browser.event',event:{type:'state',tabId:id,media,...(mediaAt?{mediaAt}:{})}});
  s=at(c,'playing',100);s=at(a,'playing',200);
  assert.deepEqual(orderCards(s.tabs).map(t=>t.id),[a,c],'the latest to begin leads');
  s=at(a,'paused');assert.equal(mainMediaTab(s.tabs)?.id,a,'pausing does not demote it');
  s=at(b,'playing',300);assert.deepEqual(orderCards(s.tabs).map(t=>t.id),[b,a,c],'a newer sound takes the lead; the others keep tab order');
  s=at(c,'playing',400);assert.equal(mainMediaTab(s.tabs)?.id,c,'a resumed sound is a new beginning');
  s=at(a,null);s=at(b,null);s=at(c,null);assert.deepEqual(orderCards(s.tabs),[]);
});

test('the play/pause button pauses a playing tab and plays a paused one', () => {
  assert.deepEqual(mediaToggle({id:'t',media:'playing'}),{type:'media',tabId:'t',action:'pause'});
  assert.deepEqual(mediaToggle({id:'t',media:'paused'}),{type:'media',tabId:'t',action:'play'});
});

test('the card names the tab as the person named it, over its site', () => {
  let s=three();const id=s.tabs.at(-1)!.id;
  s=apply(s,{type:'browser.event',event:{type:'state',tabId:id,url:'https://www.three.test/watch?v=1',title:'A long video title',loading:false}},{type:'tab.rename',id,title:'Lecture 4'});
  const tab=s.tabs.find(t=>t.id===id)!;
  assert.equal(tabCardHost(tab.url),'three.test');
  const source=readFileSync(new URL('../src/components/sidebar/NowPlaying.tsx',import.meta.url),'utf8');
  assert.match(source,/tabDisplayTitle\(tab\)/);assert.match(source,/tabCardHost\(tab\.url\)/);
});

test('the card is wired: go to the tab, play or pause, volume and mute, seek, previous / next, picture in picture, close; above the footer; on the list motion; with every word in the catalog', () => {
  const read=(path:string)=>readFileSync(new URL(path,import.meta.url),'utf8');
  const card=read('../src/components/sidebar/NowPlaying.tsx'),block=read('../src/components/sidebar/SidebarMedia.tsx'),sidebar=read('../src/components/sidebar/AciraSidebar.tsx'),css=read('../src/components/sidebar/now-playing.css'),old=read('../src/components/sidebar/sidebar-media.css'),en=JSON.parse(read('../src/i18n/en.json')) as Record<string,string>;
  assert.match(block,/type: 'tab\.select', id: tab\.id/);assert.match(card,/runtime\.browserCommand\(mediaToggle\(tab\)\)/);assert.match(card,/type: 'tab\.mute', id: tab\.id, muted: true/,'the volume slider mutes at 0 (tests/media-volume.test.ts)');
  for(const action of ['seek','skip','pip','stop'])assert.match(card,new RegExp(`action: '${action}'`),`${action} reaches main`);
  assert.match(card,/type: 'media', tabId, \.\.\.command/);assert.match(card,/action: 'volume', level: next/);
  assert.match(block,/useListMotion\(list/);assert.match(block,/animateSpring\(el/);
  assert.ok(sidebar.indexOf('<SidebarMedia')>0&&sidebar.indexOf('<SidebarMedia')<sidebar.indexOf('{bottomNodes}'),'the media block sits right above the footer');
  for(const id of ['sidebarmedia.play','sidebarmedia.pause','sidebarmedia.region','sidebarmedia.volume','rewindpage.goToTab','nowplaying.previous','nowplaying.next','nowplaying.close','nowplaying.seek','nowplaying.live','nowplaying.pip','nowplaying.pipBack','nowplaying.pipNone','nowplaying.open','nowplaying.fold','shortcutCmd.pip'])assert.equal(typeof en[id],'string',id);
  assert.match(css,/outline:2px solid var\(--sb-ring\)/);assert.match(css,/--sb-fg/);assert.match(css,/--sb-muted/);
  assert.doesNotMatch(old,/#[0-9a-fA-F]{3,8}\b/,'no hard-coded colours in the block');
});

test('R4-31: the cards keep 8px from the sidebar edges, 14px of air under them, and the rule above them shows only when the list runs into them', () => {
  const read=(path:string)=>readFileSync(new URL(path,import.meta.url),'utf8');
  const row=read('../src/components/sidebar/SidebarMedia.tsx'),css=read('../src/components/sidebar/sidebar-media.css');
  assert.match(css,/\.sb-media\{position:relative;flex:none;padding:8px 8px 14px\}/);
  assert.match(css,/\.sb-media::before\{[^}]*opacity:0/,'no rule by default');
  assert.match(css,/\.sb-media\[data-divider\]::before\{opacity:1\}/);
  assert.match(row,/data-divider=\{touches \|\| undefined\}/);assert.match(row,/scroll\.scrollHeight > scroll\.clientHeight \+ 1 \|\| free < CLEAR/);
});
