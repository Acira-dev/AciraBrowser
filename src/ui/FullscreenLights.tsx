import { useWindowFullscreen } from './windowFullscreen';
import { t as tr } from '../i18n';
import { isMac } from './platform';

/** macOS draws a window's traffic lights in the title bar, and AppKit's fullscreen title strip (which holds them) is kept invisible so it never
 * covers the tab row (desktop/native/mac-material.mm), so in fullscreen the window would have no close, no way out of fullscreen. These are Acira's
 * own, drawn where the real ones stand in a window (platform.css keeps their corner in fullscreen too, fullscreen-lights.css places them): the
 * red one closes the window, the yellow one is dimmed as macOS dims it in fullscreen, the green one leaves fullscreen. Seamless shows them with the
 * top bar, as the real ones come and go with it. The component only exists in a fullscreen window; main does the work (`window-control`). */
const send = (tabId: string, action: 'close' | 'exit-fullscreen') => { void Promise.resolve(window.acira?.browserCommand({ type: 'window-control', tabId, action })).catch(() => {}); };

export function FullscreenLights({ tabId }: { tabId: string }) {
  const fullscreen = useWindowFullscreen();
  return fullscreen && isMac() ? <Lights tabId={tabId}/> : null;
}

/** The drawing itself (a function of its own so a test can render it). */
export function Lights({ tabId }: { tabId: string }) {
  // Not tab stops (the real lights are not either): Cmd+W and the Full screen shortcut are the keyboard's.
  return <div className="fs-lights">
    <button type="button" className="fs-light fs-light-close" tabIndex={-1} aria-label={tr('shortcutCmd.close-window')} onClick={() => send(tabId, 'close')}>
      <svg viewBox="0 0 14 14" aria-hidden="true"><path d="M4.6 4.6l4.8 4.8M9.4 4.6l-4.8 4.8"/></svg>
    </button>
    <span className="fs-light fs-light-min" aria-hidden="true"/>
    <button type="button" className="fs-light fs-light-zoom" tabIndex={-1} aria-label={tr('shortcutCmd.fullscreen')} onClick={() => send(tabId, 'exit-fullscreen')}>
      <svg viewBox="0 0 14 14" aria-hidden="true"><path d="M6.6 7.4V3.4l4 4z"/><path d="M7.4 6.6v4l-4-4z"/></svg>
    </button>
  </div>;
}
