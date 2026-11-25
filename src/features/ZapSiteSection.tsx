import { useId, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { runtime } from '../runtime/client';
import { isWebsite } from '../runtime/newTabPage';
import type { TabSession, ZapRule, ZapSiteStatus } from '../runtime/types';
import { t, useT } from '../i18n';
import { createSiteStore, mayReturn, ruleName, type ZapView } from './zapModel';
import '../styles/zap-site.css';

/** The site controls' list of what Zap removed on this page (Beta 14): a heading with the count, one row per part with Restore, and Restore all from two up.
 *  It draws nothing while there is nothing removed, so a page that was never zapped shows no new row. A restore is immediate: the part is back on the page at once and the list answers a frame later. */
export function ZapSiteRows({ rules, onRestore, onRestoreAll }: { rules: readonly ZapRule[]; onRestore: (rule: ZapRule, index: number) => void; onRestoreAll: () => void }) {
  const heading = useId();
  useT();
  if (!rules.length) return null;
  return (
    <section className="zap-site" aria-labelledby={heading}>
      <div className="zap-site-head">
        <h3 id={heading} className="zap-site-title">{t('zap.site.heading', { count: rules.length })}</h3>
        {rules.length > 1 && <button type="button" className="shields-text zap-restore-all" onClick={onRestoreAll}>{t('zap.restoreAll')}</button>}
      </div>
      {rules.map((rule, index) => {
        const name = ruleName(rule), note = mayReturn(rule), noteId = `${heading}-${rule.id}`;
        return (
          <button key={`${rule.host}|${rule.id}`} type="button" className="acira-menu-row acira-menu-row-fact zap-row" aria-label={t('zap.restoreNamed', { name })} aria-describedby={note ? noteId : undefined} onClick={() => onRestore(rule, index)}>
            <span />
            <span className="acira-menu-title"><bdi>{name}</bdi>{note && <span className="acira-menu-sub" id={noteId}>{t('zap.mayReturn')}</span>}</span>
            <span className="zap-restore" aria-hidden="true">{t('zap.restore')}</span>
          </button>
        );
      })}
    </section>
  );
}

const NOTHING: ZapView<ZapSiteStatus> = { value: undefined, failed: false, busy: false, error: '' };
/** The store of a page Zap has nothing to say about (Acira's own pages, a page that failed to load). */
const idle = { subscribe: () => () => undefined, getSnapshot: () => NOTHING };

/** In the pop-up from the icon left of the address, directly under the protection rows. Shown only for a website that has something removed. */
export function ZapSiteSection({ tab }: { tab: TabSession }) {
  const live = isWebsite(tab) && !tab.error;
  const store = useMemo(() => (live ? createSiteStore((request) => runtime.service(request), (listener) => runtime.subscribeBrowser(listener), tab.id) : undefined), [live, tab.id, tab.url]);
  const source = store ?? idle;
  const view = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot);
  const here = useRef<HTMLDivElement>(null), refocus = useRef<{ popup: HTMLElement | null; index: number } | null>(null);
  const rules = view.value?.supported ? view.value.rules : undefined;
  // A restored row leaves the list while it holds the focus: the keyboard moves to the row that took its place (or the pop-up itself when none is left), so Esc and the arrows keep working.
  useLayoutEffect(() => {
    const wanted = refocus.current;
    if (!wanted) return;
    const root = here.current;
    refocus.current = null;
    if (root && document.activeElement && root.contains(document.activeElement)) return;
    const rows = root?.querySelectorAll<HTMLElement>('button.zap-row');
    (rows?.length ? rows[Math.min(wanted.index, rows.length - 1)] : wanted.popup)?.focus({ preventScroll: true });
  }, [rules]);
  if (!store) return null;
  if (!rules?.length) return !view.value && !view.failed ? <span hidden data-popup-pending="" /> : null;
  const arm = (index: number) => { refocus.current = { popup: here.current?.closest<HTMLElement>('.browser-popup') ?? null, index }; };
  return (
    <div ref={here} className="zap-site-slot">
      <ZapSiteRows rules={rules} onRestore={(rule, index) => { arm(index); void store.restore(rule); }} onRestoreAll={() => { arm(0); void store.restoreAll(); }} />
    </div>
  );
}
