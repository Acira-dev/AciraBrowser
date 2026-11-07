import { anchorSelector, type SettingsEntry } from './registry';

const focusable = 'input:not(:disabled):not([type=hidden]),button:not(:disabled),select:not(:disabled),textarea:not(:disabled),[role=switch]:not(:disabled),[role=combobox]:not(:disabled),summary,a[href],[tabindex="0"]';

const clearFound = new WeakMap<Element, number>();

/** Resolves once `node` has stopped moving (its top unchanged for three frames), or after `limit` ms. */
async function settled(node: HTMLElement, limit = 700): Promise<void> {
  const started = performance.now();
  let last = Number.NaN, still = 0;
  while (performance.now() - started < limit && still < 3) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const top = node.getBoundingClientRect().top;
    still = top === last ? still + 1 : 0;
    last = top;
  }
}

/**
 * Bring a registered control into view: expand its collapsed group, scroll to it, focus it and
 * highlight it briefly. Never activates the control. Resolves false when the control is not
 * rendered (for example it is unavailable in the current profile).
 */
export async function revealSetting(scope: HTMLElement, entry: SettingsEntry, reducedMotion: boolean, timeout = 900): Promise<boolean> {
  const started = performance.now();
  let target: HTMLElement | null = null;
  while (performance.now() - started < timeout) {
    target = scope.querySelector<HTMLElement>(anchorSelector(entry.anchor));
    if (target) break;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
  if (!target) return false;
  let opened = false;
  if (entry.expand) {
    const details = scope.querySelector<HTMLDetailsElement>(`#${CSS.escape(entry.expand)}`);
    if (details) { opened = !details.open; details.open = true; }
  }
  for (let node: HTMLElement | null = target; node && node !== scope; node = node.parentElement) {
    if (node instanceof HTMLDetailsElement) { opened ||= !node.open; node.open = true; }
  }
  // A fold that has just opened grows over a short transition: scrolling now would aim at a row that is still on its way down.
  if (opened) await settled(target);
  target.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' });
  const focusTarget = () => {
    const control = target!.matches(focusable) ? target! : target!.querySelector<HTMLElement>(focusable);
    if (control) control.focus({ preventScroll: true });
    else {
      target!.tabIndex = -1;
      target!.focus({ preventScroll: true });
    }
  };
  focusTarget();
  // A control that is still loading can drop focus when it becomes disabled; take focus back once.
  window.setTimeout(() => {
    if (target!.isConnected && !target!.contains(document.activeElement) && (!document.activeElement || document.activeElement === document.body)) focusTarget();
  }, 350);
  // Only one row is ever highlighted, and any input ends it.
  scope.querySelectorAll('[data-found]').forEach((node) => node.removeAttribute('data-found'));
  const settle = () => target?.removeAttribute('data-found');
  window.addEventListener('pointerdown', settle, { once: true, capture: true });
  window.addEventListener('keydown', settle, { once: true, capture: true });
  window.clearTimeout(clearFound.get(target));
  target.setAttribute('data-found', '');
  clearFound.set(
    target,
    window.setTimeout(() => target?.removeAttribute('data-found'), 1200),
  );
  return true;
}
