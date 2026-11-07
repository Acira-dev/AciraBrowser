const root = document.documentElement;
root.setAttribute('data-pe', 'ran');
chrome.storage.local.get(['setting'], values => root.setAttribute('data-setting', String(values && values.setting)));
chrome.runtime.sendMessage({ hello: 'private' }).then(answer => root.setAttribute('data-sw', JSON.stringify(answer)), error => root.setAttribute('data-sw', 'error ' + error));
