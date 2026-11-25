import { runtime } from '../runtime/client';
import { readInfo } from './nowPlaying';
import { samplePalette } from './nowPlayingPalette';
import { dominantHex, paletteFromColor, sampleFromLights } from './videoGlowLights';
import { createInterposer } from './ambientInterpose';

/**
 * The video's own light (Beta 14, "Fullscreen videos fill the window"). While a page fills its page view, the light round the frame (the site glow in the sidebar, Ambient in the sidebar and the toolbar)
 * takes its colours from the VIDEO, the way the now-playing card's glow does, not from the site's icon or from the page's edge (a filled player's edge is its black bars).
 *
 * Nothing is sampled per frame. The colours are the card's: `samplePalette` of the artwork main already fetched for the tab (`media` / `info`), read once per picture at idle and remembered by picture, so a card that
 * already read it makes this a cache hit. A page with no artwork takes the card's own last resort, its site colour (`paletteFromColor`); a white, grey or black site colour says nothing and the light stays as it was.
 * While the page fills, one cheap question to main every few seconds (the picture is sent only when it changed) keeps the colours with the track or the video: a new picture is a new palette, and the light
 * cross-fades to it by the layers' own fades (ambient.ts 300 ms x the speed setting in, 140 ms x out, siteGlowEngine.ts 420 ms; nothing here animates). Main stops reading the page's edge while the page fills (it would read black bars, and a thin
 * capture of a playing video every second and a half is work the glow no longer needs).
 *
 * Colour safety is the layers': Ambient's stops are gated for readable ink and marks over the frame (ambientColours.ts); the site glow's colour is held to the finish's lightness band and gated at its peak
 * (siteGlow.ts). This module only chooses which colours go in.
 *
 *   main: `page-fill` { tabId | null } (desktop/page-fullscreen.cjs `onFill`)  ->  start / stop
 *   out:  window.__aciraAmbient(sample)  (the same entry main's edge reads use; main's own pushes for the filling tab are ignored while the video's light is on)
 *         videoGlowColour(tabId) + subscribeVideoGlow(listener)   (the site glow's colour while the page fills, and a way to hear it change without rendering the App)
 */
const REFRESH_MS = 5000, FIRST_MS = 1200;   // the first answer at once; a second a moment later for a page whose metadata comes a beat after its fullscreen
interface Glow { tabId: string; lights: string[] | null; hex: string | null; src: string | null; tries: number; title: string | undefined }
/** The tab whose page fills (main's word), whether or not the light is wanted; and the two settings that want it. Off and off: no question is asked, no timer runs. */
let fillTab: string | null = null, level = 'soft', ambientOn = false;
const wanted = () => level !== 'off' || ambientOn;
let glow: Glow | null = null, timer = 0, side: 'left' | 'right' = 'left', tabs: readonly { id: string; siteColor?: string; title?: string }[] = [], installed = false, token = 0;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());
const interposer = createInterposer(tabId => !!glow?.lights && glow.tabId === tabId, () => feed());   // Ambient installs after the site glow's first colour: a light asked for before that is drawn when it does

function feed() {
  if (!glow) return;
  const sample = sampleFromLights(glow.lights, side, glow.tabId);
  if (sample) interposer.deliver(sample);
}
/** Use these lights: nothing happens when they are the ones already on; otherwise the light is drawn (cross-faded by the layers) and the site glow told. `src` is the picture they came from, kept so main is asked about
 *  that picture only when it changes. */
