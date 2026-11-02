import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {setToastActive} from '../src/ui/toastActive';
const read=(file:string)=>fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)),'..',file),'utf8');

// R4 leftovers (RESPONSIVE_QA.md "Routed"): three small layout fixes found by the responsive sweep.
test('a sidebar group name stops where the hover "+" starts, so a long name never runs under the button',()=>{
 const css=read('src/components/sidebar/sidebar.css');
 assert.match(css,/\.sb-group:has\(>\.sb-header-add\)>\.sb-group-header>\.sb-group-name\{margin-right:calc\(var\(--sb-add-right\) \+ var\(--tab-control,20px\) - 30px\)\}/);
 // 30px is what the header already keeps at its right end: padding 6 + chevron 12 + its margin 4 + the 8px gap.
 assert.match(css,/\.sb-group>\.sb-group-header\{[^}]*gap:8px[^}]*padding:0 6px/);
 assert.match(css,/\.sb-group-header>svg\{flex:none;margin-right:4px/);
});

test('a new tab tile label may use the tile padding, so "All history" fits at 150%',()=>{
 const css=read('src/styles/new-tab-page.css');
 assert.match(css,/\.nt-tile-label \{ display: block; width: calc\(100% \+ 8px\); margin-inline: -4px;/);
 assert.match(css,/\.nt-tile \{[^}]*padding: 6px;/, 'the tile keeps 6px of padding, so the label still has 2px to spare on each side');
});

test('a list page makes room under its last row while a toast shows',()=>{
 assert.match(read('src/features/library.css'),/\.lib\[data-toast\] \{ padding-bottom: 152px; \}/);
 assert.match(read('src/features/Library.tsx'),/data-toast=\{toastShowing \|\| undefined\}/);
 assert.match(read('src/App.tsx'),/setToastActive\(toasts\.length > 0\)/);
 assert.doesNotThrow(()=>{setToastActive(true);setToastActive(true);setToastActive(false);});
});

test('the responsive scan allows the hover "+" over its own group header only while the name clears it',()=>{
 const scan=read('qa/r4-responsive-scan.js');
 assert.match(scan,/addOverOwnHeader\(a\.e, b\.e\) \|\| addOverOwnHeader\(b\.e, a\.e\)/);
 assert.match(scan,/name\.getBoundingClientRect\(\)\.right <= add\.getBoundingClientRect\(\)\.left \+ 0\.5/);
});
