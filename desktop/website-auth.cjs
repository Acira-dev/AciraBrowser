"use strict";
const { randomUUID } = require("node:crypto");
const registeredApps = new WeakSet();

// One origin/proxy dispatcher. Credentials are transient callback input only.
function createWebsiteAuth({
  app,
  resolveOwner,
  publish = () => {},
  proxyGuard,
  timeoutMs = 120000,
  now = Date.now,
}) {
  if (!app?.on || typeof resolveOwner !== "function" || registeredApps.has(app))
    throw new TypeError("Website authentication needs one native dispatcher.");
  if (
    proxyGuard &&
    ["validate", "isCurrent", "revalidate", "invalidateSession"].some(
      (method) => typeof proxyGuard[method] !== "function",
    )
  )
    throw new TypeError("Proxy authentication needs its native route guard.");
  const pending = new Map(),
    watches = new Map(),
    revisions = new Map(),
    privateSessions = new Map();
  let disposed = false;
  const view = (id) => ({
    revision: revisions.get(id) || 0,
    requests: [...pending.values()]
      .filter((item) => item.owner.id === id && item.ready)
      .map((item) => ({ ...item.public })),
  });
  function changed(id) {
    revisions.set(id, (revisions.get(id) || 0) + 1);
    try {
      publish(id, view(id));
    } catch {}
  }
  function ownerFor(wc) {
    if (!wc || wc.isDestroyed()) throw Error();
    const owner = resolveOwner(wc);
    if (
      !owner ||
      owner.active !== true ||
      ![owner.id, owner.profileId, owner.tabId].every(
        (value) => typeof value === "string" && value,
      ) ||
      typeof owner.privateMode !== "boolean" ||
      !owner.session ||
      owner.session !== wc.session
    )
      throw Error();
    return owner;
  }
  function current(item) {
    try {
      const owner = ownerFor(item.wc);
      return (
        !disposed &&
        owner.id === item.owner.id &&
        owner.profileId === item.owner.profileId &&
        owner.tabId === item.owner.tabId &&
        owner.session === item.owner.session &&
        owner.privateMode === item.owner.privateMode &&
        (!item.proxyTicket || proxyGuard.isCurrent(item.proxyTicket))
      );
    } catch {
      return false;
    }
  }
  function unwatch(item) {
    const record = watches.get(item.wc);
    if (!record) return;
    record.ids.delete(item.public.id);
    if (record.ids.size) return;
    for (const [event, listener] of record.listeners)
      item.wc.removeListener(event, listener);
    watches.delete(item.wc);
  }
  function finish(item, credentials) {
    if (!pending.delete(item.public.id)) return false;
    clearTimeout(item.timer);
    unwatch(item);
    try {
      credentials
        ? item.callback(credentials.username, credentials.password)
        : item.callback();
    } catch {}
    changed(item.owner.id);
    return true;
  }
  function cancelContents(wc) {
    for (const item of [...pending.values()]) if (item.wc === wc) finish(item);
  }
  function watch(item) {
    let record = watches.get(item.wc);
    if (!record) {
      const cancel = () => cancelContents(item.wc);
      const navigate = (event, _url, legacyInPlace) => {
        if (
          !(typeof event.isSameDocument === "boolean"
            ? event.isSameDocument
            : legacyInPlace)
        )
          cancel();
      };
      record = {
        ids: new Set(),
        listeners: [
          ["destroyed", cancel],
          ["render-process-gone", cancel],
          ["did-start-navigation", navigate],
        ],
      };
      watches.set(item.wc, record);
      for (const [event, listener] of record.listeners)
        item.wc.on(event, listener);
    }
    record.ids.add(item.public.id);
  }
  function room(owner) {
    return (
      pending.size < 32 &&
      [...pending.values()].filter((item) => item.owner.id === owner.id)
        .length < 4
    );
  }
  function enqueue(
    wc,
    owner,
    details,
    authInfo,
    callback,
    display,
    ready = true,
  ) {
    const item = {
      wc,
      owner: {
        id: owner.id,
        profileId: owner.profileId,
        tabId: owner.tabId,
        session: owner.session,
        privateMode: owner.privateMode,
      },
      callback,
      ready,
      replying: false,
      public: {
        id: randomUUID(),
        scheme: "basic",
        realm: String(authInfo.realm || "")
          .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "")
          .slice(0, 256),
        profileId: owner.profileId,
        tabId: owner.tabId,
        privateMode: owner.privateMode,
        retry: details.firstAuthAttempt === false,
        createdAt: now(),
        ...display,
      },
    };
    pending.set(item.public.id, item);
    if (owner.privateMode) privateSessions.set(owner.id, owner.session);
    watch(item);
    item.timer = setTimeout(() => finish(item), timeoutMs);
    item.timer.unref?.();
    if (ready) changed(owner.id);
    return item;
  }
  function challenge(event, wc, details, authInfo, callback) {
    if (disposed) return false;
    // An extension's blocking chrome.webRequest.onAuthRequired listener is answering first (ext-api/web-request.cjs); when it gives no
    // credentials the same challenge is emitted again for this prompt.
    if (event?.aciraExtensionAuth) return false;
    if (authInfo?.isProxy) {
      if (!proxyGuard) return false;
      event.preventDefault();
      let owner;
      try {
        owner = ownerFor(wc);
        if (!room(owner) || typeof callback !== "function") throw Error();
      } catch {
        try {
          callback();
        } catch {}
        return false;
      }
      const item = enqueue(
        wc,
        owner,
        details,
        authInfo,
        callback,
        { kind: "proxy" },
        false,
      );
      // Own callback/lifetime before asynchronous native route resolution.
      void Promise.resolve()
        .then(() => proxyGuard.validate(wc, details, authInfo))
        .then(
          (ticket) => {
            if (!pending.has(item.public.id)) return;
            if (!ticket || !current(item)) {
              finish(item);
              return;
            }
            item.proxyTicket = ticket;
            if (!current(item)) {
              finish(item);
              return;
            }
            const display = ticket.display;
            Object.assign(item.public, {
              kind: "proxy",
              origin: display.origin,
              destinationOrigin: display.destinationOrigin,
              host: display.host,
              port: display.port,
              insecure: true,
            });
            item.ready = true;
            changed(owner.id);
          },
          () => finish(item),
        );
      return true;
    }
    let owner, url;
    try {
      owner = ownerFor(wc);
      url = new URL(details.url);
      const host = (value) =>
        String(value)
          .toLowerCase()
          .replace(/^\[|\]$/g, "");
      if (
        !room(owner) ||
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        authInfo?.scheme?.toLowerCase() !== "basic" ||
        host(authInfo.host) !== host(url.hostname) ||
        authInfo.port !==
          Number(url.port || (url.protocol === "https:" ? 443 : 80)) ||
        typeof callback !== "function"
      )
        throw Error();
    } catch {
      event.preventDefault();
      try {
        callback();
      } catch {}
      return false;
    }
    event.preventDefault();
    enqueue(wc, owner, details, authInfo, callback, {
      kind: "origin",
      origin: url.origin,
      host: url.hostname,
      port: Number(url.port || (url.protocol === "https:" ? 443 : 80)),
      insecure: url.protocol === "http:",
    });
    return true;
  }
  function reconcile() {
    for (const item of [...pending.values()]) if (!current(item)) finish(item);
  }
  function respond(ownerId, response) {
    if (
      !response ||
      typeof response !== "object" ||
      Array.isArray(response) ||
      typeof response.id !== "string" ||
      !["submit", "cancel"].includes(response.action) ||
      Object.keys(response).some(
        (key) => !["id", "action", "username", "password"].includes(key),
      )
    )
      return { ok: false, code: "INVALID_REQUEST" };
    const item = pending.get(response.id);
    if (!item || !item.ready || item.owner.id !== ownerId)
      return { ok: false, code: "STALE_REQUEST" };
    if (!current(item)) {
      finish(item);
      return { ok: false, code: "STALE_REQUEST" };
    }
    if (response.action === "cancel") {
      if (
        Object.hasOwn(response, "username") ||
        Object.hasOwn(response, "password")
      )
        return { ok: false, code: "INVALID_REQUEST" };
      finish(item);
      return { ok: true };
    }
    if (
      typeof response.username !== "string" ||
      typeof response.password !== "string" ||
      response.username.length > 1024 ||
      response.password.length > 4096 ||
      /[\u0000\r\n:]/.test(response.username) ||
      /[\u0000\r\n]/.test(response.password)
    )
      return { ok: false, code: "INVALID_REQUEST" };
    if (item.replying) return { ok: false, code: "REQUEST_PENDING" };
    const credentials = {
      username: response.username,
      password: response.password,
    };
    if (!item.proxyTicket) {
      finish(item, credentials);
      return { ok: true };
    }
    item.replying = true;
    return (async () => {
      let valid = false;
      try {
        valid = await proxyGuard.revalidate(item.proxyTicket);
      } catch {}
      if (!pending.has(item.public.id) || !valid || !current(item)) {
        finish(item);
        return { ok: false, code: "STALE_REQUEST" };
      }
      finish(item, credentials);
      return { ok: true };
    })();
  }
  async function cancelSession(session) {
    proxyGuard?.invalidateSession(session);
    for (const item of [...pending.values()])
      if (item.owner.session === session) finish(item);
    try {
      await session.clearAuthCache();
      return true;
    } catch {
      return false;
    }
  }
  async function cancelOwner(id) {
    for (const item of [...pending.values()])
      if (item.owner.id === id) finish(item);
    const session = privateSessions.get(id);
    privateSessions.delete(id);
    if (!session) return true;
    proxyGuard?.invalidateSession(session);
    try {
      await session.clearAuthCache();
      return true;
    } catch {
      return false;
    }
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    registeredApps.delete(app);
    app.removeListener("login", challenge);
    app.removeListener("quit", dispose);
    for (const item of [...pending.values()]) finish(item);
    for (const id of [...privateSessions.keys()]) void cancelOwner(id);
    revisions.clear();
  }
  registeredApps.add(app);
  app.on("login", challenge);
  // before-quit can be cancelled while browser windows remain usable.
  app.on("quit", dispose);
  return {
    snapshot(id) {
      reconcile();
      return view(id);
    },
    respond,
    reconcile,
    cancelOwner,
    cancelSession,
    dispose,
  };
}
module.exports = { createWebsiteAuth };
