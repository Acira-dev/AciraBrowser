import test from 'node:test';
import assert from 'node:assert/strict';
import { captionWidth, fitMetrics, fitToolbar, hideOrder, type FitInput, type FitItem } from '../src/ui/toolbarFit';

/** The top row's layout, from the CSS sizes in toolbar-controls.css, for every allowed window width, interface scale,
 * tab layout and window view. The row is [leading] [address] [actions] [caption buttons]; the property: no control's
 * right edge is beyond the viewport minus the caption buttons' width (the Acira menu is never under them), and the
 * address field keeps its minimum. */
const minWindow = 900, scales = [80, 90, 100, 110, 125, 150, 175];
const views = ['full', 'compact', 'focus', 'seamless'] as const;
const layouts = ['strip', 'sidebar'] as const;
const control = fitMetrics.control, navGroup = 3 * control + 2 * 4;
/** R4-26: Home sits in the navigation group by default (one more control and gap); the fit can move it into ». */
const homeShare = control + 4;

const optional = (...ids: string[]): FitItem[] => ids.map(id => ({ id, width: id === 'pinned' ? 3 * 33 : control }));
const defaults = optional('extensions', 'focus', 'profile');
const everything = optional('pinned', 'extensions', 'routines', 'history', 'downloads', 'bookmarks', 'split', 'appearance', 'vpn', 'focus', 'protection', 'profile');

interface Row { input: FitInput; viewport: number; pad: number; padRight: number; captionOverlays: boolean }

/** What the hook would measure for this window. `win32` false is the Mac case: no caption buttons. */
function row(width: number, scale: number, layout: typeof layouts[number], view: typeof views[number], items: FitItem[], fixedExtra: number[] = [], win32 = true, withHome = true): Row {
  const home = withHome ? homeShare : 0;
  const viewport = width / (scale / 100), caption = captionWidth(scale, win32);
  const sidebar = layout === 'sidebar' && view !== 'compact' && view !== 'focus';
  // Sidebar tabs sit beside the toolbar only in Full and a revealed Seamless row; the sidebar is 128 CSS px narrow, 240 otherwise.
  const toolbarLeft = sidebar ? (viewport < 800 ? 128 : 240) : 0;
  const standard = view === 'full' || view === 'seamless';
  const fixed = [control, ...fixedExtra];
  if (standard) {
    // Standard: a flex row. With sidebar tabs the single row also holds the caption area; with a strip it sits below the caption buttons.
    const leading = (sidebar ? 2 * control + navGroup + 2 * 6 : navGroup) + home;
    const tabViewer = sidebar ? control + 6 : 0;
    const inner = viewport - toolbarLeft - 12 - (sidebar ? 0 : 12);
    return { input: { inner, caption: sidebar ? caption : 0, gap: 12, leading, tabViewer, home, items, fixed }, viewport, pad: toolbarLeft + 12, padRight: sidebar ? 0 : 12, captionOverlays: sidebar };
  }
  // Compact and Focus: one grid row; the caption width is reserved as the actions' right margin.
  const miniTabs = layout === 'strip' ? 34 : 0, toggle = layout === 'sidebar' ? control : 0;
  const kids = [toggle, navGroup, control, miniTabs].filter(Boolean);
  const leading = kids.reduce((sum, value) => sum + value, 0) + (kids.length - 1) * 6 + home;
  const reserve = Math.max(0, caption - 12);
  return { input: { inner: viewport - 24 - reserve, caption: 0, gap: 12, leading, tabViewer: control + 6, home, items, fixed }, viewport, pad: 12, padRight: 12 + reserve, captionOverlays: true };
}

/** Right edge of the Acira menu: where the row's pieces land. */
function menuRight(r: Row, hidden: readonly string[], dropped: boolean, address: number, actions: number) {
  const { input } = r;
  const lead = input.leading - (dropped ? input.tabViewer : 0) - (hidden.includes('home') ? input.home ?? 0 : 0);
  // The field takes what is left (CSS lets it go below its minimum only when the window cannot offer more).
  return r.pad + lead + input.gap + address + input.gap + actions;
}

test('no control sits beyond the viewport minus the caption buttons, at every window width, scale, tab layout and view', () => {
  const sets: Array<[string, FitItem[], number[]]> = [['default toolbar', defaults, []], ['every toolbar button + pinned extensions + private chip', everything, [72]]];
  let checked = 0;
  for (const [name, items, extra] of sets) for (const scale of scales) for (const layout of layouts) for (const view of views) {
    for (let width = minWindow; width <= 3840; width += width < 1400 ? 4 : 40) {
      const r = row(width, scale, layout, view, items, extra);
      const result = fitToolbar(r.input);
      const right = menuRight(r, result.hidden, result.dropTabViewer, result.address, result.actions);
      const limit = r.captionOverlays ? r.viewport - captionWidth(scale) : r.viewport - r.padRight;
      const label = `${name}: ${width} DIP, ${scale}%, ${layout}, ${view}`;
      assert.ok(right <= limit + 0.01, `${label}: the menu ends at ${right.toFixed(1)}, past ${limit.toFixed(1)}`);
      // 175% is beyond the Interface size options (80-150%): only the edge guarantee above is held there.
      const nothingLeftToGive = result.hidden.filter(id => id !== 'home').length === items.length && result.hidden.includes('home') && (result.dropTabViewer || r.input.tabViewer === 0);
      if (scale <= 150 && !nothingLeftToGive) assert.ok(result.address >= fitMetrics.addressMin,`${label}: address ${result.address.toFixed(1)} is below ${fitMetrics.addressMin}`);
      checked++;
    }
  }
  assert.ok(checked > 3000);
});

