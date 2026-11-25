/* Beta 14: a card that sits in the pop-up system's frosted surface and wants the sample's finish for it (his frost f2, inner light, rim, shadow and radius, src/features/dialogs/dialogs.css) marks the surface with
 * `data-dlg`; the glass slider moves the tint by his rule, (g - 64) x .009 clamped .2 to .9. DialogLayer does this for the questions main asks; the update prompt (UpdatePopover) lives in its own pop-up kind and does it here. */
import { useLayoutEffect, type RefObject } from 'react';

export type DialogTheme = 'dark' | 'light';
/** The theme is the app's own (the attribute every surface reads). */
export const appTheme = (): DialogTheme => typeof document !== 'undefined' && document.querySelector('.app')?.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
export const dialogTint = (theme: DialogTheme, glass: number) => Math.min(.9, Math.max(.2, (theme === 'light' ? .36 : .32) + (glass - 64) * .009));

export function useDialogSurface(root: RefObject<HTMLElement | null>, family: 'dialog' | 'prompt', glass: number, theme: DialogTheme, active = true) {
  useLayoutEffect(() => {
    const surface = active ? root.current?.closest('.acira-popup-surface') as HTMLElement | null : null;
    if (!surface) return;
    surface.setAttribute('data-dlg', theme); surface.setAttribute('data-dlg-family', family);
    surface.style.setProperty('--dlg-tint', String(dialogTint(theme, glass)));
    // a pop-up kind that wraps its content in the menus' 4 px padding (`.browser-popup`) gives the card that padding back: the card fills the surface, as the sample's does
    const wrap = root.current?.closest('.browser-popup') as HTMLElement | null; wrap?.classList.add('dlg-flush');
    return () => { surface.removeAttribute('data-dlg'); surface.removeAttribute('data-dlg-family'); surface.style.removeProperty('--dlg-tint'); wrap?.classList.remove('dlg-flush'); };
  }, [root, theme, glass, family, active]);
}
