// Fixture for "an extension popup follows a size change after it has opened" (13.8 item 9).
// The mode comes from localStorage 'mode' (a rig sets it between two openings), as "<layout>:<trigger>[:<A>x<B>]":
//   layout    natural    explicit-size content, html/body not tied to the window (most extensions: Bitwarden, uBlock Origin Lite, Dark Reader)
//             vh         html, body { height: 100% } around explicit-size content
//             minvh      the content has min-height: 100vh
//             vh100      the app block is 100vh tall; flex  a full-height flex column; bodyh  html, body are as tall as state A's content (a fixed px height)
//             fixed      html, body are 100 % tall and the button is fixed to the bottom of the window (a tab bar)
//             abs        the content is absolutely positioned (its parent is 40 px tall)
//             fluid      content as wide as the window (width: 100%), a height of its own
//             winvars    Proton Pass's way: html, body { width: var(--popup-width); height: var(--popup-height) } and a script that copies the window's size
//                        into the two variables when the window's width changes (its own size is 600 x 430)
//   trigger   timer      the content switches state 700 ms after the page has loaded (and again 700 ms after that)
//             click      the content switches state when #toggle is pressed (a rig presses it; window.__toggle() does the same)
//             none       no change
//   sizes     A, B: "<width>x<height>" of the content in the two states (defaults 300x200 and 360x340); the page starts in state A
// window.__log holds what the page saw: every resize event, and every state change, with the viewport at that moment.
const [layout = 'natural', trigger = 'click', sizes = '300x200,360x340'] = (() => { try { return (localStorage.getItem('mode') || 'natural:click').split(':'); } catch { return ['natural', 'click']; } })();
const [A, B] = sizes.split(',').map(s => s.split('x').map(Number));
const log = window.__log = [];
const seen = what => log.push({what, t: Math.round(performance.now()), iw: innerWidth, ih: innerHeight});
const inner = document.getElementById('inner'), content = document.getElementById('content');
let state = 0;
function apply() {
  const [w, h] = state ? B : A;
  inner.textContent = `${layout} ${state ? 'B' : 'A'} ${w}x${h}`;
  inner.style.cssText = `height:${h}px;width:${layout === 'fluid' ? '100%' : w + 'px'};background:${state ? '#fdd' : '#cde'};font:14px sans-serif;box-sizing:border-box;padding:8px`;
}
const style = document.getElementById('layout-style');
document.body.style.margin = '0';
if (layout === 'minvh') style.textContent = '#app { min-height: 100vh }';
if (layout === 'vh100') style.textContent = '#app { height: 100vh }';
if (layout === 'flex') style.textContent = 'html, body { height: 100%; margin: 0 } #app { display: flex; flex-direction: column; height: 100% } #content { flex: 1 }';
if (layout === 'fixed') style.textContent = 'html, body { height: 100%; margin: 0 } #toggle { position: fixed; left: 0; bottom: 0 }';
if (layout === 'bodyh') style.textContent = 'html, body { height: ' + A[1] + 'px; margin: 0 }';
if (layout === 'abs') style.textContent = '#content { position: relative; height: 40px } #inner { position: absolute; top: 0; left: 0 }';
if (layout === 'vh') style.textContent = 'html, body { height: 100%; margin: 0 } #app { height: 100% }';
if (layout === 'winvars') {
  style.textContent = ':root { --popup-width: ' + A[0] + 'px; --popup-height: ' + A[1] + 'px } html, body { width: var(--popup-width) !important; height: var(--popup-height) !important; margin: 0 } #app { height: 100% }';
  let timer;
  const sync = () => {
    const {clientWidth: w, clientHeight: h} = document.documentElement;
    if (Math.abs(w - parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--popup-width'))) > 1) {
      document.documentElement.style.setProperty('--popup-width', w + 'px');
      document.documentElement.style.setProperty('--popup-height', h + 'px');
    }
  };
  const debounced = () => { clearTimeout(timer); timer = setTimeout(sync, 50); };
  debounced(); addEventListener('resize', debounced);
}
apply();
addEventListener('resize', () => seen('resize'));
function toggle() { state = 1 - state; apply(); seen('state ' + (state ? 'B' : 'A')); }
window.__toggle = toggle;
document.getElementById('toggle').addEventListener('click', toggle);
if (trigger === 'timer') { addEventListener('load', () => { setTimeout(toggle, 700); setTimeout(toggle, 1400); }); }
seen('script');
addEventListener('load', () => seen('load'));
