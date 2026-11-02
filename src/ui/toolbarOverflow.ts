import { useLayoutEffect } from 'react';
import type { ToolbarItemId } from './toolbarPrefs';
import { fitMetrics, fitToolbar, hideOrder, type FitItem } from './toolbarFit';

const px = (value: string) => Number.parseFloat(value) || 0;
const FIT = 'data-fit-hidden', REFIT = 'acira-toolbar-refit';
const shown = (node: Element) => getComputedStyle(node).display !== 'none';
const sideBy = (nodes: Element[], gap: number) => nodes.reduce((sum, node) => sum + node.getBoundingClientRect().width, 0) + Math.max(0, nodes.length - 1) * gap;

/** A row whose width changes without a render (the sidebar's drag or its slide, a zoom change) asks for a new fit. The
 * observer adopts each toolbar the first time a check meets it, so a row that mounts late is watched too. */
let watcher: ResizeObserver | undefined, watchFrame = 0;
function watch(toolbar: Element) {
  if (typeof ResizeObserver !== 'function') return;
  watcher ??= new ResizeObserver(() => { cancelAnimationFrame(watchFrame); watchFrame = requestAnimationFrame(() => dispatchEvent(new Event(REFIT))); });
  watcher.observe(toolbar);
}

/** Toolbar fit (ui/toolbarFit.ts): the row is [leading] [address] [actions] [caption buttons]. Measure the real row, ask the
 * pure model what must leave so the address field keeps a sane minimum, and mark those controls `data-fit-hidden`
 * (CSS hides them; the » below then gathers them). The Acira menu and the caption buttons never move.
 * Runs in the frame after a change, once per distinct width/content (a signature on the row skips repeats). */
function fitRow(toolbar: HTMLElement) {
  const actions = toolbar.querySelector<HTMLElement>(':scope > .toolbar-actions');
  const leading = toolbar.querySelector<HTMLElement>(':scope > .acira-leading-controls');
  if (!actions || !leading || !toolbar.getClientRects().length) return;
  const style = getComputedStyle(toolbar), grid = style.display === 'grid';
  const space = toolbar.querySelector<HTMLElement>(':scope > .compact-caption-space');
  const caption = space && shown(space) ? space.getBoundingClientRect().width : 0;
  const reserve = grid ? px(getComputedStyle(actions).marginRight) : 0;
  const inner = toolbar.clientWidth - px(style.paddingLeft) - px(style.paddingRight) - reserve;
  const gap = px(style.columnGap) || 12;
  const overview = leading.querySelector<HTMLElement>('.toolbar-tab-overview'), home = leading.querySelector<HTMLElement>('[data-toolbar-item="home"]');
  const children = [...actions.children] as HTMLElement[];
  const candidates = children.filter(node => node.hasAttribute('data-toolbar-item') || node.classList.contains('native-extension-actions'));
  // What the answer depends on, plus how many controls are marked right now (a re-created button loses its mark).
  const signature = () => [Math.round(toolbar.clientWidth * 10), Math.round(caption * 10), Math.round(reserve), grid ? 'g' : 'f', children.map(node => node.className + node.getAttribute('data-toolbar-item')).join(','), leading.querySelectorAll('button').length, overview ? 1 : 0, home ? 1 : 0, toolbar.style.getPropertyValue('--fit-lead') ? 1 : 0, toolbar.querySelectorAll('[data-fit-hidden]').length].join('|');
  if (toolbar.dataset.fitKey === signature()) return;
  // Measure the natural row: clear last answer, then see what the CSS shows and how wide it is.
  for (const node of [...candidates, ...(overview ? [overview] : []), ...(home ? [home] : [])]) node.removeAttribute(FIT);
  const items: FitItem[] = [], fixed: number[] = [fitMetrics.control];
  const present = new Map<string, HTMLElement>();
  for (const node of candidates) {
    if (!shown(node)) continue;
    const pinned = node.classList.contains('native-extension-actions');
    const id = pinned ? 'pinned' : node.getAttribute('data-toolbar-item') || '';
    const width = pinned ? node.getBoundingClientRect().width : fitMetrics.control;
    if (!width) continue;
    if (!id || !hideOrder.includes(id)) { fixed.push(width); continue; }
    items.push({ id, width }); present.set(id, node);
  }
  for (const node of children) {
    if (candidates.includes(node) || node.classList.contains('toolbar-menu-control') || !shown(node) || node.matches('.toolbar-overflow,.toolbar-overflow-profile')) continue;
    const width = node.getBoundingClientRect().width;
    if (width) fixed.push(width);
  }
  const navGap = 6;
  const kids = grid ? [...leading.querySelectorAll<HTMLElement>('.compact-navigation > *')].filter(node => shown(node)) : [];
  const leadingWidth = grid
    ? kids.reduce((sum, node) => sum + (node.classList.contains('acira-compact-tabs') ? 34 : node.getBoundingClientRect().width), 0) + Math.max(0, kids.length - 1) * navGap
    : leading.getBoundingClientRect().width;
  const overviewShown = overview && shown(overview) && overview.getBoundingClientRect().width > 0;
  const homeShown = home && shown(home) && home.getBoundingClientRect().width > 0;
  const result = fitToolbar({ inner, caption, gap, leading: leadingWidth, tabViewer: overviewShown ? overview!.getBoundingClientRect().width + navGap : 0, home: homeShown ? home!.getBoundingClientRect().width + 4 : 0, items, fixed });
  for (const id of result.hidden) present.get(id)?.setAttribute(FIT, '');
  if (result.hidden.includes('home')) home?.setAttribute(FIT, '');
  if (result.dropTabViewer && overview) overview.setAttribute(FIT, '');
  // Compact and Focus: the left column never gets narrower than its controls (the tab chips can still shrink to 34px).
  if (grid) toolbar.style.setProperty('--fit-lead', `${Math.ceil(leadingWidth - (result.dropTabViewer && overviewShown ? overview!.getBoundingClientRect().width + navGap : 0))}px`);
  toolbar.dataset.fitKey = signature();
  actions.dataset.fitPinned = result.hidden.includes('pinned') ? '1' : '';
}

