import { newTabChanged } from '../src/features/settings/changed';
import { test } from 'node:test';import assert from 'node:assert/strict';import { readNewTabPreferences, updateNewTabPreferences, undoWorkspaceArtwork, shortcutURL, selectedArtwork, defaultArtwork, artworkCatalog } from '../src/ui/newTabPreferences';
import { artworkCollectionChoice } from '../src/ui/artworkCollections';
const storage=new Map<string,string>();Object.assign(globalThis,{localStorage:{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value)},window:new EventTarget()});
test('artwork Undo rejects a changed choice or a different profile',()=>{const first=readNewTabPreferences('undo-A'),hidden=updateNewTabPreferences('undo-A',{modules:{...first.modules,artwork:false}}),undo={profile:'undo-A',privateMode:false,version:hidden.version};assert.equal(undoWorkspaceArtwork(undo,'undo-B'),false);updateNewTabPreferences('undo-A',{artwork:'peaks'});assert.equal(undoWorkspaceArtwork(undo,'undo-A'),false);assert.equal(readNewTabPreferences('undo-A').modules.artwork,false);const current=readNewTabPreferences('undo-A');assert.equal(undoWorkspaceArtwork({...undo,version:current.version},'undo-A'),true);});
test('private presentation and shortcuts never write persistent storage',()=>{const before=storage.size;updateNewTabPreferences('private-unit',{modules:{...readNewTabPreferences('private-unit',true).modules,search:false},shortcuts:[{id:'actual',title:'Actual',url:'https://example.org/path',start:true,sidebar:true}]},true);assert.equal(storage.size,before);assert.equal(readNewTabPreferences('private-unit',true).modules.search,false);assert.equal(readNewTabPreferences('private-unit').modules.search,true);assert.deepEqual(readNewTabPreferences('private-unit').shortcuts,[]);});
test('shortcut data accepts bounded plain web URLs and rejects privileged schemes/credentials',()=>{for(const value of ['javascript:alert(1)','file:///C:/private','acira://settings','https://user:secret@example.org','https://example.org/\npath','https://example.org/'+ 'x'.repeat(4096)])assert.equal(shortcutURL(value),null);assert.equal(shortcutURL('https://example.org/path?opaque=1#kept'),'https://example.org/path?opaque=1#kept');});
test('daily collection selection is stable for the local day and manual selection takes precedence',()=>{const preferences=updateNewTabPreferences('daily-unit',{daily:true,artwork:'peaks'}),morning=new Date(2026,9,24,1),evening=new Date(2026,9,24,23);assert.equal(selectedArtwork(preferences,'daily-unit',morning).id,selectedArtwork(preferences,'daily-unit',evening).id);assert.equal(selectedArtwork({...preferences,daily:false},'daily-unit',morning).id,'peaks');assert.notEqual(selectedArtwork(preferences,'daily-unit',new Date(2026,9,25,1)).id,selectedArtwork(preferences,'daily-unit',morning).id);});

test('legacy coast preferences retain their stored choice while resolving to a qualified painting',()=>{const old=updateNewTabPreferences('legacy-artwork',{artwork:'coast'});assert.equal(readNewTabPreferences('legacy-artwork').artwork,'coast');assert.equal(selectedArtwork(old,'legacy-artwork').id,'met-436535');assert.equal(selectedArtwork(old,'legacy-artwork').src,'/artwork/catalog-v2/met-436535.jpg');});

test('manual remote image seed and bounded same-collection exclusion persist together',()=>{
 const chosen=updateNewTabPreferences('remote-manual',{collection:'nature',collectionSeed:'manual-123',collectionExcludeId:'nature:0123456789ab'});
 assert.equal(readNewTabPreferences('remote-manual').collectionSeed,chosen.collectionSeed);
 assert.equal(readNewTabPreferences('remote-manual').collectionExcludeId,chosen.collectionExcludeId);
 assert.equal(updateNewTabPreferences('remote-manual',{collectionExcludeId:'nasa:0123456789ab'}).collectionExcludeId,'');
 assert.equal(updateNewTabPreferences('remote-manual',{collectionExcludeId:'nature:'+'a'.repeat(80)}).collectionExcludeId,'');
 assert.equal(updateNewTabPreferences('remote-manual',{collectionExcludeId:'nature:0123456789ab\n'}).collectionExcludeId,'');
 assert.equal(updateNewTabPreferences('remote-manual',{collectionExcludeId:'nature:0123456789ab',collection:'space'}).collectionExcludeId,'');
});

test('choosing either a remote or built-in collection clears a personal override, preserving other choices',()=>{
 const profile='personal-collection',personal='personal:00000000-0000-4000-8000-000000000001';
 updateNewTabPreferences(profile,{artwork:personal,artStyle:'full',caption:false,daily:true});
 for(const collection of ['nature','built-in'] as const){
  const next=updateNewTabPreferences(profile,{artwork:personal,...artworkCollectionChoice(collection,personal)});
  assert.equal(next.artwork,defaultArtwork);assert.equal(next.collection,collection);assert.equal(next.artStyle,'full');assert.equal(next.caption,false);assert.equal(next.daily,true);
 }
 assert.deepEqual(artworkCollectionChoice('nature','peaks'),{collection:'nature'});
});



