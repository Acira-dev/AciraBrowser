import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import type { BrowserAction, BrowserSnapshot, TaskManagerReading } from '../../runtime/types';
import { runtime } from '../../runtime/client';
import { SiteIdentityIcon } from '../../components/SiteIdentityIcon';
import { AciraSymbol } from '../../components/AciraSymbol';
import { EditorGlyph } from '../../components/EditorGlyph';
import { Chevron } from '../../components/PanelParts';
import { WorkspaceGlyph, workspaceIcon } from '../../components/WorkspaceGlyph';
import { workspaceColorOf, workspaceName } from '../../runtime/workspaces';
import { useSiteIcons } from '../../ui/siteIcons';
import { formatShortcut } from '../../ui/platform';
import { currentLocale, t, useT } from '../../i18n';
import { noteTaskManagerExtensions } from '../../ui/taskManagerRows';
import { cpuShown, formatAbout, formatCpu, formatIdle, formatMemory, holdOrder, orderOf, pinnedTab, shareOf, steadyOrder, tabTitleOf, taskView, type ExtensionRow, type OwnId, type TabRow, type TaskSection, type TaskState, type TaskView } from './taskManagerModel';
import './task-manager.css';

/** The reading is asked for every 2 s while the pop-up is open (the one timer lives here, in the pop-up's page: closed, nothing runs).
 *  The first reading has no processor figures yet, so the second is asked for sooner. */
export const TASK_MANAGER_INTERVAL_MS = 2000, TASK_MANAGER_SECOND_MS = 700;
/** A figure eases to its new value, and a re-sorted row glides to its new place, in this long (Acira's menu curve). */
export const TASK_EASE_MS = 360, TASK_GLIDE_MS = 240;
/** A re-sort where rows would cross: the row that changed rank fades out first (this long), the rows that give way glide, and it comes back in its new place (the glide's last fifth and this much more). */
export const TASK_ROOM_MS = 70, TASK_SETTLE_MS = 150;
const CURVE = 'cubic-bezier(0.2, 0, 0, 1)';

const ownName = (id: OwnId) => ({ browser: t('taskmanager.part.browser'), interface: t('taskmanager.part.interface'), graphics: t('taskmanager.part.graphics'), network: t('taskmanager.part.network'), otherPages: t('taskmanager.part.otherPages'), other: t('taskmanager.part.other') })[id];

/** The reading is shared by the pop-up's three parts (the fixed top, the scrolling list, the fixed foot); one tiny store, emptied on close. */
interface Shared { reading: TaskManagerReading | null; icons: ReadonlyMap<string, string>; failed: boolean }
const EMPTY: Shared = { reading: null, icons: new Map(), failed: false };
let shared: Shared = EMPTY; const listeners = new Set<() => void>();
const publish = (next: Shared) => { shared = next; listeners.forEach(listener => listener()); };
const useShared = () => useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => shared, () => EMPTY);
/** For tests: what the store holds. */
export const taskManagerHeld = () => shared !== EMPTY || listeners.size > 0;

/** The extensions' icons are kept for the life of the pop-up's page (a few small pictures): only the first opening asks main for them. */
const iconCache = new Map<string, string>();
/** Opened from another pop-up (a press in More tools), the shared sheet grows from that pop-up's box on its spring while this one's content is
 *  already laid out at its final size: the growing edge reveals it, as in every pop-up. But this content waits for its first reading, and
 *  when that came with the edge a few px short of the foot, the foot's second line showed cut for one frame. So: when the sheet is within
 *  TASK_SHEET_NEAR_PX of holding the fixed top and the foot, the first reading waits for it (TASK_SHEET_WAIT_MS at most, usually a frame or
 *  two). Further away, the content shows at once and the edge reveals it. A sheet that is not shown yet gets its size first: no wait. */
