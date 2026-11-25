import { useEffect, useState } from 'react';
import type { DownloadPreferences } from '../../../runtime/nativeCore';
import { SettingGroup, SettingNote, SettingRow, Switch } from '../controls';
import { native, readable } from '../nativeClient';
import type { SettingsPanel } from '../panels';
import '../native-core.css';

import { t } from '../../../i18n';
function Downloads() {
  const [prefs, setPrefs] = useState<DownloadPreferences | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    native({ type: 'downloads.preferences' }).then((result) => setPrefs(result.downloads?.preferences ?? null), (failure) => setError(readable(failure)));
  }, []);
  const apply = (request: Parameters<typeof native>[0]) => {
    setError('');
    native(request).then((result) => result.downloads && setPrefs(result.downloads.preferences), (failure) => setError(readable(failure)));
  };
  if (!prefs) return error ? <p className="nc-message" data-bad role="alert">{error}</p> : null;
  return (
    <>
      <SettingGroup title={t("downloads.saveFiles")}>
        <SettingRow id="downloads-folder" title={t("nativeCore.downloadLocation")} detail={prefs.folderMissing ? t('downloads.folderMissing') : t('downloads.folderDetail')}>
          <div className="nc-actions">
            <span className="nc-mono nc-path" title={prefs.folder}>{'‪' + prefs.folder}</span>
            <button type="button" className="st-button" onClick={() => apply({ type: 'downloads.choose-folder' })}>{t("downloads.change")}</button>
            {prefs.customFolder && <button type="button" className="nc-link" onClick={() => apply({ type: 'downloads.preferences.set', folder: null })}>{t("downloads.useDefault")}</button>}
          </div>
        </SettingRow>
        {/* Beta 14 (D3): every screenshot goes to this folder without asking; not set (or gone): each one asks where, with the Save dialog */}
        <SettingRow id="downloads-screenshots-folder" title={t("downloads.screenshotsFolder")} detail={prefs.screenshotFolderMissing ? t('downloads.screenshotsFolderMissing') : t('downloads.screenshotsFolderDetail')}>
          <div className="nc-actions">
            <span className="nc-mono nc-path" title={prefs.screenshotFolder || undefined}>{prefs.screenshotFolder ? '‪' + prefs.screenshotFolder : t('downloads.askEachTime')}</span>
            <button type="button" className="st-button" onClick={() => apply({ type: 'downloads.choose-screenshot-folder' })}>{t("downloads.choose")}</button>
            {(prefs.screenshotFolder || prefs.screenshotFolderMissing) && <button type="button" className="nc-link" onClick={() => apply({ type: 'downloads.preferences.set', screenshotFolder: null })}>{t("downloads.askEachTime")}</button>}
          </div>
        </SettingRow>
        <SettingRow id="downloads-ask" title={t("nativeCore.askWhereToSaveEach")} detail={t("nativeCore.showTheSaveDialogFor")}>
          <Switch checked={prefs.askWhere} label={t("nativeCore.askWhereToSaveEach")} onChange={(askWhere) => apply({ type: 'downloads.preferences.set', askWhere })} />
        </SettingRow>
      </SettingGroup>
      {error && <p className="nc-message" data-bad role="alert">{error}</p>}
      <SettingNote>{t("downloads.downloadsNeverOpenOnTheir")}</SettingNote>
      {/* Easy Files (Beta 14): the pop-up of recent files at a page's upload button. On in normal windows; off in private windows unless allowed. */}
      <SettingGroup title={t("downloads.uploadFiles")}>
        <SettingRow id="downloads-offer-files" title={t("downloads.offerFiles")} detail={t("downloads.offerFilesDetail")}>
          <Switch checked={prefs.offerFiles} label={t("downloads.offerFiles")} onChange={(offerFiles) => apply({ type: 'downloads.preferences.set', offerFiles })} />
        </SettingRow>
        <SettingRow id="downloads-offer-files-private" title={t("downloads.offerFilesPrivate")} detail={t("downloads.offerFilesPrivateDetail")}>
          <Switch checked={prefs.offerFilesPrivate} label={t("downloads.offerFilesPrivate")} onChange={(offerFilesPrivate) => apply({ type: 'downloads.preferences.set', offerFilesPrivate })} />
        </SettingRow>
      </SettingGroup>
    </>
  );
}

const panel: SettingsPanel = { section: 'Downloads', icon: 'inbox', order: 55, Component: Downloads };
export default panel;
