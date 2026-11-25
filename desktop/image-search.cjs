'use strict';
/**
 * Beta 14: "Search for this image" in the page right-click menu (images, linked images, a paused video's frame, an image's own tab).
 *
 * The person chooses the service (Settings, Search, "Search images with", or the first-use chooser); until they have, NOTHING is sent anywhere. Then, by one of two ways, picked
 * automatically (`chooseWay`):
 *   address  the picture has a normal public https address: the service's "search by address" page opens in a new foreground tab next to this one; only the address goes, the
 *            service fetches the picture itself; no referrer. Never used for an address with signs of being private (a signed or tokenised query, the local network, localhost,
 *            an intranet name, a name and password): those go by upload.
 *   upload   the picture exists only on the person's side (blob:, data:, behind a login, on the local network, a signed address) or the service takes no address: its bytes (a still
 *            frame, downscaled) are uploaded; the answer is the service's results page, which opens in a new foreground tab. Never without a first confirmation per service.
 * Private and Tor windows keep the item and ALWAYS show the confirm, naming the service, for both ways (the request leaves by that tab's own route, so Tor stays Tor).
 * If a service's entry point does not work the item says so ("Could not reach TinEye. Choose another service") and opens nothing. The entry points are one small table:
 * image-search-services.json, the one place to update.
 */
const crypto = require('node:crypto');
const SERVICES = require('./image-search-services.json').services;
const { searchTemplate } = require('./browser-services/search-providers.cjs');

const MAX_EDGE = 2000, MAX_BYTES = 4 * 1024 * 1024, MAX_ANSWER_BYTES = 256 * 1024;
const CHOICES = ['lens', 'tineye', 'yandex', 'bing', 'custom', 'ask'];

// ---- is this address one that is safe to hand to a service? ----
const PRIVATE_SUFFIX = /(?:^|\.)(?:localhost|local|localdomain|internal|intranet|lan|home|corp|private|home\.arpa|onion)$/i;
function privateHost(host) {
  const name = String(host).toLowerCase().replace(/^\[|\]$/g, '');
  if (!name) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(name);
  if (v4) { const [a, b] = [Number(v4[1]), Number(v4[2])]; return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168); }
  if (name.includes(':')) return name === '::' || name === '::1' || /^f[cd]/.test(name) || /^fe[89ab]/.test(name) || /^::ffff:/.test(name);
  if (!name.includes('.')) return true;                  // an intranet name
  return PRIVATE_SUFFIX.test(name);
}
const SIGNED_KEY = /^(?:token|access_?token|id_?token|auth|authorization|sig|signature|key|api_?key|secret|session|session_?id|sid|jwt|expires?|policy|credential|x-amz-.+|x-goog-.+|x-ms-.+)$/i;
/** Does the query string carry a signature, a token or any long opaque value? Such an address is a key to something: it never goes to a service. */
function signedAddress(url) {
  for (const [key, value] of url.searchParams) {
    if (SIGNED_KEY.test(key)) return true;
    if (/^[A-Za-z0-9_\-+/=.%]{40,}$/.test(value) && /[A-Za-z]/.test(value) && /\d/.test(value)) return true;
  }
  return false;
}
/** The normal public https address of a picture, or null: https, no name and password, not a private host, no signed or tokenised query. */
function publicAddress(src) {
  try {
    const url = new URL(src);
    if (url.protocol !== 'https:' || url.username || url.password || privateHost(url.hostname) || signedAddress(url)) return null;
    return url.href;
  } catch { return null; }
}

// ---- the services ----
const serviceById = id => SERVICES.find(service => service.id === id) || null;
/** `name=value` lines (%s in a value takes the picture's address); at most 12 lines. */
function parsePost(text) {
  const lines = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(0, 12), pairs = [];
  for (const line of lines) { const at = line.indexOf('='); if (at > 0) pairs.push([line.slice(0, at).trim(), line.slice(at + 1).trim()]); }
  return pairs;
}
/** A custom service's address: https with %s where the picture's address goes, or (when POST parameters carry it) a plain https address. Returns it normalised, or throws. */
function imageAddress(value) {
  if (typeof value === 'string' && value.includes('%s')) return searchTemplate(value);
  if (typeof value !== 'string' || value.length > 2048 || /[\s\u0000-\u001f\u007f]/u.test(value)) throw new Error('Enter an https address.');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Image search addresses are https without a name and password.');
  return url.href;
}
/** The person's own service (address with %s for the picture's address, optional POST parameters), or null when it is not usable. */
function customService(settings) {
  let address; try { address = imageAddress(settings?.imageSearchCustom); } catch { return null; }
  const post = parsePost(settings?.imageSearchCustomPost);
  if (!address.includes('%s') && !post.length) return null;      // nothing would carry the picture's address
  let host = ''; try { host = new URL(address.replace('%s', 'x')).hostname.replace(/^www\./, ''); } catch { /* checked above */ }
  return { id: 'custom', name: host, byAddress: address, post: post.length ? post : null, upload: null, hosts: null, custom: true };
}
/** The service chosen in Settings (or by the first-use chooser); null for "Ask every time" and for no choice yet: nothing is sent until the person has chosen. */
function chosenService(settings) {
  const id = settings?.imageSearch;
  if (id === 'custom') return customService(settings);
  return id && id !== 'ask' ? serviceById(id) : null;
}

