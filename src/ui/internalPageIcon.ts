import type { AciraGlyphName } from '../components/AciraGlyphs';

/** What stands in a tab's icon slot for Acira's own pages and for a page that failed (round 2, founder: "make the icon
 * for settings just like the normal settings icon … just for the new tab keep our logo … for downloads and those other
 * informative things, put informative icons"). `logo` is the Acira symbol; `private` and `tor` are the tab's privacy mark;
 * a glyph name is a stroke glyph of the Acira family; `null` means a website's own icon. */
export type PageIcon = 'logo' | 'private' | 'tor' | AciraGlyphName;
import pages from '../../desktop/internal-pages.json';
// The route → glyph table is JSON so the "Close Acira?" card (desktop/site-prompt.cjs) reads the same one.
const routes = pages.routes as Record<string, AciraGlyphName>;
export function pageIcon(url: string, privacy?: 'private' | 'tor', error = false): PageIcon | null {
  if (error) return 'warning';
  if (!url.startsWith('acira://')) return null;
  const route = url.slice(8).split(/[?#/]/)[0];
  if (route === '' || route === 'new' || route === 'home') return privacy ?? 'logo';
  return routes[route] ?? (pages.fallback as AciraGlyphName);
}
