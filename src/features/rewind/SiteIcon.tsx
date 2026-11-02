import type { CSSProperties } from 'react';
import { host } from './client';
import './rewind.css';

/** Site initial in a tile, for sites Acira has no icon for yet. Rewind never fetches icons (REWIND_SPEC §2: opening it contacts no website). */
export function SiteMark({ url, size = 16, className = '' }: { url: string; size?: number; className?: string }) {
  const name = host(url), letter = (/[a-z]/i.exec(name.replace(/^(www|m|app)\./, ''))?.[0] || '•').toUpperCase();
  let hue = 0; for (const ch of name) hue = (hue * 31 + ch.charCodeAt(0)) % 360;
  return <span className={`rw-mark ${className}`.trim()} style={{ width: size, height: size, '--rw-hue': hue } as CSSProperties} aria-hidden>{letter}</span>;
}
/** The site's own icon when Acira kept one while you were there (local store, no network), else its initial. */
export function SiteIcon({ url, icon, size = 16, className = '' }: { url: string; icon?: string; size?: number; className?: string }) {
  return icon ? <img className={`rw-favicon ${className}`.trim()} src={icon} width={size} height={size} alt="" aria-hidden draggable={false} /> : <SiteMark url={url} size={size} className={className} />;
}
