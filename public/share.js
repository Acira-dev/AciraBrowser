'use strict';
// The share picker and the sharing pill (desktop/share-ui.cjs). Text and pictures arrive from the main process and are set with
// textContent / img.src only; names of windows and pages are never parsed as HTML. The window is reused, so each init rebuilds the page.
const $ = id => document.getElementById(id);
const pill = location.search === '?pill';
document.documentElement.toggleAttribute('data-pill', pill);
let state = null, group = 'screen', selected = null;
const audioOn = {};
const report = () => requestAnimationFrame(() => {
  const box = (pill ? $('pill') : $('picker')).getBoundingClientRect();
  window.aciraShare.ready({width: Math.ceil(box.width) + (pill ? 32 : 0), height: Math.ceil(box.height) + (pill ? 32 : 0)});
});

function cards() { return [...$('items').querySelectorAll('.card')]; }
// A row the list's bottom edge cuts fades out; once the end is reached nothing fades.
function fade() { const list = $('items'); list.toggleAttribute('data-more', list.scrollHeight - list.scrollTop - list.clientHeight > 1); }
$('items').addEventListener('scroll', fade, {passive: true});
function choose(key, focus = false) {
  selected = key;
  for (const card of cards()) card.setAttribute('aria-checked', String(card.dataset.key === key));
  $('share').disabled = !key;
  if (focus) cards().find(card => card.dataset.key === key)?.focus();
}
function showGroup(next) {
  group = next;
  for (const tab of $('groups').children) tab.setAttribute('aria-selected', String(tab.dataset.group === next));
  const list = state.items.filter(item => item.group === next);
  $('items').replaceChildren(...(list.length ? list.map(item => {
    const card = document.createElement('button');
    card.type = 'button'; card.className = 'card'; card.dataset.key = item.key;
    card.setAttribute('role', 'radio'); card.setAttribute('aria-checked', 'false');
    const thumb = document.createElement('span'); thumb.className = 'thumb';
    const initial = document.createElement('span'); initial.className = 'initial'; initial.textContent = (item.label || '?').trim().charAt(0).toUpperCase();
    const image = document.createElement('img'); image.alt = '';
    image.addEventListener('load', () => { image.toggleAttribute('data-shown', true); initial.hidden = true; });
    if (item.thumb) image.src = item.thumb;
    thumb.append(initial, image);
    const meta = document.createElement('span'); meta.className = 'meta';
    const name = document.createElement('span'); name.className = 'name'; name.textContent = item.label; name.title = item.label;
    meta.append(name);
    if (item.detail) { const sub = document.createElement('span'); sub.className = 'sub'; sub.textContent = item.detail; meta.append(sub); }
    card.append(thumb, meta);
    card.addEventListener('click', () => choose(item.key));
    card.addEventListener('dblclick', () => { choose(item.key); share(); });
    return card;
  }) : [Object.assign(document.createElement('p'), {className: 'empty', textContent: state.text.empty})]));
  choose(list[0]?.key || null);
  $('items').scrollTop = 0; fade();
  const audio = !!state.audio[next];
  $('audio-row').hidden = !audio;
  $('audio').checked = audio && (audioOn[next] ?? next === 'tab');
}
function share() { if (selected) window.aciraShare.respond({key: selected, audio: !!state.audio[group] && $('audio').checked}); }
function cancel() { window.aciraShare.respond(null); }

window.aciraShare.onInit(payload => {
  state = payload;
  document.documentElement.toggleAttribute('data-dark', !!payload.dark);
  if (payload.mode === 'pill') {
    // The sharer's name shortens with an ellipsis; the rest of the sentence ("is sharing a tab") always shows whole.
    const part = (text, className) => Object.assign(document.createElement('span'), {className, textContent: text || ''});
    $('pill-label').replaceChildren(part(payload.text.before, 'fixed'), part(payload.text.name, 'who'), part(payload.text.after, 'fixed'));
    $('pill-label').setAttribute('aria-label', payload.text.label || '');
    $('pill-label').querySelector('.who').title = payload.text.name || '';
    $('pill-more').textContent = payload.text.more || '';
    $('pill-more').hidden = !payload.text.more;
    $('stop').textContent = payload.text.stop;
    $('pill').hidden = false;
    report();
    return;
  }
  $('title').textContent = payload.text.title;
  $('detail').textContent = payload.text.detail;
  $('audio-label').textContent = payload.text.audio;
  $('share').textContent = payload.text.share;
  $('cancel').textContent = payload.text.cancel;
  $('groups').replaceChildren(...payload.groups.map(name => {
    const tab = document.createElement('button');
    tab.type = 'button'; tab.dataset.group = name; tab.setAttribute('role', 'tab'); tab.textContent = payload.text[name];
    tab.addEventListener('click', () => showGroup(name));
    return tab;
  }));
  $('groups').hidden = payload.groups.length < 2;
  // Open on the first group that has something in it.
  showGroup(payload.groups.find(name => payload.items.some(item => item.group === name)) || payload.groups[0]);
  $('picker').hidden = false;
  report();
  window.focusDefault = () => (cards().find(card => card.dataset.key === selected) || $('cancel')).focus();
  window.focusDefault();
});
window.aciraShare.onThumbs(thumbs => {
  if (!state || pill) return;
  for (const item of state.items) if (thumbs[item.key]) item.thumb = thumbs[item.key];
  for (const card of cards()) {
    const next = thumbs[card.dataset.key], image = card.querySelector('img');
    if (next && image && image.src !== next) image.src = next;
  }
});
$('audio').addEventListener('change', () => { audioOn[group] = $('audio').checked; });
$('share').addEventListener('click', share);
$('cancel').addEventListener('click', cancel);
$('stop').addEventListener('click', () => window.aciraShare.stop());
window.addEventListener('focus', () => { if (!pill && (!document.activeElement || document.activeElement === document.body)) window.focusDefault?.(); });
document.addEventListener('keydown', event => {
  if (pill || !state) return;
  if (event.key === 'Escape') { event.preventDefault(); cancel(); return; }
  if (event.key === 'Enter' && document.activeElement?.id !== 'cancel' && document.activeElement?.closest?.('.seg') == null) { event.preventDefault(); share(); return; }
  const list = cards();
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) || !list.length || !list.includes(document.activeElement)) return;
  event.preventDefault();
  const at = list.indexOf(document.activeElement), step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' ? -3 : 3;
  const next = list[Math.min(list.length - 1, Math.max(0, at + step))];
  choose(next.dataset.key, true);
});
