// Fingerprint lab: a loopback server whose pages dump everything a site can read to decide "is this really Chrome?" and report it back.
// Pages:  /fp?label=<name>&hold=1   the fingerprint page (opens nothing by itself; buttons #pop and #blank open the two popup kinds)
//         /echo                      returns the request headers as JSON
//         /blank                     tiny same-origin page for the iframe probe
//         /opener-origin             a second origin helper (cross-origin postMessage) is served by a second listener on another port
// Reports (JSON) are stored per label; the document request headers of /fp are stored next to them.
//   import {startLab, diffReports} from './identity-lab.mjs'
import http from 'node:http';

/** Runs in the page: everything is wrapped so one failing probe never hides the others. */
export const PROBE = `(async () => {
  const out = {}, nav = navigator;
  const safe = f => { try { return f(); } catch (error) { return 'ERR:' + String(error && error.message || error).slice(0, 80); } };
  const native = fn => { try { return /\\[native code\\]/.test(Function.prototype.toString.call(fn)); } catch { return null; } };
  const shape = value => {
    if (typeof value === 'function') return { type: 'function', length: value.length, name: value.name, native: native(value) };
    if (value && typeof value === 'object') return { type: 'object', keys: Object.getOwnPropertyNames(value).sort() };
    return { type: typeof value };
  };
  const desc = (object, key) => { const d = Object.getOwnPropertyDescriptor(object, key); return d ? { get: !!d.get, set: !!d.set, value: 'value' in d ? typeof d.value : undefined, writable: d.writable, configurable: d.configurable, enumerable: d.enumerable } : null; };
  out.userAgent = nav.userAgent; out.appVersion = nav.appVersion; out.platform = nav.platform; out.vendor = nav.vendor; out.product = nav.product; out.productSub = nav.productSub;
  out.languages = safe(() => [...nav.languages]); out.language = nav.language; out.webdriver = nav.webdriver; out.webdriverDescriptor = desc(Navigator.prototype, 'webdriver');
  out.cookieEnabled = nav.cookieEnabled; out.doNotTrack = nav.doNotTrack; out.globalPrivacyControl = nav.globalPrivacyControl; out.hardwareConcurrency = nav.hardwareConcurrency; out.deviceMemory = nav.deviceMemory; out.maxTouchPoints = nav.maxTouchPoints;
  out.pdfViewerEnabled = nav.pdfViewerEnabled; out.onLine = nav.onLine; out.connectionType = safe(() => nav.connection && nav.connection.effectiveType);
  const uad = nav.userAgentData;
  out.userAgentData = uad ? { brands: uad.brands.map(b => b.brand + ' ' + b.version), mobile: uad.mobile, platform: uad.platform, json: JSON.parse(JSON.stringify(uad.toJSON())) } : null;
  out.highEntropy = uad ? await uad.getHighEntropyValues(['architecture', 'bitness', 'brands', 'formFactors', 'fullVersionList', 'model', 'platformVersion', 'uaFullVersion', 'wow64']).then(v => ({ ...v, brands: v.brands && v.brands.map(b => b.brand + ' ' + b.version), fullVersionList: v.fullVersionList && v.fullVersionList.map(b => b.brand + ' ' + b.version) })).catch(error => 'ERR:' + error) : null;
  const c = window.chrome;
  out.chromeType = typeof c; out.chromeDescriptor = desc(window, 'chrome');
  out.chromeKeys = c ? Object.getOwnPropertyNames(c).sort() : null;
  out.chromeShape = c ? Object.fromEntries(Object.getOwnPropertyNames(c).sort().map(k => [k, safe(() => shape(c[k]))])) : null;
  out.chromeApp = c && c.app ? { keys: Object.getOwnPropertyNames(c.app).sort(), isInstalled: c.app.isInstalled, installState: safe(() => c.app.InstallState && Object.keys(c.app.InstallState)), runningState: safe(() => c.app.RunningState && Object.keys(c.app.RunningState)) } : null;
  out.chromeRuntime = c && c.runtime ? { keys: Object.getOwnPropertyNames(c.runtime).sort(), id: c.runtime.id } : (c ? String(c.runtime) : null);
  out.loadTimes = safe(() => c.loadTimes && Object.keys(c.loadTimes()).sort()); out.csi = safe(() => c.csi && Object.keys(c.csi()).sort());
  out.plugins = [...nav.plugins].map(p => p.name); out.mimeTypes = [...nav.mimeTypes].map(m => m.type);
  out.notificationPermission = typeof Notification === 'undefined' ? 'none' : Notification.permission;
  out.permissionNotifications = await nav.permissions.query({ name: 'notifications' }).then(s => s.state).catch(error => 'ERR:' + error);
  out.window = { outerWidth: outerWidth, outerHeight: outerHeight, innerWidth: innerWidth, innerHeight: innerHeight, screenWidth: screen.width, availWidth: screen.availWidth, dpr: devicePixelRatio, colorDepth: screen.colorDepth };
  out.opener = window.opener !== null; out.windowName = window.name; out.historyLength = history.length; out.referrer = document.referrer;
  out.leaks = ['process', 'require', 'module', 'exports', 'Buffer', 'global', 'electron', 'ipcRenderer', '__dirname', 'cdc_adoQpoasnfa76pfcZLmcfl_Array', '__nightmare', 'callPhantom', '_phantom', 'domAutomation', 'domAutomationController'].filter(k => typeof window[k] !== 'undefined');
  out.credentials = { navigatorCredentials: typeof nav.credentials, publicKeyCredential: typeof window.PublicKeyCredential,
    conditional: await (window.PublicKeyCredential && PublicKeyCredential.isConditionalMediationAvailable ? PublicKeyCredential.isConditionalMediationAvailable() : Promise.resolve('n/a')).catch(error => 'ERR:' + error),
    platform: await (window.PublicKeyCredential && PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable ? PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable() : Promise.resolve('n/a')).catch(error => 'ERR:' + error), identityCredential: typeof window.IdentityCredential, federatedCredential: typeof window.FederatedCredential };
  out.webgl = safe(() => { const gl = document.createElement('canvas').getContext('webgl'); const ext = gl.getExtension('WEBGL_debug_renderer_info'); return { vendor: gl.getParameter(ext.UNMASKED_VENDOR_WEBGL), renderer: gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) }; });
  out.toStrings = {
    toString: Function.prototype.toString.call(Function.prototype.toString),
    languagesGetter: safe(() => Function.prototype.toString.call(Object.getOwnPropertyDescriptor(Navigator.prototype, 'languages').get)),
    brandsGetter: safe(() => Function.prototype.toString.call(Object.getOwnPropertyDescriptor(NavigatorUAData.prototype, 'brands').get)),
    highEntropy: safe(() => Function.prototype.toString.call(NavigatorUAData.prototype.getHighEntropyValues)),
    toStringDescriptor: desc(Function.prototype, 'toString'),
    toStringOwnName: Function.prototype.toString.name,
  };
  out.extras = {
    voices: await new Promise(resolve => { const get = () => speechSynthesis.getVoices().map(v => v.name + (v.localService ? '' : ' [remote]')); const first = get(); if (first.length) return resolve(first); speechSynthesis.onvoiceschanged = () => resolve(get()); setTimeout(() => resolve(get()), 2500); }).catch(() => 'ERR'),
    devices: await navigator.mediaDevices.enumerateDevices().then(d => d.map(x => x.kind).sort()).catch(e => 'ERR:' + e),
    storageQuotaGB: await navigator.storage.estimate().then(e => Math.round(e.quota / 1e9)).catch(() => null),
    battery: typeof nav.getBattery, memory: typeof (performance && performance.memory), availHeight: screen.availHeight + '/' + screen.height, connection: safe(() => [nav.connection.rtt, nav.connection.downlink, nav.connection.effectiveType].join('/')),
    gpu: typeof nav.gpu, usb: typeof nav.usb, serial: typeof nav.serial, hid: typeof nav.hid, bluetooth: typeof nav.bluetooth, share: typeof nav.share, locks: typeof nav.locks, wakeLock: typeof nav.wakeLock, mediaSession: typeof nav.mediaSession,
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches, dark: matchMedia('(prefers-color-scheme: dark)').matches, hdr: matchMedia('(dynamic-range: high)').matches,
    cookieStore: typeof window.cookieStore, trustedTypes: typeof window.trustedTypes, speechRecognition: typeof (window.SpeechRecognition || window.webkitSpeechRecognition), showOpenFilePicker: typeof window.showOpenFilePicker, documentPictureInPicture: typeof window.documentPictureInPicture,
  };
  out.windowProps = Object.getOwnPropertyNames(window).sort();
  out.navigatorOwn = Object.getOwnPropertyNames(nav).sort(); out.navigatorProto = Object.getOwnPropertyNames(Navigator.prototype).sort();
  out.uaDataProto = typeof NavigatorUAData === 'undefined' ? null : Object.getOwnPropertyNames(NavigatorUAData.prototype).sort();
  out.worker = await new Promise(resolve => { try { const w = new Worker(URL.createObjectURL(new Blob(['self.postMessage({ua:navigator.userAgent,brands:navigator.userAgentData&&navigator.userAgentData.brands.map(b=>b.brand+" "+b.version),languages:[...navigator.languages],webdriver:navigator.webdriver,platform:navigator.platform,hc:navigator.hardwareConcurrency})'], { type: 'text/javascript' }))); w.onmessage = event => resolve(event.data); w.onerror = () => resolve('ERR'); setTimeout(() => resolve('timeout'), 3000); } catch (error) { resolve('ERR:' + error); } });
  out.iframe = await new Promise(resolve => { const f = document.createElement('iframe'); f.src = '/blank'; f.onload = () => { try { const w = f.contentWindow; resolve({ chromeType: typeof w.chrome, chromeKeys: w.chrome ? Object.getOwnPropertyNames(w.chrome).sort() : null, ua: w.navigator.userAgent, brands: w.navigator.userAgentData && w.navigator.userAgentData.brands.map(b => b.brand + ' ' + b.version), webdriver: w.navigator.webdriver, languages: [...w.navigator.languages] }); } catch (error) { resolve('ERR:' + error); } }; document.body.appendChild(f); setTimeout(() => resolve('timeout'), 3000); });
  out.echo = await fetch('/echo', { cache: 'no-store' }).then(r => r.json()).catch(error => 'ERR:' + error);
  out.cookieRoundTrip = safe(() => { document.cookie = 'lab=1; path=/; SameSite=Lax'; return document.cookie.includes('lab=1'); });
  out.storage = safe(() => { localStorage.setItem('lab', '1'); return localStorage.getItem('lab') === '1'; });
  return out;
})()`;

