import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {createInitialState,reduceBrowser,persistedSnapshot,restoreSnapshot} from '../src/runtime/core';
import { SPLIT_LAYOUTS, defaultLayout, layoutsFor, minimumSize, normalizeFractions, normalizeSplit, paneRects, resizeSplit, splitHandles } from '../src/runtime/splitLayout';

const area = { x: 0, y: 72, width: 1206, height: 806 };

test('saved split parent survives unrelated/individual navigation and restart, preserving its layout and ratios',()=>{
 let s=createInitialState();const first=s.activeTabId;
 s=reduceBrowser(s,{type:'tab.new',url:'https://second.test/'});const second=s.activeTabId;
 s=reduceBrowser(s,{type:'split.open',tabIds:[first,second],layout:'rows'});
 s=reduceBrowser(s,{type:'split.resize',rows:[.3,.7]});
 const group=s.windowUi.splitGroups![0].id;
 s=reduceBrowser(s,{type:'tab.new',url:'https://outside.test/'});
 assert.equal(s.windowUi.split,null);assert.equal(s.windowUi.splitGroups?.length,1);
 s=restoreSnapshot(persistedSnapshot(s));
 s=reduceBrowser(s,{type:'split.group.select',id:group});
 assert.equal(s.windowUi.split?.layout,'rows');assert.deepEqual(s.windowUi.split?.rows,[.3,.7]);
 s=reduceBrowser(s,{type:'tab.select',id:first,individual:true});
 assert.equal(s.windowUi.split,null);assert.deepEqual(s.windowUi.splitGroups?.[0].tabIds,[first,second]);
 s=reduceBrowser(s,{type:'split.group.select',id:group});assert.deepEqual(s.windowUi.split?.tabIds,[first,second]);
 s=reduceBrowser(s,{type:'split.close'});assert.equal(s.windowUi.split,null);assert.equal(s.windowUi.splitGroups?.[0].id,group,'leaving split view keeps its saved parent, including an automatic narrow-window exit');
});

test('saved split drop deduplicates, caps at four and prunes closed members without disturbing normal groups',()=>{
 let s=createInitialState();const ids=[s.activeTabId];
 for(let index=0;index<4;index++){s=reduceBrowser(s,{type:'tab.new'});ids.push(s.activeTabId);}
 s=reduceBrowser(s,{type:'tab.group.create',tabId:ids[4],name:'Ordinary'});
 s=reduceBrowser(s,{type:'tab.select',id:ids[0]});s=reduceBrowser(s,{type:'split.open',tabIds:ids.slice(0,2)});
 const group=s.windowUi.splitGroups![0].id;
 for(const tabId of [ids[1],ids[2],ids[3],ids[4]])s=reduceBrowser(s,{type:'split.group.add',id:group,tabId});
 assert.deepEqual(s.windowUi.splitGroups![0].tabIds,ids.slice(0,4));assert.match(s.toast?.text||'',/two to four/);
 assert.equal(s.tabGroups[0].name,'Ordinary');assert.equal(s.tabs.find(tab=>tab.id===ids[4])?.group,'Ordinary');
 s=reduceBrowser(s,{type:'tab.close',id:ids[3]});assert.equal(s.windowUi.splitGroups![0].layout,'three-columns');
 s=reduceBrowser(s,{type:'tab.close',id:ids[2]});assert.equal(s.windowUi.splitGroups![0].layout,'columns');
 s=reduceBrowser(s,{type:'tab.close',id:ids[1]});assert.equal(s.windowUi.splitGroups?.length||0,0);
});

test('adding panes keeps the parent identity; whole normal-group drops merge without duplicates',()=>{
 let s=createInitialState();const first=s.activeTabId;
 s=reduceBrowser(s,{type:'tab.new'});const second=s.activeTabId;
 s=reduceBrowser(s,{type:'split.open',tabIds:[first,second]});const group=s.windowUi.splitGroups![0].id;
 s=reduceBrowser(s,{type:'tab.new',background:true});const third=s.tabs.at(-1)!.id;
 s=reduceBrowser(s,{type:'split.add',tabId:third});assert.equal(s.windowUi.splitGroups![0].id,group);
 s=reduceBrowser(s,{type:'tab.group.create',tabId:second,name:'Ordinary'});const normal=s.tabGroups[0].id;
 s=reduceBrowser(s,{type:'tab.new',background:true});const fourth=s.tabs.at(-1)!.id;
 s=reduceBrowser(s,{type:'tab.group.assign',tabIds:[fourth],groupId:normal});
 s=reduceBrowser(s,{type:'split.group.add',id:group,tabId:second,wholeGroup:true});
 assert.deepEqual(new Set(s.windowUi.splitGroups![0].tabIds),new Set([first,second,third,fourth]));
 assert.equal(s.tabs.find(tab=>tab.id===fourth)?.group,'Ordinary');
});

