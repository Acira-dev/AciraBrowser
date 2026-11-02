/** A theme or finish swap changes every color token at once. Without this, each control's own color transitions
 * (switches, icon buttons, fields: ~70 of them) animate for ~300ms, restyling and repainting the whole chrome every
 * frame. Swaps are instant instead: right after the new tokens are committed (before paint), the color transitions
 * they started jump to their end. No global CSS rule, so ordinary restyles pay nothing. Under a mode switch's crossfade
 * this is not needed (and is skipped): `data-theme-settle` turns transitions off in the same commit, and reading
 * getAnimations() here would force a full style recalc inside the switch (F04). */
export function settleThemeTransitions() {
  if (typeof document === 'undefined' || typeof document.getAnimations !== 'function') return;
  for (const animation of document.getAnimations()) if (animation instanceof CSSTransition) animation.finish();
}

/** The first color-scheme change after launch relayouts the whole chrome once (~17ms of Blink's cold work, 764 objects
 * at 27 tabs); later ones don't. So once, at idle a few seconds after launch, the frame tries the other scheme and back in
 * one task (nothing paints in between, ~11ms), and the first real theme switch starts warm (F04). Returns a cancel. */
export function prewarmColorScheme(): () => void {
  if (typeof document === 'undefined' || typeof requestIdleCallback !== 'function') return () => {};
  let idle = 0;
  const timer = setTimeout(() => { idle = requestIdleCallback(() => {
    const app = document.querySelector<HTMLElement>('.app');
    if (!app || document.documentElement.hasAttribute('data-mode-switch')) return;
    app.style.colorScheme = app.dataset.theme === 'dark' ? 'light' : 'dark'; void app.offsetHeight;
    app.style.colorScheme = ''; void app.offsetHeight;
  }, { timeout: 4000 }); }, 3000);
  return () => { clearTimeout(timer); cancelIdleCallback(idle); };
}

/** A fingerprint of the painted theme, to tell a theme change from any other render. */
export const themeKey = (tokens: Record<string, string>) => Object.values(tokens).join('|');
