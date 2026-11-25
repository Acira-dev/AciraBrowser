/** Where the address block rests with Sidebar + address (styles/address-in-sidebar.css: `left: var(--addr-left)` inside the header, `width: var(--addr-w)`):
 *  over the sidebar's column, which is left of the page (the block's left is minus the header's x) or right of it (the window's width less the sidebar's, less the header's x).
 *  It is measured, then measured again for 45 frames while the layout settles, and never while the Sidebar mode morph runs (the morph draws the block itself).
 *  D181 (24 Nov): putting the address in the sidebar and the sidebar on the right in one change starts the morph, which outlasts the 45 frames; the only value
 *  written was the first, measured before the page column had moved (header x 240 of a 1100 px window: 620 px, one sidebar width over the page), and it stayed.
 *  Now the block is also placed once when the morph ends, so it always comes to rest over the sidebar. No frame of the morph changes: nothing is written while it runs. */
export interface AddressBlockPlace { side: 'left' | 'right'; width: number; morphRunning: () => boolean; onMorphEnd: (listener: () => void) => () => void }
export interface PlaceFrames { frame: (callback: () => void) => number; cancel: (id: number) => void; windowWidth: () => number }
const browserFrames: PlaceFrames = { frame: (callback) => requestAnimationFrame(callback), cancel: (id) => cancelAnimationFrame(id), windowWidth: () => window.innerWidth };
export const SETTLE_FRAMES = 45;

export const addressBlockLeft = (side: 'left' | 'right', windowWidth: number, sidebarWidth: number, headerX: number) => (side === 'right' ? windowWidth - sidebarWidth - headerX : -headerX);

/** Places the block now and on the frames after; returns the clean-up for the effect. */
export function placeAddressBlock(root: HTMLElement, { side, width, morphRunning, onMorphEnd }: AddressBlockPlace, frames: PlaceFrames = browserFrames): () => void {
  let count = 0, frame = 0;
  const write = () => {
    if (!morphRunning()) root.style.setProperty('--addr-left', addressBlockLeft(side, frames.windowWidth(), width, root.getBoundingClientRect().x) + 'px');
    root.style.setProperty('--addr-w', width + 'px');
  };
  const place = () => { write(); if (++count < SETTLE_FRAMES) frame = frames.frame(place); };
  place();
  const off = onMorphEnd(write);
  return () => { frames.cancel(frame); off(); };
}
