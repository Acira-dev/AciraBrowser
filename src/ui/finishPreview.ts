import type { Settings } from '../runtime/types';
import { themeTokens } from './theme';
import { settleThemeTransitions } from './themeSwitch';

/** Live appearance preview without persistence: paints Acira's own views with another finish (or any appearance
 * patch) by overriding the theme's custom properties on `.app`, and restores the exact previous values on end.
 * No settings are written and React state is untouched, so a preview is instant and free; commit a choice
 * with the usual `settings.update` dispatch, then call endAppearancePreview(). */
type Saved = Map<string, string>;
const saved = new Map<HTMLElement, Saved>();

const systemDark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
export function isDarkAppearance(settings: Pick<Settings, 'appearance'>) {
  return settings.appearance === 'dark' || settings.appearance === 'system' && systemDark();
}

export function previewAppearance(settings: Settings, patch: Partial<Settings>, root: ParentNode = document) {
  const next = { ...settings, ...patch } as Settings;
  const tokens = themeTokens(next, isDarkAppearance(next));
  for (const app of root.querySelectorAll<HTMLElement>('.app')) {
    let previous = saved.get(app);
    if (!previous) { previous = new Map(); saved.set(app, previous); }
    for (const [name, value] of Object.entries(tokens)) {
      if (!previous.has(name)) previous.set(name, app.style.getPropertyValue(name));
      app.style.setProperty(name, value);
    }
    app.dataset.previewTheme = isDarkAppearance(next) ? 'dark' : 'light';
  }
  settleThemeTransitions();
}

// No previewFinish: a finish applies only when chosen (click, Enter, Space), never on hover or focus (founder, 24 Oct).

/** Cancel: repaint from the current settings when given (always correct), otherwise restore the exact values the theme
 * had painted before the preview started. Safe to call when nothing is previewed. */
export function endAppearancePreview(settings?: Settings) {
  const tokens = settings ? themeTokens(settings, isDarkAppearance(settings)) : undefined;
  for (const [app, previous] of saved) {
    for (const [name, value] of previous) {
      const next = tokens ? tokens[name] ?? value : value;
      if (next) app.style.setProperty(name, next); else app.style.removeProperty(name);
    }
    delete app.dataset.previewTheme;
  }
  saved.clear();
  settleThemeTransitions();
}

/** Commit: the chosen finish is being saved with `settings.update`; keep what is painted (it already matches) and let
 * the theme's next render take over, so the choice never flashes back to the old finish. */
export function commitAppearancePreview() {
  for (const app of saved.keys()) delete app.dataset.previewTheme;
  saved.clear();
}

export const isPreviewingAppearance = () => saved.size > 0;
