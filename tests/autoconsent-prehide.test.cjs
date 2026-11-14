'use strict';
// A speed pass: autoconsent's prehide wrote its rule with `styleEl.innerText += rule`, and reading innerText forces the page's style and layout. In Acira's preload the
// library starts before the document exists, so the prehide ran at DOMContentLoaded and every page paid one forced full layout there (6 ms on a large page). The preload
// replaces the library's DomActions.prehide with the same rule written through textContent. These tests pin it to the library's own rule, element and return value.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const entry = fs.readFileSync(path.join(root, 'desktop/browser-services/autoconsent-preload-entry.cjs'), 'utf8');
const library = fs.readFileSync(require.resolve('@duckduckgo/autoconsent', {paths: [root]}), 'utf8');
const override = entry.slice(entry.indexOf('consent.domActions.prehide=function'), entry.indexOf('};', entry.indexOf('consent.domActions.prehide=function')) + 2);

test('the library still prehides the way the override copies: one <style id="autoconsent-prehide">, the opacity rule, undone by removing that element', () => {
  assert.match(library, /prehide\(selector\) \{\s*const styleEl = getStyleElement\("autoconsent-prehide"\);[\s\S]{0,200}return hideElements\(styleEl, selector, "opacity"\);/);
  assert.match(library, /const rule = `\$\{selector\} \{ \$\{getHidingStyle\(method\)\} \} `;/);
  assert.match(library, /const hidingSnippet = method === "opacity" \? `opacity: 0` : `display: none`;\s*return `\$\{hidingSnippet\} !important; z-index: -1 !important; pointer-events: none !important;`;/);
  assert.match(library, /undoPrehide\(\) \{\s*const existingElement = getStyleElement\("autoconsent-prehide"\);[\s\S]{0,200}existingElement\.remove\(\);/);
  assert.match(library, /return selector\.length > 0;/);
});

test('the override writes that rule through textContent and reads nothing from layout', () => {
  assert.ok(override.length > 100, 'the override is in the preload');
  assert.doesNotMatch(override, /innerText|offset|getBoundingClientRect|getComputedStyle/);
  assert.match(override, /textContent\+=`\$\{selector\} \{ opacity: 0 !important; z-index: -1 !important; pointer-events: none !important; \} `/);
  // installed right after the instance exists, before DOMContentLoaded (when the library calls it)
  assert.ok(entry.indexOf('consent.domActions.prehide=function') > entry.indexOf('consent=new AutoConsent('));
});

test('the override builds the same element and text as the library, on a page with and without a head', () => {
  for (const withHead of [true, false]) {
    const made = [];
    class HTMLStyleElement { constructor() { this.id = ''; this.textContent = ''; } }
    const head = {appendChild: el => made.push(['head', el])}, html = {appendChild: el => made.push(['html', el])};
    const document = {head: withHead ? head : null, documentElement: html, getElementsByTagName: () => [], createElement: () => new HTMLStyleElement(),
      querySelector: sel => made.map(m => m[1]).find(el => sel === 'style#' + el.id) || null};
    const consent = {domActions: {prehide: () => { throw new Error('the library one'); }}};
    vm.runInNewContext('if(consent&&consent.domActions&&typeof consent.domActions.prehide===\'function\')' + override, {consent, document, HTMLStyleElement});
    assert.equal(consent.domActions.prehide('#a,.b'), true);
    assert.equal(consent.domActions.prehide(''), false);
    assert.equal(made.length, 1, 'one element, reused');
    assert.equal(made[0][0], withHead ? 'head' : 'html');
    assert.equal(made[0][1].id, 'autoconsent-prehide');
    assert.equal(made[0][1].textContent, '#a,.b { opacity: 0 !important; z-index: -1 !important; pointer-events: none !important; }  { opacity: 0 !important; z-index: -1 !important; pointer-events: none !important; } ');
  }
});