// (24 px: opened from More tools in a 600 px window this pop-up is 30 px taller, the foot at most 18 px beyond the edge at the start: that
// case always waits, however early the reading comes; measured, the edge is there 80 ms after the switch)
export const TASK_SHEET_WAIT_MS = 100, TASK_SHEET_NEAR_PX = 24;
function sheetHolds(): Promise<void> {
  return new Promise(resolve => {
    const started = performance.now();
    const check = () => {
      const top = document.querySelector<HTMLElement>('.tm-top'), foot = document.querySelector<HTMLElement>('.tm-sweep'), sheet = (foot ?? top)?.closest<HTMLElement>('.popup-surface');
      if (!sheet || sheet.dataset.preparing !== undefined || performance.now() - started > TASK_SHEET_WAIT_MS) { resolve(); return; }
      // how far the sheet's edge is from holding both (a row's text never lies in its last 4 px)
      const box = sheet.getBoundingClientRect(), lack = Math.max(top ? box.top - 4 - top.getBoundingClientRect().top : 0, foot ? foot.getBoundingClientRect().bottom - 4 - box.bottom : 0);
      if (lack <= 0 || lack > TASK_SHEET_NEAR_PX) resolve(); else requestAnimationFrame(check);
    };
    check();
  });
}
function usePolling() {
  useEffect(() => {
    let alive = true, timer: number | undefined, count = 0;
    // An extension that had a row keeps it while the pop-up is open (its worker may stop and start again within seconds): rows do not come and go.
    const listed = new Map<string, string>();
    const tick = async () => {
      try {
        const result = await runtime.service({ type: 'taskmanager.read', ...(count === 0 && !iconCache.size ? { icons: true } : {}) });
        if (count === 0) await sheetHolds();
        if (!alive) return;
        if (result.taskManager) {
          const reading = result.taskManager;
          for (const item of reading.extensions) { listed.set(item.id, item.name); if (typeof item.icon === 'string') iconCache.set(item.id, item.icon); }
          const missing = [...listed].filter(([id]) => !reading.extensions.some(item => item.id === id)).map(([id, name]) => ({ id, name, memoryKB: 0, cpu: null }));
          publish({ reading: missing.length ? { ...reading, extensions: [...reading.extensions, ...missing] } : reading, icons: new Map(iconCache), failed: false });
          noteTaskManagerExtensions(listed.size);
        }
      } catch { if (alive) publish({ ...shared, failed: true }); }
      if (alive) timer = window.setTimeout(() => void tick(), count++ === 0 ? TASK_MANAGER_SECOND_MS : TASK_MANAGER_INTERVAL_MS);
    };
    void tick();
    return () => { alive = false; window.clearTimeout(timer); publish(EMPTY); void runtime.service({ type: 'taskmanager.close' }).catch(() => undefined); };
  }, []);
}
/** One view per (state, reading): the three parts ask with the same inputs and get the same object. */
let memo: { tabs: unknown; others: unknown; workspaces: unknown; active: string; split: unknown; reading: unknown; view: TaskView } | null = null;
function viewOf(state: TaskState, reading: TaskManagerReading | null): TaskView {
  if (memo && memo.tabs === state.tabs && memo.others === state.otherWorkspaceTabs && memo.workspaces === state.workspaces && memo.active === state.activeTabId && memo.split === state.windowUi?.split && memo.reading === reading) return memo.view;
  const view = taskView(state, reading);
  memo = { tabs: state.tabs, others: state.otherWorkspaceTabs, workspaces: state.workspaces, active: state.activeTabId, split: state.windowUi?.split, reading, view };
  return view;
}

/** A figure that eases to its new value. The text is drawn from the node's `data-v` (CSS: `.tm-num::after { content: attr(data-v) }`) and written
 *  straight to it, one frame loop per changing figure: no re-render, and no change the pop-up's own measuring observer listens to (it watches text
 *  and child changes in the list, and would re-measure, with a round trip to main, on every frame of every easing figure). The box keeps its
 *  width (tabular figures in a fixed column), so nothing around it moves. */
