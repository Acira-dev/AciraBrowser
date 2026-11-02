import { useEffect, useState } from 'react';
import type { SitePermission } from '../../../runtime/nativeCore';
import { SettingGroup, SettingNote } from '../controls';
import { native, readable } from '../nativeClient';
import type { SettingsPanel } from '../panels';
import '../native-core.css';

import { t, translateText, type MessageId } from '../../../i18n';
const NAMES: Record<string, MessageId> = {
  'media-audio': 'site.perm.microphone', 'media-video': 'site.perm.camera', geolocation: 'site.perm.location', 'geolocation-approximate': 'sitePermissions.approximateLocation', notifications: 'site.perm.notifications',
  'clipboard-read': 'sitePermissions.clipboardRead', 'clipboard-sanitized-write': 'sitePermissions.clipboardWrite', midi: 'site.perm.midi', midiSysex: 'sitePermissions.midiSysex', pointerLock: 'sitePermissions.pointerLock', keyboardLock: 'site.perm.keyboardLock',
  'idle-detection': 'site.perm.idle', 'speaker-selection': 'sitePermissions.speakerSelection', 'local-network': 'sitePermissions.localNetwork', 'local-network-access': 'sitePermissions.localNetwork', 'loopback-network': 'sitePermissions.localApps',
  'storage-access': 'sitePermissions.embeddedSiteData', 'top-level-storage-access': 'sitePermissions.siteDataAcrossSites',
};
/** A permission's name; one the list does not know shows the engine's label, translated when the catalog has it. */
const permissionName = (row: SitePermission) => NAMES[row.permission] ? t(NAMES[row.permission]) : translateText(row.label);
const host = (origin: string) => origin.replace(/^https?:\/\//, '');

function SitePermissions() {
  const [rows, setRows] = useState<SitePermission[] | null>(null);
  const [error, setError] = useState('');
  const apply = (request: Parameters<typeof native>[0]) => native(request).then((result) => setRows(result.permissions?.rows ?? []), (failure) => setError(readable(failure)));
  useEffect(() => { void apply({ type: 'permissions.list' }); }, []);
  if (!rows) return error ? <p className="nc-message" data-bad role="alert">{error}</p> : null;
  return (
    <SettingGroup title={t("nativeCore.sitePermissions")} id="site-permissions">
      <div data-setting="site-permissions">
        {rows.length === 0 ? (
          <SettingNote>{t("sitePermissions.noSavedChoicesSitesAsk")}</SettingNote>
        ) : (
          <div className="nc-list" role="table" aria-label={t("sitePermissions.savedSitePermissions")}>
            {rows.map((row) => {
              const embedded = row.requester !== row.embedder;
              const key = `${row.requester}|${row.embedder}|${row.permission}`;
              return (
                <div className="nc-permission" role="row" key={key}>
                  <span className="nc-mono" role="cell" title={embedded ? t('sitePermissions.embeddedIn', { requester: row.requester, embedder: row.embedder }) : row.requester}>{embedded ? t('sitePermissions.hostIn', { requester: host(row.requester), embedder: host(row.embedder) }) : host(row.requester)}</span>
                  <span role="cell">{permissionName(row)}</span>
                  <span className="nc-mono" role="cell">{row.decision === 'allow' ? t("sitePermissions.allowed") : t("sitePermissions.blocked")}{row.temporary ? t("sitePermissions.once") : ''}</span>
                  <button type="button" className="st-button" aria-label={t("sitePermissions.resetLabelForRequester", { label: permissionName(row), requester: host(row.requester) })} onClick={() => void apply({ type: 'permissions.reset', requester: row.requester, embedder: row.embedder, permission: row.permission })}>{t("browsersettings.reset")}</button>
                </div>
              );
            })}
            <div className="nc-actions" style={{ marginTop: 12 }}>
              <button type="button" className="st-button" onClick={() => void apply({ type: 'permissions.reset-all' })}>{t("shortcuts.resetAll")}</button>
            </div>
          </div>
        )}
      </div>
      {error && <p className="nc-message" data-bad role="alert">{error}</p>}
      <SettingNote>{t("sitePermissions.choicesBelongToThisProfile")}</SettingNote>
    </SettingGroup>
  );
}

const panel: SettingsPanel = { section: 'Privacy', order: 90, Component: SitePermissions };
export default panel;
