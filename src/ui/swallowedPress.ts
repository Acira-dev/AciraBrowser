/** A press on the sidebar button while the sidebar is still sliding (13.5; a report: "I hide the sidebar with the button and when I click it again to show it, nothing happens").
 *
 * What happened: a layout switch (the sidebar leaving or arriving) is a view transition, and while a view transition plays Chromium does not hit-test the page: every pointer event lands on
 * the root element (`<html>`), whatever stands under the pointer (measured on 13.4: pointerdown and click both target `HTML.` from 10 ms to 550 ms after the first press, on the left and on the
 * right alike; `pointer-events: none` on the transition's pseudo-elements changes nothing). So a second press within about half a second of the first reached nothing and the sidebar stayed as the
 * first press left it. From the user's side it looks like "only hiding works".
 *
 * The fix: a click that lands on the root during a layout switch is handed to the sidebar button if the pointer is over it (by its box, not by hit-testing, which is what is switched off). The
 * button's own handler then does what it always does, and the layout switch it asks for waits for the one that is playing (runtime/client.ts modeSwitch queues it) and plays after it. Only this
 * button is forwarded to: another control under the pointer is not guessed at (the old picture is sliding over the new layout, so a box under the pointer is not always the thing the person pressed).
 *
 * A press is "on the button" when the pointer is over the button's box, OR over where the transition draws it right now (the button glides from its old place to its new one, and the group
 * `::view-transition-group(acira-sidebar-toggle)` is that picture), OR, in the beat before that picture exists, over the box the button had when it was last pressed. The last one is the 13.5
 * final-run find: the queued second slide flips the layout (the button's box jumps to its new place) about 50 ms before its pictures exist; the screen still shows the old picture, the button at
 * the old place, and a third press there (three presses 250 ms apart land exactly on that boundary) found no box and was dropped, 4 times in 40. */

export interface PressBox { left: number; top: number; right: number; bottom: number }
export interface PressControl<T> { control: T; box: PressBox }

/** Does the box hold the point? (its left/top edge up to, not including, its right/bottom edge; an empty box holds nothing) */
export function boxHolds(box: PressBox, x: number, y: number): boolean { return box.right > box.left && box.bottom > box.top && x >= box.left && x < box.right && y >= box.top && y < box.bottom; }

/** The control whose box holds the point, if any. */
export function controlUnder<T>(controls: readonly PressControl<T>[], x: number, y: number): T | null {
  for (const { control, box } of controls) if (boxHolds(box, x, y)) return control;
  return null;
}

/** The view transitions whose plays swallow presses and are forwarded: the sidebar's own slide is a 'layout' switch. */
export const FORWARDED_SWITCH = 'layout';
export const SIDEBAR_BUTTON = '.sidebar-toggle-control';
/** The view-transition-name of the toolbar's sidebar button (view-morph.css): its picture glides between the two places. */
export const TOGGLE_NAME = 'acira-sidebar-toggle';

interface PressEvent { type: string; target: unknown; button: number; clientX: number; clientY: number; detail: number; defaultPrevented: boolean; preventDefault(): void }
interface PressRoot { dataset: { modeSwitch?: string }; querySelectorAll(selector: string): ArrayLike<PressElement> }
interface PressElement { getBoundingClientRect(): PressBox; dispatchEvent(event: unknown): boolean; isConnected?: boolean }
export interface PressHost {
  root: PressRoot; listen(type: 'click', handler: (event: PressEvent) => void): () => void; click(event: PressEvent): unknown;
  /** Where the transition draws this control right now, when it differs from its box (it glides from its old place to its new one). */
  pictureBox?(element: PressElement): PressBox | null;
  /** The sidebar button a click's target is (or is inside), if any. */
  buttonOf?(target: unknown): PressElement | null;
  now?(): number;
}
/** How long the box a button had when it was last pressed still counts: one slide is ~480 ms and the next is queued behind it. */
export const REMEMBER_MS = 900;

