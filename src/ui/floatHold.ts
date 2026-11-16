// 13.10 round 3 + 4 (laptop traces, Windows and Linux): during a Seamless float (the sidebar or the toolbar out) the interface asked main for the Full-view page rectangle {x0,y72,..} with motion 'slide',
// and the page really moved there (a window never activated since launch: the first reveal of every launch; Linux: every reveal).
//
// Why (round 4): the page card does not move while a Seamless float is out, so what is sent for a float was "the last layout sent at rest". That memory (App.tsx edgeRestRef, and round 3's restSentRef) was
// only taken by a layout sent with no float flag at all, outside any view transition. In those windows no such layout comes after the Seamless entry: the toolbar is still asked for (the address field holds
// the focus, nothing ever blurs it) or the entry's own layouts all went out inside the entry's view transition. The memory stayed what the START-UP layout left in it, the Full view's {0,72,W,H-72}, and
// every float replayed it. Round 3's `restFrom` also took that start-up layout for a Seamless rest (its test was relative to the view, and the Full view sits at y=72 too).
//
// The rule now never depends on a memory being fresh: the card is the PANE's own rectangle, which the DOM keeps in its resting place under a floating sidebar or toolbar (the page area is the window
// onto it) and which every layout measures anew. While a Seamless float is out the page rectangle sent is
//   1. the rest this window remembers, when it is a Seamless one (at the window's edge, holding the card) for the same window size and page; else
//   2. the card itself, when the measured page rectangle does not hold it (the toolbar's row pushed the page area down, or an old Full rest came back) - at rest too; else
//   3. as measured (nothing odd).
// `restFrom` says whether a layout is a rest to remember (or that the window is no longer Seamless and the memory goes); `placeFloat` says what to send (App.tsx physicalLayout calls both).
export type Box = { x: number; y: number; width: number; height: number };
export type RestSent = { pageBounds: Box; views: Map<string, Box>; width: number; height: number };
type View = { tabId: string; bounds: Box };
export type FloatLayoutInput = {
  floating: boolean;                       // a float is out (chromeEdge isEdgeFloating)
  seamless: boolean;                       // the render's own view
  edgeTransition: boolean;                 // the edge reveal's view transition is running (data-mode-switch=edge)
  flags: { side: boolean; top: boolean };  // the edges the render says float (the toolbar counts while it is shown for any reason: the pointer, a key, the address field's focus)
  pinned: boolean;                         // a sidebar or toolbar of the float is pinned (the page then moves, as before)
  split: boolean; morph: boolean;
  pageBounds: Box;                         // what would be sent
  views: View[];                           // what would be sent
  measuredView?: Box;                      // the pane's own rectangle as the DOM has it now (the card)
  viewport?: { width: number; height: number };
};
export type Placed = { pageBounds: Box; views: View[]; kind: 'rest' | 'card' };
/** A Seamless card rests at the window's edge (the inset is 6): a page rectangle further in than this is the Full view's, a half-played glide's, or a toolbar-shown one, never a rest. */
export const SEAMLESS_EDGE = 12;
const TOLERANCE = 8;
/** Does the page rectangle start at or before the card (within a few pixels)? A page area is the window onto its pane: it never starts after it. */
export const holds = (page: Box, card: Box): boolean => page.x <= card.x + TOLERANCE && page.y <= card.y + TOLERANCE;
const single = (input: FloatLayoutInput): boolean => input.seamless && !input.split && !input.morph && !input.pinned && input.views.length === 1 && !!input.viewport && !!input.measuredView;
/** The rest to remember: a Seamless window at rest (no float flag, no edge transition) with one page whose card sits at the window's edge and is held by the page rectangle. 'forget' when the window is plainly not
 *  Seamless at rest; null when nothing can be said. A layout inside another view transition (the Seamless entry) is a rest too when it passes these tests: nothing else follows it in a window never activated. */
export function restFrom(input: FloatLayoutInput): RestSent | 'forget' | null {
  if (input.floating || input.edgeTransition) return null;
  if (!input.seamless) return 'forget';
  if (input.flags.side || input.flags.top || !single(input)) return null;
  const card = input.measuredView!, [view] = input.views;
  if (input.pageBounds.x > SEAMLESS_EDGE || input.pageBounds.y > SEAMLESS_EDGE || !holds(input.pageBounds, card) || !holds(input.pageBounds, view.bounds)) return null;
  return { pageBounds: { ...input.pageBounds }, views: new Map([[view.tabId, { ...view.bounds }]]), width: input.viewport!.width, height: input.viewport!.height };
}
/** What to send in a Seamless window with one page, or null (not Seamless, a split, a morph, a pinned edge, or nothing odd and nothing to hold: the layout goes as measured). While an edge is out the Seamless rest is held;
 *  at any time a page rectangle that does not hold its pane (the toolbar's row pushed the page area down and the pane stayed, an old Full rest) is the pane's own rectangle. */
export function placeFloat(input: FloatLayoutInput, rest: RestSent | null): Placed | null {
  if (!single(input)) return null;
  const out = input.floating || input.flags.side || input.flags.top || input.edgeTransition;   // an edge is out (or its transition is playing): the rest is held
  const card = input.measuredView!, [view] = input.views, viewport = input.viewport!;
  if (out && rest && rest.width === viewport.width && rest.height === viewport.height && rest.views.has(view.tabId) && rest.pageBounds.x <= SEAMLESS_EDGE && rest.pageBounds.y <= SEAMLESS_EDGE && holds(rest.pageBounds, card))
    return { pageBounds: { ...rest.pageBounds }, views: input.views.map(item => ({ ...item, bounds: { ...rest.views.get(item.tabId)! } })), kind: 'rest' };
  if (!holds(input.pageBounds, card) || !holds(input.pageBounds, view.bounds))
    return { pageBounds: { ...card }, views: input.views.map(item => ({ ...item, bounds: { ...card } })), kind: 'card' };
  return null;
}