/** How the picture goes: 'address', 'upload', or 'none' (the service can take neither for this picture). `image.src`: its https address or null. */
function chooseWay(service, image) {
  if (service.byAddress && image.src && publicAddress(image.src)) return 'address';
  if (service.upload) return 'upload';
  return 'none';
}
const byAddressUrl = (service, src) => service.byAddress.replace('%s', encodeURIComponent(src));

/** Must the person confirm before this goes? Always in a Private or Tor window (both ways); in an ordinary window only before the first upload to a service. */
function needsConfirm({ way, serviceId, privateOrTor, uploadOk }) {
  if (privateOrTor) return true;
  return way === 'upload' && !(Array.isArray(uploadOk) && uploadOk.includes(serviceId));
}

// ---- the upload ----
/** A multipart/form-data body with one picture: as a file part, or (Bing) as a base64 text part. */
function multipartBody({ field, filename = 'image.jpg', type = 'image/jpeg', bytes, as = 'file' }) {
  const boundary = '----AciraImage' + crypto.randomBytes(12).toString('hex'), head = Buffer.from(`--${boundary}\r\n`);
  const part = as === 'base64'
    ? Buffer.concat([Buffer.from(`Content-Disposition: form-data; name="${field}"\r\n\r\n`), Buffer.from(bytes.toString('base64'))])
    : Buffer.concat([Buffer.from(`Content-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`), bytes]);
  return { contentType: `multipart/form-data; boundary=${boundary}`, body: Buffer.concat([head, part, Buffer.from(`\r\n--${boundary}--\r\n`)]) };
}
const getPath = (data, path) => path.split('.').reduce((value, key) => (value && typeof value === 'object' ? value[key] : undefined), data);
const allowedHost = (service, url) => !service.hosts || service.hosts.includes(url.hostname);
/** The results page an upload's answer names, or null: it must be https and on one of the service's own hosts. */
function resultAddress(service, recipe, answer) {
  try {
    let target = null;
    if (recipe.result === 'redirect') {
      if (![301, 302, 303, 307, 308].includes(answer.status) || !answer.headers?.location) return null;
      target = new URL(String(answer.headers.location), recipe.url);
    } else if (recipe.result === 'json') {
      if (answer.status !== 200) return null;
      const named = getPath(JSON.parse(answer.text), recipe.jsonPath);
      if (typeof named !== 'string' || !/^https:\/\//.test(named)) return null;
      target = new URL(recipe.resultUrl.replace('%s', encodeURIComponent(named)));
    }
    return target && target.protocol === 'https:' && !target.username && allowedHost(service, target) ? target.href : null;
  } catch { return null; }
}

/**
 * The whole flow, with everything that touches Electron passed in (so it is tested without it):
 *   getSettings()            the settings (imageSearch, imageSearchCustom, imageSearchCustomPost, imageSearchUploadOk)
 *   saveSettings(patch)      persist a patch (the choice made in the chooser, "Don't ask again for X")
 *   choose(ctx)              show the first-use chooser; resolves a service id ('lens'...), 'other' (open Settings) or null (dismissed)
 *   confirm({...})           resolves { ok, dontAsk }
 *   reachable(ctx, src)      can the address be fetched by anyone, with no cookies? false for a picture behind a login (it then goes by upload); omitted = yes
 *   readImage(ctx, image)    the picture's bytes, a still frame, downscaled: { bytes, type }
 *   post(ctx, url, {headers, body})   one POST on the tab's own route and session, no cookies, no referrer: { status, headers, text }
 *   openResult(ctx, url)     a new foreground tab next to this one (same window, same kind of window)
 *   openSettings(ctx), notify(text), tr(key, vars)
 * `ctx`: { privateOrTor, tabId, params, image: { src, inline } }.
 */
function createImageSearch(env) {
  const fail = (ctx, service) => env.notify(env.tr('imagesearch.couldNotReach', { name: service.name }));
  async function search(ctx, service) {
    const settings = env.getSettings();
    let way = chooseWay(service, ctx.image);
    // A picture whose address is public in form but not in fact (behind a login: it does not answer without the person's cookies) is no address to hand to a service.
    if (way === 'address' && env.reachable && !(await env.reachable(ctx, publicAddress(ctx.image.src)).catch(() => false))) way = service.upload ? 'upload' : 'none';
    if (way === 'none') { env.notify(env.tr('imagesearch.needsUpload', { name: service.name })); return false; }
    if (needsConfirm({ way, serviceId: service.id, privateOrTor: ctx.privateOrTor, uploadOk: settings.imageSearchUploadOk })) {
      const answer = await env.confirm({ way, service, privateOrTor: ctx.privateOrTor, message: env.tr(way === 'upload' ? 'imagesearch.confirmUpload' : 'imagesearch.confirmAddress', { name: service.name }), checkboxLabel: !ctx.privateOrTor && way === 'upload' ? env.tr('imagesearch.dontAsk', { name: service.name }) : '' });
      if (!answer?.ok) return false;
      if (answer.dontAsk && !ctx.privateOrTor && way === 'upload') env.saveSettings({ imageSearchUploadOk: [...new Set([...(settings.imageSearchUploadOk || []), service.id])] });
    }
    try {
      if (way === 'address') {
        const src = publicAddress(ctx.image.src);
        if (service.post) {
          // a custom service with POST parameters: the POST goes by this tab's own route, and its answer must be a redirect to the results page
          const body = Buffer.from(service.post.map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value.replaceAll('%s', src))}`).join('&'));
          const target = service.byAddress.replace('%s', encodeURIComponent(src));
          const answer = await env.post(ctx, target, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
          const url = resultAddress({ hosts: null }, { result: 'redirect', url: target }, answer);
          if (!url) { fail(ctx, service); return false; }
          env.openResult(ctx, url); return true;
        }
        env.openResult(ctx, byAddressUrl(service, src)); return true;
      }
      const recipe = service.upload, picture = await env.readImage(ctx, ctx.image);
      if (!picture?.bytes?.length) { fail(ctx, service); return false; }
      const { contentType, body } = multipartBody({ field: recipe.field, as: recipe.as, bytes: picture.bytes, type: picture.type });
      const answer = await env.post(ctx, recipe.url, { headers: { 'Content-Type': contentType }, body });
      const url = resultAddress(service, recipe, answer);
      if (!url) { fail(ctx, service); return false; }
      env.openResult(ctx, url); return true;
    } catch { fail(ctx, service); return false; }
  }
  /** The row's click. */
  async function run(ctx) {
    let service = chosenService(env.getSettings());
    const settings = env.getSettings();
    if (!service && settings.imageSearch === 'custom') { env.notify(env.tr('imagesearch.customUnusable')); env.openSettings(ctx); return false; }
    if (!service) {
      const picked = await env.choose(ctx);
      if (!picked) return false;
      if (picked === 'other') { env.openSettings(ctx); return false; }
      service = serviceById(picked);
      if (!service) return false;
      if (settings.imageSearch !== 'ask') env.saveSettings({ imageSearch: service.id });   // "Ask every time" asks once more next time; otherwise the choice is remembered
    }
    return search(ctx, service);
  }
  return { run, search };
}

/** The row's label: it names the service once one is chosen. `tr(key, vars)`. */
function menuLabel(settings, tr) {
  const service = chosenService(settings);
  return service ? tr('pagemenu.searchImageWith', { name: service.name }) : tr('pagemenu.searchImage');
}

/**
 * The production `post`: one POST by Electron's `net` on the TAB'S OWN session (so a Private tab stays private and a Tor tab goes through Tor), with no cookies sent or kept,
 * no referrer and no identifier of ours; the answer is read, never followed (the results page is opened in a tab, not fetched here).
 */
function electronPost({ net, userAgent, timeoutMs = 20000 }) {
  return function post(session, url, { headers, body }) {
    return new Promise((resolve, reject) => {
      const request = net.request({ url, method: 'POST', session, credentials: 'omit', useSessionCookies: false, redirect: 'manual', referrerPolicy: 'no-referrer' });
      let settled = false, size = 0; const chunks = [];
      const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); if (error) reject(error); else resolve(value); };
      const timer = setTimeout(() => { finish(new Error('timeout')); try { request.abort(); } catch { /* over */ } }, timeoutMs);
      timer.unref?.();
      request.setHeader('User-Agent', userAgent(session));
      for (const [name, value] of Object.entries(headers || {})) request.setHeader(name, value);
      request.on('redirect', (status, _method, location) => { finish(null, { status, headers: { location }, text: '' }); try { request.abort(); } catch { /* over */ } });
      request.on('response', response => {
        const header = response.headers.location; const location = Array.isArray(header) ? header[0] : header;
        response.on('data', chunk => { size += chunk.length; if (size <= MAX_ANSWER_BYTES) chunks.push(chunk); });
        response.on('end', () => finish(null, { status: response.statusCode, headers: location ? { location } : {}, text: Buffer.concat(chunks).toString('utf8') }));
        response.on('error', error => finish(error));
      });
      request.on('error', error => finish(error));
      request.write(body); request.end();
    });
  };
}

module.exports = { SERVICES, CHOICES, MAX_EDGE, MAX_BYTES, privateHost, signedAddress, publicAddress, serviceById, parsePost, imageAddress, customService, chosenService, chooseWay, byAddressUrl, needsConfirm, multipartBody, resultAddress, createImageSearch, menuLabel, electronPost };
