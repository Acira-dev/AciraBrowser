import test from 'node:test';
import assert from 'node:assert/strict';
import {sidebarPatch,workspaceIsOpen} from '../src/runtime/browserChrome';

const start={url:'acira://new',contentKind:'internal' as const},site={url:'https://example.com',contentKind:'web' as const};

test('closing the sidebar on a website keeps it closed when you open a new tab',()=>{
  const ui=Object.assign({workspaceOpen:true,webWorkspaceOpen:true},sidebarPatch(false));
  assert.equal(workspaceIsOpen(ui,site),false);
  assert.equal(workspaceIsOpen(ui,start),false);
});

test('opening it anywhere opens it everywhere',()=>{
  const ui=Object.assign({workspaceOpen:false,webWorkspaceOpen:false},sidebarPatch(true));
  assert.equal(workspaceIsOpen(ui,site),true);
  assert.equal(workspaceIsOpen(ui,start),true);
});

import {defaultToolbarItems,moveToolbarItem,normalizeToolbarItems} from '../src/ui/toolbarPrefs';
test('saved toolbar layouts drop unknown buttons and gain new ones in their default place',()=>{
  const saved=[{id:'profile',visible:true},{id:'downloads',visible:true},{id:'agent',visible:true},{id:'downloads',visible:false}];
  const items=normalizeToolbarItems(saved);
  const ids=items.map(item=>item.id);
  assert.ok(ids.indexOf('profile')<ids.indexOf('downloads'));
  assert.deepEqual(items.find(item=>item.id==='downloads'),{id:'downloads',visible:true});
  assert.equal(ids.indexOf('extensions'),ids.indexOf('profile')+1,'a button the saved list lacks joins after the one it follows by default');
  assert.equal(items.length,defaultToolbarItems.length);
  assert.ok(!items.some(item=>(item.id as string)==='agent'));
  assert.deepEqual(normalizeToolbarItems('broken'),defaultToolbarItems);
});
test('keyboard moves stop at either end of the toolbar',()=>{
  const items=normalizeToolbarItems(undefined);
  assert.equal(moveToolbarItem(items,'profile',-1)[0].id,'profile');
  assert.equal(moveToolbarItem(items,'extensions',-1)[0].id,'extensions');
  assert.equal(moveToolbarItem(items,items.at(-1)!.id,5).at(-1)!.id,items.at(-1)!.id);
});
import {opensSuggestionsOnFocus} from '../src/ui/addressSuggestions';
test('focusing a new tab omnibox never opens the suggestion list, even while the field still shows the previous URL',()=>{
 // Ctrl+T after a tab opened with a URL: the field is focused before it re-renders empty. No draft on this tab, no list.
 assert.equal(opensSuggestionsOnFocus({enabled:true,draftTabId:null,tabId:'new',draft:'https://example.org/'}),false);
 assert.equal(opensSuggestionsOnFocus({enabled:true,draftTabId:'previous',tabId:'new',draft:'https://example.org/'}),false);
 assert.equal(opensSuggestionsOnFocus({enabled:true,draftTabId:'new',tabId:'new',draft:'  '}),false);
 assert.equal(opensSuggestionsOnFocus({enabled:true,draftTabId:'new',tabId:'new',draft:'acira'}),true);
 assert.equal(opensSuggestionsOnFocus({enabled:false,draftTabId:'new',tabId:'new',draft:'acira'}),false);
});
