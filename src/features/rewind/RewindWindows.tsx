import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, PanelTop, Trash2 } from '../../components/AppIcons';
import { TAB_GROUP_COLORS } from '../../runtime/tabGroups';
import type { TabGroupColor } from '../../runtime/types';
import { useListMotion, useSectionMotion } from '../../ui/sharedMotion';
import { useT } from '../../i18n';
import { host, rewind, title, when, why, type RewindDetail, type RewindSummary, type RewindTab, type WindowCard } from './client';
import { RowMenu, type RowMenuItem } from './RowMenu';
import { SiteIcon } from './SiteIcon';

export interface WindowActions {
  busy: string;
  /** A new window with everything in that state: groups and splits included. */ restoreWindow: (id: string) => void;
  /** Every tab of that state that isn't open here, added to this window. */ addToWindow: (id: string) => void;
  restoreRefs: (id: string, refs: string[], label: string) => void;
  goToTab: (tab: RewindTab) => void;
  keep: (id: string, kept: boolean) => void;
  forget: (id: string) => void;
}

const Chevron = () => <svg viewBox="0 0 16 16" aria-hidden className="rwp-chevron"><path d="M6 4l4 4-4 4" /></svg>;

/** Windows view: one card per window as it last was. The card says what the window held (name, when, how many tabs, groups, splits), restores it
 *  in one click, and folds its earlier saved states and its tab list underneath, so nothing needs a second page. */
export function WindowCards({ cards, iconFor, query, actions, openKey }: { cards: WindowCard[]; iconFor: (url: string) => string | undefined; query: string; actions: WindowActions; openKey: string }) {
  const list = useRef<HTMLDivElement>(null);
  useListMotion(list, cards.map(card => card.key).join('|'));
  return <div className="rwp-cards" ref={list}>
    {cards.map(card => <WindowCardView key={card.key} card={card} iconFor={iconFor} query={query} actions={actions} openKey={openKey} />)}
  </div>;
}

function WindowCardView({ card, iconFor, query, actions, openKey }: { card: WindowCard; iconFor: (url: string) => string | undefined; query: string; actions: WindowActions; openKey: string }) {
  const t = useT();
  const [tabsOpen, setTabsOpen] = useState(false), [statesOpen, setStatesOpen] = useState(false), [chosen, setChosen] = useState(card.id), [detail, setDetail] = useState<RewindDetail | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null), statesRef = useRef<HTMLUListElement>(null);
  useEffect(() => { if (chosen !== card.id && !card.earlier.some(item => item.id === chosen)) setChosen(card.id); }, [card, chosen]);
  const latest = chosen === card.id, needDetail = tabsOpen || !latest;
  useEffect(() => {
    if (!needDetail) { setDetail(null); return; }
    let live = true;
    void rewind<{ checkpoint: RewindDetail | null }>({ type: 'rewind.get', id: chosen }).then(({ checkpoint }) => { if (live) setDetail(checkpoint); }, () => { if (live) setDetail(null); });
    return () => { live = false; };
  }, [needDetail, chosen, openKey]);
  useSectionMotion(bodyRef, tabsOpen ? chosen : '');
  useSectionMotion(statesRef, statesOpen ? 'open' : '');
  const earlier = card.earlier.find(item => item.id === chosen), shown: RewindSummary = (detail && detail.id === chosen ? detail : null) ?? card;
  const kept = latest ? card.kept : earlier?.kept, missing = latest ? card.closed : earlier?.missing ?? 0, tabCount = latest ? card.tabCount : earlier?.tabCount ?? shown.tabCount;
  const stamp = when(latest ? card.createdAt : earlier?.createdAt ?? card.createdAt);
  const say = latest ? (card.current ? t('rewind.windowCurrent', { when: stamp }) : card.closedWindow ? t('rewind.windowClosed', { when: stamp }) : t('rewind.windowSaved', { when: stamp })) : t('rewind.windowSaved', { when: stamp });
  const meta = [say, t('plural.tabs', { count: tabCount }), shown.groupCount ? t('rewind.groupsN', { count: shown.groupCount }) : '', shown.splitCount ? t('rewind.splitsN', { count: shown.splitCount }) : '', query && card.hits ? t('rewind.matchesN', { count: card.hits }) : ''].filter(Boolean).join(' · ');
  const name = title(shown), icons = shown.hosts.slice(0, 4), more = Math.max(0, shown.siteCount - icons.length);
  const here = card.current && latest, busy = actions.busy === chosen;
  const menu: RowMenuItem[] = [
    here ? { id: 'window', label: t('rewind.restoreWindow'), icon: <PanelTop size={14} />, onSelect: () => actions.restoreWindow(chosen) } : { id: 'add', label: t('rewind.addToThisWindow'), icon: <PanelTop size={14} />, onSelect: () => actions.addToWindow(chosen) },
    'separator',
    { id: 'keep', label: kept ? t('rewind.stopKeeping') : t('rewindpage.keep'), icon: <Archive size={14} />, onSelect: () => actions.keep(chosen, !kept) },
    { id: 'forget', label: t('rewind.forgetWindow'), icon: <Trash2 size={14} />, danger: true, onSelect: () => actions.forget(chosen) },
  ];
  return <article className="rwp-card" data-current={card.current || undefined} aria-label={name}>
    <div className="rwp-card-head">
      <div className="rwp-stack" aria-hidden>{icons.map(h => <span key={h} className="rwp-tile"><SiteIcon url={`https://${h}`} icon={iconFor(`https://${h}`)} size={16} /></span>)}{more > 0 && <span className="rwp-tile rwp-tile-more tabular">+{more}</span>}</div>
      <div className="rwp-card-text">
        <h3 className="rwp-card-title" title={name}>{name}{kept && <span className="rwp-kept" title={t('rewindpage.keptUntilYouForgetIt')} aria-label={t('rewindpage.keptUntilYouForgetIt')} />}</h3>
        <p className="rwp-card-meta tabular">{meta}</p>
      </div>
      <div className="rwp-card-actions">
        <button type="button" className="acira-button acira-button-secondary lib-compact" data-lib-stop disabled={!!actions.busy || (here && !missing)} aria-busy={busy || undefined}
          onClick={() => (here ? actions.addToWindow(chosen) : actions.restoreWindow(chosen))}>{here ? t('rewind.restoreMissing', { tabs: t('plural.tabs', { count: missing }) }) : t('rewind.restoreWindow')}</button>
        <RowMenu label={t('rewind.moreActions')} items={menu} />
      </div>
    </div>
    <div className="rwp-card-foot">
      <button type="button" className="rwp-toggle" aria-expanded={tabsOpen} onClick={() => setTabsOpen(value => !value)}><Chevron />{tabsOpen ? t('rewind.hideTabs') : t('rewind.showTabs', { tabs: t('plural.tabs', { count: tabCount }) })}</button>
      {card.earlierCount > 0 && <button type="button" className="rwp-toggle" aria-expanded={statesOpen} onClick={() => setStatesOpen(value => !value)}><Chevron />{t('rewind.earlierStates', { count: card.earlierCount })}</button>}
    </div>
    {statesOpen && <ul className="rwp-states" ref={statesRef} role="radiogroup" aria-label={t('rewind.earlierStates', { count: card.earlierCount })}>
      {[{ id: card.id, createdAt: card.createdAt, tabCount: card.tabCount, reason: card.reason, label: card.label }, ...card.earlier].map(state => <li key={state.id}>
        <button type="button" role="radio" aria-checked={state.id === chosen} className="rwp-state" data-lib-stop onClick={() => setChosen(state.id)}>
          <span className="rwp-radio" aria-hidden /><span className="rwp-state-when tabular">{when(state.createdAt)}</span><span className="rwp-state-meta">{t('plural.tabs', { count: state.tabCount })} · {state.id === card.id ? (card.closedWindow ? t('rewind.whyWindow') : t('rewind.latestState')) : why(state as unknown as RewindSummary)}</span>
        </button></li>)}
    </ul>}
    {tabsOpen && <div className="rwp-tabs" ref={bodyRef}>{detail && detail.id === chosen ? <CardTabs detail={detail} iconFor={iconFor} actions={actions} /> : <p className="rwp-note" role="status">{t('rewind.loading')}</p>}</div>}
  </article>;
}

