import { t as translate, useT } from '../../i18n';
import type { BrowserAction, BrowserSnapshot } from '../../runtime/types';
import { LibraryPage } from '../Library';
import type { ReactNode } from 'react';
import { USAGE_FIELD_GROUPS, type UsageGroup } from './usageFields';
import { messageText } from './messageText';
import { useMetrics } from './useMetrics';
import './usage-page.css';

/** Where the function that receives the message can be read, in the public source. null until the public repository exists: the button below is drawn only when it is set (17 Nov: it pointed at the private
 *  repository and gave every user a GitHub 404, and the private repository's name must not ship at all: scripts/release-private-names.mjs). The same lists are in the app (usage-facts.cjs), the function and the SQL. */
export const USAGE_SOURCE_URL: string | null = null;
const GROUP_ORDER: readonly UsageGroup[] = ['identity', 'setup', 'engagement', 'features', 'discovery', 'health', 'funnel', 'billboard'];
type Key = Parameters<typeof translate>[0];

/** A plain heading and its content. The Library's own section heading is sticky (it belongs to long lists with a toolbar above); this page has none, so a sticky heading would
 *  let the field list scroll through the gap above it. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="us-page-section" aria-label={title}><h2 className="us-page-section-title">{title}</h2>{children}</section>;
}

/** acira://usage (brief B5): the exact message that will be sent today, what every field means, when the last one was sent, the switch, and the function's source. */
export function UsagePage({ dispatch }: { state: BrowserSnapshot; dispatch: (action: BrowserAction) => void }) {
  const t = useT();
  const m = useMetrics();
  const status = m.status;
  const mark = (value: boolean | null | undefined) => (value === true ? t('usage.page.markYes') : value === false ? t('usage.page.markNo') : t('usage.page.markNone'));
  const when = (time: number) => new Date(time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const lastSent = status?.lastSentAt ? t('usage.settings.lastSent', { when: when(status.lastSentAt) }) : t('usage.settings.neverSent');
  const resets = status?.enabled && status.idResetsOn ? t('usage.page.idResets', { date: new Date(status.idResetsOn + 'T00:00:00Z').toLocaleDateString(undefined, { dateStyle: 'medium', timeZone: 'UTC' }) }) : '';
  return <LibraryPage title={t('usage.page.title')} description={t('usage.page.intro')}
    actions={<button type="button" role="switch" className="us-switch" aria-label={t('usage.switchLabel')} aria-checked={m.enabled} disabled={!m.ready || m.busy} onClick={() => void m.set(!m.enabled, 'settings')}><span className="us-switch-knob" aria-hidden="true" /></button>}>
    <Section title={m.enabled ? t('usage.page.on') : t('usage.page.off')}>
      <div className="us-page-facts">
        <p className="us-page-fact">{lastSent}</p>
        {resets && <p className="us-page-fact">{resets}</p>}
        {status && !status.configured && <p className="us-page-fact">{t('usage.notConfigured')}</p>}
        <p className="us-page-fact">{t('usage.sent.never')}</p>
      </div>
    </Section>
    <Section title={t('usage.page.exactTitle')}>
      <pre className="us-page-json" aria-label={t('usage.payloadLabel')} tabIndex={0}>{messageText(status?.payload)}</pre>
    </Section>
    <Section title={t('usage.page.fieldsTitle')}>
      <div className="us-page-fields">
        {GROUP_ORDER.map((group) => <section key={group} className="us-page-group" aria-label={t(`usage.page.group.${group}` as Key)}>
          <h3 className="us-page-group-title">{t(`usage.page.group.${group}` as Key)}</h3>
          <dl className="us-page-group-list">{USAGE_FIELD_GROUPS[group].map((field) => <div key={field.name} className="us-page-field"><dt className="us-page-field-name">{field.name}</dt><dd className="us-page-field-line">{field.line}</dd></div>)}</dl>
        </section>)}
      </div>
    </Section>
    <Section title={t('usage.page.marksTitle')}>
      <div className="us-page-facts">
        <p className="us-page-fact">{t('usage.page.marksFirst', { answer: mark(status?.marks?.firstMessageSent) })}</p>
        <p className="us-page-fact">{t('usage.page.marksBefore', { answer: mark(status?.marks?.installedBefore) })}</p>
      </div>
    </Section>
    <Section title={t('usage.page.offTitle')}>
      <div className="us-page-facts">
        <p className="us-page-fact">{t('usage.page.offBody')}</p>
        {status?.offPayload && <pre className="us-page-json us-page-json-small" aria-label={t('usage.page.offTitle')}>{messageText(status.offPayload)}</pre>}
        {USAGE_SOURCE_URL && <p className="us-page-fact"><button type="button" className="us-page-button" onClick={() => dispatch({ type: 'tab.new', url: USAGE_SOURCE_URL })}>{t('usage.page.source')}</button></p>}
      </div>
    </Section>
  </LibraryPage>;
}
