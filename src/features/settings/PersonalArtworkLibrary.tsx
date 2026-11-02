import { useEffect, useRef, type KeyboardEvent } from 'react';
import { ChevronDown, Trash2 } from '../../components/AppIcons';
import type { PersonalArtwork } from '../../runtime/connectedServices';
import { t } from '../../i18n';
import './choice-cards.css';
import './personal-artwork-library.css';

/** The profile's existing local image store, presented with the same picture
 * cards as the built-in collections. Removing a copy never removes its source. */
export function PersonalArtworkLibrary({ id, assets, selected, busy, canImport, privateMode, onImport, onSelect, onRemove }: {
  id: string;
  assets: PersonalArtwork[]; selected: string; busy: boolean; canImport: boolean; privateMode: boolean;
  onImport: () => void; onSelect: (id: string) => void; onRemove: (id: string) => void;
}) {
  const details = useRef<HTMLDetailsElement>(null), group = useRef<HTMLDivElement>(null);
  const selectedIndex = Math.max(0, assets.findIndex(asset => selected === 'personal:' + asset.id));
  useEffect(() => {
    if (selected.startsWith('personal:') && details.current) details.current.open = true;
  }, [selected]);
  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key) || busy || !assets.length) return;
    const cards = [...(group.current?.querySelectorAll<HTMLButtonElement>('[role=radio]') ?? [])];
    const focused = cards.indexOf(document.activeElement as HTMLButtonElement);
    // Remove buttons have their own keyboard action and are not radio choices.
    if (focused < 0) return;
    event.preventDefault(); event.stopPropagation();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? cards.length - 1
      : (focused + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + cards.length) % cards.length;
    onSelect(assets[next].id); cards[next]?.focus();
  };
  return <section className="nt-personal-library" data-setting={id}>
    <details ref={details} className="st-fold-details" data-no-disclosure-motion>
      <summary>
        <span className="st-fold-copy"><h2>{t('ntp.personal')}</h2><p>{t(privateMode ? 'ntp.personalPrivate' : 'ntp.personalDetail')}</p></span>
        <span className="st-fold-chevron" aria-hidden="true"><ChevronDown size={15}/></span>
      </summary>
      <div className="st-group-body">
        <div className="nt-personal-toolbar"><button type="button" className="st-button" disabled={busy || !canImport || assets.length >= 5} onClick={onImport}>{t(busy ? 'ntp.wait' : 'ntp.chooseImage')}</button></div>
        {assets.length > 0 && <div ref={group} className="cc-group nt-personal-grid" role="radiogroup" aria-label={t('ntp.personal')} onKeyDown={keyboard}>
          {assets.map((asset, index) => <div className="nt-personal-item" key={asset.id}>
            <button type="button" role="radio" className="cc-card" aria-checked={selected === 'personal:' + asset.id} tabIndex={index === selectedIndex ? 0 : -1} disabled={busy} onClick={() => onSelect(asset.id)}>
              <span className="cc-art" aria-hidden="true"><img className="nt-collection-img" src={asset.url} alt="" draggable={false} decoding="async" loading="lazy"/></span>
              <span className="cc-label"><span className="cc-radio" aria-hidden="true"/><span className="cc-name">{asset.name}<small>{asset.width} × {asset.height}</small></span></span>
            </button>
            <button type="button" className="nt-personal-remove" disabled={busy} aria-label={t('ntp.removeImageAria', { name: asset.name })} title={t('ntp.remove')} onClick={() => onRemove(asset.id)}><Trash2 size={15}/></button>
          </div>)}
        </div>}
      </div>
    </details>
  </section>;
}
