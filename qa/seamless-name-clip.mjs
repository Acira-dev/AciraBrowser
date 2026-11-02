// Real app: the Seamless window view's name in every language (windowview.seamless / browsermenu.seamless): the Acira menu's toggle and the
// Settings > Window view cards show the catalog's word, and the clip scan (qa/m-clip-scan.js) has no hit on those rows, light/dark x 100/150%.
// English and German are the required pair; the longest names (es, ru, tr, hi) and ja/ko ride along. One Electron, isolated profile, off-screen
// and not focusable, no real mouse.   node qa/seamless-name-clip.mjs [--shots dir]
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp, poll, sleep} from './d-harness.mjs';
import {withSlot} from './native-slot.mjs';

const shots = process.argv.includes('--shots') ? path.resolve(process.argv[process.argv.indexOf('--shots') + 1]) : null;
const check = (ok, label) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`); if (!ok) process.exitCode = 1; };
const root = path.resolve(`.qa-profiles/seamless-name-clip-${Date.now()}`);
const scan = await fs.readFile('qa/m-clip-scan.js', 'utf8');
const catalog = async lang => JSON.parse(await fs.readFile(`src/i18n/${lang}.json`, 'utf8'));
const noise = line => !line || line === 'no hits' || /^ellipsis\(deliberate\)=\d+$/.test(line) || /live region|width 1px| cw=1 /i.test(line);
await withSlot('seamless-name-clip', async () => {
  const t = await startApp({root, skipSetup: true});
  try {
    await t.ui.locator('.setup-dialog').waitFor({state: 'hidden', timeout: 5000}).catch(() => {});
    await t.main(({BaseWindow}) => { for (const w of BaseWindow.getAllWindows()) { w.setFocusable(false); w.setIgnoreMouseEvents(true); } const w = BaseWindow.getAllWindows()[0]; w.setBounds({x: -20000, y: -20000, width: 1280, height: 900}); w.showInactive(); });
    await t.act({type: 'settings.update', patch: {onboardingComplete: true, language: 'en', appearance: 'light', interfaceScale: 100, verticalTabs: true}});
    await t.act({type: 'tab.new', url: 'acira://settings'}); await sleep(1500);
    const settingsTab = (await t.state()).tabs.find(tab => tab.url === 'acira://settings').id;
    const overlay = () => t.context.pages().find(p => { try { return p.url().includes('view=overlay'); } catch { return false; } });
    const layout = () => t.ui.evaluate(() => window.acira.getBrowserLayout());
    const closeMenu = async () => { await t.ui.evaluate(()=>window.acira.closeOverlay()); await poll(async()=>!(await layout())?.overlay,Boolean,'popup closed'); await sleep(250); };
    for (const lang of (process.env.LANGS || 'en,de,es,ru,tr,hi,ja,ko').split(',')) {
      const c = await catalog(lang), name = c['windowview.seamless'], menuName = c['browsermenu.seamless'];
      check(name === menuName || lang === 'en', `${lang}: the menu and the window view cards use one word (${menuName} / ${name})`);
      await t.act({type:'settings.update',patch:{language:lang,reducedMotion:true}}); await poll(()=>t.ui.evaluate(()=>document.documentElement.lang),x=>x===lang,'locale reload completed'); await t.ui.locator('.browser-settings').waitFor();
      for (const [appearance, scale] of [['light', 100], ['dark', 100], ['light', 150], ['dark', 150]]) {
        await t.act({type: 'settings.update', patch: {language: lang, appearance, interfaceScale: scale}}); await sleep(1500);
        await closeMenu();
        // The Acira menu's Seamless toggle.
        await t.act({type: 'tab.select', id: settingsTab});
        await t.cmd({type: 'ui', tabId: settingsTab, action: 'open', kind: 'menu', anchor: {x: 400, y: 60, width: 2, height: 2}});
        await poll(async () => (await layout())?.overlay?.kind === 'menu', Boolean, 'menu', 8000); await sleep(600);
        await poll(overlay, Boolean, 'overlay', 8000);
        // Qualify settled off-screen overlay paint, as mac-menu-fit does.
        await overlay().reload();
        await overlay().locator('.popup-content-menu').waitFor({state:'visible'});
        await overlay().locator('.menu-row', {hasText: c['browsermenu.moreTools']}).first().click();
        await poll(async () => (await layout())?.overlay?.kind === 'more-tools', Boolean, 'more tools', 8000); await sleep(600);
        await overlay().reload();
        await poll(()=>overlay().locator('.popup-content-more-tools').count(),x=>x===1,'more-tools scene painted');
        const row = await poll(()=>overlay().evaluate(label => { const hit = [...document.querySelectorAll('.browser-popup *')].find(node => [...node.childNodes].some(n => n.nodeType === 3 && n.textContent.trim() === label)); return hit ? hit.textContent.trim() : null; }, menuName),Boolean,'translated Seamless row painted');
        const text = String(await overlay().evaluate(scan)), hits = text.split('\n').filter(line => !noise(line) && line.includes(menuName.slice(0, 6)));
        check(!!row && hits.length === 0, `${lang} ${appearance} ${scale}% menu: row "${row}", clip scan ${hits.length} hits on it${hits.length ? ' (' + hits.slice(0, 2).join('; ') + ')' : ''}`);
        if (shots && (lang === 'es' || lang === 'de') && scale === 150) { await fs.mkdir(shots, {recursive: true}); await overlay().screenshot({path: path.join(shots, `menu-${lang}-${appearance}-${scale}.png`)}).catch(() => {}); }
        await closeMenu();
        // Settings > Window view: the cards carry the four names.
        const probe = label => t.ui.evaluate(async label => { const node = document.querySelector('[data-setting="window-view"]'); if (!node) return false; node.scrollIntoView({block: 'center'}); await new Promise(r => setTimeout(r, 400)); return [...node.querySelectorAll('*')].some(el => [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim() === label)); }, label).catch(() => false);
        const found = await poll(() => probe(name), Boolean, 'window view cards', 8000).catch(() => false);
        const page = String(await t.ui.evaluate(scan)), pageHits = page.split('\n').filter(line => !noise(line) && line.includes(name.slice(0, 6)));
        check(found === true && pageHits.length === 0, `${lang} ${appearance} ${scale}% Settings > Window view: shows "${name}" (${found}), clip scan ${pageHits.length} hits on it${pageHits.length ? ' (' + pageHits.slice(0, 2).join('; ') + ')' : ''}`);
        if (shots && (lang === 'es' || lang === 'de') && scale === 150) await t.ui.screenshot({path: path.join(shots, `settings-${lang}-${appearance}-${scale}.png`), scale: 'css'}).catch(() => {});
      }
    }
  } finally { await t.close(); }
});
