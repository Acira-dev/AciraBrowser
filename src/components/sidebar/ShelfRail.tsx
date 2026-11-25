import { SidePanelIcons } from './SidePanelIcons';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import type { BrowserAction, BrowserSnapshot, TabSession } from '../../runtime/types';
import { runtime } from '../../runtime/client';
import { mediaToggle } from '../../ui/mediaRows';
import { glowColors, mainMediaTab, mediaTabsOf } from '../../ui/nowPlaying';
import { paletteFromColor, samplePalette } from '../../ui/nowPlayingPalette';
import { useMediaInfo } from '../../ui/useMediaInfo';
import { isSiteRow, sidePanelRequest, useSiteMediaRows } from '../../ui/sidePanelSites';
import { isPreviewRow, usePreviewMediaRows } from '../../ui/previewMedia';
import { PreviewIcon } from '../PreviewIcon';
import { ProfileAvatar } from '../../features/accounts/profileModel';
import { ProfileDot } from '../../features/feedback/ProfileDot';
import { Pause, Play } from '../AppIcons';
import { SiteIdentityIcon } from '../SiteIdentityIcon';
import { tabDisplayTitle } from '../../runtime/tabTitle';
import './shelf.css';
import { t } from '../../i18n';

/** The Shelf's rail (Beta 14): the smallest size of Top + sidebar, a 52 px column with one icon per section. Clicking a section's icon opens that section in a panel beside the rail,
 * clicking it again (or Esc inside the panel) takes the panel away. The profile button and now-playing sit at the rail's foot.
 *
 * This file draws the rail; AciraSidebar owns what goes in it (it knows the sections, the profile, the panel's content), so a section's panel is the same component the open sidebar shows
 * and anything another feature adds to a section (Favorites' stack, the now-playing card) reaches the rail through that component, not through a copy. */
export interface RailEntry {
  key: string;
  label: string;
  icon: ReactNode;
  /** The section whose panel is open. */
  open?: boolean;
  /** The entry opens a popup (the workspaces list), not a panel. */
  popup?: boolean;
  onClick: (target: HTMLButtonElement) => void;
}

const RailButton = ({ entry, moveFocus }: { entry: RailEntry; moveFocus: (event: KeyboardEvent<HTMLElement>) => boolean | void }) => (
  <button type="button" className="sb-rail-btn" data-sb-focus data-rail-section={entry.key} aria-label={entry.label} title={entry.label} aria-pressed={entry.popup ? undefined : !!entry.open} aria-haspopup={entry.popup ? 'dialog' : undefined} data-popup-trigger={entry.popup || undefined} data-open={entry.open || undefined}
    onKeyDown={moveFocus} onClick={(event) => entry.onClick(event.currentTarget)}>{entry.icon}</button>
);

/** Now playing at the rail's foot: the main sound's track as its picture (RailMediaTile). A click on the tile goes to its tab; the play / pause disc on its corner plays or pauses; the open sidebar's card (SidebarMedia) has the volume and the seek. */
export function RailNowPlaying({ state, dispatch }: { state: BrowserSnapshot; dispatch: (action: BrowserAction) => void }) {
  // The main sound, the same tab the now-playing card puts first (ui/nowPlaying.ts, Beta 14; mediaRows.ts no longer lists media tabs).
  // Beta 14: a side panel site's sound counts for the rail's icon too (the same rows the card lists).
  const siteRows = useSiteMediaRows(state), previewRows = usePreviewMediaRows(state), tab = mainMediaTab([...mediaTabsOf(state), ...siteRows, ...previewRows]);
  if (!tab) return null;
  return <RailMediaTile key={tab.id} tab={tab} activeTabId={state.activeTabId} dispatch={dispatch} />;
}

/** No picture and no site colour: the card's own quiet neutral (NowPlaying.tsx NEUTRAL_AURA). */
const NEUTRAL_LIGHT = ['oklch(.74 .012 270)', 'oklch(.74 .01 250)', 'oklch(.74 .012 270)', 'oklch(.74 .01 250)'];

/** 14.0.1 (the team, final7 on YouTube: the Shelf rail showed the YouTube logo where he expects the video's own picture with its coloured glow): the tile shows the track's PICTURE, as the closed Mini
 * rail's tile does. The picture is main's artwork, read the way the card reads it (ui/useMediaInfo.ts: the media session's artwork, else the video's own thumbnail, else the page's image; never the site's
 * logo); the site's icon stands until it comes, and when the page has none. A soft light of the picture's own colours lies behind the tile (the card's palette, ui/nowPlayingPalette.ts; the site's colour
 * while no picture comes): full while it plays, low when paused. The press (play / pause) and the play / pause disc on the corner are unchanged. */
