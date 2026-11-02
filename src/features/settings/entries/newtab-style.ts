import { defineSettings } from '../model';

import { t } from '../../../i18n';
// R3-74: the new tab picture's style is part of its background, in Appearance.
export default [...defineSettings('Appearance', [
  { id: 'newtab-art-style', title: t("newtabStyle.artworkStyle"), group: 'New tab background', description: t("newtabStyle.showThePaintingAsA"), aliases: ['new tab', 'new tab background', 'background image', 'framed', 'background', 'full page', 'fullscreen', 'wallpaper', 'frame', 'gallery'] },
]), ...defineSettings('New tab', [
  { id: 'newtab-workspace', title: t('local.showWorkspaceHeader'), group: 'New tab', description: t('local.workspaceHeaderDetail'), aliases: ['workspace', 'heading', 'cover'] },
])];
