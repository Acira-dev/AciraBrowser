/** Toolbar fit: what the top row keeps when the window is narrow.
 *
 * The row is [leading controls] [address field] [actions] [caption buttons]. The Acira menu and the window's caption
 * buttons are ALWAYS fully visible, whatever the window width, interface scale, tab layout or window view. When the row
 * is too narrow the address field gives up width first, down to a sane minimum; after that the lower-priority actions
 * move into the » overflow menu one at a time (lowest priority first), and as a last step the tab-viewer button leaves a
 * sidebar-tabs row (the sidebar already lists the tabs; Alt T still opens the viewer). Pure and shared:
 * `useToolbarOverflow` measures the real row and applies the answer; tests/toolbar-fit.test.ts pins it for every
 * allowed window width, scale, tab layout and view. All lengths are CSS pixels of the (scaled) interface. */

/** Widths the answer is built from. They are the toolbar buttons' CSS sizes (toolbar-controls.css). */
export const fitMetrics = {
  /** An icon button in the actions row. */
  control: 28,
  /** Gap between actions. */
  actionGap: 4,
  /** The address field never gets narrower than this while an action can still make room for it. */
  addressMin: 140,
  /** Beta 14: while extension buttons share the row with the address field, the field keeps this much room (a short address and a little to spare: "github.com/acira-dev/browser"), and the buttons give way for it before
   * anything else does: one at a time from the end of the pinned list, the rest behind the "more" button. Below the pinned buttons the old floor (`addressMin`) rules again. */
  addressComfort: 220,
  /** An extension button in the toolbar and its gap (extension-actions.css; the engine's own gap between its buttons). The "more" button is one more of them. */
  extensionButton: 30,
  extensionGap: 5,
  /** Kept free at the row's end so fractional widths never push the menu under the caption buttons. */
  slack: 1,
  /** Native Windows caption buttons, in DIPs; divide by the interface scale for CSS px. */
  captionDip: 138,
  /** The compact tab strip folded to its + button (toolbar-controls.css lets it shrink this far). */
  stripFolded: 34,
  /** The compact tab strip's usable minimum: its + button and room for one tab between the scroll arrows. Below it the strip
   * shows no tabs at all (CompactTabs: condensed under 90px beside the +; CompactTabs.css min-width). */
  strip: 124,
} as const;

/** The caption buttons' width in CSS px for an interface scale (percent). Mac has none. */
export const captionWidth = (scalePercent: number, platformCaption = true): number => platformCaption ? fitMetrics.captionDip / (scalePercent / 100) : 0;

/** Hidden first to last when the row is too narrow. Profile and Protection are the last optional controls to go. Ids the
 * list does not know hide before all of these. */
export const hideOrder: readonly string[] = ['sites', 'pinned', 'extensions', 'routines', 'history', 'downloads', 'bookmarks', 'split', 'appearance', 'vpn', 'seamless', 'focus', 'home', 'protection', 'profile'];

export interface FitItem {
  id: string; width: number;
  /** The pinned extensions: a group of `count` equal buttons the fit can take off the end one at a time (the "more" button takes the last slot). Its width is then worked out from the parts, `width` being the whole group. */
  parts?: { count: number };
  /** The room the address field keeps before this item leaves the row (default `addressMin`). The pinned extension buttons say `addressComfort`: they leave first, and for the field's comfort. */
  room?: number;
  /** Beta 14: the side panel sites' icons in the top-tabs toolbar: a group of `count` equal controls (the sites, then a "+" while there is room for one more) the fit takes off the END one at a time, the "+" first. Each icon that leaves is
   * listed in the » menu (ui/toolbarOverflow.ts); with none left the group is hidden as a whole. They leave before the pinned extension buttons, for the field's comfort (`room`). */
  slots?: { count: number; /** The last slot is the "+" (it has no row in the » menu, so it leaves without needing the » button). */ plus?: boolean };
}

/** The width of the pinned extensions' group when it has `slots` slots (a button each; the last is the "more" button when some are behind it). */
export const groupWidth = (slots: number): number => slots <= 0 ? 0 : slots * fitMetrics.extensionButton + (slots - 1) * fitMetrics.extensionGap;

/** The width of the side panel sites' group when it has `slots` slots: toolbar icon buttons side by side (the actions' own size and gap). */
export const siteGroupWidth = (slots: number): number => slots <= 0 ? 0 : slots * fitMetrics.control + (slots - 1) * fitMetrics.actionGap;

export interface FitInput {
  /** The row's usable width: its width minus its horizontal padding. */
  inner: number;
  /** Width the caption buttons take at the row's right end; 0 when the row sits below them (a tab strip above). */
  caption: number;
  /** Gap between the leading controls, the address field, the actions and the caption area. */
  gap: number;
  /** Natural width of everything left of the address field, the tab-viewer button included. */
  leading: number;
  /** The tab-viewer button's share of `leading` (its width plus the gap before it); 0 when it is not in this row. */
  tabViewer: number;
  /** R4-26: the Home button's share of `leading` (its width plus the gap before it); 0 when it is off. It leaves for the » menu
   * after the low-priority actions (its place in `hideOrder`), before Protection and the profile. */
  home?: number;
  /** Optional actions that are in the row, in any order. Widths of the controls themselves. */
  items: readonly FitItem[];
  /** Controls that never leave the row, left to right: the Acira menu, a private-window chip, the AI-free control. */
  fixed: readonly number[];
}

