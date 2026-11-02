'use strict';
// A New tab closed within a few milliseconds (Cmd+T then Cmd+W) left the interface asking for the extension toolbar target of a tab main had just
// removed. The handler threw, Electron logged "Error occurred in handler for 'acira:service'" every time, and the interface only ignored the failure.
// A closed tab has no target: the answer is none (the interface already treats that as "no buttons").
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const main = fs.readFileSync(path.join(__dirname, '../desktop/main.cjs'), 'utf8');

test('the extension toolbar target of a tab that is already closed is none, not an error', () => {
  const at = main.indexOf("case 'extensions.toolbar-target':");
  assert.ok(at > 0);
  const handler = main.slice(at, at + 400);
  assert.ok(handler.includes("if(!tab)return {extensionToolbar:null};"));
  assert.ok(!handler.includes("throw new Error('Unknown toolbar target')"));
});