/** P09 (M): narrow windows hide toolbar buttons (the compact and Focus rows drop Extensions below 1000px, the study's
 * toolbar keeps only its last icon button there). The » overflow gathers whatever its row hides, Chrome-style, so
 * nothing is out of reach in the smallest window. This marks each actions row with the ids of its enabled buttons that
 * are hidden right now (`data-overflow="extensions.history"`); CSS shows » only while the list is not empty, and » opens
 * a menu of exactly those. Re-checked after every render and whenever the window resizes (width rules hide them).
 * Toolbar fit adds the width rule that matters most: a row too narrow for its controls hides the lowest-priority
 * ones (fitRow above), so the address field keeps room and the menu stays on screen.
 * After a render the check waits for the next frame: read inside the commit, getClientRects forced a full style recalc
 * there (a theme switch restyles ~700 elements, then the frame restyled them again: F04's long frame), while in the
 * frame's animation callbacks it shares the one recalc the frame does anyway. */
export function useToolbarOverflow(items: readonly { id: ToolbarItemId; label: string }[]) {
  const key = items.map(item => item.id).join('.');
  useLayoutEffect(() => {
    const mark = () => {
      // One row that cannot be measured never stops the overflow bookkeeping below.
      for (const toolbar of document.querySelectorAll<HTMLElement>('.acira-shell .acira-persistent-toolbar')) { watch(toolbar); try { fitRow(toolbar); } catch (error) { console.error('toolbar fit failed', error); } }
      for (const row of document.querySelectorAll<HTMLElement>('.acira-shell :is(.toolbar-actions,.focus-actions)')) {
        const hiddenIds: string[] = items.filter(item => { const node = row.querySelector(`:scope > [data-toolbar-item="${item.id}"]`); return !!node && !node.getClientRects().length; }).map(item => item.id);
        // Pinned extension buttons that left the row are reached through the Extensions entry, even when the toolbar has no Extensions button.
        if (row.dataset.fitPinned === '1' && !hiddenIds.includes('extensions')) hiddenIds.push('extensions');
        // R4-26: Home lives with back and forward; when the fit moves it out, it joins this row's » menu.
        if (row.parentElement?.querySelector(':scope > .acira-leading-controls [data-toolbar-item="home"][data-fit-hidden]')) hiddenIds.unshift('home');
        const hidden = hiddenIds.join('.');
        if (hidden) { if (row.dataset.overflow !== hidden) row.dataset.overflow = hidden; } else if (row.dataset.overflow !== undefined) delete row.dataset.overflow;
      }
    };
    let ran = false;
    const frame = requestAnimationFrame(() => { ran = true; mark(); });
    // A page the window system is not painting (occluded, minimized, mid-restore) gets no animation frames: a timer is the
    // fallback, so the row is fitted for the window it will show when it is next seen.
    const timer = setTimeout(() => { if (!ran) mark(); }, 200);
    addEventListener('resize', mark);
    addEventListener(REFIT, mark);
    return () => { cancelAnimationFrame(frame); clearTimeout(timer); removeEventListener('resize', mark); removeEventListener(REFIT, mark); };
  });
  return key;
}
