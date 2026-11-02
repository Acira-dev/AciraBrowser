import { useState } from 'react';
import type { SettingsPanel, SettingsPanelProps } from '../panels';
import { SettingGroup, SettingNote, SettingRow } from '../controls';
import type { BrowserSnapshot } from '../../../runtime/types';
import { installSiteAsApp, uninstallWebApp, useWebApps } from '../../../ui/webApps';
import './web-apps.css';

import { t } from '../../../i18n';
const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

/** The reason a tab cannot become an app, or '' when it can. */
const whyNot = (tab: BrowserSnapshot['tabs'][number], privateProfile: boolean) =>
  privateProfile || tab.privacy ? 'Private and Tor tabs can’t be installed.' : /^https?:\/\//.test(tab.url) ? '' : /^file:/.test(tab.url) ? 'Files on this computer can’t be installed.' : 'Acira pages can’t be installed.';
const origin = (url: string) => { try { return new URL(url).origin; } catch { return url; } };

/** Settings › Apps: every open site with its own Install button, then the installed apps with Open and Uninstall (F52). */
function WebAppsSettings({ state, dispatch }: SettingsPanelProps) {
  const { apps, error } = useWebApps();
  const tab = state.tabs.find(item => item.id === state.activeTabId) || state.tabs[0];
  const profile = state.browserProfiles.find(item => item.id === tab.browserProfileId);
  const [busyId, setBusyId] = useState<string | null>(null);
  const mine = (apps || []).filter(app => app.profileId === tab.browserProfileId);
  const installedOrigins = new Set(mine.map(app => origin(app.startUrl)));
  // One row per site (several tabs on one site are one candidate), the most recently listed tab speaking for it. Settings itself is not a site.
  const seen = new Set<string>();
  const sites = state.tabs.filter(item => item.browserProfileId === tab.browserProfileId && item.url !== 'acira://settings' && item.url !== 'acira://new').filter(item => { const key = /^https?:\/\//.test(item.url) ? origin(item.url) : item.id; if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 30);
  const install = async (id: string) => { setBusyId(id); await installSiteAsApp(state, dispatch, id); setBusyId(null); };
  return (
    <>
      <SettingGroup title={t("webApps.install")} id="web-app-install">
        {sites.length === 0 ? <SettingNote>{t("webApps.openAWebsiteThenCome")}</SettingNote> : sites.map(site => {
          const reason = whyNot(site, !!profile?.private), done = !reason && installedOrigins.has(origin(site.url));
          return (
            <div key={site.id} className="st-row wa-row" data-setting={'web-app-site-' + site.id} data-unavailable={reason ? '' : undefined}>
              {site.favicon ? <img className="wa-icon" src={site.favicon} alt="" width={20} height={20} /> : <span className="wa-icon wa-initial" aria-hidden="true">{(site.title || host(site.url))[0]?.toUpperCase()}</span>}
              <div className="st-copy"><span className="st-title">{site.title || host(site.url)}</span><p>{reason || host(site.url)}</p></div>
              <div className="st-control wa-actions">
                <button type="button" className="st-button" disabled={!!reason || done || busyId !== null} aria-label={t("webApps.installUrl", { url: site.title || host(site.url) })} onClick={() => void install(site.id)}>{busyId === site.id ? 'Installing…' : done ? t("webApps.installed") : t("webApps.install")}</button>
              </div>
            </div>
          );
        })}
        {sites.some(site => !whyNot(site, !!profile?.private)) && <SettingNote>{t("webApps.aSiteWithoutAnApp")}</SettingNote>}
      </SettingGroup>
      <SettingGroup title={t("webApps.installedApps")} id="web-apps">
        {apps === null ? <SettingNote>{t("webApps.loading")}</SettingNote> : error ? <SettingNote>{error}</SettingNote> : mine.length === 0 ? <SettingNote>{t("webApps.noAppsInstalledInThis")}</SettingNote> : mine.map(app => (
          <div key={app.id} className="st-row wa-row" data-setting={'web-app-' + app.id}>
            {app.icon ? <img className="wa-icon" src={app.icon} alt="" width={20} height={20} /> : <span className="wa-icon wa-initial" aria-hidden="true">{app.name[0]}</span>}
            <div className="st-copy"><span className="st-title">{app.name}</span><p>{host(app.startUrl)} · {app.kind === 'app' ? 'App' : t("searchEngines.shortcut")}{app.launcher==='finder' ? t('local.webAppsInFinder') : app.inStart ? t("webApps.inStartAndOnThe") : ''}</p></div>
            <div className="st-control wa-actions">
              <button type="button" className="st-button" onClick={() => dispatch({ type: 'tab.new', url: app.startUrl, browserProfileId: app.profileId })}>{t("app.open")}</button>
              <button type="button" className="st-button wa-remove" onClick={() => void uninstallWebApp(app, dispatch)}>{t("webApps.uninstall")}</button>
            </div>
          </div>
        ))}
      </SettingGroup>
    </>
  );
}

const panel: SettingsPanel = { section: 'Web apps', icon: 'LayoutGrid', order: 60, Component: WebAppsSettings };
export default panel;
