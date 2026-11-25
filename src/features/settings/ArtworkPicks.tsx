import { useRef, type KeyboardEvent } from 'react';
import { ChevronDown } from '../../components/AppIcons';
import { CoverThumbnail } from '../../components/WorkspaceCoverPicker';
import { t } from '../../i18n';
import './artwork-picks.css';

/** One picture that can be ticked. `src` is what the thumbnail draws (a built-in painting, an own image, a kept collection picture). */
export type PickTile = { id: string; name: string; src: string; position?: string };
type Group = { key: string; title: string; note?: string; tiles: PickTile[] };

/**
 * Settings › Appearance › New tab background › My picks: every picture the new tab can show, as tiles that are ticked or not. What the
 * rotation does with them is the "Pictures to choose from" row above. The grid is the cover browser's own (workspace-cover-grid), so a
 * picture looks the same here as where it is chosen; a ticked tile carries the same check and ring.
 */
export function ArtworkPicks({ id, groups, picked, count, onToggle, onOpen }: {
  id: string;
  groups: Group[];
  picked: ReadonlySet<string>;
  count: number;
  onToggle: (id: string) => void;
  /** The fold was opened: the kept collection pictures are looked up again, since a new tab may have shown more. */
  onOpen: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  // One tab stop for the whole grid (84 paintings are not 84 stops); the arrows move between tiles and Space ticks.
  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const tiles = [...(root.current?.querySelectorAll<HTMLButtonElement>('[role=checkbox]') ?? [])];
    const at = tiles.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    event.preventDefault();
    event.stopPropagation();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tiles.length - 1 : Math.max(0, Math.min(tiles.length - 1, at + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1)));
    tiles.forEach((tile, index) => { tile.tabIndex = index === next ? 0 : -1; });
    tiles[next]?.focus();
  };
  let first = true;
  return <section className="nt-picks" data-setting={id}>
    <details className="st-fold-details" data-no-disclosure-motion onToggle={(event) => { if ((event.currentTarget as HTMLDetailsElement).open) onOpen(); }}>
      <summary>
        <span className="st-fold-copy"><h2>{t('ntp.picks')}</h2><p>{t('ntp.picksDetail')}</p></span>
        <span className="nt-picks-end">
          <span className="nt-picks-count" aria-live="polite">{t('ntp.picksCount', { count })}</span>
          <span className="st-fold-chevron" aria-hidden="true"><ChevronDown size={15} /></span>
        </span>
      </summary>
      <div className="st-group-body nt-picks-body" ref={root} onKeyDown={keyboard}>
        {groups.map((group) => <div className="nt-picks-group" key={group.key}>
          <h3 className="nt-picks-title">{group.title}</h3>
          {group.note && <p className="nt-picks-note">{group.note}</p>}
          {group.tiles.length > 0 && <div className="workspace-cover-grid nt-picks-grid" role="group" aria-label={group.title}>
            {group.tiles.map((tile, index) => {
              const on = picked.has(tile.id), stop = first;
              first = false;
              return <button key={tile.id} type="button" className="nt-picks-tile" role="checkbox" aria-checked={on} tabIndex={stop ? 0 : -1} onClick={() => onToggle(tile.id)}>
                <CoverThumbnail src={tile.src} position={tile.position} selected={on} eager={index < 6} />
                <span>{tile.name}</span>
              </button>;
            })}
          </div>}
        </div>)}
      </div>
    </details>
  </section>;
}
