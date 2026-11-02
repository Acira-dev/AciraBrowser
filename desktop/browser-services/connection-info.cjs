'use strict';
// What the browser learned about a site's certificate when it first connected, kept in memory per profile session, so "Certificate details" in
// site information can answer in plain words (who vouches for the site, until when) with no debugger attached and no waiting.
// The verify hook only watches: it always hands the decision back to the engine (-3), so certificate errors and exceptions behave as before.
const MAX_HOSTS = 300, USE_ENGINE_RESULT = -3;
const text = (value, limit = 200) => (typeof value === 'string' ? value : '').replace(/[\r\n\0]+/g, ' ').trim().slice(0, limit);
const iso = seconds => (Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : null);
const principalName = principal => text(principal?.organizations?.[0]) || text(principal?.commonName);

function createConnectionInfo() {
  const sessions = new WeakMap(), attached = new WeakSet();
  function record(session, request) {
    const certificate = request?.certificate, host = text(request?.hostname, 255).toLowerCase();
    if (!certificate || !host) return;
    let hosts = sessions.get(session);
    if (!hosts) { hosts = new Map(); sessions.set(session, hosts); }
    hosts.delete(host);
    hosts.set(host, {
      verified: request.verificationResult === 'net::OK',
      issuedBy: principalName(certificate.issuer) || text(certificate.issuerName),
      issuedTo: text(certificate.subject?.commonName) || text(certificate.subjectName),
      validFrom: iso(certificate.validStart), validUntil: iso(certificate.validExpiry),
    });
    while (hosts.size > MAX_HOSTS) hosts.delete(hosts.keys().next().value);
  }
  function attach(session) {
    if (!session || attached.has(session) || typeof session.setCertificateVerifyProc !== 'function') return;
    attached.add(session);
    session.setCertificateVerifyProc((request, callback) => {
      try { record(session, request); } catch {}
      callback(USE_ENGINE_RESULT);
    });
  }
  const get = (session, hostname) => sessions.get(session)?.get(text(hostname, 255).toLowerCase()) || null;
  return {attach, get, record};
}

module.exports = {createConnectionInfo, USE_ENGINE_RESULT};
