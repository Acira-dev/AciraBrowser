import { EdgeThumb } from '../EdgeThumb';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { BrowserAction, BrowserSnapshot, TabSession } from '../../runtime/types';
import { t } from '../../i18n';
import { forgetLevels } from '../../ui/mediaVolume';
import { mainMediaTab, mediaTabsOf, orderCards } from '../../ui/nowPlaying';
import { isSiteRow, sidePanelRequest, siteRowDispatch, sitesOf, useSidePanelState, useSiteMediaRows } from '../../ui/sidePanelSites';
import { animateSpring, useListMotion } from '../../ui/sharedMotion';
import { askPeek, isPreviewRow, previewRowDispatch, usePreviewMediaRows } from '../../ui/previewMedia';
import { NowPlayingCard, useOpenCard } from './NowPlaying';
import './sidebar-media.css';

/** The now-playing block above the sidebar footer (Beta 14, which replaced the 27 Oct media rows): one card per tab that plays
 * sound, or that was paused from here. The main sound (the latest to begin) is first; every card is compact until a click opens
 * it (one open at a time). Main decides what counts (desktop/media-controls.cjs sets `tab.media` and `tab.mediaAt`); the card
 * itself is NowPlaying.tsx. This is the block around them: it rises in with its first card, settles away after its last, and
 * draws the hairline above only when the sidebar's list would otherwise run into the cards. */

/** R4-31: the hairline above the media block is drawn only when the sidebar's list would otherwise run into the cards: its
 * last row ends within 16px of the block, or it scrolls. With room above (a short list), the cards stand free and there is no line. */
const CLEAR = 16;
function useListTouches(block: RefObject<HTMLElement | null>, on: boolean): boolean {
  const [touches, setTouches] = useState(false);
  useLayoutEffect(() => {
    const el = block.current, scroll = el?.parentElement?.querySelector<HTMLElement>('.sb-scroll');
    if (!on || !el || !scroll) return;
    const measure = () => {
      const last = scroll.lastElementChild as HTMLElement | null, free = last ? scroll.clientHeight - (last.offsetTop + last.offsetHeight) : scroll.clientHeight;
      setTouches(scroll.scrollHeight > scroll.clientHeight + 1 || free < CLEAR);
    };
    const resize = new ResizeObserver(measure), watch = () => { resize.disconnect(); resize.observe(scroll); for (const child of scroll.children) resize.observe(child); };
    const mutate = new MutationObserver(() => { watch(); measure(); });
    watch(); measure();
    mutate.observe(scroll, { childList: true });
    return () => { resize.disconnect(); mutate.disconnect(); };
  }, [on]);
  return touches;
}

export function SidebarMedia({ state, dispatch }: { state: BrowserSnapshot; dispatch: (action: BrowserAction) => void }) {
  // Beta 14: a side panel site's sound is a card too, as a tab-shaped row (ui/sidePanelSites.ts); "Go to tab" opens its panel, the volume's mute reaches its page.
  const siteRows = useSiteMediaRows(state), previewRows = usePreviewMediaRows(state), panelState = useSidePanelState(), everything = useMemo<TabSession[]>(() => [...mediaTabsOf(state), ...siteRows, ...previewRows], [state.tabs, state.otherWorkspaceTabs, siteRows, previewRows]);
  const live = orderCards(everything), held = useRef<TabSession[]>([]), block = useRef<HTMLDivElement>(null), list = useRef<HTMLDivElement>(null);
  const [, redraw] = useState(0);
  const touches = useListTouches(block, live.length > 0 || held.current.length > 0);
  if (live.length) held.current = live;
  // A closed tab's volume goes with it.
  const ids = [...state.tabs.map(tab => tab.id), ...sitesOf(state).map(site => site.id)].join(' ');
  useEffect(() => { forgetLevels(ids.split(' ')); }, [ids]);
  const cardIds = live.map(tab => tab.id), { open, setOpen, keepOpen } = useOpenCard(cardIds), main = mainMediaTab(everything)?.id;
  // The block rises in with its first card and settles away after its last: the cards inside glide on the list motion, but a
  // block with no cards has nothing to glide, so these two moments are the block's own.
  const shown = live.length ? live : held.current, count = live.length, before = useRef(0);
  useListMotion(list, cardIds.join(' '));
  useLayoutEffect(() => {
    const el = block.current, was = before.current; before.current = count;
    if (!el) return;
    if (was === 0 && count > 0) animateSpring(el, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], 'panel.expand', {}, true);
    else if (was > 0 && count === 0) {
      const leaving = animateSpring(el, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(6px)' }], 'panel.collapse');
      const done = () => { if (before.current === 0) { held.current = []; redraw(n => n + 1); } };
      if (leaving) { leaving.finished.then(done, done); } else done();
    }
  }, [count]);
  if (!shown.length) return null;
  return <div ref={block} className="sb-media np-block" data-leaving={count === 0 || undefined} data-divider={touches || undefined} role="group" aria-label={t('sidebarmedia.region')}>
    <div ref={list} className="np-list">{shown.map(tab => <NowPlayingCard key={tab.id} tab={tab} main={tab.id === main} full={count > 0 && open === tab.id} active={isSiteRow(tab) ? panelState.open === tab.id : isPreviewRow(tab) ? true : tab.id === state.activeTabId} dispatch={isSiteRow(tab) ? siteRowDispatch(dispatch) : isPreviewRow(tab) ? previewRowDispatch(dispatch, askPeek) : dispatch} reduced={state.settings.reducedMotion}
      onOpen={() => setOpen(tab.id)} onFold={() => setOpen(null)}
      onGo={() => { keepOpen(2500); /* the press also hands the keyboard to the page (ui/pageFocus.ts), which blurs this window a moment later: that is not a fold */ if (isSiteRow(tab)) void sidePanelRequest({ type: 'sidepanel.open', id: tab.id }); else if (isPreviewRow(tab)) { /* the preview is already in front */ } else if (tab.id !== state.activeTabId) dispatch({ type: 'tab.select', id: tab.id }); }}/>)}</div>
    <EdgeThumb scroller={list}/>
  </div>;
}
