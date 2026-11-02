import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);

test('ordinary tab actions still pass the desktop validator',async()=>{
  const {validateAction}=require('../desktop/validation.cjs'),{createInitialState}=await import('../src/runtime/core');
  const s=createInitialState(),id=s.tabs[0].id;
  for(const action of [{type:'tab.select',id},{type:'tab.duplicate',id},{type:'tab.pin',id},{type:'tab.mute',id,muted:true},{type:'tab.new',afterId:id}])
    assert.doesNotThrow(()=>validateAction(action,s),action.type);
});

test('desktop material geometry can update independently of edge input',async()=>{
  const {validateNativeCommand}=require('../desktop/validation.cjs'),{createInitialState}=await import('../src/runtime/core');
  const state=createInitialState(),rect={x:0,y:32,width:240,height:700,radius:8};
  const command={type:'edge',tabId:state.tabs[0].id,material:{regions:[rect,rect,rect],duration:340,reveal:true}};
  // The renderer sends toolbar + sidebar, then every visible pane. A four-pane
  // split must reach the native material host just as a single page does.
  for(const panes of [0,1,2,3,4]){
    const regions=Array.from({length:2+panes},(_,i)=>({...rect,x:i*240}));
    const split={...command,material:{...command.material,regions}};
    assert.deepEqual(validateNativeCommand(split,state),split,`${panes} page cut-outs`);
  }
  for(const material of [
    {...command.material,regions:[]},
    {...command.material,regions:[rect]},
    {...command.material,regions:Array(7).fill(rect)},
    {...command.material,regions:[{...rect,width:Infinity},rect]},
    {...command.material,regions:[rect,rect,rect,rect,{...rect,x:NaN}]},
    {...command.material,regions:[rect,rect,rect,rect,{...rect,unsupported:true}]},
    {...command.material,duration:-1},
    {...command.material,reveal:'yes'},
  ])assert.throws(()=>validateNativeCommand({...command,material},state));
});
