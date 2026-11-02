// Command loop for qa/extension-api-probe/tabs-e2e.mjs: long-polls the QA server for {id, call: 'tabs.query', args: [...]} or {id, op: 'events'},
// runs it with the real chrome.tabs of this extension and reports {id, ok, value | error}. Every chrome.tabs event is recorded in order.
const base = new URL(location.href).searchParams.get('base');
const events = [];
for (const name of ['onCreated', 'onUpdated', 'onMoved', 'onActivated', 'onHighlighted', 'onDetached', 'onAttached', 'onRemoved', 'onReplaced']) {
  chrome.tabs[name].addListener((...args) => events.push({event: name, args: JSON.parse(JSON.stringify(args)), at: Date.now()}));
}
const senders = [];
chrome.runtime.onMessage.addListener((message, sender) => { if (message && message.hi) senders.push({url: message.hi, tab: JSON.parse(JSON.stringify(sender.tab || null))}); });
const plain = value => (value === undefined ? null : JSON.parse(JSON.stringify(value)));
const send = (path, body) => fetch(base + path, {method: 'POST', body: JSON.stringify(body)}).catch(() => {});
(async () => {
  await send('/hello', {id: chrome.runtime.id});
  for (;;) {
    let command;
    try { command = await (await fetch(base + '/cmd')).json(); } catch { await new Promise(r => setTimeout(r, 500)); continue; }
    if (!command || !command.id) continue;
    try {
      if (command.op === 'events') { const out = events.splice(0, events.length); await send('/report', {id: command.id, ok: true, value: out}); continue; }
      if (command.op === 'senders') { await send('/report', {id: command.id, ok: true, value: senders.slice()}); continue; }
      const [ns, fn] = command.call.split('.');
      if (command.callback) {   // the callback form, as old code (Chrono's chrome.windows.getCurrent(function (w) {...})) calls it
        const reply = await new Promise(resolve => chrome[ns][fn](...(command.args || []), (...values) => resolve({value: plain(values[0]), count: values.length, lastError: chrome.runtime.lastError ? chrome.runtime.lastError.message : null})));
        await send('/report', {id: command.id, ok: true, value: reply});
        continue;
      }
      const value = await chrome[ns][fn](...(command.args || []));
      await send('/report', {id: command.id, ok: true, value: plain(value)});
    } catch (error) {
      await send('/report', {id: command.id, ok: false, error: String(error && error.message || error)});
    }
  }
})();
