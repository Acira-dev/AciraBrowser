chrome.runtime.onMessage.addListener((message, sender, send) => { send({ ok: true, tab: !!(sender && sender.tab), echo: message && message.hello }); return true; });
