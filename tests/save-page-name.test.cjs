'use strict';
// "Save page as…" offered the same name for every page ("Saved page.html"); it now suggests the page's title, like Save as PDF.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const main=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8');

test('Save page as suggests the title of the page',()=>{
 const at=main.indexOf("c.type==='save-page'"),block=main.slice(at,at+700);
 assert.ok(at>0);
 assert.ok(block.includes("fileName(wc.getTitle(),'html')"),'the suggested name comes from the title');
 assert.ok(!block.includes("'Saved page.html'"),'no fixed name');
});

test('Save page as on a PDF tab saves the PDF, not the viewer page',()=>{
 const at=main.indexOf("c.type==='save-page'"),block=main.slice(at,at+1700);
 assert.ok(block.includes("document.contentType==='application/pdf'"),'a PDF tab is recognised the way Save as PDF does');
 assert.ok(block.includes('pageOutput.exportPDF(wc)'),'the document itself is saved');
 assert.ok(block.includes('saveHtml()'),'every other page still saves as a web page');
 assert.ok(block.indexOf('savePage(result.filePath,\'HTMLComplete\')')>0);
});
