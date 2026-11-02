'use strict';
// A tab's page gets a 'destroyed' and a 'did-start-navigation' listener from every subsystem that watches it (popup gate, page output, the
// right-click menu's frame lifetime, the close path ...). One more than Node's default limit of 10 printed a MaxListenersExceededWarning in
// the log after an ordinary right-click or a close; the page's contents now allow for them.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const main=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8');

test('every tab page raises its listener limit before the subsystems attach',()=>{
 const at=main.indexOf('wc.setMaxListeners(');
 assert.ok(at>0,'ensurePage sets a listener limit on the page contents');
 assert.ok(at<main.indexOf('popupGate.attach(wc);'),'the limit is set before the first watchers attach');
 assert.ok(Number(/wc\.setMaxListeners\((\d+)\)/.exec(main)[1])>=24,'room for the watchers and for the ones added on demand');
});
