import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { DotMatrix } from '../../components/DotMatrix';
import { Segmented } from '../../components/Segmented';
import { Archive, Columns2, Copy, PanelTop, SquareStack, Trash2, X } from '../../components/AppIcons';
import { TAB_GROUP_COLORS } from '../../runtime/tabGroups';
import type { BrowserAction, BrowserSnapshot, TabGroupColor } from '../../runtime/types';
import { copyText } from '../../ui/pageActions';
import { formatShortcut } from '../../ui/platform';
import { useListMotion } from '../../ui/sharedMotion';
import { openSettings } from '../../ui/settingsView';
import { useSiteIcons } from '../../ui/siteIcons';
import { t } from '../../i18n';
import { ConfirmAction, LibraryEmpty, LibraryPage, LibrarySection } from '../Library';
import { ago, band, bandLabel, canonical, daysLabel, host, rewind, rewindAvailable, type Band, type ClosedTab, type RestoreResult, type RewindTab, type TabsState, type WindowsState } from './client';
import { RowMenu, type RowMenuItem } from './RowMenu';
import { SiteIcon } from './SiteIcon';
import { WindowCards, type WindowActions } from './RewindWindows';
import './rewind.css';
import './rewind-page.css';

export { SiteMark } from './SiteIcon';

type View = 'tabs' | 'windows';
const VIEW_KEY = 'acira.rewind.view', INTRO_KEY = 'acira.rewind.intro.v3';
const BANDS: Band[] = ['hour', 'today', 'yesterday', 'week', 'older'];
const readView = (): View => { try { return localStorage.getItem(VIEW_KEY) === 'windows' ? 'windows' : 'tabs'; } catch { return 'tabs'; } };
const short = (text: string) => text.length > 40 ? `${text.slice(0, 39)}…` : text;

/** Rewind (R3-39): get back a tab or a window you closed, in a few seconds. The closed tab is the unit: a flat, searchable list in time bands,
 *  one click or Enter to bring a tab back (in its group, in the background, never replacing anything open), with Undo. The Windows view keeps
 *  one card per window as it last was. Restore is additive; private and Tor tabs are never recorded. */