test('the reported bug: 150% scale, tabs in the sidebar, a 960 DIP window keeps the menu in view', () => {
  // 640 CSS px wide viewport; the old row ended its menu at x=768.
  const r = row(960, 150, 'sidebar', 'full', defaults);
  assert.equal(Math.round(r.viewport), 640);
  const result = fitToolbar(r.input);
  const right = menuRight(r, result.hidden, result.dropTabViewer, result.address, result.actions);
  assert.ok(right <= 640 - captionWidth(150) + 0.01, `menu ends at ${right}`);
  assert.ok(result.hidden.length > 0, 'lower-priority buttons moved into the » menu');
  assert.ok(result.address >= fitMetrics.addressMin);
  // The smallest allowed window too.
  const small = fitToolbar(row(900, 150, 'sidebar', 'full', defaults).input);
  assert.ok(small.address >= fitMetrics.addressMin);
});

test('the address field shrinks first: nothing leaves a row that fits at the field\'s minimum', () => {
  const wide = fitToolbar(row(1920, 100, 'sidebar', 'full', everything).input);
  assert.deepEqual(wide.hidden, []);
  assert.equal(wide.dropTabViewer, false);
  // Find the first width where something has to leave; just above it the field is at (or just above) its minimum.
  let last = fitToolbar(row(1920, 100, 'sidebar', 'full', everything).input);
  for (let width = 1920; width >= minWindow; width -= 2) {
    const result = fitToolbar(row(width, 100, 'sidebar', 'full', everything).input);
    if (result.hidden.length && !last.hidden.length) assert.ok(last.address < fitMetrics.addressMin + 40, `field was ${last.address} when the first button left`);
    last = result;
  }
});

test('buttons leave lowest priority first, the profile last, and the tab viewer only when nothing else is left to hide', () => {
  const input = row(900, 175, 'sidebar', 'full', everything, [72]).input;
  const narrow = fitToolbar({ ...input, inner: 330 });
  assert.deepEqual(narrow.hidden, hideOrder.filter(id => id === 'home' || everything.some(item => item.id === id)).slice(0, narrow.hidden.length));
  assert.ok(!narrow.hidden.includes('profile') || narrow.hidden.length === everything.length + 1);
  for (let inner = 800; inner >= 0; inner -= 4) {
    const result = fitToolbar({ ...input, inner });
    if (result.dropTabViewer) assert.equal(result.hidden.length, everything.length + 1, `the tab viewer left at ${inner} while buttons could still go`);
  }
  assert.ok(fitToolbar({ ...input, inner: 60 }).dropTabViewer, 'the tab viewer is the last to go');
});

test('a Mac window reserves no caption width, and a strip row below the caption buttons keeps full width', () => {
  assert.equal(captionWidth(100, false), 0);
  const mac = fitToolbar(row(900, 150, 'sidebar', 'full', defaults, [], false).input);
  const win = fitToolbar(row(900, 150, 'sidebar', 'full', defaults).input);
  assert.ok(mac.hidden.length <= win.hidden.length);
  assert.equal(row(960, 150, 'strip', 'full', defaults).input.caption, 0);
});

test('R4-26 Home shows by default and only leaves for » after the low-priority buttons, before Protection and the profile', () => {
  assert.ok(hideOrder.indexOf('home') > hideOrder.indexOf('focus') && hideOrder.indexOf('home') < hideOrder.indexOf('protection'));
  // A default 1280 DIP window at 100% keeps Home in every layout and view.
  for (const layout of layouts) for (const view of views) assert.ok(!fitToolbar(row(1280, 100, layout, view, defaults).input).hidden.includes('home'), `${layout} ${view}`);
  // Narrowing a row: every low-priority button has left before Home does.
  const input = row(900, 150, 'sidebar', 'full', everything, [72]).input;
  for (let inner = 900; inner >= 0; inner -= 4) {
    const result = fitToolbar({ ...input, inner });
    if (result.hidden.includes('home')) for (const id of ['pinned', 'extensions', 'history', 'downloads', 'bookmarks', 'split', 'focus']) assert.ok(result.hidden.includes(id), `${id} still shown when Home left at ${inner}`);
  }
  // The founder's case: 900 DIP, 150%, tabs in the sidebar, Home on: the menu stays in view.
  const r = row(900, 150, 'sidebar', 'full', defaults), result = fitToolbar(r.input);
  assert.ok(menuRight(r, result.hidden, result.dropTabViewer, result.address, result.actions) <= r.viewport - captionWidth(150) + 0.01);
});
