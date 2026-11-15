'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createPageParking}=require('../desktop/page-parking.cjs');
class View{
 constructor(){this.bounds={x:12,y:40,width:900,height:600};this.webContents={isDestroyed:()=>false};this.moves=[];}
 getBounds(){return {...this.bounds};}
 setBounds(bounds){this.bounds={...bounds};this.moves.push(this.bounds);}
}
const page=()=>({view:new View()});

test('parking keeps the viewport live off-window and releases to the latest layout once',()=>{
 const parking=createPageParking(),entry=page(),original=entry.view.getBounds();
 assert.equal(parking.park(entry),true);assert.equal(entry.view.bounds.x,-original.width-64);
 assert.deepEqual(entry.view.getBounds(),original,'layout sees its requested location, not parking');
 const target={x:250,y:40,width:850,height:600};entry.view.setBounds(target);
 assert.equal(entry.view.bounds.width,original.width,'pending layout does not reflow the parked page');
 assert.equal(parking.park(entry),true);assert.equal(entry.view.moves.length,1,'a repeated park cannot capture its own override');
 parking.release();assert.deepEqual(entry.view.bounds,target);assert.equal(entry.view.moves.length,2);
 assert.equal(Object.hasOwn(entry.view,'setBounds'),false);assert.equal(Object.hasOwn(entry.view,'getBounds'),false);
 parking.release();assert.equal(entry.view.moves.length,2);
});

for(const closed of ['missing','destroyed'])test(`a ${closed} first pane cannot strand a later live page off-window`,()=>{
 const parking=createPageParking(),first=page(),next=page(),target={x:420,y:40,width:430,height:600};
 parking.park(first);parking.park(next);next.view.setBounds(target);
 if(closed==='missing')first.view.webContents=undefined;else first.view.webContents.isDestroyed=()=>true;
 assert.doesNotThrow(()=>parking.release());assert.deepEqual(next.view.bounds,target);
 for(const entry of [first,next]){assert.equal(Object.hasOwn(entry.view,'setBounds'),false);assert.equal(Object.hasOwn(entry.view,'getBounds'),false);}
 assert.equal(first.view.moves.length,1,'closed native views are not placed again');
});

test('detaching a parked page clears its override before adoption or a later release',()=>{
 const parking=createPageParking(),entry=page(),target={x:30,y:50,width:600,height:500};parking.park(entry);entry.view.setBounds(target);
 assert.equal(parking.forget(entry),true);assert.deepEqual(entry.view.bounds,target);
 entry.view.webContents=undefined;assert.doesNotThrow(()=>parking.release());
 assert.equal(parking.park(entry),false);assert.equal(parking.park(undefined),false);
});

test('page-owned placement methods retain their original descriptors after parking',()=>{
 const parking=createPageParking(),entry=page();entry.view.setBounds=function(bounds){View.prototype.setBounds.call(this,bounds);};
 const original=Object.getOwnPropertyDescriptor(entry.view,'setBounds');parking.park(entry);parking.release();
 assert.deepEqual(Object.getOwnPropertyDescriptor(entry.view,'setBounds'),original);
});

// 13.10 (laptop, 15 Nov: after an unfocused reveal the page stayed at {0,72,1280x608} under an empty dark band, 13 of 24 launches, until a resize): the release put the page where the last swallowed call said,
// which is not always where the last layout says (a rectangle asked for by something else while the page was parked). It lands on the last layout's rectangle.
test('the release lands on the last layout\'s rectangle, not on a stray one asked for while the page was parked',()=>{
 const parking=createPageParking(),entry=page(),card={x:6,y:6,width:1268,height:668};
 parking.park(entry);
 entry.view.setBounds(card);entry.targetBounds=card;            // the layout the interface sent
 entry.view.setBounds({x:0,y:72,width:1280,height:608});         // something else asked for the Full geometry while parked (no layout behind it)
 parking.release();
 assert.deepEqual(entry.view.bounds,card,'the page is where the layout put it');
});

test('while a glide of the page is running the release keeps the glide\'s own rectangle (the glide goes on to its end by itself)',()=>{
 const parking=createPageParking(),entry=page(),mid={x:120,y:6,width:1100,height:668};
 parking.park(entry);
 entry.targetBounds={x:240,y:6,width:1034,height:668};entry.boundsTimer={};entry.view.setBounds(mid);
 parking.release();
 assert.deepEqual(entry.view.bounds,mid,'not pulled to the glide\'s end early');
});

test('a page the caller says is not settled (HTML fullscreen) keeps what it was parked at',()=>{
 const parking=createPageParking({settled:()=>false}),entry=page(),full={x:0,y:0,width:1280,height:800};
 parking.park(entry);entry.targetBounds={x:6,y:6,width:1268,height:668};entry.view.setBounds(full);
 parking.release();
 assert.deepEqual(entry.view.bounds,full);
});

test('a differing release is logged when a log is given (ACIRA_EDGE_TRACE) and silent otherwise',()=>{
 const lines=[],parking=createPageParking({log:(...parts)=>lines.push(parts.join(' '))}),entry=page(),card={x:6,y:6,width:1268,height:668};
 parking.park(entry);entry.targetBounds=card;entry.view.setBounds({x:0,y:72,width:1280,height:608});parking.release();
 assert.equal(lines.length,1);assert.match(lines[0],/parked at .*"y":72.*the last layout says .*"y":6/);
 const quiet=createPageParking({log:(...parts)=>lines.push(parts.join(' '))}),same=page();
 quiet.park(same);same.targetBounds=card;same.view.setBounds(card);quiet.release();
 assert.equal(lines.length,1,'no line when the two agree');
});
