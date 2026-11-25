import test from 'node:test';
import assert from 'node:assert/strict';
import { captionWidth, fitMetrics, fitToolbar, groupWidth, hideOrder, type FitInput, type FitItem } from '../src/ui/toolbarFit';

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

// ---- Beta 14: the extension buttons give way to the address field, one at a time, behind the "more" button ----
/** The pinned extensions as the hook measures them now: a group of `count` buttons the fit may take off the end. */
const pinnedItems = (count: number, others: string[] = ['extensions', 'focus', 'profile']): FitItem[] => [{ id: 'pinned', width: groupWidth(count), parts: { count } }, ...optional(...others)];

test('the group is a button each at the buttons\' own size and pitch; the "more" button is one of the slots', () => {
  assert.equal(groupWidth(0), 0);
  assert.equal(groupWidth(1), fitMetrics.extensionButton);
  assert.equal(groupWidth(3), 3 * 30 + 2 * 5);
  assert.equal(fitMetrics.extensionButton, 30);
  assert.equal(fitMetrics.extensionGap, 5);
});

test('the extension buttons never take the address field below its comfortable room before they give way: one at a time from the end, the rest behind "more", at every window', () => {
  let checked = 0, partial = 0;
  for (const count of [1, 5, 12, 20]) for (const scale of [80, 100, 125, 150]) for (const layout of layouts) for (const view of views) {
    for (let width = minWindow; width <= 2560; width += 8) {
      const r = row(width, scale, layout, view, pinnedItems(count), [72]);
      const result = fitToolbar(r.input), pinned = result.pinned!;
      const label = `${count} pinned: ${width} DIP, ${scale}%, ${layout}, ${view}`;
      assert.ok(pinned, label);
      if (result.hidden.includes('pinned')) { assert.deepEqual(pinned, { visible: 0, more: false }, label); continue; }
      assert.ok(pinned.visible >= 0 && pinned.visible <= count, label);
      assert.equal(pinned.more, pinned.visible < count, `"more" shows exactly when some are behind it: ${label}`);
      const slots = pinned.visible + (pinned.more ? 1 : 0);
      // The buttons gave way for the field: either they all stay, or only the "more" button is left, or the field has its comfortable room.
      assert.ok(slots === count || slots <= 1 || result.address >= fitMetrics.addressComfort, `${label}: ${slots} slots with the field at ${result.address.toFixed(1)}`);
      const right = menuRight(r, result.hidden, result.dropTabViewer, result.address, result.actions);
      const limit = r.captionOverlays ? r.viewport - captionWidth(scale) : r.viewport - r.padRight;
      assert.ok(right <= limit + 0.01, `${label}: the menu ends at ${right.toFixed(1)}, past ${limit.toFixed(1)}`);
      if (pinned.more) partial++;
      checked++;
    }
  }
  assert.ok(checked > 3000 && partial > 300, `${checked} windows, ${partial} with a "more" button`);
});

test('narrowing the row: the extension slots only go down, nothing else leaves before the pinned group is down to the "more" button alone, and the group leaves entirely only below the old floor', () => {
  for (const count of [5, 12, 20]) {
    const input = row(1920, 100, 'sidebar', 'full', pinnedItems(count, ['extensions', 'history', 'downloads', 'focus', 'profile']), [72]).input;
    let slots = Infinity, hiddenCount = 0;
    for (let inner = input.inner; inner >= 0; inner -= 3) {
      const result = fitToolbar({ ...input, inner }), pinned = result.pinned!;
      const now = result.hidden.includes('pinned') ? 0 : pinned.visible + (pinned.more ? 1 : 0);
      assert.ok(now <= slots, `slots grew from ${slots} to ${now} at ${inner}`);
      assert.ok(result.hidden.length >= hiddenCount, 'what left does not come back as the row narrows');
      if (result.hidden.some(id => id !== 'pinned')) assert.ok(now <= 1, `another button left at ${inner} while ${now} extension slots were still there`);
      if (result.hidden.includes('pinned')) assert.ok(result.address >= 0);
      slots = now; hiddenCount = result.hidden.length;
    }
    assert.equal(slots, 0, 'in the end the group leaves too (then it is the Extensions entry in »)');
  }
});

test('with room for everything nothing moves: no "more", the field wider than its comfort', () => {
  const result = fitToolbar(row(1920, 100, 'sidebar', 'full', pinnedItems(20)).input);
  assert.deepEqual(result.pinned, { visible: 20, more: false });
  assert.deepEqual(result.hidden, []);
  assert.ok(result.address > fitMetrics.addressComfort);
});

test('the same window with 1, 5, 12 and 20 pinned: the more are pinned, the more sit behind "more", and the field is the same or wider than with the old whole-group rule', () => {
  const at = (count: number) => fitToolbar(row(1100, 100, 'sidebar', 'full', pinnedItems(count)).input);
  const ones = [1, 5, 12, 20].map(at);
  for (let i = 1; i < ones.length; i++) assert.ok(ones[i].pinned!.visible >= ones[i - 1].pinned!.visible || ones[i].pinned!.more, 'a longer list never shows fewer buttons than a shorter one without "more"');
  for (const result of ones) assert.ok(result.address >= fitMetrics.addressComfort || result.pinned!.visible + (result.pinned!.more ? 1 : 0) <= 1, `field ${result.address.toFixed(0)}`);
  assert.equal(ones[3].pinned!.more, true);
});

test('a row without a pinned group with parts answers as before, and says so (pinned: null)', () => {
  const result = fitToolbar(row(900, 150, 'sidebar', 'full', everything, [72]).input);
  assert.equal(result.pinned, null);
  assert.ok(result.hidden.includes('pinned'), 'the old rule: the group leaves whole');
});

test('a pinned group that says how much room the field keeps (the toolbar\'s whole-group rule) leaves first, at that room, and everything else still leaves at the old floor', () => {
  const room = fitMetrics.addressComfort;
  const items = (withRoom: boolean) => everything.map(item => item.id === 'pinned' && withRoom ? { ...item, room } : item);
  let sawBetween = 0;
  for (const scale of [80, 100, 125, 150]) for (const layout of layouts) for (const view of views) for (let width = minWindow; width <= 2560; width += 8) {
    const r = row(width, scale, layout, view, items(true), [72]);
    const result = fitToolbar(r.input), old = fitToolbar({ ...r.input, items: items(false) });
    const label = `${width} DIP, ${scale}%, ${layout}, ${view}`;
    if (!result.hidden.includes('pinned')) assert.ok(result.address >= room || result.hidden.length === everything.length + 1, `${label}: the group stays with the field at ${result.address.toFixed(1)}`);
    // Whatever left in the old rule leaves in this one too (the group first, and for the field's comfort: never later than before).
    assert.ok(old.hidden.every(id => result.hidden.includes(id)), `${label}: ${old.hidden.join()} vs ${result.hidden.join()}`);
    if (result.hidden.includes('pinned') && !old.hidden.includes('pinned')) sawBetween++;
  }
  assert.ok(sawBetween > 100, `${sawBetween} windows where the group now leaves earlier`);
  // The group alone is what moves between the old floor and the comfortable room: no other button leaves for it.
  const input = row(1500, 100, 'sidebar', 'full', items(true), [72]).input;
  for (let inner = input.inner; inner >= 0; inner -= 2) {
    const result = fitToolbar({ ...input, inner });
    if (result.hidden.some(id => id !== 'pinned') && !result.hidden.includes('pinned')) assert.fail(`another button left before the group at ${inner}`);
  }
});
