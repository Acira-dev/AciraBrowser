'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createMacMenuRouter,macMenuTemplate}=require('../desktop/platform.cjs');
function fixture(){
 const controllers=new Set(),events=[];
 const add=(id,focused=false)=>{const window={destroyed:false,focused,isDestroyed(){return this.destroyed;},isFocused(){return this.focused;}},popup={};const c={window,popup,closing:false,ownsMenuWindow:w=>w===window||w===popup,runMenu:command=>events.push([id,command.action])};controllers.add(c);return c;};
 const normal=add('normal',true),privateWindow=add('private');
 const run=createMacMenuRouter({getControllers:()=>controllers,getFallback:()=>normal,quit:()=>events.push(['app','quit'])});
 return {controllers,events,add,normal,privateWindow,run};
}
test('Mac menu follows the surviving window after a newer private window closes',()=>{
 const f=fixture(),menu=macMenuTemplate(f.run),file=menu.find(m=>m.label==='File');
 f.privateWindow.window.focused=true;f.normal.window.focused=false;
 file.submenu[0].click(null,f.privateWindow.window);assert.deepEqual(f.events.pop(),['private','new-tab']);
 f.privateWindow.window.destroyed=true;f.controllers.delete(f.privateWindow);f.normal.window.focused=true;
 file.submenu[0].click(null,f.privateWindow.window);assert.deepEqual(f.events.pop(),['normal','new-tab']);
 menu[0].submenu.at(-1).click(null,f.privateWindow.window);assert.deepEqual(f.events.pop(),['app','quit']);
});
test('Mac menu respects an auxiliary window owner and skips retiring controllers',()=>{
 const f=fixture();f.run({action:'close-tab'},null,f.privateWindow.popup);assert.deepEqual(f.events.pop(),['private','close-tab']);
 f.privateWindow.closing=true;f.run({action:'settings'},null,f.privateWindow.window);assert.deepEqual(f.events.pop(),['normal','settings']);
});
test('Quit works without any live browser window; ordinary commands can create a fallback',()=>{
 const f=fixture();f.controllers.clear();f.run({action:'quit'});assert.deepEqual(f.events.pop(),['app','quit']);f.run({action:'new-window'});assert.deepEqual(f.events.pop(),['normal','new-window']);
});
test('the View menu names the window view its Command+Shift+F item switches to (Focus, not Compact)',()=>{
 const seen=[],view=macMenuTemplate(command=>seen.push(command.action)).find(menu=>menu.label==='View'),item=view.submenu.find(entry=>entry.accelerator==='Command+Shift+F');
 assert.equal(item.label,'Focus View');item.click(item,null,{});assert.deepEqual(seen,['focus-mode']);
});