export function RewindPage({ state, dispatch }: { state: BrowserSnapshot; dispatch: (action: BrowserAction) => unknown }) {
  const isPrivate = Boolean(state.browserProfiles.find(p => p.id === state.activeBrowserProfileId)?.private);
  const iconFor = useSiteIcons(state);
  const [view, setViewState] = useState<View>(readView), [query, setQuery] = useState('');
  const [tabsData, setTabsData] = useState<TabsState | null>(null), [winData, setWinData] = useState<WindowsState | null>(null);
  const [error, setError] = useState(''), [slow, setSlow] = useState(false), [busy, setBusy] = useState(''), [undoToken, setUndoToken] = useState(''), [tick, setTick] = useState(0);
  const [intro, setIntro] = useState(() => { try { return localStorage.getItem(INTRO_KEY) !== '1'; } catch { return true; } });
  const seq = useRef(0), working = useRef(false), root = useRef<HTMLDivElement>(null), focusAt = useRef<number | null>(null), focusedSearch = useRef(false), searchField = useRef<HTMLInputElement>(null), searchOwners = useRef(new Set<string>());
  const setView = (next: View) => { setViewState(next); try { localStorage.setItem(VIEW_KEY, next); } catch { /* the choice lasts until the page closes */ } };
  const dismissIntro = () => { setIntro(false); try { localStorage.setItem(INTRO_KEY, '1'); } catch { /* shown again next time */ } };
  const needle = query.trim();
  // The bands glide when a tab leaves (the rows inside each band move on A's list motion, in LibrarySection; the bands below follow here), so nothing snaps.
  const bandsRef = useRef<HTMLDivElement>(null);
  useListMotion(bandsRef, `${view}|${(tabsData?.tabs ?? []).map(tab => `${tab.id}`).join(',')}`);

  const load = useCallback(async (which: View, q: string) => {
    if (!rewindAvailable()) { setError(t('rewind.needsDesktop')); return; }
    const mine = ++seq.current, timer = setTimeout(() => setSlow(true), 200);
    try {
      if (which === 'tabs') { const next = await rewind<TabsState>({ type: 'rewind.tabs', ...(q ? { query: q } : {}) }); if (mine !== seq.current) return; setTabsData(next); }
      else { const next = await rewind<WindowsState>({ type: 'rewind.windows', ...(q ? { query: q } : {}) }); if (mine !== seq.current) return; setWinData(next); }
      setError('');
    } catch (cause) { if (mine === seq.current) setError(cause instanceof Error ? cause.message : t('rewind.errorTitle')); }
    finally { clearTimeout(timer); if (mine === seq.current) setSlow(false); }
  }, []);
  // Searching asks main (it reads every title and address); typing is debounced so each key doesn't re-read.
  useEffect(() => { const timer = setTimeout(() => void load(view, needle), needle ? 120 : 0); return () => clearTimeout(timer); }, [load, view, needle, state.activeBrowserProfileId]);
  // What's open changes what is "closed": main recomputes it against the live tabs (a tab closed elsewhere shows up, a restored one leaves).
  const openKey = state.tabs.map(tab => tab.url).join('\n');
  useEffect(() => { if (tabsData || winData) void load(view, needle); }, [openKey]);// eslint-disable-line react-hooks/exhaustive-deps
  // The bands move on with the clock.
  useEffect(() => { const timer = setInterval(() => setTick(value => value + 1), 60000); return () => clearInterval(timer); }, []);
  // The page opens with search ready (Ctrl+Shift+H, then type).
  const data = view === 'tabs' ? tabsData : winData;
  useEffect(() => {
    if (!data || focusedSearch.current || !searchField.current) return;
    focusedSearch.current = true;
    searchField.current.focus({ preventScroll: true });
  }, [data]);
  // A restore moves the row you were on: focus stays at the same place in the list instead of falling to the page.
  const rememberFocus = () => {
    const stops = [...(root.current?.querySelectorAll<HTMLElement>('[data-lib-stop]:not([data-motion-ghost])') ?? [])], at = stops.indexOf(document.activeElement as HTMLElement);
    focusAt.current = at >= 0 ? at : null;
  };
  useEffect(() => {
    const at = focusAt.current; if (at === null) return;
    if (document.activeElement && document.activeElement !== document.body) { focusAt.current = null; return; }
    const stops = [...(root.current?.querySelectorAll<HTMLElement>('[data-lib-stop]:not([data-motion-ghost])') ?? [])];
    focusAt.current = null; stops[Math.min(at, stops.length - 1)]?.focus();
  }, [tabsData, winData]);

  // --- restoring -------------------------------------------------------------------------------------------------
  /** One answer for every restore: a toast with Undo (the Undo token is for this window), or a plain note when nothing came back. */
  const report = (result: RestoreResult, name = '') => {
    if (!result.ok) { dispatch({ type: 'toast', text: result.message || t('rewind.restoreFailed'), tone: 'error' }); return; }
    const n = result.restored ?? 0;
    if (result.window) dispatch({ type: 'toast', text: t('rewindpage.openedTabsInWindow', { count: n }), tone: 'status', icon: 'check' });
    else if (n && result.token) {
      const text = result.split ? t('rewind.restoredSplit') : n === 1 && name ? t('rewind.restoredOne', { title: short(name) }) : result.groups?.length === 1 ? t('rewind.restoredToGroup', { tabs: t('plural.tabs', { count: n }), group: result.groups[0] }) : t('rewind.restoredMany', { tabs: t('plural.tabs', { count: n }) });
      setUndoToken(result.token);
      dispatch({ type: 'toast', text, action: { label: t('toast.undo'), command: { type: 'rewind.undo', token: result.token } } });
    } else if (!n) dispatch({ type: 'toast', text: result.skipped?.length ? t('rewindpage.thoseTabsAreAlreadyOpen') : t('rewindpage.nothingToRestore'), tone: 'status', icon: 'info' });
  };
  /** One action at a time: a second click while the first is on its way does nothing (it can't restore a tab twice). */
  const run = async (key: string, job: () => Promise<void>) => {
    if (working.current) return;
    working.current = true; setBusy(key); rememberFocus();
    try { await job(); } catch (cause) { dispatch({ type: 'toast', text: cause instanceof Error ? cause.message : t('rewind.restoreFailed'), tone: 'error' }); }
    finally { working.current = false; setBusy(''); void load(view, needle); }
  };
  const reopen = (tab: ClosedTab, options: { newWindow?: boolean; unit?: boolean } = {}) => run(tab.id, async () => {
    report(await rewind<RestoreResult>({ type: 'rewind.reopen', ids: [tab.id], ...(options.newWindow ? { newWindow: true } : {}), ...(options.unit ? { unit: true } : {}) }), tab.title || host(tab.url));
  });
  const undo = async () => { if (!undoToken) return; const token = undoToken; setUndoToken(''); try { await rewind({ type: 'rewind.undo', token }); } catch { /* the toast's Undo may have run first */ } };
  const keepTab = (tab: ClosedTab) => run(tab.id, async () => { await rewind({ type: 'rewind.keep', id: tab.id, kept: !tab.kept }); });
  const forgetTab = (tab: ClosedTab) => run(tab.id, async () => { await rewind({ type: 'rewind.remove', id: tab.id }); dispatch({ type: 'toast', text: t('rewind.forgotTab', { title: short(tab.title || host(tab.url)) }), tone: 'status', icon: 'check' }); });
  const copyAddress = (tab: ClosedTab) => void copyText(tab.url).then(() => dispatch({ type: 'toast', text: t('app.addressCopied') }), () => dispatch({ type: 'toast', text: t('app.couldnTCopyTheLink'), tone: 'error' }));
  const windowActions: WindowActions = {
    busy,
    restoreWindow: id => void run(id, async () => report(await rewind<RestoreResult>({ type: 'rewind.restore', id, all: true, newWindow: true }))),
    addToWindow: id => void run(id, async () => report(await rewind<RestoreResult>({ type: 'rewind.restore', id, all: true }))),
    restoreRefs: (id, refs, label) => void run(id, async () => report(await rewind<RestoreResult>({ type: 'rewind.restore', id, refs }), refs.length === 1 ? label : '')),
    goToTab: (tab: RewindTab) => { const match = state.tabs.find(item => item.browserProfileId === state.activeBrowserProfileId && canonical(item.url) === canonical(tab.url)); if (match) dispatch({ type: 'tab.select', id: match.id }); },
    keep: (id, kept) => void run(id, async () => { await rewind({ type: 'rewind.keep', id, kept }); }),
    forget: id => void run(id, async () => { await rewind({ type: 'rewind.remove', id, window: true }); dispatch({ type: 'toast', text: t('rewind.forgotWindow'), tone: 'status', icon: 'check' }); }),
  };
  const saveNow = () => void run('save', async () => { await rewind({ type: 'rewind.save' }); dispatch({ type: 'toast', text: t('rewind.savedToast'), tone: 'status', icon: 'check' }); });
  const enable = async () => { await rewind({ type: 'rewind.settings', enabled: true }); void load(view, needle); };
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null, typing = !!target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable);
      if (!root.current?.offsetParent) return;
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'z' && !typing && undoToken) { event.preventDefault(); void undo(); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  });

  // --- page ---------------------------------------------------------------------------------------------------------
  const days = data?.days ?? 7, now = useMemo(() => Date.now(), [tabsData, winData, tick]);// eslint-disable-line react-hooks/exhaustive-deps
  const total = view === 'tabs' ? tabsData?.total ?? 0 : winData?.windows.length ?? 0;
  // Keep an exposed search mounted while its cleared query is loading; replacing the field loses keyboard focus.
  const searchOwner = `${state.activeBrowserProfileId}:${view}`;
  const ready = !isPrivate && !!data && (total > 0 || !!needle || searchOwners.current.has(searchOwner));
  if (ready) searchOwners.current.add(searchOwner);
  const clearSearch = () => { setQuery(''); searchField.current?.focus({ preventScroll: true }); };
  const frame = (content: ReactNode) => <LibraryPage title={t('browsermenu.rewind')} description={t('rewind.subtitle')}
    count={ready && total > 0 ? (view === 'tabs' ? t('plural.tabs', { count: total }) : t('rewind.countWindows', { count: total })) : undefined}
    actions={!isPrivate && data && (data.enabled || total > 0) ? <Segmented label={t('rewind.viewLabel')} value={view} options={[['tabs', t('rewind.viewTabs')], ['windows', t('rewind.viewWindows')]]} onChange={setView} /> : undefined}
    search={ready ? { label: view === 'tabs' ? t('rewind.searchTabs') : t('rewind.searchWindows'), placeholder: view === 'tabs' ? t('rewind.searchTabs') : t('rewind.searchWindows'), value: query, onChange: setQuery, inputRef: searchField } : undefined}>
    <div className="rw-page rwp" ref={root} aria-busy={!isPrivate && !data && !error || undefined}>{content}</div>
  </LibraryPage>;
  if (isPrivate) return frame(<LibraryEmpty title={t('rewindpage.rewindIsnTAvailableIn')} text={t('rewind.privateText')} />);
  if (error) return frame(<LibraryEmpty title={t('rewind.errorTitle')} text={t('rewind.errorText')}><button type="button" className="acira-button acira-button-secondary" onClick={() => void load(view, needle)}>{t('ne.tryAgain')}</button></LibraryEmpty>);
  if (!data) return frame(<p className="rw-loading" role="status">{slow && <><DotMatrix preset="loader" size={13} reducedMotion={state.settings.reducedMotion} /> {t('rewind.loading')}</>}</p>);
  if (!total && needle) return frame(<LibraryEmpty title={t(view === 'tabs' ? 'rewind.noTabsMatch' : 'rewind.noWindowsMatch', { query: needle })} text={t('rewind.noMatchText')}><button type="button" className="acira-button acira-button-secondary" onClick={clearSearch}>{t('lib.clearSearch')}</button></LibraryEmpty>);
  if (!total && !data.enabled) return frame(<LibraryEmpty title={t('rewindpage.rewindIsOff')} text={t('rewind.offText', { days: daysLabel(data.days) })}><button type="button" className="acira-button acira-button-primary" onClick={enable}>{t('rewindpage.turnOnRewind')}</button></LibraryEmpty>);
  if (!total) return frame(<LibraryEmpty title={t(view === 'tabs' ? 'rewind.emptyTabsTitle' : 'rewind.emptyWindowsTitle')} text={t(view === 'tabs' ? 'rewind.emptyTabsText' : 'rewind.emptyWindowsText')}
    >{/* R3-B12: no shortcut for the page you are already on; the line above says what fills it. */}{view === 'windows' && <button type="button" className="acira-button acira-button-secondary" onClick={saveNow} disabled={!!busy}>{t('rewindpage.saveNow')}</button>}</LibraryEmpty>);

  const groups = view === 'tabs' ? BANDS.map(id => ({ id, tabs: (tabsData?.tabs ?? []).filter(tab => band(tab.closedAt, now) === id) })).filter(group => group.tabs.length) : [];
  const settings = () => openSettings(state, dispatch, { section: 'Privacy', setting: 'rewind-retention' });
  return frame(<>
    {!data.enabled && <p className="rwp-off">{t('rewindpage.rewindIsOffSoNothing')} <button type="button" className="rw-link" onClick={enable}>{t('ext.turnOn')}</button></p>}
    {intro && <div className="rwp-hint" role="note"><p>{t('rewind.intro')}</p><button type="button" className="lib-icon" aria-label={t('lib.dismiss')} onClick={dismissIntro}><X size={13} /></button></div>}
    {view === 'tabs'
      ? <div className="rwp-bands" ref={bandsRef}>{groups.map(group => <LibrarySection key={group.id} title={bandLabel(group.id)} count={group.tabs.length} day lead={group.id === groups[0].id}>
        {group.tabs.map(tab => <ClosedRow key={tab.id} tab={tab} icon={iconFor(tab.url)} now={now} busy={busy === tab.id}
          onReopen={options => void reopen(tab, options)} onKeep={() => void keepTab(tab)} onForget={() => void forgetTab(tab)} onCopy={() => copyAddress(tab)} />)}
      </LibrarySection>)}</div>
      : <WindowCards cards={winData?.windows ?? []} iconFor={iconFor} query={needle} actions={windowActions} openKey={openKey} />}
    <footer className="rwp-foot">
      {view === 'tabs' && <p className="rwp-keys" aria-hidden><span><kbd>↵</kbd> {t('rewindpage.restore')}</span><span><kbd>{formatShortcut('Ctrl')}</kbd><kbd>↵</kbd> {t('browsermenu.newWindow')}</span><span><kbd>⇧</kbd><kbd>↵</kbd> {t('rewind.hintGroup')}</span><span><kbd>/</kbd> {t('rewind.hintSearch')}</span><span><kbd>{formatShortcut('Ctrl')}</kbd><kbd>Z</kbd> {t('toast.undo')}</span></p>}
      {view === 'windows' && <p className="rwp-line">{t('rewind.windowsFoot')} <button type="button" className="rw-link" onClick={saveNow} disabled={!!busy}>{t('rewindpage.saveNow')}</button></p>}
      <p className="rwp-line">{t('rewind.footerKeeps', { days: daysLabel(days) })} {t('rewind.footerPrivate')} <button type="button" className="rw-link" onClick={settings}>{t('rewind.changeInSettings')}</button></p>
    </footer>
  </>);
}