test('all bundled artwork choices persist per profile and private choices remain temporary',()=>{
 for(const artwork of artworkCatalog){
  const profile='cover-'+artwork.id;
  updateNewTabPreferences(profile,{artwork:artwork.id,daily:false});
  assert.equal(selectedArtwork(readNewTabPreferences(profile),profile).id,artwork.id);
  const before=storage.size;
  updateNewTabPreferences(profile,{artwork:artwork.id},true);
  assert.equal(storage.size,before);
  assert.equal(readNewTabPreferences('other-'+profile).artwork,defaultArtwork);
 }
});


test('personal cover selection resolves an owned capability and retains its choice when unavailable',()=>{
 const id='12345678-1234-4123-8123-123456789abc',artwork='personal:'+id;
 const personal=[{id,name:'My image',url:'acira-browser-ui://ui/personal-artwork/fixture/'+id,width:1200,height:800,bytes:4000}];
 const prefs=updateNewTabPreferences('personal-cover',{artwork,daily:false});
 assert.equal(selectedArtwork(prefs,'personal-cover',new Date(),personal).src,personal[0].url);
 assert.equal(selectedArtwork(prefs,'personal-cover').id,defaultArtwork);
 assert.equal(readNewTabPreferences('personal-cover').artwork,artwork);
 const before=storage.size;updateNewTabPreferences('private-cover',{artwork},true);
 assert.equal(readNewTabPreferences('private-cover',true).artwork,artwork);assert.equal(storage.size,before);
});


test('daily mode uses upstream museum paintings while manual reference covers remain selectable',()=>{
 const prefs=updateNewTabPreferences('daily-museum',{daily:true,artwork:'garden'});
 for(let day=1;day<=7;day++)assert.ok(selectedArtwork(prefs,'daily-museum',new Date(2026,9,day)).src.startsWith('/artwork/catalog-v2/'));
 assert.equal(selectedArtwork({...prefs,daily:false},'daily-museum').id,'garden');
 assert.equal(updateNewTabPreferences('bad-personal-cover',{artwork:'personal:not-a-capability'}).artwork,defaultArtwork);
});

test('new-tab reset detects per-tab artwork and caption preferences independently',()=>{
 const defaults=readNewTabPreferences('new-option-reset');
 assert.equal(newTabChanged(defaults,defaultArtwork),false);
 assert.equal(newTabChanged({...defaults,perTab:true},defaultArtwork),true);
 assert.equal(newTabChanged({...defaults,hourly:true},defaultArtwork),true);
 assert.equal(newTabChanged({...defaults,caption:false},defaultArtwork),true);
 assert.equal(newTabChanged({...defaults,perTab:false,caption:true},defaultArtwork),false);
});

test('per-tab artwork includes owned personal images and keeps its choice stable for the same tab',()=>{
 const id='12345678-1234-4123-8123-123456789abc',own={id,name:'Owned rotation image',url:'acira-browser-ui://ui/personal-artwork/owned/'+id,width:1200,height:800,bytes:4000};
 const prefs=updateNewTabPreferences('per-tab-own',{perTab:true});
 const seed=String.fromCharCode(artworkCatalog.length);
 assert.equal(selectedArtwork(prefs,'per-tab-own',new Date(),[own],seed).id,'personal:'+id);
 assert.equal(selectedArtwork(prefs,'per-tab-own',new Date(),[own],seed).src,own.url);
 const before=storage.size;updateNewTabPreferences('per-tab-private',{perTab:true,caption:false},true);assert.equal(storage.size,before);
 assert.equal(readNewTabPreferences('per-tab-private',true).caption,false);assert.equal(readNewTabPreferences('per-tab-private').caption,true);
});



test('a remote collection alone makes the new-tab layout resettable',()=>{
 const prefs=readNewTabPreferences('owned-collection-reset-check');
 assert.equal(newTabChanged({...prefs,collection:'built-in'},defaultArtwork),false);
 assert.equal(newTabChanged({...prefs,collection:'space'},defaultArtwork),true);
});


test('hourly artwork remains stable within the hour and private rotation stays temporary',()=>{
 const prefs=updateNewTabPreferences('hourly-owned',{hourly:true}),first=new Date('2026-10-25T10:01:00Z');
 assert.equal(selectedArtwork(prefs,'hourly-owned',first).id,selectedArtwork(prefs,'hourly-owned',new Date('2026-10-25T10:59:00Z')).id);
 assert.notEqual(selectedArtwork(prefs,'hourly-owned',first).id,selectedArtwork(prefs,'hourly-owned',new Date('2026-10-25T11:01:00Z')).id);
 const before=storage.size;
 updateNewTabPreferences('hourly-private',{hourly:true},true);
 assert.equal(readNewTabPreferences('hourly-private',true).hourly,true);
 assert.equal(readNewTabPreferences('hourly-private').hourly,false);
 assert.equal(storage.size,before);
});

test('a profile that had chosen the retired NASA collection reads back as Space',()=>{
 storage.set('acira-new-tab:nasa-legacy',JSON.stringify({collection:'nasa',collectionSeed:'abc',collectionExcludeId:'nasa:0123456789ab'}));
 const prefs=readNewTabPreferences('nasa-legacy');
 assert.equal(prefs.collection,'space');assert.equal(prefs.collectionExcludeId,'');
});
