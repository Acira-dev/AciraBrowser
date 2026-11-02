// Per-extension "does it do its job on a page" checks. Each returns {ok, detail}; the generic probe (probe.mjs) handles install, popup, options,
// native messaging, restart and tab sleep. Content scripts are isolated-world scripts, so most checks read the DOM they change; the generic
// probe also lists the extension's execution contexts over CDP, which proves injection even when the extension changes nothing visible.
const YT = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
export const SPECIFIC = {
  'proton-pass': { nativeHost: { name: 'me.proton.pass.nm', exe: 'proton_pass_nm_host.exe' } },
  'dark-reader': {
    wait: 3500,
    check: async ({page}) => { const r = await page.evaluate(() => ({ styles: document.querySelectorAll('style.darkreader').length, scheme: document.documentElement.getAttribute('data-darkreader-scheme'), mode: document.documentElement.getAttribute('data-darkreader-mode'), bg: getComputedStyle(document.body).backgroundColor })); return {ok: r.styles > 0 || !!r.scheme, detail: r}; }
  },
  vimium: {
    wait: 1500,
    check: async ({page}) => { await page.bringToFront().catch(() => {}); await page.click('h1').catch(() => {}); await page.keyboard.press('f'); await new Promise(r => setTimeout(r, 1200)); const r = await page.evaluate(() => ({ nodes: document.querySelectorAll('[class*="vimium" i],[id*="vimium" i]').length, html: /vimium/i.test(document.documentElement.outerHTML) })); await page.keyboard.press('Escape').catch(() => {}); return {ok: r.nodes > 0 || r.html, detail: r}; }
  },
  grammarly: {
    wait: 2000,
    check: async ({page}) => { await page.click('#t').catch(() => {}); await page.keyboard.type('Ths sentense have a mistake.', {delay: 20}); await new Promise(r => setTimeout(r, 6000)); const r = await page.evaluate(() => ({ tags: [...new Set([...document.querySelectorAll('*')].map(e => e.tagName.toLowerCase()).filter(t => t.includes('-')))], grammarly: !!document.querySelector('grammarly-desktop-integration,grammarly-extension,grammarly-popups,[data-grammarly-shadow-root]') })); return {ok: r.grammarly, detail: r}; }
  },
  ryd: {
    url: YT, match: 'https://www.youtube.com/', wait: 14000,
    check: async ({page}) => { const r = await page.evaluate(() => ({ dislike: [...document.querySelectorAll('#segmented-dislike-button, dislike-button-view-model')].map(e => e.innerText.trim()).filter(Boolean).slice(0, 2), title: document.title })); return {ok: r.dislike.some(text => /\d/.test(text)), detail: r}; }
  },
  sponsorblock: {
    url: YT, match: 'https://www.youtube.com/', wait: 14000,
    check: async ({page}) => { const r = await page.evaluate(() => ({ nodes: [...document.querySelectorAll('[id*="sponsorblock" i],[class*="sponsorblock" i]')].map(e => e.id || e.className).slice(0, 5), title: document.title })); return {ok: r.nodes.length > 0, detail: r}; }
  },
  'react-devtools': {
    url: 'https://react.dev/', match: 'https://react.dev/', wait: 6000,
    extra: async ({app}) => {
      // DevTools panels: open DevTools on the React page and list the panel tabs the DevTools UI shows.
      const opened = await app.main(({webContents}) => { const wc = webContents.getAllWebContents().find(w => w.getURL().startsWith('https://react.dev/')); if (!wc) return false; wc.openDevTools({mode: 'detach'}); return true; });
      if (!opened) return {status: 'fail', detail: 'react.dev tab not found'};
      await new Promise(resolve => setTimeout(resolve, 9000));
      const labels = await app.main(async ({webContents}) => { const wc = webContents.getAllWebContents().find(w => w.getURL().startsWith('https://react.dev/')); const dt = wc && wc.devToolsWebContents; if (!dt) return null; return dt.executeJavaScript(`(() => { const out = new Set(); const walk = root => { for (const el of root.querySelectorAll('*')) { if (el.shadowRoot) walk(el.shadowRoot); const label = el.getAttribute && el.getAttribute('aria-label'); if (label && label.length < 40 && el.getAttribute('role') === 'tab') out.add(label); } }; walk(document); return [...out]; })()`); }).catch(error => 'evaluate failed: ' + String(error.message || error));
      await app.main(({webContents}) => { const wc = webContents.getAllWebContents().find(w => w.getURL().startsWith('https://react.dev/')); try { wc && wc.closeDevTools(); } catch {} }).catch(() => {});
      const panels = Array.isArray(labels) ? labels.filter(label => /components|profiler|react/i.test(label)) : [];
      return {status: panels.length ? 'pass' : 'fail', detail: {devtoolsTabs: labels, reactPanels: panels}};
    },
    check: async ({page}) => { const r = await page.evaluate(() => ({ hook: typeof window.__REACT_DEVTOOLS_GLOBAL_HOOK__, renderers: window.__REACT_DEVTOOLS_GLOBAL_HOOK__?.renderers?.size ?? null, devtoolsApi: typeof chrome === 'undefined' ? 'no chrome object' : typeof chrome.devtools })); return {ok: r.hook === 'object', detail: r}; }
  },
  tampermonkey: {
    wait: 3000,
    // Round 4: chrome.userScripts exists behind Settings › Extensions › Allow user scripts (off by default, as in Chrome). Before the switch a call
    // throws (how Tampermonkey detects it); after it the extension restarts and its popup and pages see a working API.
    extra: async ({app, id, manifest}) => {
      const popup = (manifest.action || {}).default_popup || 'action.html';
      const read = () => app.main(async ({BrowserWindow, session, webContents}, args) => { const w = new BrowserWindow({show: false, width: 420, height: 600, webPreferences: {session: session.fromPartition(args.partition), sandbox: true, contextIsolation: true}}); try { await w.loadURL(args.url); await new Promise(r => setTimeout(r, 3500)); return await w.webContents.executeJavaScript(`(async () => { const out = { text: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 300) }; try { chrome.userScripts.getScripts(); out.api = 'available'; out.scripts = (await chrome.userScripts.getScripts()).map(s => s.id).slice(0, 10); } catch (e) { out.api = 'throws: ' + e.message; } return out; })()`); } finally { w.destroy(); } }, {partition: app.partition, url: `chrome-extension://${id}/${popup.replace(/^\//, '')}`});
      const state = await app.state(); app.partition = state.browserProfiles.find(p => p.id === app.profileId).partition;
      const before = await read().catch(error => ({error: String(error.message || error)}));
      const switched = await app.ext({type: 'userScripts', extensionId: id, allowed: true}); await new Promise(r => setTimeout(r, 5000));
      const after = await read().catch(error => ({error: String(error.message || error)}));
      const entry = (switched.extensions || []).find(e => e.id === id);
      return {status: after.api === 'available' && /^throws/.test(before.api || '') ? 'pass' : 'fail', detail: {before, switchedOn: entry?.userScriptsAllowed, after}};
    }
  },
  'ublock-lite': {
    wait: 3000, blockingOff: true,
    // declarativeNetRequest: do the static rulesets load and match, and (the content check) does anything actually get blocked?
    extra: async ({helper}) => { if (!helper) return {status: 'n/a', detail: 'no extension page'}; const r = await helper.evaluate(async () => { const out = {}; const dnr = chrome.declarativeNetRequest; out.api = typeof dnr; if (!dnr) return out; try { out.enabledRulesets = await dnr.getEnabledRulesets(); } catch (error) { out.enabledError = String(error.message || error).slice(0, 140); } try { out.availableStaticRules = await dnr.getAvailableStaticRuleCount(); } catch (error) { out.availableError = String(error.message || error).slice(0, 140); } try { out.match = await dnr.testMatchOutcome({url: 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js', type: 'script', initiator: 'http://127.0.0.1'}); } catch (error) { out.matchError = String(error.message || error).slice(0, 140); } return out; }); const loaded = Array.isArray(r.enabledRulesets) && r.enabledRulesets.length > 0; return {status: loaded && r.match && r.match.matchedRules && r.match.matchedRules.length ? 'partial' : 'fail', detail: r}; },
    check: async ({page, sw}) => {
      const dnr = sw ? await sw.evaluate(async () => ({ api: typeof chrome.declarativeNetRequest, enabled: chrome.declarativeNetRequest?.getEnabledRulesets ? await chrome.declarativeNetRequest.getEnabledRulesets().catch(e => String(e)) : null })) : null;
      const blocked = await page.evaluate(async () => { const urls = ['https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js', 'https://securepubads.g.doubleclick.net/tag/js/gpt.js']; const out = []; for (const url of urls) { try { await fetch(url, {mode: 'no-cors'}); out.push({url, blocked: false}); } catch { out.push({url, blocked: true}); } } return out; });
      return {ok: blocked.every(item => item.blocked), detail: {dnr, blocked}};
    }
  },
  momentum: {
    // Round 4: Momentum's page shows on new tabs once chosen in Settings › Extensions › Use as New Tab page (off by default).
    extra: async ({app, id}) => {
      const views = () => app.main(({BaseWindow}) => BaseWindow.getAllWindows().filter(w => !w.isDestroyed()).flatMap(w => w.contentView.children.map(v => { try { return {url: v.webContents?.getURL() || '', visible: v.getVisible(), bounds: v.getBounds()}; } catch { return null; } }).filter(Boolean)));
      await app.act({type: 'tab.new'}); await new Promise(r => setTimeout(r, 2500));
      const offBefore = (await views()).filter(v => v.url.startsWith(`chrome-extension://${id}/`) && v.visible);
      const chosen = await app.ext({type: 'newTab', extensionId: id, allowed: true});
      await app.act({type: 'tab.new'}); await new Promise(r => setTimeout(r, 6000));
      const shown = (await views()).filter(v => v.url.startsWith(`chrome-extension://${id}/`) && v.visible), tab = (await app.state()).tabs.at(-1);
      let shot = null; try { shot = await app.main(async ({webContents}, prefix) => { const wc = webContents.getAllWebContents().find(w => w.getURL().startsWith(prefix) && !w.getURL().includes('popup')); if (!wc) return null; const img = await wc.capturePage(); return img.toPNG().toString('base64'); }, `chrome-extension://${id}/`); } catch {}
      if (shot) { const fs = await import('node:fs/promises'); const path = await import('node:path'); const {RUN} = await import('./run-context.mjs'); const file = path.join(RUN.output, 'momentum-newtab.png'); await fs.writeFile(file, Buffer.from(shot, 'base64')); }
      const ok = !offBefore.length && shown.length > 0 && tab?.url === 'acira://new';
      return {status: ok ? 'pass' : 'fail', detail: {beforeChoice: offBefore.length, chosen: (chosen.extensions || []).find(e => e.id === id)?.newTabChosen, shown: shown.map(v => v.url.slice(0, 80)), tabUrl: tab?.url, captured: !!shot}};
    }
  }
};
