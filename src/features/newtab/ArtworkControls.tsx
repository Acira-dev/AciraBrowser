import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Eye, RefreshCw } from '../../components/AppIcons';
import { DotMatrix } from '../../components/DotMatrix';
import { t } from '../../i18n';
import { useOpenPopup } from '../../ui/openPopup';
import type { ArtworkCollection } from '../../ui/artworkCollections';

type Props = { collection: ArtworkCollection; visible: boolean; loading: boolean; failed: boolean; kept: boolean; visibilityOnly?: boolean; onRetry: () => void; onNext: () => void; onVisibility: () => void; onChoose: (target: HTMLButtonElement) => void };

/** Next picture, the cover browser's arrow and the eye: three quiet buttons (buttons.css) with no borders of their own. A rail,
 * where there is one (full-background art), is the only surface and the only line. */
export function ArtworkControls({ collection, visible, loading, failed, kept, visibilityOnly = false, onRetry, onNext, onVisibility, onChoose }: Props) {
  const [pending, setPending] = useState(false), shown = useRef(false), coverOpen = useOpenPopup() === 'workspace-cover';
  useEffect(() => {
    const timer = window.setTimeout(() => { shown.current = loading; setPending(loading); }, loading ? 90 : shown.current ? 220 : 0);
    return () => window.clearTimeout(timer);
  }, [loading]);
  const error = kept ? t('nt.imageFailed') : t('error.tech.error'), next = failed ? t('dl.retry') : t(collection === 'built-in' ? 'nt.another' : 'nt.anotherImage');
  const root = useRef<HTMLDivElement>(null), eye = useRef<HTMLButtonElement>(null);
  // Hidden art leaves only the eye. If the focused button was one that just left, focus falls to the eye instead of the page.
  useEffect(() => {
    if (!visible && root.current && !root.current.contains(document.activeElement) && document.activeElement === document.body && eye.current) eye.current.focus({ preventScroll: true });
  }, [visible]);
  return <div className="nt-art-controls" ref={root} aria-busy={loading}>
    {pending && !visibilityOnly && <span className="nt-art-pending" data-state={loading ? 'in' : 'out'} aria-hidden="true"><DotMatrix size={20} /></span>}
    {visible && !visibilityOnly && <button type="button" className="acira-button acira-button-quiet nt-change nt-next nt-art-extra" onClick={failed ? onRetry : onNext} aria-label={next} title={failed ? error : next}><span className="nt-next-label">{next}</span><RefreshCw className="nt-next-icon" size={14} aria-hidden="true" /></button>}
    {visible && !visibilityOnly && <button type="button" className="acira-button acira-button-quiet nt-change nt-cover-choose nt-art-extra" data-popup-trigger aria-label={t('local.changeWorkspaceCover')} title={t('local.changeWorkspaceCover')} aria-haspopup="dialog" aria-expanded={coverOpen} onClick={event => onChoose(event.currentTarget)}><ChevronDown size={14} aria-hidden="true" /></button>}
    <button type="button" ref={eye} className="acira-button acira-button-quiet nt-change nt-cover-visibility" aria-label={t(visible ? 'local.hideWorkspaceCover' : 'local.showWorkspaceCover')} title={t(visible ? 'local.hideWorkspaceCover' : 'local.showWorkspaceCover')} aria-pressed={visible} onClick={onVisibility}><Eye size={16} aria-hidden="true" /></button>
    <span className="nt-art-status" role="status">{loading ? t('app.loading') : failed ? error : ''}</span>
  </div>;
}
