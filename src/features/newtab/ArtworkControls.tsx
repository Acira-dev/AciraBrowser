import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ChevronDown, Eye, RefreshCw, Star } from '../../components/AppIcons';
import { DotMatrix } from '../../components/DotMatrix';
import { t } from '../../i18n';
import { useOpenPopup } from '../../ui/openPopup';
import type { ArtworkCollection } from '../../ui/artworkCollections';

/** The star with its inside filled: the outer contour of the editor set's Star (EditorGlyph.tsx), so a pick reads at a glance, as a saved page's star does. */
const SolidStar = () => <svg className="ed-editor-icon" aria-hidden="true" focusable="false" width={15} height={15} viewBox="0 0 16 16" stroke="none" fill="currentColor" style={{ '--icon-size': '15px' } as CSSProperties}><path d="M11.947 14.987Q11.68 14.987 11.467 14.88L8 13.067L4.533 14.88Q4.213 15.04 3.893 14.987Q3.573 14.933 3.307 14.613Q3.04 14.293 3.147 13.867L3.787 10.027L0.96 7.253Q0.533 6.827 0.72 6.267Q0.907 5.707 1.493 5.653L5.387 5.067L7.147 1.547Q7.307 1.227 7.653 1.093Q8 0.96 8.347 1.093Q8.693 1.227 8.853 1.547L10.613 5.067L14.507 5.653Q15.093 5.707 15.28 6.267Q15.467 6.827 15.04 7.253L12.213 10.027L12.853 13.867Q12.96 14.293 12.667 14.64Q12.373 14.987 11.947 14.987Z" /></svg>;

type Props = { collection: ArtworkCollection; /** 14.4: the profile's own video is on: no next picture and no pick star (there is one video). */ video?: boolean; /** 14.1: the person's own pictures are in the rotation: the button says "Another image", not "Another painting". */ own?: boolean; visible: boolean; loading: boolean; failed: boolean; kept: boolean; visibilityOnly?: boolean; /** The picture on screen can be ticked as one of the person's picks (not the offline stand-in). `pickBusy`: a new picture is loading, so the button waits instead of ticking the one that is leaving. */ pickable?: boolean; pickBusy?: boolean; picked?: boolean; onPick?: () => void; onRetry: () => void; onNext: () => void; onVisibility: () => void; onChoose: (target: HTMLButtonElement) => void };

/** Next picture, the cover browser's arrow and the eye: three quiet buttons (buttons.css) with no borders of their own. A rail,
 * where there is one (full-background art), is the only surface and the only line. */
export function ArtworkControls({ collection, own = false, video = false, visible, loading, failed, kept, visibilityOnly = false, pickable = false, pickBusy = false, picked = false, onPick, onRetry, onNext, onVisibility, onChoose }: Props) {
  const [pending, setPending] = useState(false), shown = useRef(false), coverOpen = useOpenPopup() === 'workspace-cover';
  useEffect(() => {
    const timer = window.setTimeout(() => { shown.current = loading; setPending(loading); }, loading ? 90 : shown.current ? 220 : 0);
    return () => window.clearTimeout(timer);
  }, [loading]);
  const error = kept ? t('nt.imageFailed') : t('error.tech.error'), next = failed ? t('dl.retry') : t(collection === 'built-in' && !own ? 'nt.another' : 'nt.anotherImage');
  const root = useRef<HTMLDivElement>(null), eye = useRef<HTMLButtonElement>(null);
  // Hidden art leaves only the eye. If the focused button was one that just left, focus falls to the eye instead of the page.
  useEffect(() => {
    if (!visible && root.current && !root.current.contains(document.activeElement) && document.activeElement === document.body && eye.current) eye.current.focus({ preventScroll: true });
  }, [visible]);
  return <div className="nt-art-controls" ref={root} aria-busy={loading}>
    {pending && !visibilityOnly && <span className="nt-art-pending" data-state={loading ? 'in' : 'out'} aria-hidden="true"><DotMatrix size={20} /></span>}
    {visible && !visibilityOnly && !video && <button type="button" className="acira-button acira-button-quiet nt-change nt-next nt-art-extra" onClick={failed ? onRetry : onNext} aria-label={next} title={failed ? error : next}><span className="nt-next-label">{next}</span><RefreshCw className="nt-next-icon" size={14} aria-hidden="true" /></button>}
    {visible && pickable && !video && onPick && <button type="button" className="acira-button acira-button-quiet nt-change nt-pick nt-art-extra" aria-pressed={picked} aria-disabled={pickBusy || undefined} aria-label={t(picked ? 'nt.unpick' : 'nt.pick')} title={t(picked ? 'nt.unpick' : 'nt.pick')} onClick={pickBusy ? undefined : onPick}>{picked ? <SolidStar /> : <Star size={15} aria-hidden="true" />}</button>}
    {visible && !visibilityOnly && <button type="button" className="acira-button acira-button-quiet nt-change nt-cover-choose nt-art-extra" data-popup-trigger aria-label={t('local.changeWorkspaceCover')} title={t('local.changeWorkspaceCover')} aria-haspopup="dialog" aria-expanded={coverOpen} onClick={event => onChoose(event.currentTarget)}><ChevronDown size={14} aria-hidden="true" /></button>}
    <button type="button" ref={eye} className="acira-button acira-button-quiet nt-change nt-cover-visibility" aria-label={t(visible ? 'local.hideWorkspaceCover' : 'local.showWorkspaceCover')} title={t(visible ? 'local.hideWorkspaceCover' : 'local.showWorkspaceCover')} aria-pressed={visible} onClick={onVisibility}><Eye size={16} aria-hidden="true" /></button>
    <span className="nt-art-status" role="status">{loading ? t('app.loading') : failed ? error : ''}</span>
  </div>;
}
