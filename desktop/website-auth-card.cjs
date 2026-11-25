'use strict';
// Beta 14: HTTP sign-in (a site's or a proxy's basic authentication) as the interface's frosted dialog, the reference design's "auth" sample: a key tile, "Sign in to <site>",
// "The site says <realm>", the notes (an unencrypted connection, a refused password), Username and Password, Cancel and Sign in.
// The requests stay the native dispatcher's (desktop/website-auth.cjs: owner, lifetime, ticket checks); only the drawing moved. Each request is one question of the
// site prompt's queue (so it waits behind another popup and comes back, like every other question), and the answer goes back through the dispatcher's own `respond`.
// The old chrome-hosted dialog (src/features/WebsiteAuthDialog.tsx) stays for a window whose interface cannot draw the card.

/** The sentence under the title. A site: what it says (its realm) or that it asks for a sign-in; a proxy: the site the person is going to. */
function describeRequest(request, say) {
  const proxy = request.kind === 'proxy';
  const host = String(request.host || '').slice(0, 253);
  const port = Number(request.port) || 0;
  const standard = request.origin && /^https:/i.test(request.origin) ? 443 : 80;
  const shown = host ? (port && port !== standard ? `${host}:${port}` : host) : String(request.origin || '');
  const realm = String(request.realm || '');
  let detail;
  if (proxy) detail = request.destinationOrigin ? `${say('websiteauthdialog.destinationSite')} ${request.destinationOrigin}` : say('websiteauthdialog.theHttpProxyIsRequesting');
  else if (realm) detail = say('websiteauthcard.says', { realm });
  else detail = say('websiteauthdialog.theSiteIsRequestingA');
  const warns = [];
  if (request.insecure) warns.push(say(proxy ? 'websiteauthdialog.thisProxyConnectionUsesUnencrypted' : 'websiteauthcard.insecure'));
  if (request.retry) warns.push(say(proxy ? 'websiteauthdialog.theProxyDidNotAccept' : 'websiteauthdialog.theSiteDidNotAccept'));
  return { title: proxy ? say('websiteauthdialog.signInToThisProxy') : say('websiteauthcard.title', { host: shown }), detail, warns, proxy };
}

function createWebsiteAuthCards({ sitePrompt, say, snapshot, respond }) {
  const open = new Set(), released = new Set(), tried = new Map();
  const prompt = () => { try { return sitePrompt() || null; } catch { return null; } };
  const live = id => { try { return snapshot().requests.some(request => request.id === id); } catch { return false; } };
  const keyOf = request => [request.kind || 'origin', request.profileId, request.origin, request.realm].join('|');
  /** Is the interface's card in use (and not the old chrome-hosted dialog)? */
  const enabled = () => { const p = prompt(); return Boolean(p && p.overlayEnabled && p.overlayEnabled()); };

  function present(request, problem = '') {
    const id = request.id;
    if (open.has(id)) return;
    const p = prompt();
    if (!p) return;
    open.add(id);
    const { title, detail, warns } = describeRequest(request, say);
    const remembered = request.retry ? tried.get(keyOf(request)) || '' : '';
    p.showMessageBox({
      type: 'question', message: title, detail, buttons: [say('main.cancel'), say('websiteauthdialog.signIn')], defaultId: 1, cancelId: 0,
      site: {
        centered: true, icon: 'lock', host: '',
        fields: [{ name: 'username', label: say('pw.frame.username'), value: remembered }, { name: 'password', label: say('pw.frame.password'), value: '' }],
        warns: problem ? [...warns, problem] : warns,
        stale: () => released.has(id) || !live(id),
      },
    }).then(async result => {
      open.delete(id);
      // handed back to the chrome-hosted dialog (the interface went down): it answers this request itself
      if (released.delete(id)) return;
      if (!live(id)) return;
      if (!result || result.dismissed || result.response !== 1) { try { await respond({ id, action: 'cancel' }); } catch {} return; }
      const values = result.values || {};
      const username = typeof values.username === 'string' ? values.username : '', password = typeof values.password === 'string' ? values.password : '';
      tried.set(keyOf(request), username);
      let answered;
      try { answered = await respond({ id, action: 'submit', username, password }); } catch { answered = { ok: false }; }
      // the dispatcher refused the words (a colon in the user name, say) but the request is still waiting: ask again with the reason
      if (answered && answered.ok === false && live(id)) present(request, answered.code === 'INVALID_REQUEST' ? 'The username cannot contain a colon for this sign-in method.' : 'The response could not be sent. Enter your details again or cancel.');
    }).catch(() => { open.delete(id); });
  }
  /** The dispatcher's list for this window changed: new requests get their card; a request that went away drops its own card (it is stale). */
  function sync(value) {
    if (!value || !Array.isArray(value.requests)) return;
    for (const request of value.requests) present(request);
    const p = prompt();
    if (p && p.onState) p.onState();
  }
  /** The interface cannot draw it any more: the cards stand down without answering, the chrome-hosted dialog takes the requests over. */
  function release() {
    for (const id of open) released.add(id);
    const p = prompt();
    if (p && p.onState) p.onState();
  }
  return { enabled, sync, release, describeRequest };
}

module.exports = { createWebsiteAuthCards, describeRequest };
