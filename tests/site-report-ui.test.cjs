'use strict';
// "Report a problem with this site" in the interface (src/features/SiteReport.tsx): offered in Page information and Protection and from the warning page,
// never in Tor; the panel names every problem and list main can send, and Send carries only the tab, the choice and the note.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {KINDS,LISTS}=require('../desktop/browser-services/site-reports.cjs');
const root=path.join(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('the panel names every problem and every list main can send',()=>{
 const ui=read('src/features/SiteReport.tsx');for(const kind of KINDS)assert.ok(ui.includes(`['${kind}',`),kind);for(const list of LISTS)assert.ok(ui.includes(`'${list}':`)||ui.includes(`${list}:`),list);
});

test('the interface offers the report only for websites outside Tor, in Page information and Protection, and from the warning page',()=>{
 const app=read('src/App.tsx'),page=read('src/components/NavigationError.tsx'),form=read('src/features/SiteReport.tsx');
 assert.match(form,/export const reportable=\(tab:TabSession,tor:boolean\)=>!tor&&tab\.privacy!=='tor'&&tab\.contentKind==='web'/);
 assert.match(app,/canReport = \(kind === 'security' \|\| kind === 'protection'\) && reportable\(tab, isTorWindow\(state\)\)/);
 assert.match(app,/onReport=\{reportable\(t,isTorWindow\(state\)\)\?/,'the warning page link is not offered in Tor');
 assert.match(page,/onReport&&<p className="ne-detail"><button type="button" className="ne-link" onClick=\{onReport\}>\{t\('report\.safeLink'\)\}/);
 assert.match(form,/runtime\.service\(\{type:'site-report\.send',tabId:tab\.id,kind,note\}\)/,'Send carries only the tab, the choice and the note: main rebuilds the rest');
 assert.match(read('desktop/validation.cjs'),/overlay\.context\.intent==='report'&&overlay\.kind!=='security'/);
});

test('every new string is in all 13 catalogs',()=>{
 const en=JSON.parse(read('src/i18n/en.json')),ids=Object.keys(en).filter(id=>id.startsWith('report.'));
 assert.ok(ids.length>=30);
 for(const file of fs.readdirSync(path.join(root,'src/i18n')).filter(name=>/^[a-z]{2}(-[A-Z]{2})?\.json$/.test(name))){const catalog=JSON.parse(read('src/i18n/'+file));for(const id of ids)assert.ok(typeof catalog[id]==='string'&&catalog[id].length>0,file+' '+id);}
 assert.equal(en['report.thanks'],'Thanks, the Acira team will look at it.');
});

test('the report form sits on the panel system: choices without an icon keep the 32px text column, labels and note on the text edge',()=>{
 const css=read('src/styles/site-report.css');
 assert.match(css,/\.site-report \.menu-choice>\.menu-toggle-blank\{display:none\}/,'without this the blank slot stretches and the choice labels are cut ("Blocked by mist…")');
 for(const rule of [/\.site-report \.acira-menu-label\{padding-left:32px\}/,/\.site-report-note\{padding:2px 8px 4px 32px\}/,/\.site-report-fine\{margin:4px 8px 4px 32px;/])assert.match(css,rule);
 assert.match(read('src/styles/error-page.css'),/\.navigation-error \.ne-detail \.ne-link\{padding:0\}/,'the warning page link starts on its paragraph\'s edge');
});
