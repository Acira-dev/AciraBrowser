import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import ts from 'typescript';

const out = path.resolve('docs/design/color-research/production-qa/import-review-' + Date.now());
await fs.mkdir(out, { recursive: true });
const hash = async file => createHash('sha256').update(await fs.readFile(file)).digest('hex');
const monitored = ['src/features/import-export/ImportPanel.tsx', 'src/features/import-export/import-export.css', 'src/features/import-export/importError.ts', 'src/features/BrowserData.tsx', 'src/features/BrowserSettings.tsx', 'src/features/browser-settings.css', 'src/styles/import-export.css', 'src/frost-preview.css', 'src/ui/theme.ts', 'src/ui/semanticColors.ts', 'src/runtime/types.ts'];
const source = await Promise.all(monitored.map(async file => ({ path: file, sha256: await hash(file) })));
const checks = [], cases = [], errors = [];
const record = (name, pass, detail = {}) => checks.push({ name, pass, ...detail });
const configFile = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, process.cwd());
const program = ts.createProgram([...config.fileNames, path.resolve('src/features/import-export/ImportPanel.tsx')], config.options);
const diagnostics = ts.getPreEmitDiagnostics(program).map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
record('new component and current application typecheck', diagnostics.length === 0, { diagnostics });

const entry = `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{BrowserSettings}from'./src/features/BrowserSettings';import{createInitialState}from'./src/runtime/core';import{runtime}from'./src/runtime/client';import{themeTokens}from'./src/ui/theme';import{appearancePalettes}from'./src/runtime/appearancePalettes';import{installDesignVariables}from'./src/ui/designSystem';import'./src/fonts.css';import'./src/styles.css';import'./src/shell-references.css';import'./src/styles/platform.css';import'./src/styles/selection.css';import'./src/styles/ux-controls.css';import'./src/frost-preview.css';installDesignVariables();
let model={finish:'Porcelain',dark:false,scenario:'discovered',long:false,serial:0},requests=[],next={},pending=[];
const source=()=>({id:'controlled-source',browser:'Chrome',name:model.long?'Controlled_profile_'+('UnbrokenName'.repeat(15)):'Personal',available:{bookmarks:true,history:true,preferences:true,extensions:model.scenario!=='unsupported'}});
const batch=()=>({id:'controlled-batch',profileId:'controlled-destination',browser:'Chrome',name:source().name,createdAt:1700000000000,results:model.scenario==='partial'?[{category:'bookmarks',count:7,folders:2,status:'imported'},{category:'history',status:'failed',error:'The source history is locked. Close that browser and retry.'+(model.long?' '+('Long_warning_'.repeat(22)):'')},{category:'extensions',count:3,status:'inventory only'},{category:'preferences',status:'unavailable',error:'This source profile does not contain this category.'}]:[{category:'bookmarks',count:7,folders:2,skipped:1,status:'imported'},{category:'history',count:11,status:'imported'},{category:'extensions',count:3,status:'inventory only'}]});
Object.assign(runtime,{platform:'win32',service:async request=>{requests.push(request);const reply=next[request.type];if(reply){delete next[request.type];if(reply.defer)return await new Promise((resolve,reject)=>pending.push({resolve,reject}));if(reply.error)throw Error(reply.error);return reply.value;}if(request.type==='imports.discover')return{sources:model.scenario==='empty'?[]:[source()],batches:model.scenario==='previous'?[batch()]:[]};if(request.type==='imports.preview')return{preview:{source:source(),bookmarks:7,history:model.scenario==='unsupported'?null:11,extensions:[{id:'a',name:'Controlled extension',version:'1',manifestVersion:3}],warnings:model.long||model.scenario==='unsupported'?['History may be locked. Close the source browser before importing.'+(model.long?' '+('Long_warning_'.repeat(22)):'')]:[]}};if(request.type==='imports.run'||request.type==='imports.html')return{batch:batch()};if(request.type==='imports.undo')return{undone:true};if(request.type==='imports.export')return{exported:true};throw Error('Unexpected controlled request '+request.type);}});
function Harness(){const[view,setView]=useState(model);window.__importQA={palettes:appearancePalettes.map(p=>p.name),show:value=>{model={...model,...value,serial:model.serial+1};requests=[];next={};setView(model);},reply:(type,value)=>next[type]=value,resolve:value=>pending.shift().resolve(value),requests:()=>requests};const state=createInitialState();state.settings.reducedMotion=true;state.browserProfiles=[{id:'controlled-destination',name:'Controlled destination',color:'#62666d',partition:'controlled-fixture',private:view.scenario==='private'}];state.activeBrowserProfileId='controlled-destination';state.tabs[0].browserProfileId=state.activeBrowserProfileId;state.tabs[0].url='acira://settings';const preset=appearancePalettes.find(p=>p.name===view.finish),tokens=themeTokens({...state.settings,colorPreset:preset.name,browserTint:preset.tint,accentColor:preset.accent},view.dark);return <div className="app style-acira" data-theme={tokens['--surface-tone']} data-appearance={tokens['--surface-tone']} style={{...tokens,display:'block'}}><BrowserSettings key={view.serial} state={state} dispatch={()=>{}}/></div>;}createRoot(document.getElementById('root')).render(<Harness/>);`;
const compiled = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: entry }, bundle: true, write: false, outdir: out, entryNames: 'imports', format: 'iife', define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.DEV': 'true' }, plugins: [
  { name: 'prospective-import-seam', setup(builder) { builder.onLoad({ filter: /[\\/]features[\\/]BrowserData\.tsx$/ }, async args => { const original = await fs.readFile(args.path, 'utf8'); const start = original.indexOf('export function ImportPanel('), end = original.indexOf('export function SiteControls', start); if (start < 0) return undefined; if (end < 0) throw Error('Importer seam changed; inspect before rerunning.'); return { contents: original.slice(0, start) + "export {ImportPanel} from './import-export/ImportPanel';\n" + original.slice(end), loader: 'tsx', resolveDir: path.dirname(args.path) }; }); } },
  { name: 'public-assets', setup(builder) { builder.onResolve({ filter: /^\// }, args => ({ path: args.path, external: true })); } },
] });
const asset = value => pathToFileURL(path.resolve('public', value.replace(/^\.?\//, ''))).href;
for (const output of compiled.outputFiles) {
  let value = output.text;
  if (output.path.endsWith('.css')) value = value.replace(/url\((['"]?)(\/[^)'"\s]+)\1\)/g, (_m, _q, p) => `url("${asset(p)}")`);
  else value = value.replace(/(["'])((?:\/|\.\/)(?:workspace-coast\.png|acira-[a-z.-]+|fonts\/[a-zA-Z0-9.-]+|frost-grain\.svg))\1/g, (_m, q, p) => q + asset(p) + q);
  await fs.writeFile(output.path, value);
}
await fs.writeFile(path.join(out, 'index.html'), '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="imports.css"><div id="root"></div><script src="imports.js"></script>');
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const open = async (page, config) => {
  await page.evaluate(value => window.__importQA.show(value), config);
  await page.getByRole('button', { name: 'Import & export', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.acira-import-panel')?.getAttribute('aria-busy') === 'false');
};
const choose = async page => { await page.locator('.aip-source').first().click(); await page.locator('.aip-categories').waitFor(); await page.waitForFunction(() => document.querySelector('.acira-import-panel').getAttribute('aria-busy') === 'false'); };
const inspect = async (page, key) => {
  const geometry = await page.locator('.acira-import-panel').evaluate(root => {
    const rect = node => node.getBoundingClientRect().toJSON();
    const main = root.closest('.bs-main'), bounds = rect(root);
    const channels = text => (text.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const luminance = color => channels(color).map(n => n / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
    const ratio = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
    const background = node => { for (let current = node; current; current = current.parentElement) { const color = getComputedStyle(current).backgroundColor; if (color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') return color; } return 'rgb(255, 255, 255)'; };
    const texts = [...root.querySelectorAll('h2,h3,p,strong,.aip-category>span>span,.aip-result-status,.aip-source>span,.aip-history>span,button')].filter(node => node.textContent.trim() && !node.disabled).map(node => ({ text: node.textContent.slice(0, 90), ratio: ratio(getComputedStyle(node).color, background(node)) }));
    return { bounds, main: rect(main), scrollWidth: main.scrollWidth, clientWidth: main.clientWidth, buttons: [...root.querySelectorAll('button')].map(node => ({ text: node.textContent, disabled: node.disabled, rect: rect(node), scrollWidth: node.scrollWidth, clientWidth: node.clientWidth })), categories: [...root.querySelectorAll('.aip-category')].map(node => ({ rect: rect(node), input: rect(node.querySelector('input')), copy: rect(node.querySelector('span')), label: node.querySelector('strong').textContent })), texts, headingCount: root.querySelector('.aip-section').querySelectorAll('.aip-heading').length };
  });
  cases.push({ ...key, ...geometry });
  record('settings content has no horizontal overflow', geometry.scrollWidth <= geometry.clientWidth + 1, { ...key, overflow: geometry.scrollWidth - geometry.clientWidth });
  record('all action targets fit and retain readable text', geometry.buttons.every(button => button.rect.left >= geometry.bounds.left - 1 && button.rect.right <= geometry.bounds.right + 1 && button.rect.height >= 29 && button.scrollWidth <= button.clientWidth + 1), key);
  record('category controls align and labels are human readable', geometry.categories.every(row => row.input.width === 16 && row.input.height === 16 && Math.abs(row.input.top - row.copy.top) <= 6 && row.copy.right <= geometry.bounds.right + 1 && ['Bookmarks', 'Browsing history', 'Browser preferences', 'Extension inventory'].includes(row.label)), key);
  record('one source or receipt heading', geometry.headingCount === 1, key);
  record('enabled text contrast at least 4.5', geometry.texts.every(text => text.ratio >= 4.49), { ...key, minimum: Math.min(...geometry.texts.map(text => text.ratio)), low: geometry.texts.filter(text => text.ratio < 4.49) });
};
try {
  for (const scale of [1, 1.5]) {
    const page = await browser.newPage({ viewport: { width: Math.floor(900 / scale), height: Math.floor(950 / scale) }, deviceScaleFactor: scale, reducedMotion: 'reduce' });
    page.on('pageerror', error => errors.push(error.message));
    await page.route(/^https?:/, route => route.abort());
    await page.goto(pathToFileURL(path.join(out, 'index.html')).href);
    await page.waitForFunction(() => window.__importQA);
    for (const finish of await page.evaluate(() => window.__importQA.palettes)) for (const dark of [false, true]) {
      const key = { finish, dark, scale, physicalHostWidth: 900, cssViewportWidth: Math.floor(900 / scale), long: true };
      await open(page, { finish, dark, scenario: 'discovered', long: true });
      await inspect(page, { ...key, state: 'discovered' });
      await choose(page);
      await inspect(page, { ...key, state: 'selected-long-warning' });
      await page.getByRole('button', { name: 'Import selected data', exact: true }).click();
      await page.locator('.aip-receipt').waitFor();
      await inspect(page, { ...key, state: 'receipt' });
      record('receipt receives focus after completion', await page.locator('.aip-receipt').evaluate(node => document.activeElement === node), key);
      await page.getByRole('button', { name: 'Undo import', exact: true }).click(); await page.getByText('Import undone.', { exact: true }).waitFor();
      record('all-finish receipt Undo uses the original batch contract', await page.evaluate(() => window.__importQA.requests().some(request => request.type === 'imports.undo' && request.batchId === 'controlled-batch')), key);
      await open(page, { finish, dark, scenario: 'partial', long: true }); await choose(page);
      await page.getByRole('button', { name: 'Import selected data', exact: true }).click(); await page.locator('.aip-receipt').waitFor();
      await inspect(page, { ...key, state: 'partial-long-warning' });
      await open(page, { finish, dark, scenario: 'discovered', long: false });
      for (const [type, button, message, stateName] of [
        ['imports.html', 'Import bookmarks HTML…', "ENOENT: no such file or directory, open 'C:\\Controlled fixture\\missing-bookmarks.html'", 'missing-file-error'],
        ['imports.export', 'Export profile JSON…', "EISDIR: illegal operation on a directory, open 'C:\\Controlled fixture\\export-directory'", 'export-directory-error'],
        ['imports.export', 'Export profile JSON…', "EACCES: permission denied, open 'C:\\Controlled fixture\\protected-export.json'", 'export-permission-error'],
        ['imports.export', 'Export profile JSON…', "EUNKNOWN: controlled diagnostic retained verbatim, open 'C:\\Controlled fixture\\unknown-export.json'", 'export-unknown-error'],
      ]) {
        await page.evaluate(({ type, message }) => window.__importQA.reply(type, { error: message }), { type, message });
        await page.getByRole('button', { name: button, exact: true }).click();
        await page.locator('.aip-error').waitFor();
        await inspect(page, { ...key, long: false, state: stateName });
        const error = await page.locator('.aip-error').evaluate(node => { const error = node.getBoundingClientRect(), main = node.closest('.bs-main').getBoundingClientRect(), action = node.closest('.aip-file-row').querySelector('button').getBoundingClientRect(); return { top: error.top, bottom: error.bottom, mainTop: main.top, mainBottom: main.bottom, viewportHeight: innerHeight, actionTop: action.top, actionBottom: action.bottom, focused: document.activeElement === node, text: node.textContent, role: node.getAttribute('role') }; });
        record('file failure is focused, announced and fully inside the current viewport beside its action', error.focused && error.role === 'alert' && error.top >= Math.max(0, error.mainTop) - 1 && error.bottom <= Math.min(error.viewportHeight, error.mainBottom) + 1 && error.top >= error.actionBottom - 1 && error.actionTop >= Math.max(0, error.mainTop) - 1, { ...key, state: stateName, error });
        const details = page.locator('.aip-error-details');
        record('primary file failure is plain and actionable with collapsed exact native details', !/ENOENT|EISDIR|EACCES|EUNKNOWN|C:\\/.test(error.text) && /Choose|Try/.test(error.text) && await details.locator('pre').textContent() === 'Error: ' + message && await details.getAttribute('open') === null && !await details.locator('pre').isVisible(), { ...key, state: stateName });
        await page.keyboard.press('Tab');
        record('error technical details are keyboard reachable with focus indication', await details.locator('summary').evaluate(node => document.activeElement === node && getComputedStyle(node).outlineStyle !== 'none' && parseFloat(getComputedStyle(node).outlineWidth) >= 2), { ...key, state: stateName });
        await page.keyboard.press('Enter');
        record('technical details expand without changing the actual failure', await details.locator('pre').isVisible() && await details.locator('pre').textContent() === 'Error: ' + message, { ...key, state: stateName });
        await page.keyboard.press('Enter');
        if (finish === 'Porcelain' && !dark) await page.screenshot({ path: path.join(out, `porcelain-light-${scale}-${stateName}.png`) });
      }
      if (['Porcelain', 'Burgundy'].includes(finish)) {
        await open(page, { finish, dark, scenario: 'partial', long: false }); await choose(page);
        await page.locator('.bs-main').evaluate(node => { node.scrollTop = 0; });
        await page.screenshot({ path: path.join(out, `${finish.toLowerCase()}-${dark ? 'dark' : 'light'}-${scale}-selected.png`) });
        await page.getByRole('button', { name: 'Import selected data', exact: true }).click();
        await page.locator('.aip-receipt').waitFor();
        await inspect(page, { ...key, long: false, state: 'partial' });
        await page.screenshot({ path: path.join(out, `${finish.toLowerCase()}-${dark ? 'dark' : 'light'}-${scale}-receipt.png`) });
      }
      await open(page, { finish, dark, scenario: 'empty', long: false });
      await inspect(page, { ...key, long: false, state: 'empty-all-finishes' });
      await page.evaluate(() => window.__importQA.reply('imports.export', { defer: true }));
      await page.getByRole('button', { name: 'Export bookmarks HTML…', exact: true }).click(); await page.getByText('Exporting profile data…', { exact: true }).waitFor();
      await inspect(page, { ...key, long: false, state: 'busy-all-finishes' });
      record('all-finish busy transfer disables actions', await page.locator('.acira-import-panel button').evaluateAll(nodes => nodes.every(node => node.disabled)), key);
      await page.evaluate(() => window.__importQA.resolve({ cancelled: true })); await page.getByText('Export cancelled.', { exact: true }).waitFor();
      await open(page, { finish, dark, scenario: 'private', long: true }); await choose(page);
      await inspect(page, { ...key, state: 'private-all-finishes' });
      record('all-finish private transfers are disabled', await page.locator('.aip-primary,.aip-files button,.aip-history input').evaluateAll(nodes => nodes.every(node => node.disabled)), key);
    }
    // Behavioral journeys use only explicit synthetic service replies; native actions are release-owned.
    for (const width of [Math.floor(900 / scale), Math.floor(378 / scale)]) {
      await page.setViewportSize({ width, height: Math.floor(950 / scale) });
      const key = { finish: 'Porcelain', dark: false, scale, cssViewportWidth: width };
      await open(page, { finish: 'Porcelain', dark: false, scenario: 'empty', long: false });
      record('empty discovery provides HTML route', await page.getByText('No supported profiles were discovered.', { exact: false }).isVisible() && await page.getByRole('button', { name: 'Import bookmarks HTML…', exact: true }).isEnabled(), key);
      await inspect(page, { ...key, state: 'empty' });
      await page.evaluate(() => window.__importQA.reply('imports.html', { value: { cancelled: true } }));
      await page.getByRole('button', { name: 'Import bookmarks HTML…', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.acira-import-panel').getAttribute('aria-busy') === 'false');
      record('cancelled HTML import has no completion receipt', await page.locator('.aip-receipt').count() === 0, key);
      await page.evaluate(() => window.__importQA.reply('imports.export', { value: { cancelled: true } }));
      await page.getByRole('button', { name: 'Export bookmarks HTML…', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.acira-import-panel').getAttribute('aria-busy') === 'false');
      record('cancelled export has no success message', await page.getByText('Bookmarks exported.', { exact: true }).count() === 0, key);
      await page.getByLabel('Include this profile’s history in JSON export', { exact: true }).check();
      await page.getByRole('button', { name: 'Export profile JSON…', exact: true }).click();
      await page.getByText('Profile data exported.', { exact: true }).waitFor();
      record('JSON passes the real history flag', await page.evaluate(() => window.__importQA.requests().some(request => request.type === 'imports.export' && request.format === 'json' && request.history === true)), key);
      await open(page, { scenario: 'discovered', long: true });
      await page.evaluate(() => window.__importQA.reply('imports.preview', { defer: true }));
      await page.locator('.aip-source').click();
      await page.getByText('Reading selected browser data…', { exact: true }).waitFor();
      await inspect(page, { ...key, state: 'busy-preview' });
      record('busy blocks all transfer actions', await page.locator('.acira-import-panel button').evaluateAll(buttons => buttons.every(button => button.disabled)), key);
      await page.evaluate(() => window.__importQA.resolve({}));
      await page.getByRole('button', { name: 'Retry preview', exact: true }).waitFor();
      await page.evaluate(() => window.__importQA.reply('imports.preview', { error: 'Controlled unreadable source. ' + 'Long_error_'.repeat(30) }));
      await page.getByRole('button', { name: 'Retry preview', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'Couldn’t read browser profiles' }).waitFor();
      await inspect(page, { ...key, state: 'preview-error' });
      await page.getByRole('button', { name: 'Retry preview', exact: true }).click();
      await page.locator('.aip-categories').waitFor();
      await page.getByRole('button', { name: 'Change profile', exact: true }).focus(); await page.keyboard.press('Tab');
      record('keyboard reaches first category with visible focus', await page.locator('.aip-category input').first().evaluate(node => document.activeElement === node && getComputedStyle(node).outlineStyle !== 'none' && parseFloat(getComputedStyle(node).outlineWidth) >= 2), key);
      await page.keyboard.press('Space');
      await page.getByRole('button', { name: 'Import selected data', exact: true }).click(); await page.locator('.aip-receipt').waitFor();
      record('category keyboard selection reaches runtime unchanged', await page.evaluate(() => { const request = window.__importQA.requests().find(request => request.type === 'imports.run'); return request.sourceId === 'controlled-source' && JSON.stringify(request.categories) === JSON.stringify(['history']); }), key);
      await page.getByRole('button', { name: 'Undo import', exact: true }).click(); await page.getByText('Import undone.', { exact: true }).waitFor();
      record('receipt Undo calls native batch contract and returns to sources', await page.evaluate(() => window.__importQA.requests().some(request => request.type === 'imports.undo' && request.batchId === 'controlled-batch')) && await page.locator('.aip-source').count() === 1, key);
      await open(page, { scenario: 'unsupported', long: false }); await choose(page);
      record('unavailable category is visible and disabled', await page.locator('.aip-category').last().locator('input').isDisabled() && await page.locator('.aip-category').last().getByText('Not available in this profile', { exact: true }).isVisible(), key);
      await inspect(page, { ...key, state: 'unsupported' });
      await open(page, { scenario: 'partial', long: true }); await choose(page); await page.getByRole('button', { name: 'Import selected data', exact: true }).click(); await page.locator('.aip-receipt').waitFor();
      await inspect(page, { ...key, state: 'partial-long-error' });
      record('partial receipt distinguishes actual outcomes and uninstalled extensions', await page.getByRole('heading', { name: 'Import finished with issues', exact: true }).isVisible() && await page.getByText('Extensions have not been installed.', { exact: true }).isVisible() && await page.locator('.aip-results [data-result=failed] .aip-copy').count() === 1, key);
      await page.getByRole('button', { name: 'Import more data', exact: true }).click(); record('import more resets the completed selection', await page.locator('.aip-source').count() === 1 && await page.locator('.aip-receipt').count() === 0, key);
      await open(page, { scenario: 'previous', long: true });
      await page.getByRole('button', { name: 'Undo this import', exact: true }).click(); await page.getByText('Import undone.', { exact: true }).waitFor();
      record('previous batch Undo uses the real batch ID', await page.evaluate(() => window.__importQA.requests().some(request => request.type === 'imports.undo' && request.batchId === 'controlled-batch')), key);
      await open(page, { scenario: 'private', long: true }); await choose(page);
      await inspect(page, { ...key, state: 'private' });
      record('private state exposes restriction and disables all transfers', await page.getByText('Import and export are unavailable in private browsing.', { exact: false }).isVisible() && await page.locator('.aip-primary,.aip-files button,.aip-history input').evaluateAll(nodes => nodes.every(node => node.disabled)), key);
    }
    await page.close();
  }
} catch (error) { errors.push(error.stack || error.message); }
finally { await browser.close(); }
const sourceStable = (await Promise.all(source.map(async item => item.sha256 === await hash(item.path)))).every(Boolean);
record('monitored source stays stable', sourceStable);
const report = { checkedAt: new Date().toISOString(), qualification: 'Actual replacement ImportPanel inside actual BrowserSettings using an in-memory prospective BrowserData export seam and complete shared stylesheet order. Explicit synthetic replies only. Twelve finishes/light-dark, 900px physical host at modeled100/150% (900/600CSSpx plus DPR), plus378px stress host at100/150%. Renderer layout, labels, contrast, keyboard, request contracts and fixture states; no native chooser/file/database/export/Undo acceptance and no global App toast coverage.', source, sourceStable, cases, checks, failures: checks.filter(check => !check.pass), errors, outputs: await Promise.all(['imports.js', 'imports.css'].map(async file => ({ path: path.join(out, file), sha256: await hash(path.join(out, file)) }))) };
await fs.writeFile(path.join(out, 'result.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ out, cases: cases.length, checks: checks.length, failures: report.failures.reduce((all, item) => (all[item.name] = (all[item.name] || 0) + 1, all), {}), errors, sourceStable }));
if (report.failures.length || errors.length || !sourceStable) process.exitCode = 1;
