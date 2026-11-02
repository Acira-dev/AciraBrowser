import test from 'node:test';
import assert from 'node:assert/strict';
import { MOVABLE_SECTIONS,moveSection,sectionLayout,sectionShown,toggleSection } from '../src/ui/sidebarSections';

// Customisable sidebar (Round 2): which sections show and in what order, as Settings › Sidebar and the sidebar share it.
test('a new profile shows Favorites, pinned tabs, Tabs and Bookmarks; Downloads, History and the Reading list start off',()=>{
 const layout=sectionLayout({});
 assert.deepEqual(layout.order,MOVABLE_SECTIONS);
 for(const id of ['favorites','pinned','tabs','bookmarks'] as const)assert.equal(sectionShown(layout,id),true,id);
 for(const id of ['downloads','history','reading'] as const)assert.equal(sectionShown(layout,id),false,id);
});

test('a saved layout keeps its order, drops unknown ids and gains sections added later',()=>{
 const layout=sectionLayout({sections:{order:['bookmarks','nope','tabs','bookmarks'],hidden:['favorites','bogus']}});
 assert.deepEqual(layout.order,['bookmarks','tabs','downloads','history','reading']);
 assert.deepEqual(layout.hidden,['favorites'],'a saved choice means only what was saved is hidden');
});

test('moving and hiding',()=>{
 const start=sectionLayout({});
 assert.deepEqual(moveSection(start,'bookmarks',0).order.slice(0,2),['bookmarks','tabs']);
 assert.equal(moveSection(start,'tabs',0),start,'no move returns the same layout');
 assert.equal(moveSection(start,'favorites',3),start,'Favorites does not move');
 assert.deepEqual(moveSection(start,'tabs',99).order.at(-1),'tabs','clamped to the end');
 const off=toggleSection(start,'bookmarks');
 assert.equal(sectionShown(off,'bookmarks'),false);
 assert.equal(sectionShown(toggleSection(off,'bookmarks'),'bookmarks'),true);
});