test('public snapshots discard every split containing a private or Tor tab, including its metadata',()=>{
 for(const privacy of ['private','tor'] as const){
  let s=createInitialState();const normal=s.activeTabId;
  s=reduceBrowser(s,{type:'tab.new',privacy,url:'https://secret-split.test/'});const secret=s.activeTabId;
  s=reduceBrowser(s,{type:'split.open',tabIds:[normal,secret]});const group=s.windowUi.splitGroups![0].id;
  const saved=persistedSnapshot(s),json=JSON.stringify(saved);
  assert.equal(saved.windowUi.split,null);assert.equal(saved.windowUi.splitGroups?.length,0);
  assert.ok(!json.includes(secret));assert.ok(!json.includes(group));assert.ok(!json.includes('secret-split.test'));
 }
});

test('native split-group boundary accepts live destinations and rejects missing groups or malformed flags',()=>{
 const {validateAction}=createRequire(import.meta.url)('../desktop/validation.cjs');
 let state=createInitialState();const first=state.activeTabId;
 state=reduceBrowser(state,{type:'tab.new'});state=reduceBrowser(state,{type:'split.open',tabIds:[first,state.activeTabId]});
 const id=state.windowUi.splitGroups![0].id;
 for(const action of [{type:'split.group.select',id},{type:'split.group.toggle',id},{type:'split.group.add',id,tabId:first,wholeGroup:true},{type:'tab.select',id:first,individual:true}])assert.doesNotThrow(()=>validateAction(action,state));
 for(const action of [{type:'split.group.select',id:'missing'},{type:'split.group.add',id,tabId:'missing'},{type:'split.group.add',id,tabId:first,wholeGroup:'yes'},{type:'tab.select',id:first,individual:'yes'}])assert.throws(()=>validateAction(action,state));
});

test('public split serialization keeps only known member focus and recognized group metadata',()=>{
 let state=createInitialState();const first=state.activeTabId;
 state=reduceBrowser(state,{type:'tab.new'});state=reduceBrowser(state,{type:'split.open',tabIds:[first,state.activeTabId]});
 state.windowUi.split!.groupId='split-private-stale';
 (state.windowUi.splitGroups![0] as any).privateLabel='secret-private-label';
 state.windowUi.splitGroups![0].lastActiveTabId='private-stale-tab';
 const text=JSON.stringify(persistedSnapshot(state));
 for(const marker of ['split-private-stale','secret-private-label','private-stale-tab'])assert.ok(!text.includes(marker),marker);
});

test('an older persisted active split gains a saved parent when reopened',()=>{
 let state=createInitialState();const first=state.activeTabId;
 state=reduceBrowser(state,{type:'tab.new'});const second=state.activeTabId;
 state.windowUi.split={tabIds:[first,second],layout:'rows',cols:[1],rows:[.4,.6]};
 delete state.windowUi.splitGroups;
 const restored=restoreSnapshot(state);
 assert.equal(restored.windowUi.splitGroups?.length,1);
 assert.equal(restored.windowUi.split?.groupId,restored.windowUi.splitGroups?.[0].id);
 assert.deepEqual(restored.windowUi.split?.rows,[.4,.6]);
});

test('layouts per pane count, default first; 1 or 5 panes have none', () => {
  assert.deepEqual(layoutsFor(2), ['columns', 'rows']);
  assert.deepEqual(layoutsFor(3), ['three-columns', 'three-rows', 'top-two-bottom-one', 'top-one-bottom-two', 'left-one-right-two', 'left-two-right-one']);
  assert.deepEqual(layoutsFor(4), ['grid', 'four-columns', 'four-rows', 'left-one-right-three', 'left-three-right-one', 'top-one-bottom-three']);
  assert.deepEqual([defaultLayout(1), defaultLayout(5)], [null, null]);
  for (const [id, spec] of Object.entries(SPLIT_LAYOUTS)) {
    const used = new Set(spec.areas.flat());
    assert.equal(used.size, spec.panes, `${id} uses every pane`);
    assert.equal(spec.areas.length, spec.rows); assert.ok(spec.areas.every(row => row.length === spec.cols));
  }
});

