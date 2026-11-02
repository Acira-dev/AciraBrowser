/** Addresses that have no name to spell: IP addresses, localhost and local files. A letter monogram would read as broken
 *  ("1" for 127.0.0.1), so these get a neutral globe; letters are only for real hostnames. */
export function isAddressLike(url: string): boolean {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return !/[a-z]/i.test(url) || /^localhost(?::\d+)?(?:\/|$)/i.test(url); }
  if (parsed.protocol === 'file:') return true;
  const name = parsed.hostname.toLowerCase();
  if (!name) return true;
  if (name === 'localhost' || name.endsWith('.localhost')) return true;
  if (name.startsWith('[')) return true;
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(name);
}