function Eased({ value, format, reduced, className = '' }: { value: number; format: (value: number) => string; reduced: boolean; className?: string }) {
  const node = useRef<HTMLSpanElement>(null), shown = useRef(value), first = useRef(format(value)), formatter = useRef(format);
  formatter.current = format;
  useLayoutEffect(() => {
    const element = node.current, from = shown.current; if (!element) return;
    const write = (next: number) => { shown.current = next; const text = formatter.current(next); if (element.getAttribute('data-v') !== text) element.setAttribute('data-v', text); };
    if (reduced || from === value || typeof requestAnimationFrame !== 'function') { write(value); return; }
    let frame = 0; const start = performance.now();
    const step = (time: number) => { const p = Math.min(1, Math.max(0, (time - start) / TASK_EASE_MS)), eased = 1 - (1 - p) ** 3; write(p >= 1 ? value : from + (value - from) * eased); if (p < 1) frame = requestAnimationFrame(step); };
    frame = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(frame); };
  }, [value, reduced]);
  return <span ref={node} className={`tm-num ${className}`.trim()} data-v={first.current}/>;
}

/** The fixed top: the name, the one number that matters and how it splits. */
export function TaskManagerHeader({ state }: { state: BrowserSnapshot }) {
  useT();
  const { reading, failed } = useShared(), view = viewOf(state, reading), locale = currentLocale(), reduced = !!state.settings.reducedMotion;
  const memory = (kb: number) => formatMemory(kb, locale), { all, tabs, extensions, own } = view.totals;
  // The legend and the bar have their Extensions part whenever the list has extension rows (also in the rare first moment when their figures are not in yet): the header never gains a part after it opened.
  const listed = view.sections.some(section => section.kind === 'extensions');
  // "Acira is using {memory}": the sentence stays one string for the translators; the figure is set larger wherever the language puts it.
  const [before, after] = t('taskmanager.using', { memory: '\u0000' }).split('\u0000');
  const part = (key: 'tabs' | 'ext' | 'own', label: string, kb: number) => <span className="tm-legend-item" data-k={key}>{label} {reading && kb > 0 ? <Eased value={kb} format={memory} reduced={reduced} className="tm-legend-fig"/> : <span className="tm-legend-fig">–</span>}</span>;
  // Until the first reading is in (a frame or two after the glass), only the name shows: no dash where a figure will be, no bar that then changes.
  return <div className="tm-top" data-wait={!reading && !failed || undefined}>
    <div className="tm-title"><strong className="tm-title-name">{t('taskmanager.title')}</strong><kbd className="popup-shortcut tm-key">{formatShortcut('Shift Esc')}</kbd></div>
    <p className="tm-using">{before && <span>{before.trim()}</span>}{reading ? <Eased value={all} format={memory} reduced={reduced} className="tm-total"/> : <span className="tm-total">–</span>}{after?.trim() && <span>{after.trim()}</span>}</p>
    <div className="tm-split" aria-hidden="true" data-empty={!reading || undefined}><i className="tm-split-part" data-k="tabs" style={{ flexGrow: Math.max(tabs, 1) }}/>{listed && <i className="tm-split-part" data-k="ext" style={{ flexGrow: Math.max(extensions, 1) }}/>}<i className="tm-split-part" data-k="own" style={{ flexGrow: Math.max(own, 1) }}/></div>
    <div className="tm-legend">{part('tabs', t('taskmanager.legend.tabs'), tabs)}{listed && part('ext', t('taskmanager.legend.extensions'), extensions)}{part('own', t('taskmanager.legend.acira'), own)}</div>
  </div>;
}

