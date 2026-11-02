"use strict";

// Native route proof only. No app login listener, callback, secret or persistence.
function createProxyAuthGuard({
  status,
  resolveOwner,
  resolveRoute = (wc, url) => wc.session.resolveProxy(url),
}) {
  if (typeof status !== "function" || typeof resolveOwner !== "function")
    throw new TypeError("Proxy authentication needs native route ownership.");
  const epochs = new WeakMap();
  const host = (value) =>
    typeof value === "string"
      ? value.toLowerCase().replace(/^\[|\]$/g, "")
      : "";
  function context(wc) {
    try {
      if (!wc || wc.isDestroyed()) return null;
      const owner = resolveOwner(wc),
        routing = status(wc.session),
        server = routing?.choice?.server;
      if (
        !owner ||
        owner.active !== true ||
        typeof owner.id !== "string" ||
        !owner.id ||
        typeof owner.tabId !== "string" ||
        !owner.tabId ||
        typeof owner.profileId !== "string" ||
        !owner.profileId ||
        typeof owner.privateMode !== "boolean" ||
        typeof routing.private !== "boolean" ||
        owner.session !== wc.session ||
        owner.profileId !== routing.profileId ||
        !!owner.privateMode !== !!routing.private ||
        routing.applied !== true ||
        routing.busy !== false ||
        routing.error ||
        routing.choice.mode !== "fixed_servers" ||
        server?.scheme !== "http" ||
        !host(server.host) ||
        !Number.isSafeInteger(server.port) ||
        server.port < 1 ||
        server.port > 65535
      )
        return null;
      return {
        owner: {
          id: owner.id,
          profileId: owner.profileId,
          tabId: owner.tabId,
          session: owner.session,
          privateMode: !!owner.privateMode,
        },
        session: wc.session,
        endpoint: { host: host(server.host), port: server.port },
        epoch: epochs.get(wc.session) || 0,
        fingerprint: JSON.stringify({
          profileId: routing.profileId,
          private: !!routing.private,
          choice: routing.choice,
        }),
      };
    } catch {
      return null;
    }
  }
  const same = (a, b) =>
    !!a &&
    !!b &&
    a.session === b.session &&
    a.epoch === b.epoch &&
    a.fingerprint === b.fingerprint &&
    a.owner.id === b.owner.id &&
    a.owner.profileId === b.owner.profileId &&
    a.owner.tabId === b.owner.tabId &&
    a.owner.privateMode === b.owner.privateMode;
  async function validate(wc, details, authInfo) {
    try {
      if (
        authInfo?.isProxy !== true ||
        authInfo.scheme?.toLowerCase() !== "basic"
      )
        return null;
      const before = context(wc),
        url = new URL(details.url);
      if (
        !before ||
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        host(authInfo.host) !== before.endpoint.host ||
        authInfo.port !== before.endpoint.port
      )
        return null;
      const route = await resolveRoute(wc, url.href);
      // Multiple/fallback/system/PAC/SOCKS routes are deliberately unqualified.
      if (typeof route !== "string" || !/^PROXY [^\s;]+$/.test(route))
        return null;
      const actual = new URL("http://" + route.slice(6));
      if (
        actual.username ||
        actual.password ||
        actual.pathname !== "/" ||
        actual.search ||
        actual.hash ||
        host(actual.hostname) !== before.endpoint.host ||
        Number(actual.port || 80) !== before.endpoint.port ||
        !same(before, context(wc))
      )
        return null;
      const proxyOrigin =
        "http://" +
        (before.endpoint.host.includes(":")
          ? "[" + before.endpoint.host + "]"
          : before.endpoint.host) +
        ":" +
        before.endpoint.port;
      return {
        ...before,
        wc,
        details: { url: url.href, firstAuthAttempt: details.firstAuthAttempt },
        authInfo: {
          isProxy: true,
          scheme: "basic",
          host: authInfo.host,
          port: authInfo.port,
          realm: String(authInfo.realm || "").slice(0, 256),
        },
        display: {
          kind: "proxy",
          origin: proxyOrigin,
          destinationOrigin: url.origin,
          host: before.endpoint.host,
          port: before.endpoint.port,
          scheme: "basic",
        },
      };
    } catch {
      return null;
    }
  }
  return {
    validate,
    isCurrent: (ticket) => !!ticket && same(ticket, context(ticket.wc)),
    async revalidate(ticket) {
      return (
        !!ticket &&
        same(ticket, await validate(ticket.wc, ticket.details, ticket.authInfo))
      );
    },
    invalidateSession(session) {
      epochs.set(session, (epochs.get(session) || 0) + 1);
    },
  };
}
module.exports = { createProxyAuthGuard };
