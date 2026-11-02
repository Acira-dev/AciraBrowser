'use strict';
// The first run's "Imported … · Undo" toast: a toast may carry exactly one kind of command (import.undo with batch ids),
// and import.undo itself only takes a short list of batch ids. Main reverts the batches with the importer.
const test=require('node:test');const assert=require('node:assert/strict');
const {validateAction}=require('../desktop/validation.cjs');
const snapshot={tabs:[],tabGroups:[],browserProfiles:[]};

test('a toast can offer Undo for an import',()=>{
 const action={type:'toast',text:'Imported 47 bookmarks from Chrome',action:{label:'Undo',command:{type:'import.undo',batchIds:['batch-1']}}};
 assert.deepEqual(validateAction(action,snapshot),action);
 assert.doesNotThrow(()=>validateAction({type:'toast',text:'Import undone'},snapshot));
});

test('toast actions are limited to import undo',()=>{
 assert.throws(()=>validateAction({type:'toast',text:'x',action:{label:'Undo',command:{type:'tab.close',id:'t'}}},snapshot));
 assert.throws(()=>validateAction({type:'toast',text:'x',action:{label:'Undo',command:{type:'import.undo'}}},snapshot));
});

test('import.undo takes a short list of batch ids',()=>{
 assert.doesNotThrow(()=>validateAction({type:'import.undo',batchIds:['a','b']},snapshot));
 assert.throws(()=>validateAction({type:'import.undo',batchIds:'a'},snapshot));
 assert.throws(()=>validateAction({type:'import.undo',batchIds:Array.from({length:21},(_,i)=>'b'+i)},snapshot));
});
