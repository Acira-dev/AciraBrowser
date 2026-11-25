/* Beta 14: where the aura goes. The profile picture lives in the interface (the toolbar's profile button, or the sidebar's foot where the tabs are in the
   sidebar), main draws the aura in its own small layer above it, so the interface measures the picture and tells main in the window's own units (DIPs: CSS px
   times the interface scale, the same units every native view uses; desktop/interface-scale.cjs). Nothing here draws anything.

   `toolbarBottom` is the toolbar's lower edge when the picture is in the toolbar (the glow hangs below it and reaches at most 96 below that edge), null in the
   sidebar's foot (the glow rises above the button instead). Where the toolbar is hidden (Seamless) there is no picture to measure: pass the last rect measured
   while it was showing (`remember`), which is where it will be when the toolbar comes back. */
export interface AuraAnchor {
  avatar: { x: number; y: number; width: number; height: number };
  toolbarBottom: number | null;
  scale: number;
  size: { width: number; height: number };
  source: 'toolbar' | 'sidebar' | 'remembered';
  /** The picture is on screen now (measured live). False for the remembered place of a button whose toolbar is hidden: the aura rests there and waits for the toolbar. */
  visible: boolean;
}

const TOOLBAR_AVATAR = '.browser-shell .profile-button.toolbar-optional-profile .profile-avatar';
/* the open sidebar's foot, or the Shelf rail's profile button (Beta 14): only one of them is drawn at a time */
const SIDEBAR_AVATAR = '.sb-foot-profile .profile-avatar, .sb-rail-profile .profile-avatar';
const TOOLBAR = '.browser-shell';
/** What was last measured, in css px, with the window's width then and which side of the window the picture was on: when the window is resized while the toolbar is away, the place it will come back to
 * moves with the side it is attached to (the toolbar's controls are packed against the right edge, mirrored against the left in a right-to-left window). */
interface Remembered { avatar: AuraAnchor['avatar']; toolbarBottom: number | null; source: 'toolbar' | 'sidebar'; width: number; side: 'start' | 'end' }
let remembered: Remembered | null = null;

const visibleRect = (selector: string) => {
  const element = document.querySelector(selector);
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? rect : null;
};

/** The remembered place for a window of `width` css px: the same distance from the edge it hangs on. Pure (tests). */
export function recallPlace(place: Remembered, width: number): AuraAnchor['avatar'] {
  const shift = place.side === 'end' ? width - place.width : 0;
  return { x: place.avatar.x + shift, y: place.avatar.y, width: place.avatar.width, height: place.avatar.height };
}
/** The rank ring the profile picture the aura is about wears right now (its `data-rank`: the ring the interface draws), on screen or not; null when there is no such picture or it has no ring. The interface tells main when
 * the ring of the rank an aura just earned shows up here, and the layer's own ring (identical, over it) fades then. */
export function auraRingRank(): string | null {
  const element = document.querySelector(TOOLBAR_AVATAR) ?? document.querySelector(SIDEBAR_AVATAR);
  return element ? element.getAttribute('data-rank') : null;
}
/** For tests: forget everything. */
export function forgetAuraAnchor(): void { remembered = null; }
export function rememberAuraAnchor(place: Remembered): void { remembered = place; }

/** The profile picture's rectangle now, in DIPs, or the remembered one when neither is showing; null when there has never been one. `interfaceScale`: the setting (80..150). */
export function measureAuraAnchor(interfaceScale: number): AuraAnchor | null {
  const zoom = interfaceScale > 0 ? interfaceScale / 100 : 1;
  const size = { width: Math.round(window.innerWidth * zoom), height: Math.round(window.innerHeight * zoom) };
  const toolbar = visibleRect(TOOLBAR_AVATAR), foot = visibleRect(SIDEBAR_AVATAR), rect = toolbar ?? foot;
  const dip = (box: { x: number; y: number; width: number; height: number }) => ({ x: box.x * zoom, y: box.y * zoom, width: box.width * zoom, height: box.height * zoom });
  if (!rect) {
    if (!remembered) return null;
    return { avatar: dip(recallPlace(remembered, window.innerWidth)), toolbarBottom: remembered.toolbarBottom === null ? null : remembered.toolbarBottom * zoom, scale: zoom, size, source: 'remembered', visible: false };
  }
  const bar = toolbar ? document.querySelector(TOOLBAR)?.getBoundingClientRect() : null;
  const anchor: AuraAnchor = {
    avatar: dip(rect),
    toolbarBottom: toolbar && bar ? bar.bottom * zoom : null,
    scale: zoom, size, source: toolbar ? 'toolbar' : 'sidebar', visible: true,
  };
  remembered = { avatar: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, toolbarBottom: toolbar && bar ? bar.bottom : null, source: toolbar ? 'toolbar' : 'sidebar', width: window.innerWidth, side: rect.x + rect.width / 2 > window.innerWidth / 2 ? 'end' : 'start' };
  return anchor;
}
