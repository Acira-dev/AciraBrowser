// Extension page half of the P7 live check: a blob: URL made in the page is downloaded through chrome.downloads (the usual "Export" button).
const base = new URLSearchParams(location.search).get('base');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, ms = 20000) { const end = Date.now() + ms; for (;;) { const value = await read(); if (value) return value; if (Date.now() > end) throw new Error('timed out'); await sleep(100); } }
(async () => {
  const out = {};
  try {
    const url = URL.createObjectURL(new Blob(['hello from a blob'], {type: 'text/plain'}));
    const id = await chrome.downloads.download({url, filename: 'p7/blob.txt'});
    const [item] = await chrome.downloads.search({id});
    const done = await until(async () => { const [now] = await chrome.downloads.search({id}); return now && now.state !== 'in_progress' ? now : null; });
    out.blob = {ok: true, state: done.state, error: done.error, filename: done.filename, bytes: done.bytesReceived, startUrlScheme: item && item.url.split(':')[0]};
  } catch (error) { out.blob = {ok: false, error: String(error && error.message || error)}; }
  try {
    const all = await chrome.downloads.search({});
    out.pageSearch = {ok: true, total: all.length};
  } catch (error) { out.pageSearch = {ok: false, error: String(error && error.message || error)}; }
  await fetch(base + '/report-page', {method: 'POST', body: JSON.stringify(out)});
})();
