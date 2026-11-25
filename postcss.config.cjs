'use strict';
// Build-time CSS transforms (vite reads this file):
// 1. a :has() on <html>, <body> or .app becomes a test of an attribute the interface mirrors on <html> (scripts/postcss-root-has.cjs, src/ui/rootMirror.ts);
// 2. rightmost :is() lists become plain selectors with the same specificity, so Blink can bucket them (scripts/postcss-flatten-is.cjs).
module.exports = { plugins: [require('./scripts/postcss-root-has.cjs')(), require('./scripts/postcss-flatten-is.cjs')()] };
