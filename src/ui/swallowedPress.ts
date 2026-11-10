/** A press on the sidebar button while the sidebar is still sliding (13.5; a report: "I hide the sidebar with the button and when I click it again to show it, nothing happens").
 *
 * What happened: a layout switch (the sidebar leaving or arriving) is a view transition, and while a view transition plays Chromium does not hit-test the page: every pointer event lands on
 * the root element (`<html>`), whatever stands under the pointer (measured on 13.4: pointerdown and click both target `HTML.` from 10 ms to 550 ms after the first press, on the left and on the
 * right alike; `pointer-events: none` on the transition's pseudo-elements changes nothing). So a second press within about half a second of the first reached nothing and the sidebar stayed as the
 * first press left it. From the user's side it looks like "only hiding works".
 *
 * The fix: a click that lands on the root during a layout switch is handed to the sidebar button if the pointer is over it (by its box, not by hit-testing, which is what is switched off). The
 * button's own handler then does what it always does, and the layout switch it asks for waits for the one that is playing (runtime/client.ts modeSwitch queues it) and plays after it. Only this
 * button is forwarded to: another control under the pointer is not guessed at (the old picture is sliding over the new layout, so a box under the pointer is not always the thing the person pressed). */

export interface PressBox { left: number; top: number; right: number; bottom: number }
export interface PressControl<T> { control: T; box: PressBox }

/** The control whose box holds the point, if any (a box is its left/top edge up to, not including, its right/bottom edge). */
export function controlUnder<T>(controls: readonly PressControl<T>[], x: number, y: number): T | null {
  for (const { control, box } of controls) if (box.right > box.left && box.bottom > box.top && x >= box.left && x < box.right && y >= box.top && y < box.bottom) return control;
  return null;
}

/** The view transitions whose plays swallow presses and are forwarded: the sidebar's own slide is a 'layout' switch. */
export const FORWARDED_SWITCH = 'layout';
export const SIDEBAR_BUTTON = '.sidebar-toggle-control';

interface PressEvent { type: string; target: unknown; button: number; clientX: number; clientY: number; detail: number; defaultPrevented: boolean; preventDefault(): void }
interface PressRoot { dataset: { modeSwitch?: string }; querySelectorAll(selector: string): ArrayLike<PressElement> }
interface PressElement { getBoundingClientRect(): PressBox; dispatchEvent(event: unknown): boolean; isConnected?: boolean }
export interface PressHost { root: PressRoot; listen(type: 'click', handler: (event: PressEvent) => void): () => void; click(event: PressEvent): unknown }

/** Hand a click that the root swallowed during a layout switch to the sidebar button under the pointer. Returns the function that stops it. */
export function forwardSwallowedPress(host: PressHost): () => void {
  return host.listen('click', event => {
    const { root } = host;
    if (event.target !== root || event.button !== 0 || event.defaultPrevented || root.dataset.modeSwitch !== FORWARDED_SWITCH) return;
    const controls: PressControl<PressElement>[] = Array.from(root.querySelectorAll(SIDEBAR_BUTTON), element => ({ control: element, box: element.getBoundingClientRect() }));
    const hit = controlUnder(controls, event.clientX, event.clientY);
    if (!hit) return;
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
    click: event => (event.target as unknown as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, detail: Math.max(1, event.detail), clientX: event.clientX, clientY: event.clientY })),
  };
}

/** What the sidebar button turned the sidebar to the last time, so a press that comes before the screen has caught up (the first one's switch is still playing, the second one is queued behind it)
 * turns it the other way from where the person MEANT it to be, not from where the last frame still shows it: three quick presses end hidden, shown, hidden, as three presses should.
 * The intent counts only while the rendered state is the one it was made from (`base`) and for `INTENT_MS`: any other change of the sidebar (the key, a command, a setting) retires it. */
export interface SidebarIntent { open: boolean; base: boolean; at: number }
export const INTENT_MS = 1500;
export const openBeforePress = (intent: SidebarIntent | null | undefined, rendered: boolean, now: number): boolean => intent && intent.base === rendered && now - intent.at < INTENT_MS && now >= intent.at ? intent.open : rendered;
