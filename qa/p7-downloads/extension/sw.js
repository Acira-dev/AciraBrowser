// P7 live check: chrome.downloads from an extension's service worker, against a local server (qa/p7-downloads-live.mjs).
importScripts('config.js');
const base = self.P7.base;
const events = {created: [], changed: [], erased: []};
const results = {};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
chrome.downloads.onCreated.addListener(item => events.created.push({id: item.id, url: item.url, state: item.state, byExtensionId: item.byExtensionId, filename: item.filename}));
chrome.downloads.onChanged.addListener(delta => events.changed.push(delta));
chrome.downloads.onErased.addListener(id => events.erased.push(id));
// chrome.history events (Vimium keeps its history cache current with these): each one is posted to the local server as it happens.
chrome.history.onVisited.addListener(item => fetch(base + '/hist', {method: 'POST', body: JSON.stringify({type: 'visited', item})}));
chrome.history.onVisitRemoved.addListener(info => fetch(base + '/hist', {method: 'POST', body: JSON.stringify({type: 'removed', info})}));

async function until(read, ms = 20000, every = 100) {
  const end = Date.now() + ms;
  for (;;) { const value = await read(); if (value) return value; if (Date.now() > end) throw new Error('timed out'); await sleep(every); }
}
const finished = id => until(async () => { const [item] = await chrome.downloads.search({id}); return item && item.state !== 'in_progress' ? item : null; });
async function step(name, run) {
  try { results[name] = {ok: true, value: await run()}; } catch (error) { results[name] = {ok: false, error: String(error && error.message || error)}; }
}
const slim = item => item && ({id: item.id, url: item.url, finalUrl: item.finalUrl, filename: item.filename, state: item.state, paused: item.paused, canResume: item.canResume, error: item.error,
  bytesReceived: item.bytesReceived, totalBytes: item.totalBytes, fileSize: item.fileSize, exists: item.exists, mime: item.mime, byExtensionId: item.byExtensionId, byExtensionName: item.byExtensionName,
  hasStart: !!item.startTime, hasEnd: !!item.endTime, danger: item.danger, incognito: item.incognito});

(async () => {
  await step('plain', async () => {
    const id = await chrome.downloads.download({url: base + '/file/a.txt', filename: 'p7/a.txt'});
    return {id, item: slim(await finished(id))};
  });
  await step('uniquify', async () => {
    const id = await chrome.downloads.download({url: base + '/file/a.txt', filename: 'p7/a.txt', conflictAction: 'uniquify'});
    return slim(await finished(id));
  });
  await step('overwrite', async () => {
    const id = await chrome.downloads.download({url: base + '/file/a2.txt', filename: 'p7/a.txt', conflictAction: 'overwrite'});
    return slim(await finished(id));
  });
  await step('headers', async () => {
    const id = await chrome.downloads.download({url: base + '/echo-headers', filename: 'p7/headers.json', headers: [{name: 'X-P7', value: 'hello'}, {name: 'Authorization', value: 'Bearer t0k'}]});
    return slim(await finished(id));
  });
  await step('redirect', async () => {
    const id = await chrome.downloads.download({url: base + '/redir', filename: 'p7/redirected.txt'});
    return slim(await finished(id));
  });
  await step('attachment-name', async () => {
    const id = await chrome.downloads.download({url: base + '/attach'});
    return slim(await finished(id));
  });
  await step('cookies', async () => {
    const id = await chrome.downloads.download({url: base + '/secure/c.txt', filename: 'p7/secure.txt'});
    return slim(await finished(id));
  });
  await step('not-found', async () => {
    const id = await chrome.downloads.download({url: base + '/missing', filename: 'p7/missing.txt'});
    return slim(await finished(id));
  });
  await step('refused-port', async () => {
    const id = await chrome.downloads.download({url: 'http://127.0.0.1:9/never', filename: 'p7/never.txt'});
    return slim(await finished(id));
  });
  await step('data-url', async () => {
    const id = await chrome.downloads.download({url: 'data:text/plain;base64,aGVsbG8gZGF0YQ==', filename: 'p7/data.txt'});
    return slim(await finished(id));
  });
  await step('pause-resume', async () => {
    const id = await chrome.downloads.download({url: base + '/slow?n=8', filename: 'p7/slow.bin'});
    await until(async () => { const [item] = await chrome.downloads.search({id}); return item && item.bytesReceived > 0; });
    await chrome.downloads.pause(id);
    const [paused] = await chrome.downloads.search({id});
    const pausedAt = paused.bytesReceived;
    await sleep(1200);
    const [still] = await chrome.downloads.search({id});
    await chrome.downloads.resume(id);
    const done = await finished(id);
    return {paused: slim(paused), stillPaused: still.paused, noProgressWhilePaused: still.bytesReceived === pausedAt || still.bytesReceived - pausedAt < 2048, done: slim(done)};
  });
  await step('cancel', async () => {
    const id = await chrome.downloads.download({url: base + '/slow?n=20', filename: 'p7/cancelled.bin'});
    await until(async () => { const [item] = await chrome.downloads.search({id}); return item && item.bytesReceived > 0; });
    await chrome.downloads.cancel(id);
    return slim(await finished(id));
  });
  await step('search', async () => {
    const all = await chrome.downloads.search({});
    const byQuery = await chrome.downloads.search({query: ['secure']});
    const sorted = await chrome.downloads.search({orderBy: ['-startTime'], limit: 3});
    const done = await chrome.downloads.search({state: 'complete', exists: true});
    const regex = await chrome.downloads.search({filenameRegex: 'headers\\.json$'});
    return {total: all.length, byQuery: byQuery.map(i => i.filename), sortedIds: sorted.map(i => i.id), complete: done.length, regex: regex.length, ids: all.map(i => i.id)};
  });
  await step('invalid', async () => {
    const out = {};
    for (const [name, options] of [['url', {url: 'nope'}], ['filename', {url: base + '/file/a.txt', filename: '../x.txt'}], ['header', {url: base + '/file/a.txt', headers: [{name: 'Cookie', value: 'a=b'}]}]]) {
      try { await chrome.downloads.download(options); out[name] = 'resolved'; } catch (error) { out[name] = error.message; }
    }
    try { await chrome.downloads.pause(987654); } catch (error) { out.badId = error.message; }
    return out;
  });
  await step('erase', async () => {
    const [victim] = await chrome.downloads.search({filenameRegex: 'data\\.txt$'});
    const erased = await chrome.downloads.erase({id: victim.id});
    await sleep(300);
    return {erased, after: (await chrome.downloads.search({id: victim.id})).length};
  });
  await fetch(base + '/report', {method: 'POST', body: JSON.stringify({results, events})});
})();
