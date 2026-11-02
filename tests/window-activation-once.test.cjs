'use strict';
// main.cjs opens every window through the same function and asks composition.cjs to track window activation each time. The listeners it
// installs are app-wide, so a second install must add nothing: before, each extra window put one more dom-ready handler on every page and one
// more nativeTheme listener that was never removed (MaxListenersExceededWarning from the 11th window opened in a session).
const test = require('node:test'), assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {trackWindowActivation} = require('../desktop/composition.cjs');

test('tracking window activation installs its app-wide listeners once however many windows ask', () => {
  const app = new EventEmitter();
  let ready = 0;
  app.whenReady = () => { ready += 1; return new Promise(() => {}); };
  for (let window = 0; window < 12; window += 1) trackWindowActivation(app);
  assert.equal(app.listenerCount('web-contents-created'), 1);
  assert.equal(ready, 1);
});
