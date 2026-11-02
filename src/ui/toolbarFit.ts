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
  /** Kept free at the row's end so fractional widths never push the menu under the caption buttons. */
  slack: 1,
  /** Native Windows caption buttons, in DIPs; divide by the interface scale for CSS px. */
  captionDip: 138,
} as const;

/** The caption buttons' width in CSS px for an interface scale (percent). Mac has none. */
export const captionWidth = (scalePercent: number, platformCaption = true): number => platformCaption ? fitMetrics.captionDip / (scalePercent / 100) : 0;

/** Hidden first to last when the row is too narrow. Profile and Protection are the last optional controls to go. Ids the
 * list does not know hide before all of these. */
export const hideOrder: readonly string[] = ['pinned', 'extensions', 'routines', 'history', 'downloads', 'bookmarks', 'split', 'appearance', 'vpn', 'focus', 'home', 'protection', 'profile'];

export interface FitItem { id: string; width: number }

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
}

const rank = (id: string) => { const at = hideOrder.indexOf(id); return at < 0 ? -1 : at; };

export function fitToolbar(input: FitInput): FitResult {
  const { inner, caption, gap, leading, tabViewer, fixed, home = 0 } = input;
  const order = [...input.items, ...(home > 0 ? [{ id: 'home', width: home }] : [])].sort((a, b) => rank(a.id) - rank(b.id));
  const hidden: string[] = [];
  let dropTabViewer = false;
  const measure = () => {
    const shown = order.filter(item => item.id !== 'home' && !hidden.includes(item.id)).map(item => item.width);
    const widths = [...fixed, ...(hidden.length ? [fitMetrics.control] : []), ...shown];
    const actions = widths.reduce((sum, width) => sum + width, 0) + Math.max(0, widths.length - 1) * fitMetrics.actionGap;
    const lead = leading - (dropTabViewer ? tabViewer : 0) - (hidden.includes('home') ? home : 0);
    const columns = caption > 0 ? 3 : 2;
    // One CSS pixel of slack: measured widths are fractional at 125% and 150% and the row rounds them, which put the menu
    // 0.6-0.7px past the caption-safe edge (R4 responsive sweep). The fit decides with that pixel kept free.
    const address = inner - lead - actions - caption - gap * columns - fitMetrics.slack;
    return { actions, address, lead };
  };
  let now = measure();
  while (now.address < fitMetrics.addressMin && hidden.length < order.length) { hidden.push(order[hidden.length].id); now = measure(); }
  if (now.address < fitMetrics.addressMin && tabViewer > 0) { dropTabViewer = true; now = measure(); }
  return { hidden, dropTabViewer, address: Math.max(0, now.address), actions: now.actions };
}