function RailMediaTile({ tab, activeTabId, dispatch }: { tab: TabSession; activeTabId: string; dispatch: (action: BrowserAction) => void }) {
  const { info, art } = useMediaInfo(tab, false);
  const [palette, setPalette] = useState<string[] | null>(null);
  useEffect(() => { if (!art) return; let alive = true; void samplePalette(art).then(p => { if (alive) setPalette(p); }); return () => { alive = false; }; }, [art]);
  const siteTint = useMemo(() => paletteFromColor(tab.siteColor), [tab.siteColor]);
  const light = useMemo(() => glowColors({ palette, pictureComing: !!art || !!info?.artSrc, siteTint, neutral: NEUTRAL_LIGHT }), [palette, art, info?.artSrc, siteTint]);
  const playing = tab.media === 'playing', name = tabDisplayTitle(tab);
  const toggleLabel = `${playing ? t('sidebarmedia.pause') : t('sidebarmedia.play')} · ${name}`, goLabel = `${t('rewindpage.goToTab')}: ${name}`;
  const style = { '--np-c1': light[0], '--np-c3': light[2] ?? light[0] } as CSSProperties;
  // 14.1 (as the closed Mini rail's tile, the team 20 Nov: "the video player ... should be clickable"): a click on the tile goes to the playing tab, as the open card's artwork does
  // (SidebarMedia onGo: a side panel site opens its panel, a link preview is already in front); the play / pause disc on its corner plays and pauses.
  const go = () => { if (isSiteRow(tab)) void sidePanelRequest({ type: 'sidepanel.open', id: tab.id }); else if (isPreviewRow(tab)) { /* the preview is already in front */ } else if (tab.id !== activeTabId) dispatch({ type: 'tab.select', id: tab.id }); };
  return (
    <div className="sb-rail-media-wrap" style={style}>
      <button type="button" className="sb-rail-btn sb-rail-media" data-sb-focus data-playing={playing || undefined} data-art={art ? '' : undefined} aria-label={goLabel} title={goLabel} onClick={go}>
        <span className="sb-rail-media-light" aria-hidden="true" />
        <SiteIdentityIcon url={tab.url} favicon={tab.favicon} size={18} className="sb-rail-glyph" />
        {art && <img key={art} className="sb-rail-media-art" src={art} alt="" draggable={false} />}
      </button>
      <button type="button" className="sb-rail-media-glyph" data-sb-focus aria-label={toggleLabel} title={toggleLabel} onClick={() => void runtime.browserCommand(mediaToggle(tab)).catch(() => {})}><PreviewIcon icon={playing ? Pause : Play} size={9} className="sb-rail-media-icon" /></button>
    </div>
  );
}

export function ShelfRail({ state, dispatch, entries, tiles, panelTitle, panel, onClose, onProfile, profileName, privateMark, moveFocus, sidePanelOff = false }: {
  state: BrowserSnapshot; dispatch: (action: BrowserAction) => void; entries: readonly RailEntry[];
  /** Customize sidebar turned the side panel sites off: the rail draws none of their icons either. */
  sidePanelOff?: boolean;
  /** The Favorites as tiles, above the sections' icons (Beta 14, the brief's picture: each Favorite is its own tile in the rail). AciraSidebar draws them with the open sidebar's own Favorites component. */
  tiles?: ReactNode;
  /** The open panel's name, and its content (null: no panel). */
  panelTitle?: string; panel: ReactNode | null; onClose: () => void;
  onProfile: (target: HTMLButtonElement) => void; profileName: string; moveFocus: (event: KeyboardEvent<HTMLElement>) => boolean | void;
  /** In a private window the profile button wears the private mark, as the open sidebar's foot does (a private profile has no picture to show, and no rank ring or dot: nothing of the profile follows into it). AciraSidebar owns the glyph. */
  privateMark?: ReactNode;
}) {
  const current = state.tabs.find((tab) => tab.id === state.activeTabId) || state.tabs[0];
  const profile = state.browserProfiles.find((item) => item.id === current?.browserProfileId);
  const wrap = useRef<HTMLDivElement>(null);
  // Esc inside the panel closes it and hands the focus back to its icon.
  const escape = (event: KeyboardEvent<HTMLElement>) => { if (event.key !== 'Escape') return; event.stopPropagation(); onClose(); wrap.current?.querySelector<HTMLElement>('.sb-rail-btn[data-open]')?.focus(); };
  return (
    <div ref={wrap} className="sb-rail-wrap" data-panel={panel ? '' : undefined}>
      <nav className="sb-rail" aria-label={t('acirasidebar.sidebar')} aria-orientation="vertical">
        {tiles ? <div className="sb-rail-tiles">{tiles}</div> : null}
        <div className="sb-rail-sections" data-after-tiles={tiles ? '' : undefined}>{entries.map((entry) => <RailButton key={entry.key} entry={entry} moveFocus={moveFocus} />)}</div>
        <div className="sb-rail-foot">
          {!sidePanelOff && <SidePanelIcons state={state} dispatch={dispatch} current={current} rail />}
          <RailNowPlaying state={state} dispatch={dispatch} />
          <button type="button" className="sb-rail-btn sb-rail-profile" data-sb-focus data-popup-trigger aria-haspopup="dialog" aria-label={`${profileName}. ${t('app.switchProfile')}`} title={privateMark ? t('acirasidebar.privateWindowNothingFromThis') : `${profileName}. ${t('app.switchProfile')}`} onKeyDown={moveFocus} onClick={(event) => onProfile(event.currentTarget)}>
            {privateMark ?? (
              <>
                {/* Beta 14 + K (integration): the rail's picture wears the rank ring and the quiet dot like the foot's; never in a private window (privateMark above). */}
                <ProfileAvatar profileId={profile?.id} name={profile?.name || profileName} color={profile?.color || '#6b7280'} avatar={profile?.avatar} picture={profile?.picture} size={24} />
                <ProfileDot profileId={profile?.id} />
              </>
            )}
          </button>
        </div>
      </nav>
      {/* Exact sample parity (item18's notes: "No animation was designed for the rail itself"): the panel is drawn with the column's width change, with no fade or slide of its own. */}
      {panel && <div className="sb-rail-panel" role="region" aria-label={panelTitle} onKeyDown={escape}>{panel}</div>}
    </div>
  );
}
