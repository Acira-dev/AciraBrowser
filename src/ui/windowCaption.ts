import { mix } from './colorMath';

/** Windows' own minimise, maximise and close buttons (titleBarOverlay, desktop/platform.cjs): the colour of the band they sit on and
 * the colour of their glyphs. Full view with tabs on top puts them on the recessed strip row (toolbar-controls.css
 * --tab-strip-recess); with the sidebar on the frame they sit on the sidebar's colour (G, Round 2), or on a toolbar colour of its own
 * (A's frame.css); otherwise on the finish's frame. The glyphs take the ink of that same surface, so the × reads on every finish. */
export function windowCaptionColors(finish: Record<string, string>, colors: Record<string, string>, place: { standardTop: boolean; sidebarFrame: boolean; toolbarOwn: boolean }) {
 const hex = (triple: string) => '#' + triple.split(' ').map(part => Math.max(0, Math.min(255, Math.round(Number(part)))).toString(16).padStart(2, '0')).join('');
 return {
  captionColor: place.standardTop ? mix('#000000', finish['--ed-chrome'], finish['--chrome-tone'] === 'dark' ? .22 : .05) : place.sidebarFrame ? hex(place.toolbarOwn ? colors['--toolbar-rgb'] : finish['--sidebar-rgb']) : finish['--ed-chrome'],
  captionForeground: place.sidebarFrame ? (place.toolbarOwn ? colors['--toolbar-ink'] : finish['--sidebar-ink']) : finish['--chrome-fg'],
 };
}
