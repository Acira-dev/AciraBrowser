'use strict';
// Regression: "Make it yours" mounts a host <div> into `.app`, which is a CSS grid. An in-flow host became an implicit
// second grid row and squeezed `.browser-root` to about half the window; the acrylic window showed the desktop below.
// The host must stay out of flow. The live check is qa/h-setup-viewport.mjs (measures the real window after setup).
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const css=fs.readFileSync(path.join(__dirname,'../src/features/onboarding/onboarding.css'),'utf8');
const source=fs.readFileSync(path.join(__dirname,'../src/features/onboarding/MakeItYours.tsx'),'utf8');

test('the Make it yours host is out of the .app grid flow',()=>{
 assert.match(source,/host\.className = "fr-yours-host"/,'host class is what the rule targets');
 const rule=/\.fr-yours-host\s*\{([^}]*)\}/.exec(css);
 assert.ok(rule,'onboarding.css styles .fr-yours-host');
 // Fixed or absolute both take a grid child out of flow, so neither creates an implicit row.
 assert.match(rule[1],/position:\s*(fixed|absolute)/);
});

test('the panel title takes focus over the new tab\'s empty address field, and only text the person typed keeps it',()=>{
 // After setup the browser lands on a new tab whose address field already holds focus. The check used to treat any focused field as
 // "the person is typing", so the panel never took focus: a screen reader never announced it and Tab walked the whole browser first.
 const focus=/const active = document\.activeElement as HTMLElement \| null;[\s\S]{0,400}?title\.current\?\.focus/.exec(source);
 assert.ok(focus,'the focus effect is in place');
 assert.match(focus[0],/\(active as HTMLInputElement\)\.value \?\? active\.textContent \?\? ""\) !== ""\) return;/,'a field only keeps focus when it holds text');
});
