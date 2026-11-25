import type { SettingsPanelProps } from './panels';
import { Select, SettingGroup, SettingNote, SettingRow, Switch } from './controls';
import { ArrowUp } from '../../components/AppIcons';
import { SiteIdentityIcon } from '../../components/SiteIdentityIcon';
import { SIDE_PANEL_KEEP_DEFAULT, keepMinutes, siteWidth, SIDE_PANEL_DEFAULT_WIDTH } from '../../runtime/sidePanelSites';
import { sitesOf } from '../../ui/sidePanelSites';
import { openSettings } from '../../ui/settingsView';
import { t } from '../../i18n';

/** Settings › Tabs › Side panel sites (Beta 14, brief section AF): the pinned sites (reorder, reset a site's width, remove), how long a closed site keeps running, whether it closes when the person switches tabs or Favorites (14.3), and the shortcuts link.
 *  Nothing is drawn for a profile with no pinned site but the note and the two choices; the sites themselves are the profile's (runtime/sidePanelSites.ts). */
const KEEP: { value: string; label: () => string }[] = [
  { value: '5', label: () => t('sidepanel.keep5') }, { value: '15', label: () => t('sidepanel.keep15') }, { value: '60', label: () => t('sidepanel.keep60') }, { value: '0', label: () => t('sidepanel.keepUntilClose') },
];
const hostOf = (url: string) => { try { return new URL(url).host.replace(/^www\./, ''); } catch { return url; } };

export function SidePanelSettings({ state, dispatch }: SettingsPanelProps) {
  const sites = sitesOf(state);
  const keep = String(keepMinutes(state.settings.sidePanelKeepMinutes ?? SIDE_PANEL_KEEP_DEFAULT));
  return (
    <SettingGroup title={t('sidepanel.settingsTitle')} id="side-panel-sites" fold foldDetail={t('settings.sidePanelFoldDetail')}>
      <SettingNote>{t('sidepanel.settingsDetail')}</SettingNote>
      <SettingRow id="side-panel-keep" title={t('sidepanel.keepTitle')} detail={t('sidepanel.keepDetail')}>
        <Select<string> label={t('sidepanel.keepTitle')} value={keep} onChange={(value) => dispatch({ type: 'settings.update', patch: { sidePanelKeepMinutes: Number(value) } })} options={KEEP.map((choice) => ({ value: choice.value, label: choice.label() }))} />
      </SettingRow>
      {/* 14.3 (a member's ask): off by default, the panel stays open across tabs as it always did */}
      <SettingRow id="side-panel-close-on-switch" title={t('sidepanel.closeOnSwitchTitle')} detail={t('sidepanel.closeOnSwitchDetail')}>
        <Switch label={t('sidepanel.closeOnSwitchTitle')} checked={state.settings.sidePanelCloseOnSwitch === true} onChange={(next) => dispatch({ type: 'settings.update', patch: { sidePanelCloseOnSwitch: next } })} />
      </SettingRow>
      {sites.map((site, index) => {
        const width = siteWidth(site), own = width !== SIDE_PANEL_DEFAULT_WIDTH;
        return (
          <SettingRow key={site.id} title={site.title} detail={own ? t('sidepanel.siteWidth', { host: hostOf(site.url), width }) : hostOf(site.url)}>
            <span className="st-site-icon" aria-hidden="true"><SiteIdentityIcon url={site.url} favicon={site.icon} size={16} /></span>
            <button type="button" className="st-button st-icon-button" aria-label={t('sidepanel.moveUp', { name: site.title })} disabled={index === 0} onClick={() => dispatch({ type: 'sidepanel.move', id: site.id, index: index - 1 })}><ArrowUp size={14} /></button>
            <button type="button" className="st-button st-icon-button flip" aria-label={t('sidepanel.moveDown', { name: site.title })} disabled={index === sites.length - 1} onClick={() => dispatch({ type: 'sidepanel.move', id: site.id, index: index + 1 })}><ArrowUp size={14} /></button>
            <button type="button" className="st-button" disabled={!own} onClick={() => dispatch({ type: 'sidepanel.width', id: site.id, width: null })}>{t('sidepanel.resetWidth')}</button>
            <button type="button" className="st-button" onClick={() => dispatch({ type: 'sidepanel.unpin', id: site.id })}>{t('sidepanel.removeShort')}</button>
          </SettingRow>
        );
      })}
      {!sites.length && <SettingNote>{t('sidepanel.emptyNote')}</SettingNote>}
      <SettingRow id="side-panel-shortcuts" title={t('sidepanel.shortcutsTitle')} detail={t('sidepanel.shortcutsDetail')}>
        <button type="button" className="st-button" onClick={() => openSettings(state, dispatch, { section: 'Shortcuts' })}>{t('sidepanel.shortcutsOpen')}</button>
      </SettingRow>
    </SettingGroup>
  );
}
