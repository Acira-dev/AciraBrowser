// The popup page (popup.js) reads its mode from this extension's localStorage; this page, of the same origin, sets it without a debugger.
const $ = id => document.getElementById(id);
const [layout = 'natural', trigger = 'click', sizes = '360x340,300x120'] = (localStorage.getItem('mode') || '').split(':');
$('layout').value = layout; $('trigger').value = trigger; $('sizes').value = sizes;
$('save').addEventListener('click', () => { localStorage.setItem('mode', `${$('layout').value}:${$('trigger').value}:${$('sizes').value}`); $('saved').textContent = 'saved: ' + localStorage.getItem('mode'); });
