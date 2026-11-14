'use strict';
// Build-time CSS transforms (vite reads this file): rightmost :is() lists become plain selectors with the same specificity, so Blink can bucket them (scripts/postcss-flatten-is.cjs).
module.exports = { plugins: [require('./scripts/postcss-flatten-is.cjs')()] };