/** The tabs of one saved state, in their groups: a closed tab comes back on a click, an open one is a way to go to it. */
function CardTabs({ detail, iconFor, actions }: { detail: RewindDetail; iconFor: (url: string) => string | undefined; actions: WindowActions }) {
  const t = useT();
  const blocks = useMemo(() => {
    const out: { ref: string | null; name: string; color: string; tabs: RewindTab[] }[] = [];
    for (const tab of [...detail.tabs].sort((a, b) => a.order - b.order)) {
      const group = detail.groups.find(g => g.ref === tab.groupRef), ref = group?.ref ?? null, block = out.find(b => b.ref === ref);
      if (block) block.tabs.push(tab); else out.push({ ref, name: group?.name ?? '', color: group?.color ?? 'none', tabs: [tab] });
    }
    return out;
  }, [detail]);
  return <>{blocks.map(block => {
    const closed = block.tabs.filter(tab => !tab.open);
    return <div key={block.ref ?? 'none'} className="rwp-block" role="group" aria-label={block.name || t('rewindpage.notInAGroup')}>
      {(block.name || detail.groups.length > 0) && <div className="rwp-block-head">
        {block.name ? <><span className="rwp-swatch" style={{ background: TAB_GROUP_COLORS[block.color as TabGroupColor] ?? 'transparent' }} aria-hidden />{block.name}</> : t('rewindpage.notInAGroup')}
        <span className="tabular rwp-block-count">{block.tabs.length}</span>
        {closed.length > 1 && <button type="button" className="acira-button acira-button-quiet lib-compact" onClick={() => actions.restoreRefs(detail.id, closed.map(tab => tab.ref), block.name)}>{block.name ? t('rewindpage.restoreGroup') : t('rewindpage.restoreThese')}</button>}
      </div>}
      {block.tabs.map(tab => {
        const name = tab.title || host(tab.url);
        return <button key={tab.ref} type="button" className="rwp-tab" data-open={tab.open || undefined} data-lib-stop title={tab.url} aria-label={tab.open ? t('rewind.openGoTo', { title: name }) : t('rewind.restoreTitle', { title: name })}
          onClick={() => (tab.open ? actions.goToTab(tab) : actions.restoreRefs(detail.id, [tab.ref], ''))}>
          <SiteIcon url={tab.url} icon={iconFor(tab.url)} /><span className="rwp-tab-title">{name}</span><span className="rwp-tab-host">{host(tab.url)}</span>
          <span className="rwp-tab-hint">{tab.open ? t('rewind.open') : t('rewindpage.restore')}</span>
        </button>;
      })}
    </div>;
  })}</>;
}
