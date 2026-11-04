'use strict';
// Test-only preload for tests/privacy-plus-ai-early.test.cjs (cases with `probe`): counts the animation frames, style reads and layout reads (element boxes) the app's frame script asks for,
// lets the runner say the tab was hidden or shown again, then runs the real content-filter-preload.cjs in the same isolated world. Needs sandbox: false (require).
const { contextBridge } = require('electron');
const counts = { frames: 0, styles: 0, rects: 0 }; let visibility = 'visible';
const frame = window.requestAnimationFrame.bind(window), style = window.getComputedStyle.bind(window);
window.requestAnimationFrame = callback => { counts.frames++; return frame(callback); };
window.getComputedStyle = (...args) => { counts.styles++; return style(...args); };
const rect = Element.prototype.getBoundingClientRect;
Element.prototype.getBoundingClientRect = function () { counts.rects++; return rect.call(this); };
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
contextBridge.exposeInMainWorld('__aciraProbe', {
  reset: () => { counts.frames = 0; counts.styles = 0; counts.rects = 0; },
  read: () => ({ ...counts }),
  visibility: state => { visibility = state; document.dispatchEvent(new Event('visibilitychange')); }
});
require('../../../desktop/browser-services/content-filter-preload.cjs');
