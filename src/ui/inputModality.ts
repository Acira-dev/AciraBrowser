/** The input that last acted in this renderer. Keyboard-triggered menus and actions don't animate (founder videos,
 * 25 Oct; bible §4 "One motion"): a popup opened or closed from the keyboard appears and leaves at once. */
let last: 'pointer' | 'keyboard' = 'pointer', at = 0;
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', () => { last = 'pointer'; at = performance.now(); }, true);
  window.addEventListener('keydown', () => { last = 'keyboard'; at = performance.now(); }, true);
}
/** True when the last input was a key press within `withinMs`. */
export const keyboardInput = (withinMs = 800) => last === 'keyboard' && performance.now() - at < withinMs;
