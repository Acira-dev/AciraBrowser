import test from 'node:test';
import assert from 'node:assert/strict';
import { PROFILE_PALETTE,isGreyProfileColor,profileColorFor } from '../src/runtime/profileColors';
import { normalizeBrowserProfiles } from '../src/runtime/browserProfiles';

const luminance=(hex:string)=>{const n=parseInt(hex.slice(1),16),c=(v:number)=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)};return .2126*c(n>>16&255)+.7152*c(n>>8&255)+.0722*c(n&255);};

// Founder (31 Oct): a profile circle was grey because new and default profiles were hardcoded #62666d.
test('every palette colour is colourful and keeps a white initial above 4.5:1',()=>{
 for(const {value} of PROFILE_PALETTE){
  assert.equal(isGreyProfileColor(value),false,value);
  assert.ok(1.05/(luminance(value)+.05)>=4.5,value);
 }
});

test('grey and missing colours become a stable palette colour; chosen colours stay',()=>{
 const rows=[
  {id:'a',name:'A',color:'#62666d',partition:'persist:a'},
  {id:'b',name:'B',color:'#6b7280',partition:'persist:b'},
  {id:'c',name:'C',partition:'persist:c'},
  {id:'d',name:'D',color:'#2f6fde',partition:'persist:d'},
 ];
 const first=normalizeBrowserProfiles(rows,[]),again=normalizeBrowserProfiles(rows,[]);
 assert.deepEqual(first.map(p=>p.color),again.map(p=>p.color));
 assert.equal(first[3].color,'#2f6fde');
 for(const p of first)assert.equal(isGreyProfileColor(p.color),false,p.id);
 assert.equal(new Set(first.map(p=>p.color)).size,4);
});

test('profileColorFor skips colours already in use',()=>{
 const taken=PROFILE_PALETTE.slice(0,7).map(item=>item.value);
 assert.equal(profileColorFor('x',taken),PROFILE_PALETTE[7].value);
});
