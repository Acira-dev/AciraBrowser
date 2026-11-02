'use strict';
// Engine adapters for the ad-blocker benchmark. Both read the same list text.
//   ghostery : @ghostery/adblocker-electron exactly as desktop/browser-services/filter-updates.cjs builds it, with the
//              cosmetic + scriptlet delivery of desktop/content-blocking.cjs (safe-scriptlet allow-list included).
//   brave    : Brave adblock-rust via the adblock-rs Node binding (MPL-2.0). Network check, url cosmetic resources,
//              generic class/id hiding and the injected scriptlet script are wired the way brave-core consumes them.
// External inputs (not committed): ADBLOCK_RS_PATH (built adblock-rs package dir), ADBLOCK_BENCH_LISTS (downloaded lists).
const fs = require('node:fs'), path = require('node:path');
const ROOT = path.join(__dirname, '..', '..'), BUNDLED = path.join(ROOT, 'resources', 'filters');
const BUNDLED_ORDER = ['easylist.txt', 'easyprivacy.txt', 'unbreak.txt', 'ubo-filters.txt', 'ubo-quick-fixes.txt'];
const BRAVE_EXTRA = ['ubo-privacy.txt', 'ubo-badware.txt', 'ubo-resource-abuse.txt', 'ubo-general.txt', 'ubo-2020.txt', 'ubo-2021.txt', 'ubo-2022.txt', 'ubo-2023.txt', 'ubo-2024.txt', 'ubo-2025.txt', 'ubo-2026.txt', 'ubo-link-shorteners.txt', 'urlhaus.txt', 'brave-unbreak.txt', 'brave-specific.txt', 'brave-social.txt', 'brave-sugarcoat.txt', 'brave-firstparty.txt', 'brave-firstparty-regional.txt'];
function listText(listSet) {
  const parts = BUNDLED_ORDER.map(f => fs.readFileSync(path.join(BUNDLED, f), 'utf8'));
  if (listSet === 'brave' || listSet === 'brave+cookies') {
    const dir = process.env.ADBLOCK_BENCH_LISTS; if (!dir) throw new Error('Set ADBLOCK_BENCH_LISTS to the folder with the downloaded Brave lists.');
    for (const f of BRAVE_EXTRA) parts.push(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (listSet === 'brave+cookies') for (const f of ['cookiemonster.txt', 'ubo-annoyances-cookies.txt', 'brave-cookie-specific.txt']) parts.push(fs.readFileSync(path.join(dir, f), 'utf8'));
  }
  return parts.join('\n');
}
const BRAVE_TYPE = { mainFrame: 'main_frame', subFrame: 'sub_frame', stylesheet: 'stylesheet', script: 'script', image: 'image', font: 'font', object: 'object', xhr: 'xhr', ping: 'ping', cspReport: 'csp_report', media: 'media', webSocket: 'websocket', other: 'other' };
const SAFE_SCRIPTLETS = new Set(['jsonPrune', 'jsonPruneFetchResponse', 'jsonPruneXhrResponse', 'setConstant', 'trustedReplaceFetchResponse', 'trustedReplaceXhrResponse']);
const scriptletKind = script => { let kind = ''; for (const m of script.matchAll(/\(function (\w+)\(/g)) kind = m[1]; return kind; };
const safeScriptlet = script => typeof script === 'string' && SAFE_SCRIPTLETS.has(scriptletKind(script)) && !script.includes('reelWatchEndpoint');
function buildGhostery(text) {
  const { ElectronBlocker } = require('@ghostery/adblocker-electron');
  const t0 = process.hrtime.bigint();
  const engine = ElectronBlocker.parse(text, { enableCompression: true, loadNetworkFilters: true, loadCosmeticFilters: true, enableMutationObserver: true });
  try { engine.updateResources(fs.readFileSync(path.join(BUNDLED, 'resources.json'), 'utf8'), 'bundled'); } catch { }
  return { engine, buildMs: Number(process.hrtime.bigint() - t0) / 1e6 };
}
function buildBrave(text, resourcesPath) {
  const base = process.env.ADBLOCK_RS_PATH; if (!base) throw new Error('Set ADBLOCK_RS_PATH to the built adblock-rs package.');
  const { FilterSet, Engine, RuleTypes, FilterFormat } = require(base);
  const t0 = process.hrtime.bigint();
  const set = new FilterSet(false); const record = set.addFilters(text, { format: FilterFormat.STANDARD, rule_types: RuleTypes.ALL });
  const engine = new Engine(set);
  const resources = JSON.parse(fs.readFileSync(resourcesPath || process.env.BRAVE_RESOURCES_JSON || path.join(process.env.ADBLOCK_BENCH_LISTS || '', 'brave-resources.json'), 'utf8'));
  engine.useResources(resources);
  return { engine, buildMs: Number(process.hrtime.bigint() - t0) / 1e6, record, resourceCount: resources.length };
}
async function createEngines({ mode, listSet = 'ours' }) {
  const { app, ipcMain } = require('electron');
  const { parse } = require('tldts');
  const text = listText(listSet), stats = () => ({ cssSelectors: 0, styleBytes: 0, scripts: 0, scriptBytes: 0, genericCalls: 0, genericSelectors: 0 });
  let current = stats();
  const takeStats = () => { const out = current; current = stats(); return out; };
  if (mode === 'ghostery') {
    const { engine, buildMs } = buildGhostery(text);
    const q = (url, msg, injection) => { const p = parse(url); return { domain: p.domain || '', hostname: p.hostname || '', url, classes: msg?.classes, hrefs: msg?.hrefs, ids: msg?.ids, getBaseRules: !injection && msg === undefined, getInjectionRules: injection, getExtendedRules: false, getRulesFromHostname: msg === undefined, getRulesFromDOM: msg !== undefined }; };
    ipcMain.handle('@ghostery/adblocker/inject-cosmetic-filters', async (event, url, msg) => { if (typeof url !== 'string' || !/^https?:/.test(url)) return; if (msg !== undefined) { return engine.onInjectCosmeticFilters(event, url, msg); } const { active, styles } = engine.getCosmeticsFilters({ ...q(url, msg, false), callerContext: { frameId: event.frameId, processId: event.processId, lifecycle: undefined } }); if (active !== false && styles.length) { current.styleBytes += styles.length; current.cssSelectors += (styles.match(/\{/g) || []).length; event.sender.insertCSS(styles, { cssOrigin: 'user' }); } });
    ipcMain.on('acira:scriptlets', event => { let scripts = []; try { const url = event.senderFrame?.url; if (/^https?:/.test(url || '')) { const found = engine.getCosmeticsFilters(q(url, undefined, true)); if (found.active !== false) scripts = found.scripts.filter(safeScriptlet).slice(0, 64); current.scripts += scripts.length; current.scriptBytes += scripts.reduce((s, x) => s + x.length, 0); } } catch { scripts = []; } event.returnValue = scripts; });
    ipcMain.handle('@ghostery/adblocker/is-mutation-observer-enabled', async () => true);
    return {
      info: { engine: 'ghostery', version: require('@ghostery/adblocker-electron/package.json').version, listSet, listBytes: text.length, buildMs, filters: engine.getFilters ? (() => { const f = engine.getFilters(); return { network: f.networkFilters.length, cosmetic: f.cosmeticFilters.length }; })() : null },
      preloads: [path.join(__dirname, '..', '..', 'desktop', 'browser-services', 'scriptlet-preload.cjs'), require.resolve('@ghostery/adblocker-electron-preload')],
      attach() { },
      onBeforeRequest(details, pageUrl) { let result = {}; engine.onBeforeRequest(process.env.BENCH_SOURCE === 'page' && pageUrl ? { ...details, referrer: pageUrl } : details, patch => { result = patch; }); return result; },
      takeStats
    };
  }
  if (mode === 'brave') {
    const built = buildBrave(text);
    const { engine } = built;
    ipcMain.on('brave:url-cosmetic', event => {
      let out = { hide: [], style: {}, script: '', generichide: false, exceptions: [] };
      try {
        const url = event.senderFrame?.url; if (/^https?:/.test(url || '')) {
          const r = engine.urlCosmeticResources(url);
          out = { hide: r.hide_selectors || [], style: r.style_selectors || {}, script: r.injected_script || '', generichide: !!r.generichide, exceptions: r.exceptions || [] };
          current.cssSelectors += out.hide.length + Object.keys(out.style).length; current.scripts += out.script ? 1 : 0; current.scriptBytes += out.script.length;
        }
      } catch { }
      event.returnValue = out;
    });
    ipcMain.handle('brave:hidden', (event, classes, ids, exceptions) => { try { const sel = engine.hiddenClassIdSelectors(classes, ids, exceptions); current.genericCalls++; current.genericSelectors += sel.length; return sel; } catch { return []; } });
    return {
      info: { engine: 'brave', adblockRs: require(path.join(process.env.ADBLOCK_RS_PATH, 'package.json')).version, listSet, listBytes: text.length, buildMs: built.buildMs, parse: built.record && { filtersAdded: built.record.filtersAdded ?? null }, resources: built.resourceCount },
      preloads: [path.join(__dirname, 'brave-cosmetic-preload.cjs')],
      attach() { },
      onBeforeRequest(details, pageUrl) {
        const type = BRAVE_TYPE[details.resourceType] || 'other', source = details.referrer || pageUrl || details.url;
        const r = engine.check(details.url, source, type, details.method || '', true);
        if (r.redirect) return { redirectURL: r.redirect };
        if (r.rewritten_url) return { redirectURL: r.rewritten_url };
        return r.should_block ? { cancel: true } : {};
      },
      takeStats
    };
  }
  throw new Error('Unknown mode ' + mode);
}
module.exports = { createEngines, listText, buildGhostery, buildBrave, BRAVE_TYPE, BUNDLED_ORDER, BRAVE_EXTRA };