test('fractions sum to 1 with a floor; nonsense falls back to even', () => {
  assert.deepEqual(normalizeFractions([1, 1], 2), [.5, .5]);
  const lifted = normalizeFractions([.98, .02], 2); assert.ok(lifted[1] >= .15 && Math.abs(lifted[0] + lifted[1] - 1) < 1e-3);
  assert.deepEqual(normalizeFractions(['x', 2], 2), [.5, .5]); assert.deepEqual(normalizeFractions([1, 2], 3).length, 3);
  assert.deepEqual(normalizeFractions(undefined, 1), [1]);
});

test('normalizeSplit keeps 2–4 distinct open tabs with the active one, reads the old ratio, repairs the layout', () => {
  const open = ['a', 'b', 'c', 'd', 'e'];
  assert.deepEqual(normalizeSplit({ tabIds: ['a', 'b'], ratio: .3 }, open, 'a'), { tabIds: ['a', 'b'], layout: 'columns', cols: [.3, .7], rows: [1] });
  assert.equal(normalizeSplit({ tabIds: ['a', 'b', 'c'], layout: 'grid' }, open, 'b')?.layout, 'three-columns', 'a 4-pane layout for 3 tabs falls back');
  assert.equal(normalizeSplit({ tabIds: ['a', 'b', 'c', 'd'], layout: 'grid' }, open, 'd')?.layout, 'grid');
  assert.deepEqual(normalizeSplit({ tabIds: ['a', 'b'], layout: 'rows', ratio: .6 }, open, 'a')?.rows, [.6, .4]);
  for (const bad of [{ tabIds: ['a'] }, { tabIds: ['a', 'a'] }, { tabIds: ['a', 'z'] }, { tabIds: ['b', 'c'] }, { tabIds: ['a', 'b', 'c', 'd', 'e'] }, null, 'x', []])
    assert.equal(normalizeSplit(bad, open, 'a'), null, JSON.stringify(bad));
});

test('pane rectangles tile the page area with gaps; spanning panes include the gap they cover', () => {
  const two = paneRects({ layout: 'columns', cols: [.5, .5], rows: [1] }, area, 6);
  assert.deepEqual(two, [{ x: 0, y: 72, width: 600, height: 806 }, { x: 606, y: 72, width: 600, height: 806 }]);
  const tri = paneRects({ layout: 'top-two-bottom-one', cols: [.5, .5], rows: [.5, .5] }, area, 6);
  assert.equal(tri[2].width, area.width, 'the bottom pane spans both columns and the gap between');
  assert.equal(tri[0].height + 6 + tri[2].height, area.height);
  const grid = paneRects({ layout: 'grid', cols: [.25, .75], rows: [.5, .5] }, area, 6);
  assert.equal(grid[0].width, 300); assert.equal(grid[1].x, 306); assert.equal(grid[3].x + grid[3].width, area.width);
});

test('handles: a column edge runs its full length, a row edge is one segment per column in a grid, and a junction sits where a segment meets a column edge', () => {
  const g = splitHandles({ layout: 'grid', cols: [.5, .5], rows: [.5, .5] }, area, 6, 10);
  assert.deepEqual(g.map(h => h.kind), ['col', 'row', 'row', 'corner'], 'aligned segments share one four-way junction');
  assert.equal(g[0].rect.height, area.height, 'the 2×2 column edge runs the full height');
  const t = splitHandles({ layout: 'top-two-bottom-one', cols: [.5, .5], rows: [.5, .5] }, area, 6, 10);
  assert.deepEqual(t.map(h => h.kind), ['col', 'row', 'corner'], 'a T junction moves both axes');
  assert.ok(t[0].rect.height < area.height / 2 + 10, 'the column edge only runs along the top row');
  assert.equal(splitHandles({ layout: 'three-columns', cols: [1, 1, 1], rows: [1] }, area).filter(h => h.kind === 'col').length, 2);
});

