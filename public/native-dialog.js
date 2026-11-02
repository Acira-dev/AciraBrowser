'use strict';
// Renders the question it is given with textContent only (website-provided text is never parsed as HTML).
// The window is reused, so every question rebuilds the page from scratch.
let state = { buttons: [], defaultId: 0, cancelId: 0 };
let selected = -1;
// The window is shown after the page is built; focus set while hidden does not survive, so the default (the safe answer
// when the action is risky) is focused again when the window gains focus, unless the person already moved focus.
let focusDefault = () => {};
window.addEventListener('focus', () => { if (!document.activeElement || document.activeElement === document.body || document.activeElement === actions.firstElementChild) focusDefault(); });
const actions = document.getElementById('actions');
const choose = index => {
  selected = index;
  [...document.getElementById('items').children].forEach((child, at) => child.setAttribute('aria-checked', String(at === index)));
};
document.addEventListener('keydown', event => {
  const buttons = [...actions.children], items = [...document.getElementById('items').children];
  if (!buttons.length) return;
  const onItem = items.includes(document.activeElement);
  if (event.key === 'Escape') { event.preventDefault(); window.aciraDialog.respond(state.cancelId, undefined, true); }
  else if (event.key === 'Enter' && (onItem || document.activeElement?.tagName !== 'BUTTON')) { event.preventDefault(); window.aciraDialog.respond(state.defaultId, selected < 0 ? undefined : selected); }
  else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
    event.preventDefault();
    const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
    if (onItem || (items.length && !buttons.includes(document.activeElement))) {
      const next = (Math.max(0, items.indexOf(document.activeElement)) + step + items.length) % items.length;
      choose(next); items[next].focus();
    } else { const at = Math.max(0, buttons.indexOf(document.activeElement)); buttons[(at + step + buttons.length) % buttons.length].focus(); }
  }
});
window.aciraDialog.onInit(payload => {
  state = payload;
  document.documentElement.toggleAttribute('data-dark', !!payload.dark);
  document.documentElement.toggleAttribute('data-popover', !!payload.popover);
  const kicker = document.getElementById('kicker');
  kicker.hidden = !payload.kicker;
  kicker.textContent = payload.kicker || '';
  kicker.toggleAttribute('data-warning', !!payload.warning);
  document.getElementById('title').textContent = payload.title || payload.kicker || '';
  const detail = document.getElementById('detail');
  detail.textContent = payload.detail || '';
  detail.hidden = !payload.detail;
  // Optional choices (screen or window to share): one is always selected, arrow keys move between them.
  const list = document.getElementById('items');
  selected = payload.items?.length ? 0 : -1;
  list.hidden = !payload.items?.length;
  list.replaceChildren(...(payload.items || []).map((item, index) => {
    const option = document.createElement('button');
    option.type = 'button';
    option.setAttribute('role', 'radio');
    option.setAttribute('aria-checked', String(index === selected));
    option.className = 'item';
    if (item.thumb) { const image = document.createElement('img'); image.src = item.thumb; image.alt = ''; option.appendChild(image); }
    const label = document.createElement('span'), kind = document.createElement('small');
    label.textContent = item.label; kind.textContent = item.kind;
    option.append(kind, label);
    option.addEventListener('click', () => choose(index));
    option.addEventListener('dblclick', () => window.aciraDialog.respond(state.defaultId, index));
    return option;
  }));
  // Windows order (bible §4): the actions first, the safe (cancel) answer last. A dialog accents its default; a prompt
  // accents its action and still focuses the safe default.
  const order = payload.buttons.map((_, index) => index).sort((a, b) => (a === payload.cancelId) - (b === payload.cancelId));
  const accent = payload.popover ? order.find(index => index !== payload.cancelId) ?? payload.defaultId : payload.defaultId;
  actions.replaceChildren(...order.map(index => {
    const label = payload.buttons[index];
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.dataset.index = String(index);
    if (index === accent) button.setAttribute('data-primary', '');
    // A warning's action that is not the safe default is destructive: red text (bible §4).
    else if (payload.warning && !payload.popover && index !== payload.cancelId) button.setAttribute('data-danger', '');
    button.addEventListener('click', () => window.aciraDialog.respond(index, index === payload.cancelId ? undefined : selected < 0 ? undefined : selected));
    return button;
  }));
  focusDefault = () => actions.querySelector('[data-index="' + payload.defaultId + '"]')?.focus();
  focusDefault();
  // No requestAnimationFrame: the window is hidden between questions and a hidden page never paints a frame.
  Promise.resolve(document.fonts?.ready).catch(() => undefined).then(() => window.aciraDialog.ready(Math.ceil(document.getElementById('root').getBoundingClientRect().height)));
});
