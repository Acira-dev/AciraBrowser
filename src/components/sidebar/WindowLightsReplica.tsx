import '../../styles/window-lights.css';

/** Beta 14.0 re-release: the Mac's three window buttons are native and cannot ride the sidebar's slide (they can only be shown, hidden or placed), so in Sidebar + address three replicas stand in the sidebar's
 * top row at the native buttons' exact place (x 12 pt, 23 pt apart, 14 pt wide, y as main places them: setWindowButtonPosition) and travel with the panel: they leave with it on a close and arrive with it on a reveal or a dock.
 * They are always there under the native buttons (same disc, so nothing shows at rest) and carry the motion while the native ones are away (ui/sidebarLights.ts). The look is the native one for the window's state
 * (grey while it is not the active window, coloured while it is: the root's `data-window-active`, ui/windowActive.ts; the yellow one is the disabled grey in both states, as in the team's own window). Sizes are in window points: the interface is zoomed by the interface scale, so a point is 1/zoom of a CSS px. Not drawn on Windows or Linux, in fullscreen, or in Seamless. */
export function lightsPlace(scale: number, toolbar: number): { top: number; unit: number } {
  const unit = 100 / Math.max(25, scale);
  return { top: Math.max(4, Math.round((toolbar * (scale / 100) - 14) / 2)) * unit, unit };
}
export function WindowLightsReplica({ scale, toolbar }: { scale: number; toolbar: number }) {
  const { top, unit } = lightsPlace(scale, toolbar);
  return <span className="wl-replica" aria-hidden="true" style={{ '--wl-u': `${unit}px`, '--wl-top': `${top}px` } as React.CSSProperties}><i className="wl-dot wl-close"/><i className="wl-dot wl-min"/><i className="wl-dot wl-zoom"/></span>;
}
