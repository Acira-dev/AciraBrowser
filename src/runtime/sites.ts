import { navigationTitle } from './navigation';


/** Public destinations only. These shortcuts do not imply an authenticated account. */
export const DEFAULT_FAVORITES = [
  { url: 'https://mail.google.com/', label: 'Gmail', icon: '/site-icons/gmail.ico' },
  { url: 'https://docs.google.com/document/', label: 'Google Docs', icon: '/site-icons/docs.png' },
  { url: 'https://www.youtube.com/', label: 'YouTube', icon: '/site-icons/youtube.ico' },
  { url: 'https://drive.google.com/', label: 'Google Drive', icon: '/site-icons/drive.png' },
] as const;

export interface SiteIdentity {
  label: string;
  icon?: string;
  kind: 'web' | 'internal' | 'mail' | 'document' | 'supplier' | 'records' | 'store';
  letter?: string;
  color?: string;
}

/** Match parsed origins, never a substring in an arbitrary URL or page title. */
export function siteIdentity(input: string): SiteIdentity {
  const url=input;
  if (url.startsWith('acira://')) return { label: navigationTitle(url), kind: 'internal' };
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return { label: 'Page', kind: 'web' };
    const host = parsed.hostname.toLowerCase();
    if (host === 'mail.google.com') return { ...DEFAULT_FAVORITES[0], kind: 'web' };
    if (host === 'docs.google.com' && !/^\/(spreadsheets|presentation|forms)(\/|$)/.test(parsed.pathname)) return { ...DEFAULT_FAVORITES[1], kind: 'web' };
    if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'].includes(host)) return { ...DEFAULT_FAVORITES[2], label: host === 'music.youtube.com' ? 'YouTube Music' : 'YouTube', kind: 'web' };
    if (host === 'drive.google.com') return { ...DEFAULT_FAVORITES[3], kind: 'web' };
    return { label: host.replace(/^www\./, ''), kind: 'web' };
  } catch { return { label: 'Page', kind: 'web' }; }
}

