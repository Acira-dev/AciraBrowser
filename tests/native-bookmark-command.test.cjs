'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
// Exercise the product's exact native command case without launching Electron or replacing its handler.
const main=fs.readFileSync(require.resolve('../desktop/main.cjs'),'utf8'),start=main.indexOf(" case 'bookmark':"),end=main.indexOf(" case 'bookmark-all':",start);
assert.ok(start>=0&&end>start,'native bookmark command is present');
const command=new Function('state','active','dispatch','ui',`switch('bookmark'){${main.slice(start,end)}}`);
function fixture({saved=false,privacy,privateProfile=false,url='https://fixture.example/',refuse=false}={}){
 const active={id:'tab-fixture',browserProfileId:'profile-fixture',url,...(privacy?{privacy}:{})},state={browserProfiles:[{id:active.browserProfileId,private:privateProfile}],bookmarkNodes:saved?[{id:'saved',browserProfileId:active.browserProfileId,url}]:[]},events=[];
 const run=()=>command(state,active,action=>{events.push('save');assert.deepEqual(action,{type:'bookmark.toggle',url});if(!refuse)state.bookmarkNodes.push({id:'new',browserProfileId:active.browserProfileId,url,...(privacy==='tor'?{tor:true}:{})});},kind=>{assert.equal(kind,'bookmark-edit');assert.ok(state.bookmarkNodes.some(node=>node.browserProfileId===active.browserProfileId&&node.url===url),'actual bookmark must exist before opening editor');events.push('edit');});
 return {state,events,run};
}
test('native Ctrl+D saves before editing and repeated invocation keeps the saved record',()=>{
 const value=fixture();value.run();assert.deepEqual(value.events,['save','edit']);value.events.length=0;value.run();assert.deepEqual(value.events,['edit']);assert.equal(value.state.bookmarkNodes.length,1);
});
test('a bookmark in a different profile does not substitute for the current profile record',()=>{
 const value=fixture();value.state.bookmarkNodes.push({id:'other',browserProfileId:'other-profile',url:'https://fixture.example/'});value.run();assert.deepEqual(value.events,['save','edit']);assert.equal(value.state.bookmarkNodes.length,2);
});
test('native bookmark refuses unsupported/internal/private targets and does not open an editor on rejected save',()=>{
 for(const choice of [{url:'acira://new'},{url:'file:///fixture.txt'},{privacy:'private'},{privacy:'tor',privateProfile:true},{privateProfile:true}]){const value=fixture(choice);value.run();assert.deepEqual(value.events,[],JSON.stringify(choice));}
 const value=fixture({refuse:true});value.run();assert.deepEqual(value.events,['save'],'no editor if lifecycle or persistence boundary refused saving');
});
test('a Tor tab saves its own Tor bookmark; the ordinary bookmark of the same page does not stand in for it',()=>{
 const value=fixture({privacy:'tor'});value.state.bookmarkNodes.push({id:'ordinary',browserProfileId:'profile-fixture',url:'https://fixture.example/'});
 value.run();assert.deepEqual(value.events,['save','edit']);assert.ok(value.state.bookmarkNodes.some(node=>node.id==='new'&&node.tor));
 value.events.length=0;value.run();assert.deepEqual(value.events,['edit'],'a second Ctrl+D opens the saved Tor bookmark');
});
