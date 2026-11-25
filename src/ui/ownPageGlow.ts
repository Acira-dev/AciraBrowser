import { useSyncExternalStore } from 'react';
import { toOklch } from './colorMath';
import { MAX_CHROMA, MIN_CHROMA, glowHex, type IconColor } from './siteIconColor';

// Acira's own pages (New Tab, Settings, History, Downloads, every acira:// page) have no site colour, so with Settings > Site color on they used to have no tab glow either.
// They now take the THEME's accent (the default Acira blue, or the one the person chose), through the same road a website's colour takes: the sidebar row and the top tab and its pill
// read `rowGlowColour`, the frame glow and the sidebar's edge light read `engineGlowColour`. Only the selected tab and its light change, never the page, and a website keeps its own
// colour (or none while it is not read yet). Strength is the same Soft or Rich the setting already gives; every gate (Off, private, Tor, sleeping, risk, linked copy, window finish) is unchanged.

/** True for Acira's own pages. */
export const isOwnPage = (url: string | undefined): boolean => /^acira:\/\//i.test(url ?? '');

/** An accent with less chroma than this is a grey: there is no colour to glow in, and the tab stays plain, as a website with a grey icon does. */
const MIN_ACCENT_CHROMA = 0.03;

/** A colour (`#rrggbb`) as the hue and chroma a site icon's reading gives (siteIconColor.ts IconColor): its hue, its chroma kept in the icon's range. `undefined` for a grey
 *  or a value that is not a colour. */
export function toneOf(hex: string | undefined): IconColor | undefined {
  if (!hex || !/^#[\da-f]{6}$/i.test(hex)) return undefined;
  const [, chroma, hue] = toOklch(hex);
  if (!(chroma >= MIN_ACCENT_CHROMA)) return undefined;
  const degrees = ((hue * 180 / Math.PI) % 360 + 360) % 360;
  return { h: Math.round(degrees) % 360, c: Math.round(Math.min(MAX_CHROMA, Math.max(MIN_CHROMA, chroma)) * 1000) / 1000 };
}

/** The accent as a glow colour (`#rrggbb`): its hue, its chroma kept in the range a site icon's is, at the one glow lightness (siteIconColor.ts). `undefined` for a grey or a value that is not a colour. */
export function ownPageGlowColour(accent: string | undefined): string | undefined {
  const tone = toneOf(accent);
  return tone ? glowHex(tone) : undefined;
}

/** 14.1 (reported 21 Nov: "the tab's outline red while the light from the sidebar is blue"; "some sites have no tint and don't colour the folder"): ONE colour per site.
 *  The colour main's engine gave the tab (`tab.siteColor`: its theme-color, else its flat top edge, else its icon, else the page's own colour; desktop/site-colour.cjs) is the
 *  site's colour for the row's ring and its top tab, the folder and the frame's glow alike. The ring and the folder used to read the icon on their own (another reading,
 *  another colour for a site with a theme-color or a many-coloured icon). The icon's own reading now only stands in while main has not read the tab (a tab not shown yet
 *  this run). As a ring colour: its hue and chroma at the one glow lightness, like the accent's. */
export const siteGlowColour = (siteColor: string | undefined): string | undefined => ownPageGlowColour(siteColor);

/** The site a page address belongs to, as main names it (desktop/site-colour.cjs hostOf): the http(s) host without www., lower case; '' for anything else. */
const siteHostOf = (url: string): string => { try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.hostname.replace(/^www\./, '').toLowerCase() : ''; } catch { return ''; } };
/** The tab's site colour from main, only while it is the colour of the site the tab SHOWS. Across a navigation to another site main keeps the last colour on the tab until it has
 *  read the new one (the frame's glow never blinks to nothing and back); the ring and the folder must not wear the last site's colour meanwhile (they use the icon until then). */
export function currentSiteColor(tab: { url: string; siteColor?: string; siteColorHost?: string }): string | undefined {
  if (!tab.siteColor || !tab.siteColorHost) return undefined;
  const host = siteHostOf(tab.url);
  return host && host === tab.siteColorHost ? tab.siteColor : undefined;
}

/** The colour a tab row glows in: a website's colour (main's, else its icon's while main has not read it), the accent for an Acira page. `enabled` is false for a row that must not
 *  glow (private, Tor, asleep, risk outline, linked copy). */
export function rowGlowColour(row: { url: string; iconColour: string | undefined; siteColor?: string | undefined; accentGlow: string | undefined; enabled: boolean; error: boolean }): string | undefined {
  if (!isOwnPage(row.url)) return (row.enabled && !row.error ? siteGlowColour(row.siteColor) : undefined) ?? row.iconColour;
  return row.enabled && !row.error ? row.accentGlow : undefined;
}

/** The colour the frame glow and the sidebar's edge light are fed: the page's own colour wins, an Acira page falls back to the accent, a website whose colour is not read yet gets none. */
export function engineGlowColour(input: { siteColor: string | undefined; url: string | undefined; accentGlow: string | undefined }): string | undefined {
  if (input.siteColor) return input.siteColor;
  return isOwnPage(input.url) ? input.accentGlow : undefined;
}

// The accent is handed over by the App (its resolved theme colour) and kept as a glow colour; rows follow it through one tiny store so a new accent repaints them at once.
let current: string | undefined;
const listeners = new Set<() => void>();
export function setOwnPageAccent(accent: string | undefined): void {
  const next = ownPageGlowColour(accent);
  if (next === current) return;
  current = next;
  for (const listener of [...listeners]) listener();
}
export const ownPageAccentGlow = (): string | undefined => current;
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const useOwnPageAccent = (): string | undefined => useSyncExternalStore(subscribe, ownPageAccentGlow, ownPageAccentGlow);
