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
        <SettingRow id="downloads-ask" title={t("nativeCore.askWhereToSaveEach")} detail={t("nativeCore.showTheSaveDialogFor")}>
          <Switch checked={prefs.askWhere} label={t("nativeCore.askWhereToSaveEach")} onChange={(askWhere) => apply({ type: 'downloads.preferences.set', askWhere })} />
        </SettingRow>
      </SettingGroup>
      {error && <p className="nc-message" data-bad role="alert">{error}</p>}
      <SettingNote>{t("downloads.downloadsNeverOpenOnTheir")}</SettingNote>
    </>
  );
}

const panel: SettingsPanel = { section: 'Downloads', icon: 'inbox', order: 55, Component: Downloads };
export default panel;