/** The fixed foot: the one action for the background tabs that can be unloaded now. The row keeps its place when there is nothing to free, so the pop-up never changes height for it. */
export function TaskManagerFooter({ state, dispatch }: { state: BrowserSnapshot; dispatch: (action: BrowserAction) => unknown }) {
  useT();
  const { reading, failed } = useShared(), view = viewOf(state, reading), locale = currentLocale(), count = view.sweep.tabIds.length;
  // Before the first reading the foot keeps its room and says nothing yet (it would say "nothing to unload" for a frame or two, then change).
  if (!reading && !failed) return <div className="tm-row tm-static tm-sweep" data-wait=""/>;
  // Nothing to unload: the same row in the same place, as a quiet line (not a greyed-out button), so the pop-up keeps its height.
  if (!count) return <div className="tm-row tm-static tm-sweep tm-sweep-idle">
    <EditorGlyph name="Moon" className="acira-menu-icon"/>
    <span className="acira-menu-title">{t('taskmanager.sweepNone')}<span className="acira-menu-sub">{t('taskmanager.sweepNoneSub')}</span></span>
    <span/>
  </div>;
  return <button type="button" className="acira-menu-row acira-menu-row-identity tm-sweep" onClick={() => void dispatch({ type: 'tab.sleep', tabIds: view.sweep.tabIds })}>
    <EditorGlyph name="Moon" className="acira-menu-icon"/>
    <span className="acira-menu-title">{t('taskmanager.sweep', { count })}<span className="acira-menu-sub">{view.sweep.memoryKB >= 10 * 1024 ? t('taskmanager.sweepFrees', { memory: formatAbout(view.sweep.memoryKB, locale) }) : t('taskmanager.sweepKeeps')}</span></span>
    <span/>
  </button>;
}

const heldNow = (root: HTMLElement | null) => !!root?.querySelector('.tm-item:hover, .tm-item:focus-within');

