import {AciraSymbol} from './AciraSymbol';
import { AciraGlyph } from './AciraGlyphs';
import { TabPrivacyMark } from './TabPrivacyMark';
import { pageIcon } from '../ui/internalPageIcon';
import { useState } from 'react';
import { siteIdentity } from '../runtime/sites';
import { Globe2 } from './AppIcons';
import './tab-sleeping.css';

/** The parent control supplies its accessible name. Website icons never own hit targets. */
export function SiteIdentityIcon({ url, favicon, size = 16, className = '', privacy, error = false }: { url: string; favicon?: string; size?: number; className?: string; privacy?: 'private' | 'tor'; error?: boolean }) {
  const identity = siteIdentity(url);
  const source = identity.icon || (favicon && /^(https?:|data:image\/|acira-app:)/i.test(favicon) ? favicon : '');
  const [failedSource, setFailedSource] = useState('');
  const style = { width: size, height: size, flexShrink: 0, pointerEvents: 'none' as const };
  // Acira's own pages wear an informative glyph (only the New tab keeps the logo); a failed page shows the alert.
  const page = pageIcon(url, privacy, error);
  if (page === 'logo') return <AciraSymbol size={size} className={className}/>;
  if (page === 'private' || page === 'tor') return <TabPrivacyMark privacy={page} size={size} className={`site-identity-icon ${className}`}/>;
  if (page) return <AciraGlyph name={page} size={size} className={`site-identity-icon ${className}`}/>;
  if (source && source !== failedSource) return <img className={`site-identity-icon ${className}`} src={source} alt="" aria-hidden="true" width={size} height={size} draggable={false} style={{ ...style, objectFit: 'contain' }} onError={() => setFailedSource(source)}/>;
  return <Globe2 className={`site-identity-icon ${className}`} size={size} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" style={style}/>;
}
