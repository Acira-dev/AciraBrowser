import test from 'node:test';import assert from 'node:assert/strict';
import {resolveNavigation} from '../src/runtime/navigation';
import {resolveSearch} from '../src/runtime/searchProviders';
import {rankAddressSuggestions} from '../src/ui/addressSuggestions';
import {createInitialState} from '../src/runtime/core';

// encodeURIComponent throws "URI malformed" on a lone surrogate. The address list ranks on every keystroke, in the overlay's React render: one throw
// emptied the list for good (until Esc). A paste longer than 4096 characters is cut at 4096, which can split an emoji and leave exactly such a half.
const providers={defaultId:'google',engines:[{id:'google',name:'Google',keyword:'g',template:'https://www.google.com/search?q=%s'}]};
const HALF='\ud83d';

test('a search with half an emoji in it still searches, the half read as the replacement character',()=>{
 for(const typed of [`hello ${HALF} world`,`cats ${HALF}`,`${HALF}`,`a\ude00b`]){
  const target=resolveNavigation(typed,'google',providers);
  assert.equal(target.error,undefined,typed);
  assert.ok(target.url.startsWith('https://www.google.com/search?q='),target.url);
  assert.ok(target.url.includes('%EF%BF%BD'),'the half became U+FFFD: '+target.url);
 }
 assert.doesNotThrow(()=>resolveNavigation(`!g cats ${HALF}`,'google'),'a search shortcut');
 assert.equal(resolveSearch(`ok ${HALF}`,providers)?.query,'ok �');
 assert.equal(resolveSearch('a 😀 b',providers)?.query,'a 😀 b','a whole emoji is untouched');
 assert.equal(resolveSearch('a 😀 b',providers)?.url,'https://www.google.com/search?q=a%20%F0%9F%98%80%20b');
});

test('ranking the address list never throws on such text, whatever cut it',()=>{
 const state=createInitialState();
 assert.doesNotThrow(()=>rankAddressSuggestions(`hello ${HALF} world`,state as never));
 const cut='x'.repeat(4095)+'😀 tail';// the 4096 limit lands between the two halves
 const rows=rankAddressSuggestions(cut,state as never);
 assert.ok(rows.length>0,'the typed row is still there');
});
