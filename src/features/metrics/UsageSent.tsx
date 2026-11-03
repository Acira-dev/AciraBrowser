import { t as translate, useT } from '../../i18n';
import type { MetricsStatus } from '../../runtime/types';
import './usage-sent.css';

type Key = Parameters<typeof translate>[0];

/** R4-60 "What's sent", in plain words: every field of the daily message grouped as the person thinks about it, each row followed by the
 * values that would really be sent (read from `status.payload`, the same object the sender serialises), plus the rating message (R4-61)
 * and, on Windows, the one message the uninstaller sends (`status.uninstallPayload`; a Mac cannot tell that Acira is being deleted).
 * The raw message stays below it, so this never says more or less than the truth. */
const GROUPS: { title: Key; rows: { label: Key; fields: string[] }[] }[] = [
  { title: 'usage.sent.groupSetup', rows: [
    { label: 'usage.sent.look', fields: ['theme', 'finish', 'windowView', 'tabLayout', 'toolbar', 'animation', 'interfaceScale'] },
    { label: 'usage.sent.language', fields: ['uiLanguage', 'searchEngine'] },
    { label: 'usage.sent.protection', fields: ['aiFree', 'adBlocking', 'phishingProtection', 'siteProtectionOff'] },
    { label: 'usage.sent.habits', fields: ['linkPreview', 'askBeforeClosing', 'tabSleep', 'shortcutsCustom'] },
    { label: 'usage.sent.connection', fields: ['proxy', 'vpn', 'vpnApp'] },
    { label: 'usage.sent.movingIn', fields: ['setup', 'importSource', 'passwordsImported', 'signBackIn'] },
  ] },
  { title: 'usage.sent.groupFeatures', rows: [
    { label: 'usage.sent.featureCounts', fields: ['splitView', 'peek', 'seamlessReveals', 'workspaceSwitches', 'tabGroups', 'rewind', 'tabSets', 'privateTabs', 'privateWindows', 'torTabs', 'torWindows', 'vpnToggles', 'mediaControls', 'commandBar', 'protectionPanel'] },
    { label: 'usage.sent.sizes', fields: ['tabsOpen', 'windows', 'splitPanes', 'workspaces', 'profiles', 'extensions'] },
  ] },
  { title: 'usage.sent.groupSystem', rows: [
    { label: 'usage.sent.system', fields: ['appVersion', 'channel', 'platform', 'arch', 'language', 'day'] },
    { label: 'usage.sent.id', fields: ['installId'] },
  ] },
];

export function UsageSent({ status }: { status: MetricsStatus }) {
  const t = useT();
  const payload = status.payload || {}, rating = status.ratingPayload, uninstall = status.uninstallPayload;
  const values = (fields: string[], from: Record<string, string | number>) => fields.filter((field) => field in from).map((field) => `${field} ${from[field]}`).join(' · ');
  return (
    <div className="us-sent" data-usage-sent>
      {GROUPS.map((group) => (
        <section key={group.title} className="us-group" aria-label={t(group.title)}>
          <h3 className="us-title">{t(group.title)}</h3>
          {group.rows.map((row) => (
            <div key={row.label} className="us-row">
              <p className="us-label">{t(row.label)}</p>
              <p className="us-values">{values(row.fields, payload)}</p>
            </div>
          ))}
        </section>
      ))}
      {rating && status.askRatings !== false && (
        <section className="us-group" aria-label={t('usage.sent.groupRatings')}>
          <h3 className="us-title">{t('usage.sent.groupRatings')}</h3>
          <div className="us-row"><p className="us-label">{t('usage.sent.rating')}</p><p className="us-values">{values(Object.keys(rating), rating)}</p></div>
        </section>
      )}
      {uninstall && (
        <section className="us-group" aria-label={t('usage.sent.groupUninstall')}>
          <h3 className="us-title">{t('usage.sent.groupUninstall')}</h3>
          <div className="us-row"><p className="us-label">{t('usage.sent.uninstall')}</p><p className="us-values">{values(Object.keys(uninstall), uninstall)}</p></div>
        </section>
      )}
      <p className="us-never">{t('usage.sent.never')}</p>
    </div>
  );
}
