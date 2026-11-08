// Records every chrome.bookmarks event the service worker hears, in order, in chrome.storage.session ("events").
const NAMES = ['onCreated', 'onChanged', 'onMoved', 'onRemoved', 'onChildrenReordered', 'onImportBegan', 'onImportEnded'];
let chain = Promise.resolve();
const record = (name, args) => { chain = chain.then(async () => { const { events = [] } = await chrome.storage.session.get('events'); events.push({ name, args }); await chrome.storage.session.set({ events }); }).catch(() => {}); };
for (const name of NAMES) chrome.bookmarks[name].addListener((...args) => record(name, args));
chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message === 'events') { chain.then(() => chrome.storage.session.get('events')).then(({ events = [] }) => reply(events)); return true; }
  if (message === 'clear') { chain = chain.then(() => chrome.storage.session.set({ events: [] })).then(() => reply(true)); return true; }
  return false;
});
