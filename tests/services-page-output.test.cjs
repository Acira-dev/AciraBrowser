'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{EventEmitter}=require('node:events'),{createPageOutput,fileTitle}=require('../desktop/browser-services/page-output.cjs');
function fixture(){const wc=new EventEmitter();let url='https://example.org/',response={canceled:true},pdfCalls=0;Object.assign(wc,{session:{},isDestroyed:()=>false,getURL:()=>url,getTitle:()=>'Page',printToPDF:async()=>{pdfCalls++;return Buffer.from('%PDF-1.7\nfixture-only\n%%EOF');}});const service=createPageOutput({getContext:()=>({profileId:'A',tabId:'t'}),getWindow:()=>({}),downloadsPath:path.resolve('.qa-profiles'),dialog:{showSaveDialog:async()=>typeof response==='function'?response():response}});return {wc,service,answer:r=>response=r,calls:()=>pdfCalls,navigate:()=>{url='https://other.example/';}};}
test('PDF chooser cancellation writes nothing and stale/same-URL navigation rejects before native print',async()=>{const f=fixture();assert.deepEqual(await f.service.exportPDF(f.wc),{cancelled:true});assert.equal(f.calls(),0);f.answer(()=>{f.wc.emit('did-start-navigation',{},'https://example.org/',false,true);return {filePath:path.resolve('.qa-profiles/must-not-write.pdf')};});await assert.rejects(f.service.exportPDF(f.wc),/website changed/);assert.equal(f.calls(),0);});
test('native print cancellation/error is truthful and output names cannot become paths/devices',async()=>{const f=fixture();f.wc.print=(_options,callback)=>callback(false,'cancelled');assert.equal((await f.service.print(f.wc)).cancelled,true);f.wc.print=(_options,callback)=>callback(false,'printer unavailable');const failed=await f.service.print(f.wc);assert.equal(failed.printed,false);assert.equal(failed.cancelled,false);assert.equal(fileTitle('../secret:page\\name').includes('/'),false);assert.match(fileTitle('CON'),/^Page/);});

test('Save as PDF / page opens in the download folder chosen in Settings when it is given as a function, and in a fixed folder otherwise',async()=>{
 for(const [given,expected] of [[()=>path.resolve('.qa-profiles/chosen'),path.resolve('.qa-profiles/chosen')],[path.resolve('.qa-profiles/fixed'),path.resolve('.qa-profiles/fixed')]]){
  const wc=new EventEmitter();Object.assign(wc,{session:{},isDestroyed:()=>false,getURL:()=>'https://example.org/',getTitle:()=>'My Page'});let seen;
  const service=createPageOutput({getContext:()=>({profileId:'A',tabId:'t'}),getWindow:()=>({}),downloadsPath:given,dialog:{showSaveDialog:async(_window,options)=>{seen=options.defaultPath;return {canceled:true};}}});
  assert.deepEqual(await service.exportPDF(wc),{cancelled:true});assert.equal(seen,path.join(expected,'My Page.pdf'));
 }
});
test('a PDF tab saves the document itself, not the viewer page that prints blank',async()=>{
 const f=fixture(),file=path.resolve('.qa-profiles','page-output-pdf-tab.pdf'),original=Buffer.from('%PDF-1.4\noriginal-document\n%%EOF');
 fs.mkdirSync(path.dirname(file),{recursive:true});fs.rmSync(file,{force:true});
 let asked='';Object.assign(f.wc,{executeJavaScript:async()=>true,session:{fetch:async url=>{asked=url;return {ok:true,arrayBuffer:async()=>original.buffer.slice(original.byteOffset,original.byteOffset+original.length)};}}});
 f.answer({canceled:false,filePath:file});
 const result=await f.service.exportPDF(f.wc);
 assert.equal(result.saved,true);assert.equal(asked,'https://example.org/');assert.equal(f.calls(),0,'the blank viewer page is not printed');
 assert.deepEqual(fs.readFileSync(file),original);fs.rmSync(file,{force:true});
 Object.assign(f.wc,{session:{fetch:async()=>({ok:false})}});f.answer({canceled:false,filePath:file});
 assert.equal((await f.service.exportPDF(f.wc)).saved,true);assert.equal(f.calls(),1,'a failed fetch falls back to printing');fs.rmSync(file,{force:true});
});
