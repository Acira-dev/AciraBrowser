/** Pure helpers of the site-list editor (no React, no CSS) so they can be tested on their own. */

/** "https://Mail.Example.com/inbox", "mail.example.com" and "*.example.com" all mean the host. */
export const hostOf = (line: string) => {
  const bare = line.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^\*\./, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '').replace(/\.$/, '');
  const labels = bare.split('.');
  // Every dot-separated label is 1-63 letters, digits or inner hyphens; a bare word is not a site (only localhost is).
  return bare.length <= 253 && labels.every((label) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) && (labels.length > 1 || bare === 'localhost') ? bare : '';
};

export const siteLimit = 100;
/** Hosts in a pasted or typed text, separated by commas, semicolons or new lines; invalid pieces are dropped, duplicates collapse. */
export const parseSites = (text: string) => [...new Set(text.split(/[\n,;]+/).map(hostOf).filter(Boolean))].slice(0, siteLimit);

export type AddResult = { next: string[]; result: 'added' | 'invalid' | 'duplicate' | 'full' };
/** What typing `text` into the add field does to `list`. Nothing is stored unless the result is 'added'. */
export function addSites(list: string[], text: string, limit = siteLimit): AddResult {
  const found = parseSites(text);
  if (!found.length) return { next: list, result: 'invalid' };
  const fresh = found.filter((site) => !list.includes(site));
  if (!fresh.length) return { next: list, result: 'duplicate' };
  if (list.length >= limit) return { next: list, result: 'full' };
  return { next: [...list, ...fresh].slice(0, limit), result: 'added' };
}

export const removeSite = (list: string[], site: string) => list.filter((item) => item !== site);
