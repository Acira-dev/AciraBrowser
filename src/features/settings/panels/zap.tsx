import { useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type Ref } from 'react';
import { Search, X } from '../../../components/AppIcons';
import { runtime } from '../../../runtime/client';
import type { SettingsPanel, SettingsPanelProps } from '../panels';
import { SettingGroup, SettingNote } from '../controls';
import { countRules, createListStore, filterSites, mayReturn, ruleName, type ZapSite, type ZapView } from '../../zapModel';
import type { ZapRule } from '../../../runtime/types';
import '../native-core.css';
import '../zap.css';

import { t, useT } from '../../../i18n';

/** Settings > Privacy > Removed parts: everything Zap removed, on every site, with a search, a Restore for each part and for each site, and one Clear all that asks once.
 *  Restoring is immediate (the part is back on any page showing it); nothing here needs a reload. */
export function ZapRemovedView({ view, query, onQuery, confirming, onConfirming, onRestoreRule, onRestoreSite, onClear, bodyRef, onArm }: {
  view: ZapView<ZapSite[]>; query: string; onQuery: (query: string) => void; confirming: boolean; onConfirming: (confirming: boolean) => void;
  onRestoreRule: (rule: ZapRule) => void; onRestoreSite: (host: string) => void; onClear: () => void;
  /** The group's body, and a hook told which Restore button was pressed (the panel keeps the keyboard in the list when that button goes). */
  bodyRef?: Ref<HTMLDivElement>; onArm?: (button: HTMLElement) => void;
}) {
  const list = useId();
  useT();
  const sites = view.value, shown = useMemo(() => (sites ? filterSites(sites, query) : []), [sites, query]);
  const total = sites ? countRules(sites) : 0, asking = confirming && total > 0;
  return (
    <SettingGroup title={t('zap.settings.title')} id="zap-removed" bodyRef={bodyRef} fold foldDetail={t('settings.zapFoldDetail')}>
      <SettingNote>{t('zap.settings.detail')}</SettingNote>
      {view.error && <p className="nc-message" data-bad role="alert">{view.error}</p>}
      {sites && total === 0 && <p className="zap-empty" role="status">{t('zap.settings.empty')}</p>}
      {sites && total > 0 && (
        <>
          <div className="st-search zap-search">
            <div className="st-search-field">
              <Search size={16} />
              <input type="search" className="ab-input" aria-label={t('zap.settings.search')} placeholder={t('zap.settings.search')} spellCheck={false} autoComplete="off" value={query} onChange={(event) => onQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape' && query) { event.preventDefault(); event.stopPropagation(); onQuery(''); } }} />
              {query && <button type="button" className="st-search-clear" aria-label={t('shortcuts.clearSearch')} onClick={() => onQuery('')}><X size={14} /></button>}
            </div>
          </div>
          {shown.length === 0 && <p className="zap-empty" role="status">{t('zap.settings.noMatch', { query: query.trim() })}</p>}
          <div className="zap-list" data-zap-list="">
            {shown.map((site) => {
              const heading = `${list}-${site.host}`;
              return (
                <div className="zap-site-group" role="group" aria-labelledby={heading} key={site.host}>
                  <div className="zap-host">
                    <h3 id={heading} className="zap-host-name"><bdi>{site.host}</bdi></h3>
                    <button type="button" className="st-button pm-quiet" data-zap-restore="" onClick={(event) => { onArm?.(event.currentTarget); onRestoreSite(site.host); }}>{t('zap.settings.restoreSite')}</button>
                  </div>
                  {site.rules.map((rule) => {
                    const name = ruleName(rule);
                    return (
                      <div className="st-row zap-rule" key={rule.id}>
                        <div className="st-copy">
                          <span className="st-title"><bdi>{name}</bdi></span>
                          {mayReturn(rule) && <p>{t('zap.mayReturn')}</p>}
                        </div>
                        <div className="st-control">
                          <button type="button" className="st-button" data-zap-restore="" aria-label={t('zap.restoreNamed', { name })} onClick={(event) => { onArm?.(event.currentTarget); onRestoreRule(rule); }}>{t('zap.restore')}</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
          <div className="st-row zap-foot">
            <div className="st-copy">{asking && <span className="st-title" role="alert">{t('zap.settings.clearAsk')}</span>}</div>
            <div className="st-control">
              {asking && <button type="button" className="st-button" onClick={() => onConfirming(false)}>{t('dialog.cancel')}</button>}
              {asking
                ? <button type="button" className="btn danger" onClick={onClear}>{t('zap.settings.clearConfirm')}</button>
                : <button type="button" className="st-button" onClick={() => onConfirming(true)}>{t('zap.settings.clear')}</button>}
            </div>
          </div>
        </>
      )}
    </SettingGroup>
  );
}

function ZapRemoved({ state }: SettingsPanelProps) {
  const profileId = state.activeBrowserProfileId;
  const store = useMemo(() => createListStore((request) => runtime.service(request), (listener) => runtime.subscribeBrowser(listener)), [profileId]);
  const view = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [query, setQuery] = useState(''), [confirming, setConfirming] = useState(false);
  const here = useRef<HTMLDivElement>(null), refocus = useRef<number | null>(null);
  // A restored part leaves the list while its button holds the focus: the keyboard goes to the button that took its place, so it is never dropped onto the page.
  useLayoutEffect(() => {
    const index = refocus.current;
    if (index === null) return;
    refocus.current = null;
    const root = here.current;
    if (root && document.activeElement && root.contains(document.activeElement)) return;
    const buttons = root?.querySelectorAll<HTMLElement>('[data-zap-restore]');
    (buttons?.length ? buttons[Math.min(index, buttons.length - 1)] : root?.querySelector<HTMLElement>('input[type="search"]'))?.focus({ preventScroll: true });
  }, [view.value]);
  const arm = (button: HTMLElement) => { refocus.current = Math.max(0, [...(here.current?.querySelectorAll('[data-zap-restore]') ?? [])].indexOf(button)); };
  return (
    <ZapRemovedView
      view={view} query={query} onQuery={setQuery} confirming={confirming} onConfirming={setConfirming} bodyRef={here} onArm={arm}
      onRestoreRule={(rule) => void store.restoreRule(rule)} onRestoreSite={(host) => void store.restoreSite(host)}
      onClear={() => { setConfirming(false); void store.clear(); }}
    />
  );
}

// Privacy, next to the site scripts (91) and the site permissions (90) the same way: a per-site decision the person can undo here.
const panel: SettingsPanel = { section: 'Protection', order: 92, placed: true, Component: ZapRemoved };
export default panel;
