const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');const {closeOwnedWindow}=require('../desktop/owned-window-close.cjs');
class Window extends EventEmitter{constructor(){super();this.webContents=new EventEmitter();this.destroyed=false;this.beforeUnload=true;}isDestroyed(){return this.destroyed;}close(){const event={defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};this.emit('close',event);if(event.defaultPrevented)return;if(this.beforeUnload){const prevented={allowed:false,preventDefault(){this.allowed=true;}};this.webContents.emit('will-prevent-unload',prevented);if(!prevented.allowed)return;}this.destroyed=true;this.emit('closed');}}
test('Stay keeps the owned window alive, then a separate Leave closes it; temporary listeners are removed',async()=>{const window=new Window();assert.equal(await closeOwnedWindow(window,()=>false),false);assert.equal(window.isDestroyed(),false);assert.equal(window.listenerCount('close'),0);assert.equal(window.webContents.listenerCount('will-prevent-unload'),0);assert.equal(await closeOwnedWindow(window,()=>true),true);assert.equal(window.isDestroyed(),true);});
test('a native close-event cancellation is preserved without removing its listener',async()=>{const window=new Window(),keep=event=>event.preventDefault();window.on('close',keep);assert.equal(await closeOwnedWindow(window,()=>true),false);assert.equal(window.isDestroyed(),false);assert.equal(window.listenerCount('close'),1);window.removeListener('close',keep);window.beforeUnload=false;assert.equal(await closeOwnedWindow(window,()=>{throw Error('No dialog expected');}),true);});

test('a question that answers later keeps the browser running, and Leave closes the window with its prompt waived',async()=>{
  const window=new Window();window.beforeUnload=true;let answer,asked=0;
  const closing=closeOwnedWindow(window,()=>{asked++;return new Promise(resolve=>{answer=resolve;});});
  assert.equal(window.isDestroyed(),false,'the page stays while the question is open');assert.equal(asked,1);
  answer(true);assert.equal(await closing,true);assert.equal(window.isDestroyed(),true);
  assert.equal(window.listenerCount('close'),0);assert.equal(window.webContents.listenerCount('will-prevent-unload'),0);
});

test('Stay on a question that answers later keeps the window',async()=>{
  const window=new Window();window.beforeUnload=true;let answer;
  const closing=closeOwnedWindow(window,()=>new Promise(resolve=>{answer=resolve;}));
  answer(false);assert.equal(await closing,false);assert.equal(window.isDestroyed(),false);assert.equal(window.webContents.listenerCount('will-prevent-unload'),0);
});

test('a second prompt while the question is open asks nothing more, and a question that fails is Stay',async()=>{
  const window=new Window();window.beforeUnload=true;let asked=0,answer;
  const closing=closeOwnedWindow(window,()=>{asked++;return new Promise(resolve=>{answer=resolve;});});
  window.webContents.emit('will-prevent-unload',{preventDefault(){}});assert.equal(asked,1);
  answer(false);assert.equal(await closing,false);
  const failing=new Window();failing.beforeUnload=true;
  assert.equal(await closeOwnedWindow(failing,()=>Promise.reject(new Error('no sheet'))),false);assert.equal(failing.isDestroyed(),false);
});
