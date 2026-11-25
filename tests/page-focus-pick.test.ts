import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PAGE_PICK_SELECTOR,choosesPage,type PickEvent} from '../src/ui/pagePick';

// Founder, 6 Nov: after a click in the sidebar the keyboard stays in the interface, so Space no longer pauses the video. A plain press
// on a control that chooses a page asks main to hand the keyboard to the page (desktop/page-focus.cjs); everything that is not such a
// press leaves it alone. The sidebar and strips are DOM, so the controls are stood in for by small nodes that answer `closest`.

type Node={pick?:boolean;control?:boolean;parent?:Node};
const closestOf=(node:Node)=>(selector:string)=>{
  for(let at:Node|undefined=node;at;at=at.parent){if(selector===PAGE_PICK_SELECTOR?at.pick:at.control)return elementOf(at);}
  return null;
};
const cache=new WeakMap<Node,any>();
function elementOf(node:Node):any{
  let el=cache.get(node);
  if(!el){el={closest:closestOf(node),contains:(other:any)=>{for(let at=other?.node as Node|undefined;at;at=at.parent)if(at===node)return true;return false;},node};cache.set(node,el);}
  return el;
}
const press=(node:Node|null,over:Partial<PickEvent>={}):PickEvent=>({detail:1,button:0,ctrlKey:false,metaKey:false,shiftKey:false,altKey:false,target:node?elementOf(node):null,...over});

const row:Node={pick:true,control:true};                    // a sidebar tab, favorite or bookmark: a button that chooses a page
const strip:Node={pick:true};                               // a strip tab: a div with role="tab"
const close:Node={control:true,parent:strip};               // the close or mute button inside a strip tab
const field:Node={control:true,parent:row};                 // a rename field inside a row
const label:Node={parent:strip};                            // text inside a strip tab

test('a plain press on a tab, favorite, bookmark or strip tab chooses a page',()=>{
  assert.equal(choosesPage(press(row)),true);
  assert.equal(choosesPage(press(strip)),true);
  assert.equal(choosesPage(press(label)),true,'the title text inside a tab');
});

test('a press that is not on such a control does not',()=>{
  assert.equal(choosesPage(press({})),false,'any other part of the interface');
  assert.equal(choosesPage(press(null)),false);
  assert.equal(choosesPage({...press(row),target:{}}),false,'a target that cannot say');
});

// Beta 14, the team 17 Nov: a press on the Favorites stack opens the panel that holds the folded Favorites. The stack is a `.sb-app` too, so it chose a page: main handed the keyboard to the page, the interface
// lost it in the same breath, and the panel (it folds when the interface loses the keyboard) shut as it opened; a second click then landed on the stack again, and so on. The selector is read here as the real
// `closest()` reads it: a comma list of `[role="x"]` and `.class` parts, with `.class:not(.other)`.
type El={classes:string[];role?:string};
const partMatches=(part:string,el:El)=>{
  const role=part.match(/^\[role="([\w-]+)"\]$/);if(role)return el.role===role[1];
  const cls=part.match(/^\.([\w-]+)(?::not\(\.([\w-]+)\))?$/);if(!cls)throw Error('a selector part this test cannot read: '+part);
  return el.classes.includes(cls[1])&&!(cls[2]&&el.classes.includes(cls[2]));
};
const picks=(el:El)=>PAGE_PICK_SELECTOR.split(',').map(part=>part.trim()).some(part=>partMatches(part,el));

test('the Favorites stack opens a panel and chooses no page; every other Favorites tile still does',()=>{
  assert.equal(picks({classes:['sb-app','sb-app-stack']}),false,'the stack tile');
  assert.equal(picks({classes:['sb-app','sb-app-stack','sb-stack-ghost']}),false,'the stack\'s stand-in during the motion');
  assert.equal(picks({classes:['sb-app']}),true,'a Favorite in the grid or in the panel');
  assert.equal(picks({classes:['sb-app','sb-app-add']}),true,'the add tile keeps its behaviour');
  assert.equal(picks({classes:['sb-tab-main']}),true);
  assert.equal(picks({classes:[],role:'tab'}),true);
  assert.equal(picks({classes:['sb-apps-panel']}),false,'the panel itself');
});

test('keyboard activation keeps the focus where the person is navigating (Enter or Space on a focused tab reports detail 0)',()=>{
  assert.equal(choosesPage(press(row,{detail:0})),false);
});

test('the second click of a double-click is left alone: a rename follows and needs the keyboard in the interface',()=>{
  assert.equal(choosesPage(press(row,{detail:2})),false);
  assert.equal(choosesPage(press(row,{detail:3})),false);
});

test('modified or other-button clicks open a background tab, a new window or a menu: no focus change',()=>{
  for(const over of [{ctrlKey:true},{metaKey:true},{shiftKey:true},{altKey:true},{button:1},{button:2}])
    assert.equal(choosesPage(press(row,over)),false,JSON.stringify(over));
});

test('controls inside a tab (close, mute, a rename field) are their own thing',()=>{
  assert.equal(choosesPage(press(close)),false);
  assert.equal(choosesPage(press(field)),false);
});

test('every class and role in the selector is still drawn by a component (a renamed class would silently stop the rule)',()=>{
  const read=(file:string)=>readFileSync(new URL('../src/'+file,import.meta.url),'utf8');
  const sidebar=read('components/sidebar/AciraSidebar.tsx'),media=read('components/sidebar/NowPlaying.tsx'),frost=read('features/FrostWorkspace.tsx');
  for(const name of ['sb-tab-main','sb-app','sb-bookmark','sb-group-header'])assert.ok(sidebar.includes(name),name);
  for(const name of ['np-art','np-gotab'])assert.ok(media.includes(name),name);
  for(const name of ['ed-rail-tab','ed-rail-app','ed-rail-tab-group-name'])assert.ok(frost.includes(name),name);
  for(const file of ['components/BrowserTabsHorizontal.tsx','components/CompactTabs.tsx'])assert.ok(read(file).includes('role="tab"'),file);
  for(const name of ['.sb-tab-main','.sb-app','.sb-bookmark','.sb-group-header','.np-art','.np-gotab','.ed-rail-tab','.ed-rail-app','.ed-rail-tab-group-name','[role="tab"]'])
    assert.ok(PAGE_PICK_SELECTOR.includes(name),name);
});

test('the app installs the rule once, with the tab on screen',()=>{
  const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
  assert.ok(app.includes("import {usePageFocusOnPick} from './ui/pageFocus';"));
  assert.equal(app.split('usePageFocusOnPick(tab.id);').length-1,1);
  const hook=readFileSync(new URL('../src/ui/pageFocus.ts',import.meta.url),'utf8');
  assert.ok(hook.includes("type: 'focus-page'"));
  assert.ok(hook.includes("from './pagePick'"));
  assert.ok(hook.includes("document.addEventListener('click', onClick)"),'after the control\'s own handler has dispatched (bubble, document level)');
});
