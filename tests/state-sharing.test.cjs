'use strict';
// The reducer shares the history list (the big one: 20000 visits cost 20 ms to clone, on every action and page event) with the state it came from: an action
// that does not touch it costs nothing for it, and one that does must replace the list, never edit it in place (the old state is still in use).
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createInitialState,reduceBrowser}=require('../desktop/runtime.cjs');
function seeded(){
  let s=createInitialState();
  for(let i=0;i<4;i++)s=reduceBrowser(s,{type:'tab.new',url:`https://site${i}.example/page`});
  s=reduceBrowser(s,{type:'bookmark.folder',title:'Work',parentId:null});
  const folder=s.bookmarkNodes.find(b=>!b.url);
  for(let i=0;i<5;i++)s=reduceBrowser(s,{type:'bookmark.add',url:`https://bm${i}.example/`,title:`Bookmark ${i}`,parentId:i%2?folder.id:null,index:0});
  s=structuredClone(s);
  s.browsingHistory=Array.from({length:60},(_,i)=>({id:'v'+i,url:`https://site${i%7}.example/p${i}`,title:'Title '+i,time:'12:'+String(i%60).padStart(2,'0'),profileId:'',visitedAt:Date.now()-i*1000,browserProfileId:s.activeBrowserProfileId}));
  return s;
}
const signature=s=>JSON.stringify([s.browsingHistory,s.bookmarkNodes]);
const corpus=s=>{
  const tab=s.tabs[2],node=s.bookmarkNodes.find(b=>b.url),folder=s.bookmarkNodes.find(b=>!b.url),visit=s.browsingHistory[3];
  return [
    {type:'tab.select',id:s.tabs[1].id},{type:'tab.new',url:'https://new.example/'},{type:'tab.close',id:tab.id},{type:'settings.update',patch:{reducedMotion:true}},
    {type:'browser.event',event:{type:'state',tabId:tab.id,title:'Changed title',url:tab.url,loading:false}},
    {type:'browser.event',event:{type:'state',tabId:tab.id,url:'https://fresh.example/path',title:'Fresh',loading:false}},
    {type:'bookmark.toggle',url:tab.url},{type:'bookmark.toggle',url:node.url},{type:'bookmark.rename',id:node.id,title:'Renamed'},
    {type:'bookmark.add',url:'https://another.example/',title:'Another',parentId:folder.id,index:0},{type:'bookmark.folder',title:'Two',parentId:null},
    {type:'bookmark.move',id:node.id,parentId:folder.id,index:0},{type:'bookmark.remove',id:node.id},{type:'bookmark.clear',id:folder.id},
    {type:'bookmark.restore',nodes:[{id:'bx',url:'https://restore.example/',title:'R',parentId:null,browserProfileId:s.activeBrowserProfileId,position:0,createdAt:1}]},
    {type:'history.remove',id:visit.id},{type:'history.delete',ids:[visit.id,s.browsingHistory[5].id]},{type:'history.clear'},{type:'history.clear',since:Date.now()-5000},
    {type:'history.restore',visits:[{id:'vr',url:'https://r.example/',title:'R',time:'09:00',profileId:'',visitedAt:1,browserProfileId:s.activeBrowserProfileId}]},
    {type:'browser.profile.create',name:'Second'},
  ];
}
test('no action edits the history or bookmark lists of the state it was given',()=>{
  const state=seeded(),before=signature(state);
  for(const action of corpus(state)){
    let next;try{next=reduceBrowser(state,action);}catch(error){assert.fail(action.type+' threw: '+error.message);}
    assert.equal(signature(state),before,`${action.type} edited the previous state's lists in place`);
    assert.ok(next,action.type);
  }
});
test('an action that does not touch the history hands it on by reference (no clone per click)',()=>{
  const state=seeded();
  for(const action of [{type:'tab.select',id:state.tabs[1].id},{type:'settings.update',patch:{reducedMotion:true}},{type:'browser.event',event:{type:'state',tabId:state.tabs[2].id,loading:true,progress:.4}}]){
    const next=reduceBrowser(state,action);
    assert.ok(next!==state,action.type);assert.ok(next.browsingHistory===state.browsingHistory,action.type+': history shared');
  }
});
