// 13.8, item 10: an extension's page shown as the New Tab is a "web" tab (it has a page view of its own, so it stacks like any page) whose address is
// still acira://new. The interface must treat it as the New Tab (start-page sidebar choice, bookmarks row, no loading dots, a start tab's menu and card)
// and not as a website (no Shields, certificate, site information, Reader, Favorites, Split view, Copy address).
import test from 'node:test';
import assert from 'node:assert/strict';
import {isNewTabPage,isWebsite} from '../src/runtime/newTabPage';
import {bookmarksOnTab,workspaceIsOpen,workspacePreferenceKey} from '../src/runtime/browserChrome';
import {tabShowsLoading} from '../src/ui/tabLoading';
import {tabCardKind} from '../src/runtime/tabCard';
import {tabMenuRows} from '../src/ui/popup';
import {createInitialState,reduceBrowser} from '../src/runtime/core';

const page={url:'acira://new',contentKind:'web' as const},start={url:'acira://new',contentKind:'internal' as const},site={url:'https://example.com/',contentKind:'web' as const};

test('the New Tab\'s extension page is a page but not a website',()=>{
  assert.equal(isNewTabPage(page),true);assert.equal(isWebsite(page),false);
  assert.equal(isNewTabPage(start),false);assert.equal(isWebsite(start),false);
  assert.equal(isWebsite(site),true);assert.equal(isNewTabPage(site),false);
});

test('it keeps the start page\'s sidebar choice and the bookmarks row of a New Tab',()=>{
  assert.equal(workspacePreferenceKey(page),'workspaceOpen');assert.equal(workspacePreferenceKey(site),'webWorkspaceOpen');
  const ui={workspaceOpen:true,webWorkspaceOpen:false};
  assert.equal(workspaceIsOpen(ui,page),true,'like Acira\'s own New Tab, not like a website');
  const settings={bookmarksBar:true,bookmarksOnNewTabOnly:true};
  assert.equal(bookmarksOnTab(settings,page),true);assert.equal(bookmarksOnTab(settings,start),true);assert.equal(bookmarksOnTab(settings,site),false);
});

test('it never wears the loading dots; a website does',()=>{
  const loading={loading:true,sleeping:false,error:null};
  assert.equal(tabShowsLoading({...loading,...page}),false);
  assert.equal(tabShowsLoading({...loading,...site}),true);
});

test('its hover card is the name card, as a New Tab\'s, never a picture of the page',()=>{
  assert.equal(tabCardKind({},{...page,privacy:undefined,sleeping:false}),'name');
  assert.equal(tabCardKind({},{...site,privacy:undefined,sleeping:false}),'preview');
});

test('its tab menu has a start page\'s rows (no website rows: copy address, mute, split view), as the menu is sized',()=>{
  let s=createInitialState();s=reduceBrowser(s,{type:'tab.new'} as never);
  const id=s.activeTabId,a=s.tabs.find(tab=>tab.id===id)!;
  const asPage={...a,contentKind:'web' as const},asStart={...a,contentKind:'internal' as const};
  assert.equal(tabMenuRows(s,asPage),tabMenuRows(s,asStart),'the same rows');
  assert.ok(tabMenuRows(s,{...a,url:'https://example.com/',contentKind:'web' as const})>tabMenuRows(s,asPage),'a website has more');
});