function apply(lights: string[] | null, src: string | null) {
  if (!glow) return;
  const same = JSON.stringify(lights) === JSON.stringify(glow.lights);
  if (src) glow.src = src;
  if (same) return;
  glow.lights = lights; glow.hex = dominantHex(lights);
  feed(); notify();
}
const RETRY_MS = 1200, RETRIES = 6;
function later(mine: number, ms: number) { window.setTimeout(() => void refresh(mine), ms); }
async function refresh(mine: number) {
  const now = glow; if (!now || mine !== token) return;
  try {
    const info = readInfo(await runtime.browserCommand({ type: 'media', tabId: now.tabId, action: 'info', have: now.src }));
    if (!glow || mine !== token || glow.tabId !== now.tabId) return;
    const src = info?.artSrc ?? null;
    if (src && info?.art) {   // a picture arrived (main sends it only when it differs from the one held): its palette, once, remembered by picture
      const lights = await samplePalette(info.art);
      if (!glow || mine !== token) return;
      if (lights) { apply(lights, src); return; }
    } else if (src && src === glow.src && glow.lights) return;   // the picture held: the same light, nothing to do
    else if (src && glow.tries < RETRIES) { glow.tries++; later(mine, RETRY_MS); return; }   // the page names a picture and main is still fetching it: wait for it, never show the site's colour in between
    if (glow.src) return;   // a picture's colours are on: an unreadable or missing next one leaves them
    apply(paletteFromColor(tabs.find(tab => tab.id === now.tabId)?.siteColor), null);   // no picture at all: the card's last resort, the site's own colour
  } catch { /* the tab is closing or the page does not answer: the light stays as it is */ }
}
function start(tabId: string) {
  stop(false);
  // `data-video-glow="off"` on the root: the regression rig's way to take the same picture with the video's light left out (the site's own colour and the edge reads, as before).
  if (document.documentElement.getAttribute('data-video-glow') === 'off') return;
  const mine = ++token;
  glow = { tabId, lights: null, hex: null, src: null, tries: 0, title: tabs.find(tab => tab.id === tabId)?.title };
  void refresh(mine);
  window.setTimeout(() => void refresh(mine), FIRST_MS);
  timer = window.setInterval(() => { if (!document.hidden) void refresh(mine); }, REFRESH_MS);
}
function stop(tell = true) {
  window.clearInterval(timer); timer = 0; token++;
  if (!glow) return;
  const left = glow.tabId;
  glow = null;
  // the site glow goes back to the site's colour; the ambient light goes back to the page's own edge read from before the fill (main asks for a fresh one as the page lets go and pushes it if it differs)
  interposer.restore(left);
  if (tell) notify();
}

/** The site glow's colour while this tab's page fills: the video's, or null (the site's own colour then). */
export const videoGlowColour = (tabId: string | undefined): string | null => (glow && tabId && glow.tabId === tabId ? glow.hex : null);
/** The App is told when the video's colour changes without rendering: it re-runs the site glow with its last request (App.tsx), so the light changes and nothing else does. Returns the way to stop listening. */
export const subscribeVideoGlow = (listener: () => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function installVideoGlow(): () => void {
  if (installed || typeof window === 'undefined') return () => {};
  installed = true;
  interposer.install(window as unknown as Parameters<typeof interposer.install>[0]);
  const follow = (raw: unknown) => {
    const state = raw as { tabs?: { id: string; siteColor?: string; title?: string }[]; settings?: { sidebarSide?: string; siteColor?: string; ambientMode?: boolean } } | null;
    if (!state) return;
    if (state.settings) {
      level = state.settings.siteColor ?? level; ambientOn = state.settings.ambientMode === true;
      if (!wanted()) { if (glow) stop(); } else if (fillTab && !glow) start(fillTab);   // the person turned the light on or off while the page fills
    }
    if (Array.isArray(state.tabs)) tabs = state.tabs;   // a reference, nothing built per update: the site colour is looked up only when the page fills and the light is asked for
    // a track that moves on while the page fills (the tab's title changes, as the card notices): ask for its picture soon, once, instead of waiting for the next tick
    if (glow && Array.isArray(state.tabs)) { const title = state.tabs.find(tab => tab.id === glow!.tabId)?.title; if (title !== glow.title) { glow.title = title; glow.tries = 0; later(token, 400); } }
    const next = state.settings?.sidebarSide === 'right' ? 'right' : 'left';
    if (state.settings && next !== side) { side = next; feed(); }
  };
  const offState = window.acira?.subscribe?.(follow as never);
  void window.acira?.getSnapshot?.().then(follow as never).catch(() => {});
  const offEvents = window.acira?.subscribeBrowser?.(raw => {
    const event = raw as unknown as { type?: string; tabId?: string | null; light?: boolean };
    if (event.type !== 'page-fill') return;
    // `light` is main's verdict: a private, Tor or secured tab, a start page, or a window that is being shared keeps Acira's own colours, as it does for the site colour and the edge reads.
    fillTab = typeof event.tabId === 'string' && event.tabId && event.light !== false ? event.tabId : null;
    if (fillTab && wanted()) start(fillTab); else stop();
  });
  return () => { installed = false; stop(false); try { offState?.(); offEvents?.(); } catch { /* gone with the window */ } };
}
