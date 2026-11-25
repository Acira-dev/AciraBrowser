'use strict';
// Connects chrome.history writes and chrome.browsingData to Acira's real history list (history/host.cjs). main.cjs calls connectAppHost() once the windows exist;
// this file is the only code that knows about windows ("controllers"). A visit is changed with the same actions the History page uses ('history.delete', 'history.add'),
// so every window of the profile, the History page and the saved list follow, and the onVisited / onVisitRemoved events come from the shared-state hook as for any change.
const crypto = require('node:crypto');
const hostModule = require('./host.cjs');

const privateId = id => String(id || '').startsWith('private-');

function createAppHost({controllers}) {
  /** An ordinary (not private) window that can carry the profile's list, preferably the profile's own. */
  const controllerFor = profileId => {
    const open = [...controllers].filter(c => !c.privateMode && !c.closing && c.state);
    return open.find(c => c.profileId === profileId) || open.find(c => (c.state.tabs || []).some(t => t.browserProfileId === profileId && !t.privacy)) || open[0] || null;
  };
  const mine = (c, profileId) => (c ? c.state.browsingHistory : []).filter(v => (v.browserProfileId || v.profileId) === profileId);
  return {
    records(profileId) {
      if (privateId(profileId)) return [];
      return mine(controllerFor(profileId), profileId).map(v => ({id: v.id, url: v.url, title: v.title || '', time: v.time}));
    },
    async remove(profileId, ids) {
      if (privateId(profileId)) return;
      const c = controllerFor(profileId);
      if (!c) throw new Error('Acira has no open window for this profile, so its history cannot change now.');
      const own = new Set(mine(c, profileId).map(v => v.id)), doomed = ids.filter(id => own.has(id));
      if (doomed.length) c.commitAction({type: 'history.delete', ids: doomed});
    },
    async add(profileId, {url, title}) {
      if (privateId(profileId)) return;
      const c = controllerFor(profileId);
      if (!c) throw new Error('Acira has no open window for this profile, so its history cannot change now.');
      c.commitAction({type: 'history.add', visits: [{id: 'ext-' + crypto.randomUUID(), title: String(title || ''), url, time: new Date().toISOString(), profileId: c.state.activeProfileId || '', browserProfileId: profileId}]});
    }
  };
}

/** Connect the host; returns a function that disconnects it. */
function connectAppHost(options) { return hostModule.connectStore(createAppHost(options)); }

module.exports = {createAppHost, connectAppHost};
