'use strict';
// How Acira's own pages are drawn at a page zoom. They live in the interface's renderer, so a wrapper (.page-zoom-content) uses CSS `zoom`
// (the standardized property of Chromium 128+): a percentage is a share of the container whatever the zoom. The wrapper is therefore
// 100% of the pane and the page is laid out in (pane / zoom) CSS pixels, as Chromium lays out a website. Dividing by the zoom as well
// (the old width: calc(100% / zoom)) drew the page in the pane's corner at every zoom but 100%. Viewport units are not divided by the
// zoom, so the pages use --pz-vw / --pz-vh, which are 1vw / 1vh at 100% and shrink with the zoom like a website's.
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const css=file=>read(file).replace(/\/\*[^]*?\*\//g,'');

test('the page wrapper fills the pane and lets zoom do the scaling',()=>{
 const rule=css('src/styles/toolbar-controls.css').match(/\.page-pane>\.page-zoom-content\{([^}]*)\}/);
 assert.ok(rule,'the wrapper rule exists');
 const body=rule[1].replace(/\s+/g,'');
 assert.match(body,/zoom:var\(--page-zoom,1\)/);
 assert.match(body,/width:100%;height:100%;min-height:100%/,'a percentage is not scaled by the zoom: the box is the pane');
 assert.doesNotMatch(body,/calc\(100%\/var\(--page-zoom/,'the old divide-by-zoom drew the page in a corner');
 assert.match(body,/--pz-vw:calc\(1vw\/var\(--page-zoom,1\)\)/);assert.match(body,/--pz-vh:calc\(1vh\/var\(--page-zoom,1\)\)/);
});

test('the pages\' viewport units follow the page zoom (--pz-vw / --pz-vh) instead of the window',()=>{
 const files=['src/features/tor/tor.css','src/features/newtab/private-new-tab.css','src/styles/error-page.css','src/styles/new-tab-page.css','src/features/library.css','src/features/rewind/rewind.css','src/features/settings/settings.css','src/components/setting-info.css'];
 for(const file of files){
  const raw=css(file).replace(/var\(--pz-v[wh],\s*1v[wh]\)/g,'').match(/[\d.]+(?:vw|vh|dvh|dvw|svh|svw)\b/g)||[];
  assert.deepEqual(raw,[],`${file} uses a viewport unit the zoom would not divide`);
  assert.match(css(file),/var\(--pz-v[wh],\s*1v[wh]\)/,`${file} keeps its viewport rule through --pz-*`);
 }
});
