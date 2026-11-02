import { t } from '../i18n';
import type { WindowView } from '../runtime/windowView';

/** The four Window views by name and by one plain sentence (R3-68, R3-65): Settings, the toolbar menu, the command bar and the
 * shortcut editor all say the same words. */
export const windowViewName = (mode: WindowView): string => ({
  full: t('windowview.full'), compact: t('windowview.compact'), focus: t('windowview.focus'), seamless: t('windowview.seamless'),
}[mode]);

export const windowViewDetail = (mode: WindowView): string => ({
  full: t('windowview.fullDetail'), compact: t('windowview.compactDetail'), focus: t('windowview.focusDetail'), seamless: t('windowview.seamlessDetail'),
}[mode]);