export function TaskManagerPanel({ state, dispatch, close }: { state: BrowserSnapshot; dispatch: (action: BrowserAction) => unknown; close: () => void }) {
  useT();
  usePolling();
  const { reading, icons, failed } = useShared(), locale = currentLocale(), reduced = !!state.settings.reducedMotion;
  const iconFor = useSiteIcons(state);
  const root = useRef<HTMLElement>(null), order = useRef(new Map<string, string[]>()), places = useRef(new Map<string, number>()), settled = useRef(false), inside = useRef(false);
  const [open, setOpen] = useState(false);
  const fresh = viewOf(state, reading);
  // While the pointer rests on a row, or the keyboard is on one, the order stays as it is: a row never leaves from under the pointer. Figures still update.
  // Otherwise it follows the weights, but steadily: two rows change places only when one has become clearly heavier (steadyOrder's margin).
  const held = heldNow(root.current), view = useMemo(() => held ? holdOrder(fresh, order.current) : steadyOrder(fresh, order.current), [fresh, held]);
  useLayoutEffect(() => { order.current = orderOf(view); }, [view]);
  // A row that changed place moves there without two rows ever being drawn over each other (FLIP: where it was, where it is, one transform between).
  //  - Rows that all move the same way by the same amount (a tab closed above them, a section that grew) simply glide together.
  //  - A re-sort, where rows would cross: the rows that give way (the largest set moving by one same amount) glide together to make the place;
  //    the row that changed rank fades out where it was first (TASK_ROOM_MS) and fades in at its new place once it is free. At no frame do
  //    two rows share a place, and no row travels through another.
  useLayoutEffect(() => {
    const list = root.current; if (!list) return;
    const before = places.current, after = new Map<string, number>();
    const rows = Array.from(list.querySelectorAll<HTMLElement>('[data-key]'));
    rows.forEach(row => after.set(row.dataset.key!, row.offsetTop));
    places.current = after;
    // Not while it opens: the first reading sorts the list and brings the extensions in before anyone has seen another order.
    const glide = settled.current; settled.current = !!reading;
    if (reduced || !glide || !before.size) return;
    const moved = rows.map(row => ({ row, by: (before.get(row.dataset.key!) ?? NaN) - after.get(row.dataset.key!)! })).filter(item => item.by && typeof item.row.animate === 'function');
    if (!moved.length) return;
    const sets = new Map<number, typeof moved>(); for (const item of moved) sets.set(item.by, [...(sets.get(item.by) ?? []), item]);
    if (sets.size === 1) { for (const item of moved) item.row.animate([{ transform: `translateY(${item.by}px)` }, { transform: 'translateY(0)' }], { duration: TASK_GLIDE_MS, easing: CURVE }); return; }
    // the set that glides: the largest; of two equal ones, the one that moves the shorter way
    const body = [...sets.values()].reduce((best, set) => set.length > best.length || set.length === best.length && Math.abs(set[0].by) < Math.abs(best[0].by) ? set : best);
    const total = TASK_ROOM_MS + TASK_GLIDE_MS + TASK_SETTLE_MS, room = TASK_ROOM_MS / total, back = (TASK_ROOM_MS + TASK_GLIDE_MS * 0.8) / total;   // by then the rows that glide are within a fraction of a pixel of their places
    for (const item of moved) {
      const from = `translateY(${item.by}px)`;
      if (body.includes(item)) item.row.animate([{ transform: from, offset: 0 }, { transform: from, offset: room, easing: CURVE }, { transform: 'translateY(0)', offset: (TASK_ROOM_MS + TASK_GLIDE_MS) / total }, { transform: 'translateY(0)', offset: 1 }], { duration: total });
      else item.row.animate([{ transform: from, opacity: 1, offset: 0 }, { transform: from, opacity: 0, offset: room }, { transform: 'translateY(0)', opacity: 0, offset: room + 0.001 }, { transform: 'translateY(0)', opacity: 0, offset: back }, { transform: 'translateY(0)', opacity: 1, offset: 1 }], { duration: total, easing: 'linear' });
    }
  });
  // The keyboard never falls out of the pop-up: when the row it was on leaves by itself (its tab closed elsewhere), the pop-up takes it back.
  useLayoutEffect(() => { if (inside.current && document.activeElement === document.body) root.current?.closest<HTMLElement>('.browser-popup')?.focus({ preventScroll: true }); });
  const goTo = (id: string) => { dispatch({ type: 'tab.select', id }); close(); };
  /** Closing a row's tab: when the keyboard is on that row it first steps to the row that will take its place (the next one, else the one before). */
  const closeTab = (row: TabRow) => {
    const item = root.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(row.key)}"]`);
    if (item?.contains(document.activeElement)) { const items = Array.from(root.current?.querySelectorAll<HTMLElement>('.tm-item[data-kind="tab"]') ?? []), at = items.indexOf(item), next = items[at + 1] ?? items[at - 1]; (next?.querySelector<HTMLElement>('.tm-row') ?? root.current?.closest<HTMLElement>('.browser-popup'))?.focus({ preventScroll: true }); }
    void dispatch({ type: 'tab.close', id: row.id });
  };
  const keys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    const item = (event.target as HTMLElement).closest<HTMLElement>('.tm-item'); if (!item) return;
    const row = view.sections.flatMap(section => section.rows).find(candidate => candidate.key === item.dataset.key);
    if ((event.key === 'Delete' || event.key === 'Backspace') && row?.kind === 'tab') { event.preventDefault(); event.stopPropagation(); closeTab(row); return; }
    // Left and Right walk between the row and its buttons.
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      const stops = Array.from(item.querySelectorAll<HTMLElement>('.tm-row, .tm-act')).filter(stop => !stop.matches(':disabled')), at = stops.indexOf(document.activeElement as HTMLElement);
      const next = stops[at + (event.key === 'ArrowRight' ? 1 : -1)];
      if (at >= 0 && next) { event.preventDefault(); event.stopPropagation(); next.focus({ preventScroll: true }); }
      else if (at > 0 || event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); }
    }
  };
  const visible = new Set<string>([state.activeTabId, ...(state.windowUi?.split?.tabIds || [])]);
  const line = (row: TabRow): ReactNode => {
    const idle = formatIdle(row.idleMs, locale);
    const words = row.sharedWith ? t('taskmanager.sharedWith', { title: tabTitleOf(row.sharedWith) })
      : row.state === 'screen' ? t('taskmanager.state.screen') : row.state === 'problem' ? t(/stopped responding/i.test(row.tab.error || '') ? 'taskmanager.state.stopped' : 'taskmanager.state.failed')
      : row.state === 'sleeping' ? t('taskmanager.sleeping') : row.state === 'playing' ? t('taskmanager.state.playing') : row.state === 'pinned' ? t('taskmanager.state.pinned')
      : row.state === 'acira' ? t('taskmanager.partOfAcira') : idle ? t('taskmanager.state.backgroundFor', { time: idle }) : t('taskmanager.state.background');
    return <>{row.state === 'playing' && !row.sharedWith && <EditorGlyph name="Volume2" className="tm-live"/>}{words}{cpuShown(row.cpu) && <> · {t('taskmanager.cpu', { percent: formatCpu(row.cpu, locale) })}</>}{row.sharing > 0 && <> · {t('taskmanager.sharing', { count: row.sharing + 1 })}</>}</>;
  };
  const meter = (memoryKB: number | null) => <span className="tm-meter" aria-hidden="true" style={{ '--tm-share': `${(shareOf(memoryKB, view.peakKB) * 100).toFixed(1)}%` } as CSSProperties}/>;
  const memory = (kb: number) => formatMemory(kb, locale);
  const figure = (row: TabRow | ExtensionRow): ReactNode => {
    // A tab's figure sits over its meter (its weight against the heaviest tab); an extension's one-line row has the figure alone.
    if (row.memoryKB !== null && row.memoryKB > 0) return <span className="tm-fig"><Eased value={row.memoryKB} format={memory} reduced={reduced} className="tm-mem"/>{row.kind === 'tab' && meter(row.memoryKB)}</span>;
    if (row.kind === 'tab' && row.sharedWith) return <span className="tm-fig tm-fig-quiet" title={t('taskmanager.sharedWith', { title: tabTitleOf(row.sharedWith) })}><EditorGlyph name="ArrowUp" className="tm-glyph"/></span>;
    if (row.kind === 'tab' && row.state === 'sleeping') return <span className="tm-fig tm-fig-quiet"><EditorGlyph name="Moon" className="tm-glyph"/></span>;
    // An awake page whose memory the system does not report, and a page of Acira's own (it lives in Acira itself): no figure, never a made-up one.
    return <span className="tm-fig tm-fig-quiet">{row.kind === 'tab' && (row.state === 'acira' || !reading) ? '' : '–'}</span>;
  };
  // A press never moves the keyboard onto a button (it may leave with its row); a button used from the keyboard hands it back to its row first.
  const act = (label: string, glyph: 'Moon' | 'X', run: () => void, danger = false) => <button type="button" className="tm-act" data-danger={danger || undefined} aria-label={label} title={label} onMouseDown={event => event.preventDefault()} onClick={event => { if (document.activeElement === event.currentTarget) event.currentTarget.closest('.tm-item')?.querySelector<HTMLElement>('.tm-row')?.focus({ preventScroll: true }); run(); }}><EditorGlyph name={glyph} className="tm-glyph"/></button>;
  const tabRow = (row: TabRow) => {
    const tab = row.tab, title = tabTitleOf(tab);
    const canSleep = row.state !== 'sleeping' && row.state !== 'acira' && row.state !== 'problem' && !visible.has(tab.id) && row.state !== 'pinned' && !pinnedTab(state, tab) && !tab.privacy && /^https?:/i.test(tab.url);
    return <div className="tm-item" key={row.key} data-key={row.key} data-kind="tab" data-state={row.state} data-acts={canSleep ? 2 : 1}>
      <button type="button" className="acira-menu-row acira-menu-row-identity tm-row" onClick={() => goTo(tab.id)} title={`${title}\n${tab.url}`} aria-current={row.state === 'screen' ? 'true' : undefined}>
        <SiteIdentityIcon url={tab.url} favicon={tab.favicon || iconFor(tab.url)} privacy={tab.privacy === 'private' || tab.privacy === 'tor' ? tab.privacy : undefined} error={!!tab.error}/>
        <span className="acira-menu-title"><span className="tm-name">{title}</span><span className="acira-menu-sub">{line(row)}</span></span>
        {figure(row)}
      </button>
      <span className="tm-acts">{canSleep && act(t('tabsleep.menuTab'), 'Moon', () => void dispatch({ type: 'tab.sleep', tabIds: [tab.id] }))}{act(t('taskmanager.close'), 'X', () => closeTab(row), true)}</span>
    </div>;
  };
  const extensionRow = (row: ExtensionRow) => {
    const icon = icons.get(row.id);
    return <div className="tm-item" key={row.key} data-key={row.key} data-kind="extension">
      <div className="tm-row tm-static">{icon ? <img className="tm-ext-icon" src={icon} alt="" width={16} height={16} draggable={false}/> : <EditorGlyph name="extensions" className="acira-menu-icon"/>}<span className="acira-menu-title tm-ext-title"><span className="tm-name">{row.name}</span>{cpuShown(row.cpu) && <span className="tm-ext-cpu">{t('taskmanager.cpu', { percent: formatCpu(row.cpu, locale) })}</span>}</span>{figure(row)}</div>
    </div>;
  };
  const head = (section: TaskSection) => {
    const workspace = section.workspace, name = workspace ? workspaceName(workspace) : section.kind === 'extensions' ? t('taskmanager.legend.extensions') : t('taskmanager.legend.tabs');
    const color = workspace ? workspaceColorOf(state, workspace) : undefined;
    // (a head has a key too: when a row above it leaves, it glides up with the rows instead of jumping ahead of them)
    return <div className="tm-head" data-key={`head:${section.key}`} style={color ? { '--tm-ws': color } as CSSProperties : undefined}>
      <span className="tm-head-icon">{workspace ? <WorkspaceGlyph icon={workspaceIcon(workspace)}/> : <EditorGlyph name={section.kind === 'extensions' ? 'extensions' : 'tabs'}/>}</span>
      <span className="tm-head-name" id={`tm-${section.key}`}>{name}</span>
      {section.memoryKB > 0 ? <Eased value={section.memoryKB} format={memory} reduced={reduced} className="acira-menu-meta"/> : <span/>}
    </div>;
  };
  if (!reading && failed) return <section className="tm-panel" aria-label={t('taskmanager.title')}><div className="tm-row tm-static tm-note"><EditorGlyph name="Activity" className="acira-menu-icon"/><span className="acira-menu-title">{t('taskmanager.unavailable')}</span><span/></div></section>;
  // The rows are laid out from the window's tabs at once (the pop-up has its final height from its first frame) and shown with the first reading:
  // sorted, with their figures, never in one order and then another.
  return <section ref={root} className="tm-panel" aria-label={t('taskmanager.title')} aria-busy={!reading || undefined} data-wait={!reading || undefined} onKeyDown={keys} onFocusCapture={() => { inside.current = true; }} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) inside.current = false; }}>
    {/* The pop-up measures its height once the first reading is in (it arrives at once): no second size. */}
    {!reading && <span hidden data-popup-pending/>}
    {view.sections.map(section => <div key={section.key} className="tm-section" role="group" aria-labelledby={`tm-${section.key}`}>{head(section)}{section.rows.map(row => row.kind === 'tab' ? tabRow(row) : extensionRow(row))}</div>)}
    <div className="tm-section tm-own" role="group" aria-label={t('taskmanager.own')}>
      <div className="tm-item" data-key="own" data-kind="own">
        <button type="button" className="acira-menu-row acira-menu-row-identity tm-row" aria-expanded={open} onClick={() => setOpen(value => !value)}>
          <AciraSymbol size={16}/>
          <span className="acira-menu-title"><span className="tm-name tm-own-name">{t('taskmanager.own')}<Chevron/></span><span className="acira-menu-sub">{t('taskmanager.ownSub')}{cpuShown(view.own.cpu) && <> · {t('taskmanager.cpu', { percent: formatCpu(view.own.cpu, locale) })}</>}</span></span>
          {reading ? <span className="tm-fig"><Eased value={view.own.memoryKB} format={memory} reduced={reduced} className="tm-mem"/></span> : <span className="tm-fig"/>}
        </button>
      </div>
      {open && view.own.parts.map(part => <div className="tm-row tm-static tm-part" key={part.id} data-key={`part:${part.id}`}><span/><span className="acira-menu-title">{ownName(part.id)}</span><Eased value={part.memoryKB} format={memory} reduced={reduced} className="acira-menu-value"/></div>)}
    </div>
  </section>;
}
