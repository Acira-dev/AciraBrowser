/** Address-bar presentation of a URL at rest (design bible §5.1): scheme and `www.` hidden, the registrable
 * domain emphasised, the rest quieter, and `Not secure` only for plain HTTP to a non-local host. */
export interface UrlDisplay { prefix: string; domain: string; rest: string; insecure: boolean }
const secondLevel = new Set(['co', 'com', 'net', 'org', 'gov', 'edu', 'ac', 'or', 'ne', 'go', 'gob', 'nic', 'mil', 'ltd', 'plc']);
const loopback = (host: string) => host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' || /^127\./.test(host);
const ipLike = (host: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[');

/** The last two labels, or three when the second-level label is a common country SLD (`bbc.co.uk`). */
export function registrableDomain(host: string): string {
  if (ipLike(host) || !host.includes('.')) return host;
  const labels = host.split('.');
  if (labels.length >= 3 && labels.at(-1)!.length === 2 && secondLevel.has(labels.at(-2)!)) return labels.slice(-3).join('.');
  return labels.slice(-2).join('.');
}

export function urlDisplay(value: string): UrlDisplay | null {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol === 'acira:') return { prefix: 'acira://', domain: url.host + url.pathname.replace(/^\/\//, ''), rest: '', insecure: false };
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const host = url.host.replace(/^www\./, ''), hostname = url.hostname.replace(/^www\./, '');
  const domain = registrableDomain(hostname), subdomain = hostname.slice(0, Math.max(0, hostname.length - domain.length));
  const port = host.slice(hostname.length), tail = `${url.pathname === '/' ? '' : url.pathname}${url.search}${url.hash}`;
  return { prefix: subdomain, domain, rest: port + tail, /* an onion address is encrypted end to end by Tor itself, without a certificate: never "Not secure" (Tor Browser shows an onion mark) */ insecure: url.protocol === 'http:' && !loopback(url.hostname) && !/\.onion$/i.test(url.hostname) && !/^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(url.hostname) };
}
