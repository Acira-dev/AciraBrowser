'use strict';
// The one thing chrome.management needs from the extension manager (extension-manager.cjs): the installed list including extensions that
// are switched off (they are not loaded in the session, so the engine cannot list them), and the manager's own enable / disable / remove.
// The manager calls attach(session, hooks) when it creates a profile's runtime; ext-api/management.cjs asks hooksFor(session) at call time.
//   hooks = {profileId, entries(): [{id, path, name, version, source, enabled}], command({type: 'enable' | 'disable' | 'remove', extensionId}): Promise<{error?}>}
const bySession = new WeakMap();

function attach(session, hooks) {
  if (session && typeof session === 'object' && hooks && typeof hooks === 'object') bySession.set(session, hooks);
}
function hooksFor(session) {
  return session && typeof session === 'object' ? bySession.get(session) || null : null;
}

module.exports = {attach, hooksFor};