export interface FitResult {
  /** Ids of the optional actions that move into the » overflow menu. */
  hidden: string[];
  /** The tab-viewer button leaves the row too. */
  dropTabViewer: boolean;
  /** The address field's width after the above. */
  address: number;
  /** Width of the actions group (the Acira menu is its last control). */
  actions: number;
  /** AD3: the pinned extension buttons that stay in the row (`visible`, from the start of the pinned list) and whether the "more" button takes the last slot. Null when no pinned group with parts was given; `visible: 0, more: false` when the whole group left (it is then in `hidden`). */
  pinned: { visible: number; more: boolean } | null;
  /** AF: how many of the side panel sites' slots stay in the row (from the start of the group), of `count`. Null when no group of sites was given; `visible: 0` when the whole group left. */
  sites: { visible: number; count: number } | null;
}

const rank = (id: string) => { const at = hideOrder.indexOf(id); return at < 0 ? -1 : at; };

export function fitToolbar(input: FitInput): FitResult {
  const { inner, caption, gap, leading, tabViewer, fixed, home = 0 } = input;
  const order = [...input.items, ...(home > 0 ? [{ id: 'home', width: home }] : [])].sort((a, b) => rank(a.id) - rank(b.id));
  const group = order.find(item => item.id === 'pinned' && item.parts && item.parts.count > 0);
  const count = group?.parts?.count ?? 0;
  /** AF: the side panel sites' group and its slots right now (the "+" is the last slot). */
  const sitesGroup = order.find(item => item.id === 'sites' && item.slots && item.slots.count > 0);
  const siteCount = sitesGroup?.slots?.count ?? 0, plusSlot = sitesGroup?.slots?.plus ? 1 : 0;
  let siteSlots = siteCount;
  /** The group's slots right now: all its buttons, then fewer (the last slot being the "more" button), down to that button alone. */
  let slots = count;
  const hidden: string[] = [];
  let dropTabViewer = false;
  const widthOf = (item: FitItem) => item === group ? groupWidth(slots) : item === sitesGroup ? siteGroupWidth(siteSlots) : item.width;
  const measure = () => {
    const shown = order.filter(item => item.id !== 'home' && !hidden.includes(item.id)).map(widthOf);
    const widths = [...fixed, ...(hidden.length || siteSlots < siteCount - plusSlot ? [fitMetrics.control] : []), ...shown];
    const actions = widths.reduce((sum, width) => sum + width, 0) + Math.max(0, widths.length - 1) * fitMetrics.actionGap;
    const lead = leading - (dropTabViewer ? tabViewer : 0) - (hidden.includes('home') ? home : 0);
    const columns = caption > 0 ? 3 : 2;
    // One CSS pixel of slack: measured widths are fractional at 125% and 150% and the row rounds them, which put the menu
    // 0.6-0.7px past the caption-safe edge (R4 responsive sweep). The fit decides with that pixel kept free.
    const address = inner - lead - actions - caption - gap * columns - fitMetrics.slack;
    return { actions, address, lead };
  };
  let now = measure();
  // AF: the side panel sites' icons give way before the extension buttons, for the same comfort: from the end of the group (the "+" first), one at a time, the last one leaving takes the whole group out of the row.
  while (sitesGroup && !hidden.includes('sites') && now.address < (sitesGroup.room ?? fitMetrics.addressComfort)) {
    if (siteSlots > 1) siteSlots--; else { siteSlots = 0; hidden.push('sites'); }
    now = measure();
  }
  // AD3: the extension buttons give way first, for the field's comfort: from the end of the pinned list, one at a time, the rest behind the "more" button, down to that button alone.
  while (group && !hidden.includes('pinned') && slots > 1 && now.address < fitMetrics.addressComfort) { slots--; now = measure(); }
  // What leaves next leaves when the field is below what that item protects: the pinned buttons at their comfortable room, everything else at the old floor.
  while (hidden.length < order.length && now.address < (order[hidden.length].room ?? fitMetrics.addressMin)) { hidden.push(order[hidden.length].id); now = measure(); }
  if (now.address < fitMetrics.addressMin && tabViewer > 0) { dropTabViewer = true; now = measure(); }
  const pinned = group ? (hidden.includes('pinned') ? { visible: 0, more: false } : { visible: slots < count ? slots - 1 : count, more: slots < count }) : null;
  const sites = sitesGroup ? { visible: hidden.includes('sites') ? 0 : siteSlots, count: siteCount } : null;
  return { hidden, dropTabViewer, address: Math.max(0, now.address), actions: now.actions, pinned, sites };
}

/** Compact and Focus: the left column's floor (the grid's `--fit-lead`). `lead` counts the tab strip folded to its + button,
 * as the fit does, and `address` is the field's room from `fitToolbar`. When the field can give the strip its usable minimum
 * and still keep its own, the floor holds the strip at that minimum: the field gives way (it moves off the window's centre,
 * then narrows) before the strip loses its tabs. Otherwise nothing changes: the strip folds as before and no button leaves
 * the row for it. */
export function compactLeadFloor(lead: number, address: number, strip: boolean): number {
  const room = fitMetrics.strip - fitMetrics.stripFolded;
  return strip && address - room >= fitMetrics.addressMin ? lead + room : lead;
}
