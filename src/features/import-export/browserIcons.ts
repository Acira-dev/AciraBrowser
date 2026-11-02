/** Installed browsers' own app icons, as the main process sends them with the import list (R4-53). They are PNG data URLs read
 *  from the browser's executable; anything else is ignored, so a malformed answer can only ever fall back to the letter tile. */
const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;
const MAX_URL_LENGTH = 96 * 1024;

/** The icon when it is a small PNG data URL; otherwise nothing (the caller draws the letter tile). */
export function safeBrowserIcon(value: unknown): string | undefined {
  return typeof value === 'string' && value.length <= MAX_URL_LENGTH && PNG_DATA_URL.test(value) ? value : undefined;
}

/** The icon for one browser section header, from the `icons` field of an `imports.discover` answer. */
export function browserIconFor(icons: unknown, browser: string): string | undefined {
  if (!icons || typeof icons !== 'object' || !Object.hasOwn(icons, browser)) return undefined;
  return safeBrowserIcon((icons as Record<string, unknown>)[browser]);
}

/** The letter tile shown while a browser has no icon: its first letter. */
export const browserLetter = (browser: string): string => [...browser.trim()][0]?.toLocaleUpperCase() || '?';
