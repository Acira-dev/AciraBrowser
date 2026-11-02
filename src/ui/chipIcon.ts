import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { DotMatrix } from '../components/DotMatrix';
import { motionScale } from './splitMotion';

/** The icon on a carried chip (a tab or pane dragged out of the strip, the sidebar or a pane ribbon). Founder 27 Oct: the chip must never be blank. A copy
 *  of the icon on screen is used when it is a picture; a loading tab's icon is the dot matrix, a canvas a copy can't carry (it comes out empty), so then
 *  the chip shows, in this order, the site's favicon, the site icon stored on this computer (useSiteIcons), or the loading dot matrix itself (preset
 *  "loader", in the full text colour of R5-11). */
export type ChipIconSource = { kind: 'shown' } | { kind: 'favicon'; src: string } | { kind: 'stored'; src: string } | { kind: 'loader' };
export interface ChipIconTab { url: string; favicon?: string }

export function chipIconSource(shown: { picture: boolean; canvas: boolean }, tab?: ChipIconTab | null, stored?: ((url: string) => string | undefined) | null): ChipIconSource {
  if (shown.picture && !shown.canvas) return { kind: 'shown' };
  if (tab?.favicon) return { kind: 'favicon', src: tab.favicon };
  const icon = tab?.url ? stored?.(tab.url) : undefined;
  if (icon) return { kind: 'stored', src: icon };
  return { kind: 'loader' };
}

let lookup: { tab: (id: string) => ChipIconTab | undefined; stored: (url: string) => string | undefined } | null = null;
/** The app's tabs and stored site icons, for chips made outside React (set by App on every render). */
export function setChipIconLookup(next: typeof lookup) { lookup = next; }

/** A live loading dot matrix for a chip: rendered by its own small root, unmounted once the chip is gone. */
function loaderIcon(size: number): HTMLElement {
  const host = document.createElement('span'); host.className = 'tab-agent-icon chip-icon-loader';
  const root = createRoot(host); root.render(createElement(DotMatrix, { preset: 'loader', size, reducedMotion: motionScale() === 0 }));
  let seen = false, frames = 0;
  const watch = () => { if (host.isConnected) seen = true; else if (seen || ++frames > 240) { root.unmount(); return; } requestAnimationFrame(watch); };
  requestAnimationFrame(watch);
  return host;
}
function pictureIcon(src: string, size: number): HTMLElement {
  const img = document.createElement('img'); img.className = 'chip-icon-picture'; img.src = src; img.alt = ''; img.draggable = false;
  Object.assign(img.style, { width: `${size}px`, height: `${size}px`, objectFit: 'contain', display: 'block' });
  return img;
}
const hasPicture = (node: Element) => Boolean(node.matches('img[src]:not([src=""]),svg') || node.querySelector('img[src]:not([src=""]),svg'));

/** Makes sure a chip's copied icon (`within`: the chip, or the copied tab) shows something: a copied canvas (the loading dot matrix, blank as a copy) or an
 *  empty icon is replaced by the favicon, the stored icon or a live loader. Returns what it chose. */
export function fillChipIcon(within: HTMLElement, tabId?: string, size = 14): ChipIconSource['kind'] {
  const canvas = within.querySelector('canvas'), source = chipIconSource({ picture: hasPicture(within), canvas: Boolean(canvas) }, tabId ? lookup?.tab(tabId) : null, lookup?.stored);
  if (source.kind === 'shown') return source.kind;
  const icon = source.kind === 'loader' ? loaderIcon(size) : pictureIcon(source.src, size);
  if (canvas) { const box = canvas.closest('.tab-agent-icon') ?? canvas; box.replaceWith(icon); within.querySelectorAll('canvas').forEach(other => other.remove()); }
  else { const first = within.firstElementChild; if (first && within.classList.contains('tab-drag-chip')) first.replaceWith(icon); else within.prepend(icon); }
  return source.kind;
}