const PAGE = label => `<!doctype html><meta charset="utf-8"><title>fp ${label}</title>
<body style="font:13px/1.4 system-ui;margin:20px"><h3>fingerprint lab: ${label}</h3>
<button id="pop" style="font-size:20px;padding:12px">window.open popup</button>
<a id="blank" target="_blank" href="/fp?label=${label}-blank" style="font-size:20px;display:inline-block;padding:12px">target=_blank link</a>
<pre id="out">collecting...</pre>
<script>
document.getElementById('pop').addEventListener('click', () => { window.open('/fp?label=${label}-popup', 'labpopup', 'popup=yes,width=640,height=760'); });
if (/[?&]auto=1/.test(location.search)) setTimeout(() => { document.getElementById('pop').click(); document.getElementById('blank').click(); }, 800);
const run = () => ${PROBE};
run().then(result => { document.getElementById('out').textContent = 'reported'; return fetch('/report?label=' + encodeURIComponent(${JSON.stringify(label)}), { method: 'POST', body: JSON.stringify(result) }); });
</script>`;

/** Starts the lab on 127.0.0.1. Returns {url, reports, documents, close}. */
export async function startLab() {
  const reports = new Map(), documents = new Map(), waiters = new Map();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/echo') { res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store'); res.end(JSON.stringify(req.headers)); return; }
    if (url.pathname === '/blank') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>blank</title>'); return; }
    if (url.pathname === '/report' && req.method === 'POST') {
      let body = ''; req.on('data', chunk => { body += chunk; }); req.on('end', () => { const label = url.searchParams.get('label'); try { reports.set(label, JSON.parse(body)); waiters.get(label)?.(reports.get(label)); } catch { /* ignored */ } res.end('ok'); }); return;
    }
    if (url.pathname === '/fp') {
      const label = url.searchParams.get('label') || 'x'; documents.set(label, req.headers);
      res.setHeader('content-type', 'text/html; charset=utf-8'); res.setHeader('cache-control', 'no-store'); res.end(PAGE(label)); return;
    }
    res.statusCode = 404; res.end('no');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const wait = (label, ms = 20000) => reports.has(label) ? Promise.resolve(reports.get(label)) : new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('No report for ' + label)), ms); waiters.set(label, value => { clearTimeout(timer); resolve(value); }); });
  return { base, reports, documents, wait, close: () => new Promise(resolve => server.close(resolve)) };
}

