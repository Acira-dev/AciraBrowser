import { useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import type { BrowserAction, BrowserSnapshot, TabSession } from '../../runtime/types';
import { SIDE_PANEL_MAX_SITES, type SidePanelSite } from '../../runtime/sidePanelSites';
import { canPin, pinAction, sidePanelRequest, sitesOf, useSidePanelState, warmSidePanel } from '../../ui/sidePanelSites';
import { SiteIdentityIcon } from '../SiteIdentityIcon';
import { TabSoundMeter } from '../TabSound';
import { PreviewIcon } from '../PreviewIcon';
import { Plus } from '../AppIcons';
import { t } from '../../i18n';
import { useMiniPhase } from '../../ui/miniRail';

/**
 * The side panel sites' icons (Beta 14, brief section AF), small real site icons in the sidebar's bottom row beside the profile and the four small icons, separated by a little
 * space; when they do not fit they wrap into one thin row just above it (sidebar.css: the footer wraps upward). Same size and treatment as the row's icons, the sites' own
 * icons, never tinted. Nothing at all is drawn until the first site is pinned (the team's clutter rule); after that a "+" ends the row while there is room.
 * A click opens the site's panel (the same icon again closes it, another icon switches it), a right click offers Remove, dragging orders them. Marks: an unread dot and the
 * sound mark, from main (ui/sidePanelSites.ts). Hover names the site.
 */
const DRAG = 'application/x-acira-side-panel-site';

/** `rail`: the Shelf's narrow rail draws them as a column above the profile (no "+": the rail keeps to the sites).
 *  `toolbar`: the top-tabs layout has no sidebar, so the icons are at the right end of the toolbar's actions (the plan), as the toolbar's own icon buttons: a group the toolbar fit
 *  (ui/toolbarFit.ts, the "sites" item) takes off the end one at a time, the "+" first; each slot carries `data-slot`, each site `data-site-id`, and the ones that leave are rows of the » menu.
 *  `mini` (14.3, D154): the sidebar is the Mini rail (or floats open from it). The row is the open sidebar's; the rail had nothing in its place (miniRail.css hid it with the rows that have no
 *  rail form), so the sites could not be reached from the rail at all. The rail draws them as the Shelf's rail does: one column on the rail's axis, above the profile, no "+". The column is the
 *  rail's own (like its Favorites column): it fades out as the rail opens and the row fades in, and the row's room grows by what the column needs more (--mini-sp-dy), gliding on the rail's
 *  curve as the Favorites band does, so the list above never jumps. */
export function SidePanelIcons({ state, dispatch, current, rail = false, toolbar = false, mini = false, place = 'bottom' }: { state: BrowserSnapshot; dispatch: (action: BrowserAction) => void; current: TabSession; rail?: boolean; toolbar?: boolean; mini?: boolean; /** Customize sidebar: the row stands at an edge of the sidebar or in its list (the bottom edge, above the icon row, is where it always was). */ place?: 'top' | 'bottom' | 'list' | 'end' }) {
  const sites = sitesOf(state), panel = useSidePanelState(), miniPhase = useMiniPhase();
  const [dragging, setDragging] = useState<string | null>(null), [over, setOver] = useState<{ id: string; after: boolean } | null>(null);
  const row = useRef<HTMLDivElement>(null), wrap = useRef<HTMLDivElement>(null), column = useRef<HTMLDivElement>(null);
  const withColumn = mini && !rail && !toolbar && sites.length > 0;
  /* D154: the room the rail's column needs beyond the row's own (both are laid out in the rail, the row at opacity 0): set before paint, every render, so a site pinned or removed in the rail resizes it at once */
  useLayoutEffect(() => {
    const box = wrap.current; if (!box) return;
    const dy = withColumn && column.current && row.current ? Math.max(0, column.current.offsetHeight - row.current.offsetHeight) : 0, value = `${dy}px`;
    if (box.style.getPropertyValue('--mini-sp-dy') !== value) box.style.setProperty('--mini-sp-dy', value);
  });
  if (!sites.length) return null;
  const pinnable = canPin(state, current) && sites.length < SIDE_PANEL_MAX_SITES;
  const toggle = (site: SidePanelSite) => void sidePanelRequest({ type: 'sidepanel.toggle', id: site.id });
  const menu = (event: MouseEvent<HTMLElement>, site: SidePanelSite) => {
    event.preventDefault();
    const box = event.currentTarget.getBoundingClientRect();
    void (window as unknown as { acira?: { sidePanel?: (request: unknown) => Promise<unknown> } }).acira?.sidePanel?.({ type: 'sidepanel.menu', id: site.id, anchor: { x: Math.round(box.left), y: Math.round(box.top), width: Math.round(box.width), height: Math.round(box.height) } });
  };
  /** Arrow keys walk the row; Alt+Arrow moves the focused icon (the keyboard's way to order). */
  const keys = (event: KeyboardEvent<HTMLButtonElement>, site: SidePanelSite, index: number) => {
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); dispatch({ type: 'sidepanel.unpin', id: site.id }); return; }
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    if (event.altKey) { dispatch({ type: 'sidepanel.move', id: site.id, index: Math.max(0, Math.min(sites.length - 1, index + step)) }); return; }
    const buttons = [...(row.current?.querySelectorAll<HTMLButtonElement>(toolbar ? '.toolbar-site[data-site-id]' : '.sb-sp-icon') ?? [])];
    buttons[Math.max(0, Math.min(buttons.length - 1, index + step))]?.focus();
  };
  const dragStart = (event: DragEvent<HTMLButtonElement>, site: SidePanelSite) => { event.dataTransfer.setData(DRAG, site.id); event.dataTransfer.effectAllowed = 'move'; setDragging(site.id); };
  const dragOver = (event: DragEvent<HTMLButtonElement>, site: SidePanelSite) => {
    if (!dragging || !event.dataTransfer.types.includes(DRAG)) return;
    event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move';
    const box = event.currentTarget.getBoundingClientRect(), after = event.clientX > box.left + box.width / 2;
    if (over?.id !== site.id || over.after !== after) setOver({ id: site.id, after });
  };
  const drop = (event: DragEvent<HTMLElement>, target: SidePanelSite) => {
    const id = event.dataTransfer.getData(DRAG) || dragging;
    if (!id || !event.dataTransfer.types.includes(DRAG)) return;
    event.preventDefault(); event.stopPropagation();
    const from = sites.findIndex(site => site.id === id), at = sites.findIndex(site => site.id === target.id);
    if (from >= 0 && at >= 0) {
      let index = at + (over?.id === target.id && over.after ? 1 : 0);
      if (from < index) index -= 1;
      if (index !== from) dispatch({ type: 'sidepanel.move', id, index });
    }
    setDragging(null); setOver(null);
  };
  const icon = toolbar ? 'icon-button toolbar-site' : 'sb-foot-icon sb-sp-icon', plus = !rail && sites.length < SIDE_PANEL_MAX_SITES;
  /** A site's face: its own icon, the sound mark and the unread dot (the same in the row, the Shelf's rail and the Mini rail's column). */
  const face = (site: SidePanelSite, open: boolean): ReactNode => { const mark = panel.marks[site.id]; return <>
    <span className="sb-sp-glyph"><SiteIdentityIcon url={site.url} favicon={site.icon} size={16} className="sb-sp-site" /></span>
    {mark?.audible ? <span className="sb-sp-sound"><TabSoundMeter badge reducedMotion={state.settings.reducedMotion} /></span> : null}
    {mark?.dot && !open ? <i className="sb-foot-dot sb-sp-dot" aria-hidden="true" /> : null}
  </>; };
  const labelOf = (site: SidePanelSite) => { const mark = panel.marks[site.id]; return [site.title, mark?.unread ? t('sidepanel.unread') : '', mark?.audible ? t('tabsound.playing') : ''].filter(Boolean).join(', '); };
  const group = <div className={toolbar ? 'toolbar-sites' : rail ? 'sb-sp sb-sp-rail' : 'sb-sp'} role="group" aria-label={t('sidepanel.group')} ref={row} data-count={toolbar ? sites.length + (plus ? 1 : 0) : sites.length}>
    {sites.map((site, index) => {
      const mark = panel.marks[site.id], open = panel.open === site.id, name = site.title;
      const label = labelOf(site);
      return <button key={site.id} type="button" className={icon} data-site={site.id} {...(toolbar ? { 'data-slot': index, 'data-site-id': site.id } : {})} data-open={open ? '' : undefined} data-sound={mark?.audible ? '' : undefined} data-drop={over?.id === site.id ? (over.after ? 'after' : 'before') : undefined} data-dragging={dragging === site.id ? '' : undefined}
        aria-label={label} aria-pressed={open} title={name} draggable onPointerEnter={warmSidePanel} onFocus={warmSidePanel} onClick={() => toggle(site)} onContextMenu={event => menu(event, site)} onKeyDown={event => keys(event, site, index)}
        onDragStart={event => dragStart(event, site)} onDragOver={event => dragOver(event, site)} onDrop={event => drop(event, site)} onDragEnd={() => { setDragging(null); setOver(null); }}>
        {face(site, open)}
      </button>;
    })}
    {plus ? <button type="button" className={toolbar ? 'icon-button toolbar-site toolbar-site-add' : 'sb-foot-icon sb-sp-add'} {...(toolbar ? { 'data-slot': sites.length } : {})} disabled={!pinnable} aria-label={t('sidepanel.addPage')} title={pinnable ? t('sidepanel.addPage') : t('sidepanel.addPageNot')}
      onClick={() => { if (pinnable) dispatch(pinAction(current)); }}><PreviewIcon icon={Plus} size={16} /></button> : null}
  </div>;
  /* D154: the Mini rail's column (rail only: inert and out of the accessibility tree while the sidebar is open, the row is the one then; like the rail's Favorites, its buttons stay out of the tab order) */
  const railHidden = miniPhase !== 'rail';
  const railColumn = withColumn ? <div ref={column} className="sb-sp-mini" role="group" aria-label={t('sidepanel.group')} aria-hidden={railHidden || undefined} inert={railHidden || undefined} data-count={sites.length}>
    {sites.map(site => { const mark = panel.marks[site.id], open = panel.open === site.id; return <button key={site.id} type="button" tabIndex={-1} className="sb-foot-icon sb-sp-icon" data-site={site.id} data-open={open ? '' : undefined} data-sound={mark?.audible ? '' : undefined}
      aria-label={labelOf(site)} aria-pressed={open} title={site.title} onPointerEnter={warmSidePanel} onClick={() => toggle(site)} onContextMenu={event => menu(event, site)}>{face(site, open)}</button>; })}
  </div> : null;
  return rail || toolbar ? group : <div ref={wrap} className="sb-sp-row" data-place={place === 'bottom' ? undefined : place} data-mini-column={withColumn ? '' : undefined}>{group}{railColumn}</div>;
}

/** A one-off request for the palette and menus: pin this tab's page. */
export const pinThisTab = (dispatch: (action: BrowserAction) => void, tab: TabSession) => dispatch(pinAction(tab));