test('resizing moves the edge by the drag, clamps at the minimum pane, and the corner moves both edges', () => {
  const start = { layout: 'columns' as const, cols: [.5, .5], rows: [1] };
  const moved = resizeSplit(start, { kind: 'col', col: 0 }, 120, 0, area, 6, 240);
  assert.equal(Math.round(moved.cols[0] * 1200), 720);
  const clamped = resizeSplit(start, { kind: 'col', col: 0 }, 5000, 0, area, 6, 240);
  assert.equal(Math.round(clamped.cols[1] * 1200), 240, 'the right pane keeps 240px');
  const corner = resizeSplit({ layout: 'grid', cols: [.5, .5], rows: [.5, .5] }, { kind: 'corner', col: 0, row: 0 }, -100, 80, area, 6, 240);
  assert.ok(corner.cols[0] < .5 && corner.rows[0] > .5, 'both edges follow the corner');
  assert.deepEqual(resizeSplit(start, { kind: 'row', row: 0 }, 0, 50, area).rows, [1], 'no row edge in side-by-side');
});

test('minimum page size per layout', () => {
  assert.deepEqual(minimumSize('columns'), { width: 486, height: 180 });
  assert.equal(minimumSize('grid').width, 486); assert.equal(minimumSize('three-columns').width, 732);
});

test('reducer: open up to four panes, change layout, add, remove, resize and swap; nothing leaves an invalid split', async () => {
  const { createInitialState, reduceBrowser } = await import('../src/runtime/core');
  let s = createInitialState();
  for (const url of ['https://a.test/', 'https://b.test/', 'https://c.test/', 'https://d.test/', 'https://e.test/']) s = reduceBrowser(s, { type: 'tab.new', url });
  const [, a, b, c, d, e] = s.tabs.map(t => t.id);
  s = reduceBrowser(s, { type: 'tab.select', id: a });
  s = reduceBrowser(s, { type: 'split.open', tabIds: [a, b], ratio: .4 });
  const {groupId,...opened}=s.windowUi.split!;assert.ok(groupId);
  assert.deepEqual(opened, { tabIds: [a, b], layout: 'columns', cols: [.4, .6], rows: [1] });
  s = reduceBrowser(s, { type: 'split.layout', layout: 'rows' }); assert.equal(s.windowUi.split?.layout, 'rows');
  assert.equal(reduceBrowser(s, { type: 'split.layout', layout: 'grid' }), s, 'a 4-pane layout for 2 panes is refused');
  s = reduceBrowser(s, { type: 'split.add', tabId: c }); assert.deepEqual([s.windowUi.split?.tabIds.length, s.windowUi.split?.layout], [3, 'three-columns']);
  s = reduceBrowser(s, { type: 'split.add', tabId: d, layout: 'grid' }); assert.equal(s.windowUi.split?.layout, 'grid');
  assert.equal(reduceBrowser(s, { type: 'split.add', tabId: e }), s, 'a fifth pane is refused');
  s = reduceBrowser(s, { type: 'split.resize', cols: [.7, .3], rows: [.4, .6] }); assert.deepEqual([s.windowUi.split?.cols, s.windowUi.split?.rows], [[.7, .3], [.4, .6]]);
  s = reduceBrowser(s, { type: 'split.swap', a, b: d }); assert.deepEqual(s.windowUi.split?.tabIds, [d, b, c, a]);
  s = reduceBrowser(s, { type: 'split.remove', tabId: a }); assert.equal(s.activeTabId, d, 'removing the active pane selects another pane');
  assert.deepEqual([s.windowUi.split?.tabIds.length, s.windowUi.split?.layout], [3, 'three-columns']);
  s = reduceBrowser(reduceBrowser(s, { type: 'split.remove', tabId: b }), { type: 'split.remove', tabId: c }); assert.equal(s.windowUi.split, null, 'one pane left is no split');
  s = reduceBrowser(s, { type: 'split.open', tabIds: [d, e] }); s = reduceBrowser(s, { type: 'tab.close', id: e }); assert.equal(s.windowUi.split, null, 'closing a member ends a two-pane split');
  s = reduceBrowser(s, { type: 'split.open', tabIds: [d, b, c], layout: 'left-one-right-two' }); s = reduceBrowser(s, { type: 'tab.close', id: c });
  assert.deepEqual([s.windowUi.split?.tabIds, s.windowUi.split?.layout], [[d, b], 'columns'], 'closing one of three leaves the other two side by side');
});

test('the keyboard split commands know the same layouts and pane counts as the engine', async () => {
  const { createRequire } = await import('node:module');
  const { LAYOUT_PANES } = createRequire(import.meta.url)('../desktop/rewind/split-commands.cjs') as { LAYOUT_PANES: Record<string, number> };
  assert.deepEqual(LAYOUT_PANES, Object.fromEntries(Object.entries(SPLIT_LAYOUTS).map(([id, spec]) => [id, spec.panes])));
});
