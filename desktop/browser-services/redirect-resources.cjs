'use strict';
// uBlock's $redirect stand-ins (googletagservices_gpt.js, googletagmanager_gtm.js, scorecardresearch_beacon.js, 1x1.gif, noop.js …): a blocked ad or
// tracker file is answered with a small neutered copy, so the page's own code that calls it (googletag.cmd.push, ga(), COMSCORE.beacon) keeps working.
// The engine (Ghostery) answers with a data: URL, and Chromium refuses to redirect a request there (net::ERR_UNSAFE_REDIRECT; the websites hunt saw it
// on about 20 sites, 2 Nov), so the stand-in never arrived. The same bytes are served from Acira's own scheme instead, the way uBlock serves them from
// its extension's files: the request is redirected to acira-resource://<launch token>/<id>. The scheme is secure (no mixed-content block on https pages)
// and bypasses the page's CSP, as an extension's resources do; the random launch token keeps pages from probing for it.
const { randomBytes, createHash } = require('node:crypto');
const SCHEME = 'acira-resource';
/** For protocol.registerSchemesAsPrivileged (main.cjs, before the app is ready). */
const PRIVILEGES = Object.freeze({ scheme: SCHEME, privileges: Object.freeze({ standard: true, secure: true, bypassCSP: true, supportFetchAPI: true, corsEnabled: true }) });
const MAX_BYTES = 2 * 1024 * 1024;

/** A data: URL's content type and bytes, or null. "image/gif;base64;base64" (as the engine writes some types) is image/gif, decoded once. */
function decodeDataUrl(url) {
  if (typeof url !== 'string' || !/^data:/i.test(url)) return null;
  const comma = url.indexOf(','); if (comma < 0) return null;
  const params = url.slice(5, comma).split(';').map(part => part.trim()), data = url.slice(comma + 1), base64 = params.slice(1).some(part => part.toLowerCase() === 'base64');
  const type = [params[0] || 'text/plain', ...params.slice(1).filter(part => part.includes('='))].join(';');
  const body = base64 ? Buffer.from(data, 'base64') : Buffer.concat(data.split(/(%[0-9a-fA-F]{2})/).map(part => /^%[0-9a-fA-F]{2}$/.test(part) ? Buffer.from([parseInt(part.slice(1), 16)]) : Buffer.from(part, 'utf8')));
  return body.length > MAX_BYTES ? null : { type, body };
}

function createRedirectResources({ token = randomBytes(16).toString('hex'), limit = 512 } = {}) {
  const byId = new Map(), prefix = `${SCHEME}://${token}/`;
  /** A request result whose redirect is a data: URL, moved to the stand-in address; every other result unchanged. An unreadable one is blocked. */
  function translate(result) {
    const target = result && result.redirectURL;
    if (typeof target !== 'string' || !/^data:/i.test(target)) return result;
    const id = createHash('sha256').update(target).digest('hex').slice(0, 24);
    if (!byId.has(id)) {
      const resource = decodeDataUrl(target); if (!resource) return { cancel: true };
      if (byId.size >= limit) byId.delete(byId.keys().next().value);
      byId.set(id, resource);
    }
    return { ...result, redirectURL: prefix + id };
  }
  /** The scheme's handler: the stand-in's bytes for this launch's token, readable by the page that asked (CORS, credentials too), never cached. */
  function respond(request) {
    let url; try { url = new URL(request.url); } catch { return new Response(null, { status: 400 }); }
    const resource = url.host === token ? byId.get(url.pathname.slice(1)) : null;
    if (!resource) return new Response(null, { status: 404 });
    const origin = request.headers.get('origin');
    return new Response(resource.body, { headers: { 'content-type': resource.type, 'cache-control': 'no-store', 'access-control-allow-origin': origin || '*', ...(origin ? { 'access-control-allow-credentials': 'true', vary: 'origin' } : {}) } });
  }
  /** Serves the stand-ins in one browsing session (each profile, private and Tor session has its own protocol table). */
  function attach(session) { const table = session?.protocol; if (typeof table?.handle === 'function' && !table.isProtocolHandled?.(SCHEME)) table.handle(SCHEME, respond); }
  return { translate, respond, attach, prefix };
}
module.exports = { SCHEME, PRIVILEGES, createRedirectResources, decodeDataUrl };
