'use strict';
// "Report a problem" in the interface (src/features/SiteReport.tsx): offered in Page information and Protection, from the warning page, and in
// the Acira menu (and Help on a Mac), never in Tor and never before this build can send reports; the panel names every problem and list main can
// send, and Send carries only the tab, the subject, the choice and the note. The form drawn for real: tests/site-report-menu.test.ts.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {KINDS,LISTS}=require('../desktop/browser-services/site-reports.cjs');
const root=path.join(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('the panel names every problem and every list main can send',()=>{
 const ui=read('src/features/SiteReport.tsx');for(const kind of KINDS)assert.ok(ui.includes(`['${kind}',`),kind);for(const list of LISTS)assert.ok(ui.includes(`'${list}':`)||ui.includes(`${list}:`),list);
});

test('the interface offers the report only outside Tor and once this build can send reports: the site in Page information, Protection and the warning page; the site or Acira from the Acira menu',()=>{
 const app=read('src/App.tsx'),page=read('src/components/NavigationError.tsx'),form=read('src/features/SiteReport.tsx');
 assert.match(form,/export const reportable=\(tab:TabSession,tor:boolean\)=>!tor&&tab\.privacy!=='tor'&&tab\.contentKind==='web'/);
 assert.match(app,/const reportSubjects: SiteReportSubject\[\] = !state\.siteReports \|\| isTorWindow\(state\) \|\| tab\.privacy === 'tor' \? \[\] : kind === 'menu' \? \(reportable\(tab, false\) \? \['site', 'app'\] : \['app'\]\) : \(kind === 'security' \|\| kind === 'protection'\) && reportable\(tab, false\) \? \['site'\] : \[\];/,'nothing before the endpoint is set (merged builds showed the row with Send greyed out), nothing in Tor');
 assert.match(app,/canReport = reportSubjects\.length > 0;/);
 assert.match(app,/<SiteReport tab=\{tab\} subjects=\{reportSubjects\} initialKind=\{intent === 'report' && kind === 'security' \? 'blocked' : undefined\}/,'only the warning page starts on "Blocked by mistake"');
 assert.match(app,/onReport=\{state\.siteReports&&reportable\(t,isTorWindow\(state\)\)\?/,'the warning page link waits for the endpoint and is not offered in Tor');
 assert.match(page,/onReport&&<p className="ne-detail"><button type="button" className="ne-link" onClick=\{onReport\}>\{t\('report\.safeLink'\)\}/);
 assert.match(form,/runtime\.service\(\{type:'site-report\.send',tabId:tab\.id,subject,kind,note\}\)/,'Send carries only the tab, the subject, the choice and the note: main rebuilds the rest');
 assert.match(form,/disabled=\{busy\|\|!kind\|\|!payload\|\|!available\|\|\(app&&!payload\.note\)\}/,'about Acira, Send waits for a note');
 assert.match(read('desktop/validation.cjs'),/overlay\.context\.intent==='report'&&overlay\.kind!=='security'&&overlay\.kind!=='menu'\)fail/);
});

test('the Acira menu: "Report a problem…" under Settings only when App hands it the action; Help > Report a Problem opens the menu on the form',()=>{
 const menu=read('src/components/BrowserMenu.tsx'),app=read('src/App.tsx');
 assert.match(menu,/\{row\(t\("browsermenu\.settings"\),Settings2,\(\)=>parts\.navigate\('acira:\/\/settings'\),'Ctrl ,'\)\}\n\s*\{parts\.report&&row\(t\('report\.menuRow'\),MessageSquare,parts\.report\)\}\n\s*<\/>;/,'the last row, the existing row style and the form\'s speech-bubble glyph; nothing else moves');
 assert.match(app,/report: kind === 'menu' && canReport \? \(\) => setReporting\(true\) : undefined/);
 assert.match(app,/\(kind === 'security' \|\| kind === 'menu'\) && id === 'report' \? 'report' as const/,'the menu takes the report intent');
 assert.match(app,/\(overlay === 'tor' \|\| overlay === 'security' \|\| overlay === 'menu'\) && popupIntent\.current/,'and carries it to the native popup');
 const {macMenuTemplate}=require('../desktop/platform.cjs'),seen=[];
 assert.equal(macMenuTemplate(()=>{}).some(menu=>menu.role==='help'),false,'no Help menu while reports cannot be sent');
 const help=macMenuTemplate(command=>seen.push(command.action),{report:true}).find(menu=>menu.role==='help');
 assert.deepEqual(help.submenu.map(item=>item.label),['Report a Problem…']);help.submenu[0].click(null,null,{});assert.deepEqual(seen,['report']);
 assert.match(read('desktop/main.cjs'),/macMenuTemplate\(createMacMenuRouter\(\{[^]*?\}\),\{report:Boolean\(require\('\.\/browser-services\/site-reports\.cjs'\)\.endpoints\(\)\.report\)\}\)/);
 assert.match(read('desktop/main.cjs'),/const ask=\(\)=>emitBrowser\(\{type:'ui',action:'open',kind:'menu',targetTabId:'report'\}\);/);
});

test('Up and Down in the note move its caret; elsewhere in a panel they still move between rows',()=>{
 assert.match(read('src/App.tsx'),/if \(kind !== 'tabs' && kind !== 'find' && \['ArrowDown', 'ArrowUp'\]\.includes\(e\.key\) && !\(e\.target instanceof HTMLTextAreaElement\)\) \{/);
});

test('every new string is in all 13 catalogs',()=>{
 const en=JSON.parse(read('src/i18n/en.json')),ids=Object.keys(en).filter(id=>id.startsWith('report.'));
 assert.ok(ids.length>=45);
 for(const file of fs.readdirSync(path.join(root,'src/i18n')).filter(name=>/^[a-z]{2}(-[A-Z]{2})?\.json$/.test(name))){const catalog=JSON.parse(read('src/i18n/'+file));for(const id of ids)assert.ok(typeof catalog[id]==='string'&&catalog[id].length>0,file+' '+id);}
 assert.equal(en['report.thanks'],'Thanks, the Acira team will look at it.');assert.equal(en['report.menuRow'],'Report a problem…');
 for(const file of fs.readdirSync(path.join(root,'src/i18n')).filter(name=>/^[a-z]{2}(-[A-Z]{2})?\.json$/.test(name)))assert.equal(JSON.parse(read('src/i18n/'+file))['report.subject.app'],'Acira',file+': the name stays Acira');
});

test('the report form sits on the panel system: choices without an icon keep the 32px text column, labels and note on the text edge',()=>{
 const css=read('src/styles/site-report.css');
 assert.match(css,/\.site-report \.menu-choice>\.menu-toggle-blank\{display:none\}/,'without this the blank slot stretches and the choice labels are cut ("Blocked by mist…")');
 assert.match(css,/\.app \.browser-popup \.site-report \.menu-seg button\{padding:0 10px\}/,'the About switch has words and no glyph: even padding');
 for(const rule of [/\.site-report \.acira-menu-label\{padding-left:32px\}/,/\.site-report-note\{padding:2px 8px 4px 32px\}/,/\.site-report-fine\{margin:4px 8px 4px 32px;/])assert.match(css,rule);
 assert.match(read('src/styles/error-page.css'),/\.navigation-error \.ne-detail \.ne-link\{padding:0\}/,'the warning page link starts on its paragraph\'s edge');
});
