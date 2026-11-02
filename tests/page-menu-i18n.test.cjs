'use strict';
// The page's right-click menu (link, image, media, editable, selection, plain page) is built in the main process: every row, its
// tooltip and the search row follow Settings > Languages instead of staying English.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {EventEmitter}=require('node:events');
const {createContextCommands}=require('../desktop/browser-services/context-commands.cjs');
const i18n=require('../desktop/i18n.cjs'),tx=require('../desktop/browser-services/tx.cjs');
const LOCALES=['en','es','fr','de','pt-BR','it','ja','zh-CN','ar','tr','ru','ko','hi'];
const catalog=name=>JSON.parse(fs.readFileSync(path.join(__dirname,'../src/i18n',name+'.json'),'utf8'));
const use=locale=>tx.setTranslator({t:(id,params)=>{i18n.setMainLocale(locale,'en-US');return i18n.tm(id,params);},locale:()=>i18n.setMainLocale(locale,'en-US')});
test.after(()=>tx.setTranslator(null));
function service(extra={}){const url='https://top.example/',owner={tabId:'t',profileId:'p',searchEngine:'duckduckgo',private:false},frame={url:'https://child.example/',isDestroyed:()=>false,executeJavaScript:async()=>{}};
 const wc=Object.assign(new EventEmitter(),{mainFrame:{},getURL:()=>url,isDestroyed:()=>false,navigationHistory:{canGoBack:()=>true,canGoForward:()=>true},downloadURL(){},copyImageAt(){},inspectElement(){},session:{isPersistent:()=>true,addWordToSpellCheckerDictionary:()=>true}});
 return {frame,wc,service:createContextCommands({getContext:()=>owner,clipboard:{writeText(){}},openTab(){},openWindow(){},command(){},peek(){},...extra})};}
const VARIANTS={
 link:{linkURL:'https://destination.example/page',selectionText:''},
 image:{mediaType:'image',srcURL:'https://img.example/a.png',hasImageContents:true},
 video:{mediaType:'video',srcURL:'https://media.example/v.mp4',mediaFlags:{canLoop:true,canSave:true,hasAudio:true,canShowPictureInPicture:true,canToggleControls:true}},
 editable:{isEditable:true,editFlags:{canUndo:true,canCut:true,canCopy:true,canPaste:true,canSelectAll:true},misspelledWord:'teh',dictionarySuggestions:['the']},
 selection:{selectionText:'some selected words',editFlags:{canCopy:true}},
 page:{},
};
test('no page-menu row, tooltip or search row is English in another language',()=>{
 const reused=['toast.undo','sidebarmedia.play','sidebarmedia.pause','acirasidebar.mute','acirasidebar.unmute','shortcutCmd.fullscreen','app.back','app.forward','shortcutCmd.reload','app.print','browsermenu.savePageAs'];
 const en=catalog('en'),english=new Set(Object.entries(en).filter(([id])=>id.startsWith('pagemenu.')||reused.includes(id)).map(([,text])=>text).filter(text=>!text.includes('{')));
 for(const locale of LOCALES){
  use(locale);const own=catalog(locale);
  for(const [name,params] of Object.entries(VARIANTS)){
   const f=service({resolveSelectionSearch:()=>({url:'https://engine.example/?q=x',engineName:'Engine'})}),items=f.service.build(f.wc,{frame:f.frame,x:1,y:1,...params});
   assert.ok(items.some(item=>item.type!=='separator'),`${locale}/${name}: has rows`);
   for(const item of items){
    if(item.type==='separator'||item.id==='inspect'&&locale==='en')continue;
    for(const text of [item.label,item.toolTip].filter(Boolean)){
     // Still the English words only when that language's own catalog says the same (French "Pause", Italian "Picture in picture").
     if(locale!=='en')assert.ok(!english.has(text)||Object.keys(en).some(id=>(id.startsWith('pagemenu.')||reused.includes(id))&&en[id]===text&&own[id]===text),`${locale}/${name}/${item.id}: "${text}" is still English`);
     assert.doesNotMatch(text,/\bpagemenu\./,`${locale}/${name}/${item.id}: raw id`);
    }
   }
  }
 }
});
test('the search row names the engine and the text in the language\'s own sentence',()=>{
 use('de');const f=service({resolveSelectionSearch:()=>({url:'https://engine.example/?q=x',engineName:'Engine'})});
 const label=f.service.build(f.wc,{frame:f.frame,selectionText:'wort'}).find(item=>item.id==='selection-search').label;
 assert.equal(label,'Mit Engine nach „wort“ suchen');
 const plain=service({resolveSelectionSearch:()=>({url:'https://engine.example/?q=x'})});
 assert.equal(plain.service.build(plain.wc,{frame:plain.frame,selectionText:'wort'}).find(item=>item.id==='selection-search').label,'Nach „wort“ suchen');
 use('en');const en=service({resolveSelectionSearch:()=>({url:'https://engine.example/?q=x',engineName:'A & B'})});
 assert.equal(en.service.build(en.wc,{frame:en.frame,selectionText:'x'}).find(item=>item.id==='selection-search').label,'Search A && B for “x”');
});
test('the source keeps no English label literal in an item(id, label) call',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../desktop/browser-services/context-commands.cjs'),'utf8');
 assert.deepEqual(source.match(/item\('[a-z-]+',\s*'[A-Z][^']*'/g)||[],[]);
});