/** Hand a click that the root swallowed during a layout switch to the sidebar button under the pointer. Returns the function that stops it. */
export function forwardSwallowedPress(host: PressHost): () => void {
  let remembered: { box: PressBox; at: number } | null = null;
  const now = () => host.now?.() ?? 0;
  return host.listen('click', event => {
    const { root } = host;
    // an ordinary press on the button: remember where it was drawn (before the layout flips under it)
    const own = host.buttonOf?.(event.target);
    // (a button with no box, the hidden duplicate that sits first in the page, remembers nothing: the forwarded press below is dispatched on the first control that holds the pointer, which can be that one, and
    // its click comes back through here; its empty box would wipe the one the press before it left, and a third press in the beat before the pictures exist found nothing: 13.6 final run, Compact, 6 in 60)
    if (own) { const ownBox = own.getBoundingClientRect(); if (ownBox.right > ownBox.left && ownBox.bottom > ownBox.top) remembered = { box: ownBox, at: now() }; return; }
    if (event.target !== root || event.button !== 0 || event.defaultPrevented || root.dataset.modeSwitch !== FORWARDED_SWITCH) return;
    const controls: PressControl<PressElement>[] = [], elements = Array.from(root.querySelectorAll(SIDEBAR_BUTTON));
    let pictured = false;
    for (const element of elements) {
      controls.push({ control: element, box: element.getBoundingClientRect() });
      const drawn = host.pictureBox?.(element);
      if (drawn) { pictured = true; controls.push({ control: element, box: drawn }); }
    }
    if (!pictured && remembered && now() - remembered.at < REMEMBER_MS && now() >= remembered.at) for (const element of elements) controls.push({ control: element, box: remembered.box });
    const found = controls.find(c => boxHolds(c.box, event.clientX, event.clientY)), hit = found?.control;
    if (!found || !hit) return;
    remembered = { box: found.box, at: now() };   // the next press, before this one's slide has caught up, is aimed at the same picture
    event.preventDefault();
    host.click({ type: 'click', target: hit, button: event.button, clientX: event.clientX, clientY: event.clientY, detail: event.detail, defaultPrevented: false, preventDefault() {} });   // fields named one by one: a real event's are on its prototype, a spread would lose them
  });
}

/** The browser's host: the document's root, the window's click events (capture phase, so nothing above can have eaten it), a real click event to the button. */
export function browserPressHost(): PressHost {
  const root = document.documentElement;
  return {
    root: root as unknown as PressRoot,
    listen: (type, handler) => { const listener = (event: Event) => handler(event as unknown as PressEvent); window.addEventListener(type, listener, true); return () => window.removeEventListener(type, listener, true); },
    pictureBox: element => {
      try {
        if (getComputedStyle(element as unknown as Element).getPropertyValue('view-transition-name') !== TOGGLE_NAME) return null;
        const group = getComputedStyle(root, `::view-transition-group(${TOGGLE_NAME})`), matrix = /^matrix\(([^)]*)\)$/.exec(group.transform);
        const width = parseFloat(group.width), height = parseFloat(group.height);
        if (!matrix || !(width > 0) || !(height > 0)) return null;
        const parts = matrix[1].split(',').map(Number), left = parts[4], top = parts[5];
        return Number.isFinite(left) && Number.isFinite(top) ? { left, top, right: left + width, bottom: top + height } : null;
      } catch { return null; }
    },
    buttonOf: target => (target instanceof Element ? (target.closest(SIDEBAR_BUTTON) as unknown as PressElement | null) : null),
    now: () => performance.now(),
    click: event => (event.target as unknown as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, detail: Math.max(1, event.detail), clientX: event.clientX, clientY: event.clientY })),
  };
}

/** What the sidebar button turned the sidebar to the last time, so a press that comes before the screen has caught up (the first one's switch is still playing, the second one is queued behind it)
 * turns it the other way from where the person MEANT it to be, not from where the last frame still shows it: three quick presses end hidden, shown, hidden, as three presses should.
 * The intent counts only while the rendered state is the one it was made from (`base`) and for `INTENT_MS`: any other change of the sidebar (the key, a command, a setting) retires it. */
export interface SidebarIntent { open: boolean; base: boolean; at: number }
export const INTENT_MS = 1500;
export const openBeforePress = (intent: SidebarIntent | null | undefined, rendered: boolean, now: number): boolean => intent && intent.base === rendered && now - intent.at < INTENT_MS && now >= intent.at ? intent.open : rendered;
