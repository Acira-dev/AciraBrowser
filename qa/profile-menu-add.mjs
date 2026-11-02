// Founder 29 Oct: the profile menu's "Add profile…" row (under the profile list; opens Settings › Profiles with the add form open and
// its name field focused) and the Workspaces heading on the icon edge. Real app, disposable hidden profile, one native slot.
//   node qa/profile-menu-add.mjs <outdir>
// Prints one JSON line per language x theme x scale (left edges, popup height, clip/overlap hits) and the click-through result.
import fs from 'node:fs/promises';
import path from 'node:path';
import {withSlot} from './native-slot.mjs';
import {startApp, sleep, poll} from './d-harness.mjs';

const out = path.resolve(process.argv[2] || '.qa-profiles/profile-menu-add-out'); await fs.mkdir(out, {recursive: true});
const rows = [], failures = [];
const scan = () => {
  const popup = document.querySelector('.browser-popup'), pf = popup?.querySelector('.pf'); if (!pf) return null;
  const hits = [], pr = popup.getBoundingClientRect(), left = el => el ? +el.getBoundingClientRect().left.toFixed(2) : null;
  const items = [...pf.querySelectorAll('.acira-menu-row')];
  for (const el of pf.querySelectorAll('.acira-menu-title,.acira-menu-sub,.acira-menu-meta,.ws-menu-head-title')) {
    if (el.scrollWidth > el.clientWidth + 1) hits.push('clipped: ' + el.textContent.trim().slice(0, 40));
    const r = el.getBoundingClientRect();
    if (r.right > pr.right + .5 || r.left < pr.left - .5 || r.bottom > pr.bottom + .5 || r.top < pr.top - .5) hits.push('outside popup: ' + el.textContent.trim().slice(0, 40));
  }
  for (let i = 0; i < items.length - 1; i++) if (items[i].getBoundingClientRect().bottom > items[i + 1].getBoundingClientRect().top + .5) hits.push('rows overlap: ' + items[i].textContent.trim().slice(0, 30));
  const head = pf.querySelector('.ws-menu-head'), add = pf.querySelector('[data-profile-add]'), ident = [...pf.querySelectorAll('.acira-menu-row-identity')], lastIdent = ident[ident.length - 1];
  if (head && add && head.getBoundingClientRect().top < add.getBoundingClientRect().bottom) hits.push('Workspaces heading not below the add row');
  if (add && lastIdent && add.getBoundingClientRect().top < lastIdent.getBoundingClientRect().bottom - .5) hits.push('add row not under the last profile');
  const scroll = popup.querySelector('.popup-scroll') || popup;
  if (scroll.scrollHeight - scroll.clientHeight > 1) hits.push('popup scrolls ' + (scroll.scrollHeight - scroll.clientHeight) + 'px');
  if (pr.bottom > innerHeight + .5) hits.push('popup below viewport');
  const center = el => el ? +((el.getBoundingClientRect().left + el.getBoundingClientRect().right) / 2).toFixed(2) : null;
  return {
    hits, popupHeight: popup.offsetHeight, addText: add?.textContent.trim(), order: items.map(r => r.dataset.profileAdd !== undefined ? 'ADD' : r.dataset.profileWorkspaceNew !== undefined ? 'NEWWS' : r.dataset.profileWorkspace ? 'ws' : r.classList.contains('acira-menu-row-identity') ? 'profile' : 'action').join(','),
    headTitleLeft: left(pf.querySelector('.ws-menu-head-title')), headSubLeft: left(pf.querySelector('.ws-menu-head .acira-menu-sub')),
    addIconLeft: left(add?.querySelector('.acira-menu-icon')), wsGlyphLeft: left(pf.querySelector('[data-profile-workspace] .acira-menu-icon')), newWsIconLeft: left(pf.querySelector('[data-profile-workspace-new] .acira-menu-icon')),
    avatarCenter: center(pf.querySelector('.acira-menu-avatar')), addIconCenter: center(add?.querySelector('.acira-menu-icon')),
  };
};
await withSlot('profile-menu-add', async () => {
  let app;
  try {
    app = await startApp({root: `.qa-profiles/profile-menu-add-${Date.now()}`});
    const overlay = () => app.context.pages().find(p => { try { return p.url().includes('view=overlay'); } catch { return false; } });
    await app.main(({BaseWindow}) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds({x: 40, y: 30, width: 1280, height: 820}); });
    await app.act({type: 'settings.update', patch: {verticalTabs: true}}); await sleep(600);
    for (const name of ['Work', 'Study']) await app.act({type: 'workspace.create', name});
    await sleep(600);
    const openMenu = async () => {
      await app.ui.locator('.sb-foot-profile').first().click();
      await poll(async () => { const o = overlay(); return o && await o.locator('[data-profile-add]').count().catch(() => 0); }, Boolean, 'profile menu with add row', 8000);
      await sleep(700);
      return overlay();
    };
    const capture = async file => {
      const png = await app.main(async ({webContents}) => { const wc = webContents.getAllWebContents().find(w => w.getURL().includes('view=overlay')); return (await wc.capturePage()).toPNG().toString('base64'); });
      await fs.writeFile(path.join(out, file), Buffer.from(png, 'base64'));
    };
    for (const language of ['en', 'de']) for (const theme of ['light', 'dark']) for (const scale of [100, 150]) {
      await app.act({type: 'settings.update', patch: {appearance: theme, interfaceScale: scale, language}}); await sleep(1500);
      const o = await openMenu();
      const r = await o.evaluate(scan);
      const line = {language, theme, scale, ...r}; rows.push(line); console.log(JSON.stringify(line));
      if (!r) failures.push(`${language} ${theme} ${scale}: no menu`);
      else {
        if (r.hits.length) failures.push(`${language} ${theme} ${scale}: ${r.hits.join(' | ')}`);
        if (r.headTitleLeft !== r.addIconLeft || r.headSubLeft !== r.addIconLeft || r.wsGlyphLeft !== r.addIconLeft || r.newWsIconLeft !== r.addIconLeft) failures.push(`${language} ${theme} ${scale}: left edges differ`);
        if (Math.abs(r.avatarCenter - r.addIconCenter) > .6) failures.push(`${language} ${theme} ${scale}: avatar centre ${r.avatarCenter} vs plus centre ${r.addIconCenter}`);
        if (!/^profile,ADD,ws,ws,ws,NEWWS,action,action$/.test(r.order)) failures.push(`${language} ${theme} ${scale}: order ${r.order}`);
      }
      await o.locator(".sheet-popup .browser-popup").first().screenshot({path: path.join(out, `profile-menu-${language}-${theme}-${scale}.png`)}).catch(error => console.log("shot", error.message.slice(0, 80)));
      await o.keyboard.press('Escape').catch(() => {}); await sleep(500);
    }
    // Click-through: Add profile… opens Settings › Profiles with the form open and the name field focused (twice: new tab, then the form already open).
    await app.act({type: 'settings.update', patch: {appearance: 'light', interfaceScale: 100, language: 'en'}}); await sleep(1500);
    const settingsState = () => app.main(async ({webContents}) => {
      for (const wc of webContents.getAllWebContents()) {
        try { const s = await wc.executeJavaScript(`(()=>{const f=document.querySelector('.pm-create');if(!f)return null;const a=document.activeElement;return {form:true,focusedName:!!a&&a.matches('.pm-create input.st-input'),placeholder:a&&a.placeholder||'',url:location.href}})()`); if (s) return {id: wc.id, ...s}; } catch {}
      }
      return null;
    });
    for (const attempt of ['first click (new Settings tab)', 'second click (form already open)']) {
      const o = await openMenu();
      await o.locator('[data-profile-add]').click(); await sleep(300);
      const s = await poll(async () => { const v = await settingsState(); return v?.focusedName ? v : null; }, Boolean, attempt, 10000).catch(() => settingsState());
      const result = {attempt, ...s}; console.log(JSON.stringify(result)); rows.push(result);
      if (!s?.form || !s.focusedName) failures.push(`${attempt}: ${JSON.stringify(s)}`);
      if (attempt.startsWith('first')) {
        const png = await app.main(async ({webContents}, id) => (await webContents.fromId(id).capturePage()).toPNG().toString('base64'), s.id);
        await fs.writeFile(path.join(out, 'settings-add-profile-open.png'), Buffer.from(png, 'base64'));
        // Move focus away so the second click has to focus it again.
        await app.main(async ({webContents}, id) => { await webContents.fromId(id).executeJavaScript(`document.activeElement?.blur()`); }, s.id);
        await sleep(300);
      }
    }
  } catch (error) {
    failures.push('run: ' + (error.stack || error).toString().split('\n').slice(0, 3).join(' | '));
  } finally {
    try { await app?.close(); } catch {}
  }
});
await fs.writeFile(path.join(out, 'profile-menu-add.json'), JSON.stringify({rows, failures}, null, 1));
console.log(failures.length ? 'FAILURES\n' + failures.join('\n') : 'all pass');
process.exit(failures.length ? 1 : 0);
