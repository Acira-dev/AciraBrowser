'use strict';
// chrome.windows / browser.windows (package P2, extension pages and workers). Copied into the engine preload as text: only `acira` and the
// page's globals may be used here. Every member of Chromium's windows API exists; argument checks, promises, callbacks and lastError come
// from acira.build; the answers come from the main process (ext-api/windows.cjs).
module.exports = {
  namespaces: ['windows'],
  renderer(acira) {
    // Event filters (addListener(cb, {windowTypes: ['popup']})): onCreated / onBoundsChanged carry the window; onRemoved / onFocusChanged
    // carry an id only, so the type is the one this context last saw for that id (every Window object that reaches it is noted).
    const types = new Map();
    const note = value => { if (value && typeof value === 'object' && typeof value.id === 'number' && typeof value.type === 'string') types.set(value.id, value.type); return value; };
    const noteAll = list => { if (Array.isArray(list)) list.forEach(note); return list; };
    const accepts = (filter, type) => !filter || !Array.isArray(filter.windowTypes) || filter.windowTypes.length === 0 || filter.windowTypes.indexOf(type) >= 0;
    const byWindow = (filter, value) => { note(value); return accepts(filter, value && value.type); };
    const byId = (filter, id) => accepts(filter, types.get(id) || 'normal');
    return {
      windows: {
        factory: () => acira.build('windows', {
          functions: {
            get: (windowId, queryOptions) => acira.call('windows.get')(windowId, queryOptions).then(note),
            getCurrent: queryOptions => acira.call('windows.getCurrent')(queryOptions).then(note),
            getLastFocused: queryOptions => acira.call('windows.getLastFocused')(queryOptions).then(note),
            getAll: queryOptions => acira.call('windows.getAll')(queryOptions).then(noteAll),
            create: createData => acira.call('windows.create')(createData).then(note),
            update: (windowId, updateInfo) => acira.call('windows.update')(windowId, updateInfo).then(note),
            remove: windowId => acira.call('windows.remove')(windowId)
          },
          events: {
            onCreated: acira.event('windows.onCreated', {matches: byWindow}),
            onRemoved: acira.event('windows.onRemoved', {matches: byId}),
            onFocusChanged: acira.event('windows.onFocusChanged', {matches: byId}),
            onBoundsChanged: acira.event('windows.onBoundsChanged', {matches: byWindow})
          }
        })
      }
    };
  }
};