/** One closed tab, in the Library's row (favicon, title, site) with what the History row has not: the group it was in, the split it was in, and Restore. */
function ClosedRow({ tab, icon, now, busy, onReopen, onKeep, onForget, onCopy }: { tab: ClosedTab; icon?: string; now: number; busy: boolean;
  onReopen: (options?: { newWindow?: boolean; unit?: boolean }) => void; onKeep: () => void; onForget: () => void; onCopy: () => void }) {
  const name = tab.title || host(tab.url), together = (tab.group && tab.groupSize > 1) || !!tab.split, partner = tab.split?.partners[0];
  const keys = (event: KeyboardEvent) => {
    if (event.key !== 'Enter') return;
    event.preventDefault(); event.stopPropagation();
    const mod = event.ctrlKey || event.metaKey;
    onReopen({ ...(mod ? { newWindow: true } : {}), ...(event.shiftKey && together ? { unit: true } : {}) });
  };
  const groupLabel = tab.group && tab.groupSize > 1 && tab.split ? t('rewind.restoreGroupAndSplit') : tab.group && tab.groupSize > 1 ? t('rewind.restoreGroupN', { tabs: t('plural.tabs', { count: tab.groupSize }) }) : t('rewind.restoreSplit');
  const items: RowMenuItem[] = [
    { id: 'window', label: t('rewind.restoreInWindow'), icon: <PanelTop size={14} />, hint: <><kbd>{formatShortcut('Ctrl')}</kbd><kbd>↵</kbd></>, onSelect: () => onReopen({ newWindow: true }) },
    ...(together ? [{ id: 'unit', label: groupLabel, icon: tab.split && !(tab.group && tab.groupSize > 1) ? <Columns2 size={14} /> : <SquareStack size={14} />, hint: <><kbd>⇧</kbd><kbd>↵</kbd></>, onSelect: () => onReopen({ unit: true }) }] : []),
    'separator',
    { id: 'copy', label: t('rewind.copyAddress'), icon: <Copy size={14} />, onSelect: onCopy },
    { id: 'keep', label: tab.kept ? t('rewind.stopKeeping') : t('rewindpage.keep'), icon: <Archive size={14} />, onSelect: onKeep },
    { id: 'forget', label: t('rewindpage.forget'), icon: <Trash2 size={14} />, danger: true, onSelect: onForget },
  ];
  return <div className="lib-row rwp-row" data-busy={busy || undefined} data-id={tab.id}>
    <button type="button" className="lib-open" data-lib-stop aria-busy={busy || undefined} title={`${name} · ${tab.url}`} aria-label={t('rewind.restoreTitle', { title: name })} onClick={() => onReopen()} onKeyDown={keys}>
      <SiteIcon url={tab.url} icon={icon} />
      <span className="lib-text"><span className="lib-title">{name}</span><span className="lib-host">{host(tab.url)}</span></span>
      {tab.group && <span className="rwp-chip"><i className="rwp-swatch" style={{ background: TAB_GROUP_COLORS[tab.groupColor as TabGroupColor] ?? 'var(--text-3)' }} aria-hidden />{tab.group}</span>}
      {partner && <span className="rwp-chip" title={partner.title}><Columns2 size={12} aria-hidden />{t('rewind.splitWith', { title: partner.title })}</span>}
      {tab.kept && <Archive size={12} className="rwp-kept-pin" aria-label={t('rewindpage.keptUntilYouForgetIt')} />}
    </button>
    <span className="lib-trail rwp-trail">
      <time className="lib-time" dateTime={new Date(tab.closedAt).toISOString()}>{ago(tab.closedAt, now)}</time>
      <span className="lib-actions">
        <button type="button" className="acira-button acira-button-quiet lib-compact" tabIndex={-1} aria-hidden disabled={busy} onClick={() => onReopen()}>{t('rewindpage.restore')}</button>
        <button type="button" className="lib-icon" aria-label={t('rewind.restoreInWindow')} title={`${t('rewind.restoreInWindow')} · ${formatShortcut('Ctrl Enter')}`} onClick={() => onReopen({ newWindow: true })}><PanelTop size={14} /></button>
        <RowMenu label={t('rewind.moreActions')} items={items} />
      </span>
    </span>
  </div>;
}

