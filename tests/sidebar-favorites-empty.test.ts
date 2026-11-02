import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {favoritesSeparator,favoritesTop} from '../src/components/sidebar/favoritesTop';
const read=(file:string)=>fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)),'..',file),'utf8');

// R4 leftovers: a fresh profile's sidebar shows no empty boxes above New tab.
test('with no favorites the top of the sidebar draws nothing, until a tab or link is dragged',()=>{
 assert.equal(favoritesTop({hidden:false,count:0}),'idle','nothing drawn at rest');
 assert.equal(favoritesTop({hidden:false,count:0,tabDrag:true}),'drop','a tab being dragged');
 assert.equal(favoritesTop({hidden:false,count:0,linkDrag:true}),'drop','a link being dragged');
 assert.equal(favoritesTop({hidden:false,count:0,overZone:true}),'drop','a drag over the zone keeps it');
 assert.equal(favoritesTop({hidden:false,count:0,tabDrag:false,linkDrag:false,overZone:false}),'idle','the drag ended: gone again');
});

test('favorites switched off or present decide before any drag does',()=>{
 assert.equal(favoritesTop({hidden:true,count:0,tabDrag:true}),'none');
 assert.equal(favoritesTop({hidden:true,count:3}),'none');
 assert.equal(favoritesTop({hidden:false,count:1}),'grid');
 assert.equal(favoritesTop({hidden:false,count:5,tabDrag:true}),'grid','the grid shows its own drop slots');
 assert.equal(favoritesTop({hidden:false,count:0,editingNew:true}),'grid','the Add editor needs the grid');
});

test('the hairline under Favorites exists only when there is a grid above it',()=>{
 assert.equal(favoritesSeparator(0),false);assert.equal(favoritesSeparator(1),true);assert.equal(favoritesSeparator(12),true);
});

test('the sidebar draws no placeholder tiles at rest, floats the zone over the list while dragging, and keeps one place in the tree',()=>{
 const code=read('src/components/sidebar/AciraSidebar.tsx'),css=read('src/components/sidebar/sidebar.css');
 assert.match(code,/if\(top==='idle'\)return null;/,'no tiles, no sentence at rest');
 assert.match(code,/if\(top==='drop'\)\{/);
 assert.doesNotMatch(code,/\[0,1,2\]\.map\(index=><button/,'the dashed placeholder buttons are gone');
 assert.match(code,/favoritesSeparator\(favorites\.apps\.length\)&&<div className="sb-sep"/);
 assert.match(code,/className="sb-caption" data-filled=/);
 assert.match(css,/\.sb-caption\[data-filled\]\{display:contents\}/);
 assert.match(css,/\.sb-apps-region\.sb-apps-float\{position:absolute;/,'floating, so rows do not move under the pointer');
 assert.match(css,/var\(--motion-scale,1\)/,'the entrance reads the global motion speed');
 assert.match(css,/\[data-reduced-motion\] \.sb-apps-region\.sb-apps-float\{animation:none\}/);
});
