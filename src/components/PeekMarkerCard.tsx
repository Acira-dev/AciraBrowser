import { useLayoutEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { DotMatrix } from './DotMatrix';
import { SiteIdentityIcon } from './SiteIdentityIcon';
import { peekMarkerFor, usePeekMarkerState } from '../ui/peekMarker';

/**
 * The Link preview marker (item 17): the small page card that slides out beside a tab's or a favorite tile's icon while a preview
 * is open from that tab, and slides back when it closes (ui/peekMarker.ts holds the state, sidebar.css draws and moves it).
 * It shows the preview site's icon: the loader's dots while the page loads and has no icon yet, the site's own icon once it has
 * one, the globe when it never gets one. Rendered inside a tile (`size` 14) or beside a row's icon (`size` 12) of the tab; it
 * renders nothing for any other tab. The card is mounted closed and opened one frame later, so opening is always a transition,
 * and it stays mounted a moment after the preview closes (the store's `leaving`) so it can slide back.
 */
export function PeekMarkerCard({ tabId, size, reduced }: { tabId: string | undefined; size: 12 | 14; reduced: boolean }) {
  const found = peekMarkerFor(usePeekMarkerState(), tabId);
  const open = Boolean(found?.open);
  const card = useRef<HTMLSpanElement>(null);
  const [armed, setArmed] = useState(false);
  useLayoutEffect(() => {
    if (!open) { setArmed(false); return; }
    void card.current?.getBoundingClientRect(); // the closed card is styled first, so setting `data-open` next is a transition
    setArmed(true);
  }, [open]);
  if (!found) return null;
  const { marker } = found;
  return (
    <span ref={card} className="sb-peek-card" data-open={open && armed ? '' : undefined} data-size={size} role="img" aria-label={t('peek.frameLabel')}>
      <span className="sb-peek-face" aria-hidden="true">
        {marker.loading && !marker.favicon
          ? <DotMatrix preset="loader" size={size} reducedMotion={reduced}/>
          : <SiteIdentityIcon url={marker.url} favicon={marker.favicon} size={size}/>}
      </span>
    </span>
  );
}
