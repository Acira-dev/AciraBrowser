'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {pageMenuOf,previewMenuUp}=require('../desktop/native-policy.cjs');

// 13.4: a page's menu belongs to that page. What the page loading another document, crashing or going away closes is its own menu on screen, and nothing else.
test('pageMenuOf: only the page menu on screen that was opened over that very page',()=>{
 const menu={tabId:'t1',owner:7,at:1,toggles:new Set()};
 assert.equal(pageMenuOf({id:3,kind:'page-context'},menu,7),true,'its own menu, on screen');
 assert.equal(pageMenuOf({id:3,kind:'page-context'},menu,8),false,'another page loading or crashing leaves it alone');
 assert.equal(pageMenuOf({id:3,kind:'tab-context'},menu,7),false,'another popup is on screen, not its menu');
 assert.equal(pageMenuOf({id:3,kind:'menu'},menu,7),false);
 assert.equal(pageMenuOf({id:3,kind:'toast'},menu,7),false);
 assert.equal(pageMenuOf(undefined,menu,7),false,'nothing on screen');
 assert.equal(pageMenuOf({id:3,kind:'page-context'},null,7),false,'no menu was ever opened');
 assert.equal(pageMenuOf({id:3,kind:'page-context'},{tabId:'t1',run(){},at:1},7),false,'a toolbar extension menu has no page');
 assert.equal(pageMenuOf({id:3,kind:'page-context'},menu,undefined),false,'no page, no match (undefined is not an owner)');
});

test('previewMenuUp: only a page menu that was opened over a Link preview\'s page',()=>{
 assert.equal(previewMenuUp({id:3,kind:'page-context'},{owner:9,preview:true}),true);
 assert.equal(previewMenuUp({id:3,kind:'page-context'},{owner:9}),false,'a tab\'s own menu is not the preview\'s');
 assert.equal(previewMenuUp({id:3,kind:'page-context'},{owner:9,preview:false}),false);
 assert.equal(previewMenuUp({id:3,kind:'menu'},{owner:9,preview:true}),false,'another popup is on screen');
 assert.equal(previewMenuUp({id:3,kind:'toast'},{owner:9,preview:true}),false);
 assert.equal(previewMenuUp(undefined,{owner:9,preview:true}),false);
 assert.equal(previewMenuUp({id:3,kind:'page-context'},null),false);
});