/** The signals that matter for "is this Chrome?", flattened to simple strings for comparison tables. */
export function summarize(report, document) {
  const r = report || {}, h = r.echo && typeof r.echo === 'object' ? r.echo : {};
  const pick = (headers, key) => headers ? headers[key] : undefined;
  return {
    userAgent: r.userAgent, webdriver: r.webdriver, 'uaData.brands': (r.userAgentData?.brands || []).join(' | '), 'uaData.platform': r.userAgentData?.platform, 'uaData.mobile': r.userAgentData?.mobile,
    'highEntropy.fullVersionList': (r.highEntropy?.fullVersionList || []).join(' | '), 'highEntropy.platformVersion': r.highEntropy?.platformVersion, 'highEntropy.architecture': r.highEntropy?.architecture, 'highEntropy.bitness': r.highEntropy?.bitness,
    'highEntropy.formFactors': JSON.stringify(r.highEntropy?.formFactors), 'highEntropy.model': JSON.stringify(r.highEntropy?.model), 'highEntropy.wow64': r.highEntropy?.wow64,
    chromeType: r.chromeType, chromeKeys: (r.chromeKeys || []).join(','), 'chrome.app': r.chromeApp ? r.chromeApp.keys.join(',') : String(r.chromeApp), 'chrome.runtime': typeof r.chromeRuntime === 'object' && r.chromeRuntime ? r.chromeRuntime.keys.join(',') : String(r.chromeRuntime),
    loadTimes: Array.isArray(r.loadTimes) ? r.loadTimes.join(',') : String(r.loadTimes), csi: Array.isArray(r.csi) ? r.csi.join(',') : String(r.csi), chromeDescriptor: JSON.stringify(r.chromeDescriptor),
    plugins: (r.plugins || []).length, mimeTypes: (r.mimeTypes || []).length, pdfViewerEnabled: r.pdfViewerEnabled, notification: r.notificationPermission + '/' + r.permissionNotifications,
    outer_vs_inner: r.window ? `${r.window.outerWidth}x${r.window.outerHeight} / ${r.window.innerWidth}x${r.window.innerHeight}` : '', opener: r.opener, languages: (r.languages || []).join(','), leaks: (r.leaks || []).join(','),
    'worker.ua': r.worker?.ua, 'worker.brands': (r.worker?.brands || []).join(' | '), 'worker.webdriver': r.worker?.webdriver, 'iframe.ua': r.iframe?.ua, 'iframe.chromeType': r.iframe?.chromeType, 'iframe.brands': (r.iframe?.brands || []).join(' | '), 'iframe.webdriver': r.iframe?.webdriver,
    'cookie+storage': `${r.cookieRoundTrip}/${r.storage}`, credentials: `${r.credentials?.navigatorCredentials}/${r.credentials?.publicKeyCredential}/${r.credentials?.conditional}/${r.credentials?.platform}/${r.credentials?.identityCredential}`,
    ...Object.fromEntries(Object.entries(r.extras || {}).map(([k, v]) => ['x.' + k, JSON.stringify(v)])),
    toString: r.toStrings?.toString, languagesGetter: r.toStrings?.languagesGetter, brandsGetter: r.toStrings?.brandsGetter,
    'doc.sec-ch-ua': pick(document, 'sec-ch-ua'), 'doc.sec-ch-ua-mobile': pick(document, 'sec-ch-ua-mobile'), 'doc.sec-ch-ua-platform': pick(document, 'sec-ch-ua-platform'), 'doc.user-agent': pick(document, 'user-agent'),
    'doc.sec-fetch': ['sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest', 'sec-fetch-user'].map(k => pick(document, k)).join(','), 'doc.accept-language': pick(document, 'accept-language'), 'doc.extra': ['x-requested-with', 'sec-gpc', 'dnt', 'upgrade-insecure-requests', 'sec-ch-ua-full-version-list'].filter(k => document && document[k] !== undefined).join(','),
    'fetch.sec-ch-ua': h['sec-ch-ua'], 'fetch.sec-ch-ua-mobile': h['sec-ch-ua-mobile'], 'fetch.sec-ch-ua-platform': h['sec-ch-ua-platform'], 'fetch.user-agent': h['user-agent'], 'fetch.extra': ['x-requested-with', 'sec-gpc', 'dnt'].filter(k => h[k] !== undefined).join(','),
  };
}

/** Keys where two summaries differ, ignoring the numbers that legitimately differ (window sizes, version minor numbers handled by the caller). */
export function diffSummaries(a, b, ignore = []) {
  return Object.keys({ ...a, ...b }).filter(k => !ignore.includes(k) && String(a[k]) !== String(b[k])).map(k => ({ key: k, a: a[k], b: b[k] }));
}
