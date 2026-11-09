// A sidebar group header reads "{group}, {count} tabs" to a screen reader: with one tab it said "Docs, 1 tabs". The message has its plural now.
import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {format} from '../src/i18n/format';
const catalog=(lang:string)=>JSON.parse(readFileSync(new URL(`../src/i18n/${lang}.json`,import.meta.url),'utf8')) as Record<string,string>;
const say=(lang:string,count:number)=>format(lang,catalog(lang)['acirasidebar.groupCountTabs'],{group:'Docs',count});

test('one tab is "1 tab", more are "tabs", in the languages that mark the plural',()=>{
 assert.equal(say('en',1),'Docs, 1 tab');assert.equal(say('en',3),'Docs, 3 tabs');
 assert.equal(say('de',1),'Docs, 1 Tab');assert.equal(say('de',2),'Docs, 2 Tabs');
 assert.equal(say('fr',1),'Docs, 1 onglet');assert.equal(say('fr',4),'Docs, 4 onglets');
 assert.equal(say('es',1),'Docs, 1 pestaña');assert.equal(say('es',2),'Docs, 2 pestañas');
 assert.equal(say('it',1),'Docs, 1 scheda');assert.equal(say('it',5),'Docs, 5 schede');
 assert.equal(say('pt-BR',1),'Docs, 1 guia');assert.equal(say('pt-BR',2),'Docs, 2 guias');
});
