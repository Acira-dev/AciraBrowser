import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Check } from '../../components/AppIcons';
import '../../components/PanelParts.css';
import { securedRequest } from './securedClient';
import { Segmented } from '../../components/Segmented';
import { WorkspaceGlyph, isGlyphId, workspaceIcon } from '../../components/WorkspaceGlyph';
import { MAX_WORKSPACES, WORKSPACE_COLOR_NAMES, WORKSPACE_COLORS, WORKSPACE_GLYPHS, WORKSPACE_NAME_MAX, activeWorkspaceOf, cleanWorkspaceName, validWorkspaceIcon, windowWorkspaces } from '../../runtime/workspaces';
import type { BrowserAction, BrowserSnapshot } from '../../runtime/types';
import { openSettings } from '../../ui/settingsView';
import { takeWorkspaceTarget } from '../../ui/workspaceTarget';
import { shownColor, shownName, workspaceKey } from './WorkspaceSwitcher';
import { suggestedGlyph } from './workspaceIcons';
import '../library.css';
import '../../styles/workspaces.css';
import { t } from '../../i18n';

const colorName: Record<typeof WORKSPACE_COLOR_NAMES[number], () => string> = {
  blue: () => t('workspaces.colorBlue'), purple: () => t('workspaces.colorPurple'), pink: () => t('workspaces.colorPink'), red: () => t('workspaces.colorRed'), orange: () => t('workspaces.colorOrange'),
  yellow: () => t('workspaces.colorYellow'), green: () => t('workspaces.colorGreen'), cyan: () => t('workspaces.colorCyan'), grey: () => t('workspaces.colorGrey'),
};
/** The colours as stored (lower case). */
const SWATCHES = WORKSPACE_COLORS.map(value => value.toLowerCase());
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const lastLetter = (text: string): string | undefined => [...segmenter.segment(text)].at(-1)?.segment;
/** What a new workspace starts with, said as outcomes (R4-48 P0-5): a new tab, the tab on screen (and its split), or every tab here. */
export type Start = 'empty' | 'current' | 'move';

/** Arrow keys walk a grid of choices (focus only: a choice applies on click, Enter or Space), as the finish swatches do. */
function walk(event: KeyboardEvent<HTMLElement>, columns: number) {
  const key = event.key, cells = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-cell]')], at = cells.indexOf(document.activeElement as HTMLElement);
  const step = key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : key === 'ArrowDown' ? columns : key === 'ArrowUp' ? -columns : key === 'Home' ? -at : key === 'End' ? cells.length : 0;
  if (!step || at < 0 || event.target instanceof HTMLInputElement && (key === 'ArrowLeft' || key === 'ArrowRight')) return;
  event.preventDefault(); event.stopPropagation();
  cells[Math.max(0, Math.min(cells.length - 1, at + step))]?.focus();
}

/**
 * The new-workspace and edit-workspace form (R3-57, R4-48): one small glass popover on the Edit favorite form's look. A live
 * preview on top (the icon, the name, the key that will open it), then Name, Icon (sixteen glyphs of the icon family and one
 * cell for a single letter or emoji), Color (the tab group colours, or none), and, for a new workspace, what it starts with,
 * worded as outcomes, with a live line saying where the other tabs stay, and one line on scope: sign-ins are the profile's.
 * The icon follows the name while the person has not picked one ("Study" takes the book); the colour skips the profile's
 * and the other workspaces' colours. Enter creates or saves; Esc leaves everything as it was.
 */
export function WorkspaceEditor({ state, dispatch, close }: { state: BrowserSnapshot; dispatch: (action: BrowserAction) => void; close: () => void }) {
  const [target] = useState(takeWorkspaceTarget), list = windowWorkspaces(state);
  const editing = target?.mode === 'edit' ? list.find(item => item.id === target.workspaceId) : undefined, adding = !editing;
  const taken = useMemo(() => new Set(list.map(item => workspaceIcon(item))), [list]);
  const firstFree = WORKSPACE_GLYPHS.find(glyph => !taken.has(glyph)) ?? 'workspace';
  const profile = state.browserProfiles.find(item => item.id === state.activeBrowserProfileId);
  const [name, setName] = useState(editing ? shownName(editing) : '');
  const [icon, setIcon] = useState(editing ? workspaceIcon(editing) : firstFree), picked = useRef(!!editing);
  const [color, setColor] = useState<string | null>(() => {
    if (editing) return editing.color ?? null;
    const worn = new Set([...list.map(item => shownColor(state, item)), profile?.color?.toLowerCase()].filter(Boolean));
    return SWATCHES.find(candidate => !worn.has(candidate)) ?? null;
  });
  const [locked, setLocked] = useState(false);
  const [start, setStart] = useState<Start>(target?.mode === 'new' && target.start === 'current' ? 'current' : 'empty');
  const field = useRef<HTMLInputElement>(null), form = useRef<HTMLFormElement>(null);
  const full = adding && list.length >= MAX_WORKSPACES, from = activeWorkspaceOf(state) ?? list[0], fromName = from ? shownName(from) : '', fromKey = from ? workspaceKey(list.indexOf(from)) ?? '' : '';
  const count = state.tabs.length, moving = target?.mode === 'new' && target.tabId ? target.tabId : state.activeTabId;
  useLayoutEffect(() => {
    if (target?.mode === 'edit' && target.focus === 'icon') form.current?.querySelector<HTMLElement>('[data-grid=icon] [aria-checked=true]')?.focus({ preventScroll: true });
    else { field.current?.focus({ preventScroll: true }); field.current?.select(); }
  }, []);// eslint-disable-line react-hooks/exhaustive-deps
  const clean = cleanWorkspaceName(name), clash = list.some(item => item.id !== editing?.id && shownName(item).toLowerCase() === clean.toLowerCase());
  const error = clash ? t('runtime.workspaceNameTaken', { name: clean }) : full ? t('runtime.workspaceLimit', { count: MAX_WORKSPACES }) : '';
  const index = editing ? list.indexOf(editing) : list.length, key = workspaceKey(index);
  const submit = () => {
    if (!clean || error) return;
    if (editing) {
      const patch: { name?: string; icon?: string; color?: string | null } = {};
      if (clean !== shownName(editing)) patch.name = clean;
      if (icon !== workspaceIcon(editing)) patch.icon = icon;
      if ((color ?? null) !== (editing.color ?? null)) patch.color = color;
      if (Object.keys(patch).length) dispatch({ type: 'workspace.update', id: editing.id, patch });
    } else {
      const id = `workspace-${crypto.randomUUID()}`;
      dispatch({ type: 'workspace.create', id, name: clean, icon, ...(color ? { color } : {}), tabs: start, ...(start === 'current' && moving ? { tabId: moving } : {}) });
      // R3-38: Windows verifies the person once (so nobody locks themselves out); main waits for the new workspace to exist.
      if (locked) void securedRequest({ type: 'enable', id });
    }
    close();
  };
  const choose = (glyph: string) => { picked.current = true; setIcon(glyph); };
  const rename = (value: string) => {
    setName(value);
    // The icon follows the name until the person picks one: "Study" takes the book, "Work" the bag.
    if (!picked.current) setIcon(suggestedGlyph(value) ?? firstFree);
  };
  const typed = (value: string) => { const next = lastLetter(value); picked.current = !!value; if (next && validWorkspaceIcon(next)) setIcon(next); else if (!value) setIcon(suggestedGlyph(name) ?? firstFree); };
  const options: [Start, string][] = [['empty', t('workspaces.startNewTab')], ['current', t('workspaces.startThisTab')], ['move', t('workspaces.startAll', { count })]];
  const note = start === 'empty' ? t('workspaces.noteStay', { count, name: fromName, key: fromKey })
    : start === 'current' ? t('workspaces.noteThis', { count: Math.max(0, count - 1), name: fromName, key: fromKey })
    : t('workspaces.noteAll', { count, name: fromName });
  return <form ref={form} className="bm-edit ws-edit" aria-label={adding ? t('workspaces.newTitle') : t('workspaces.editTitle')} onSubmit={event => { event.preventDefault(); submit(); }}
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); close(); } }}>
    <header className="bm-edit-head ws-edit-head">
      <span className="ws-edit-preview" data-colored={color ? '' : undefined} style={color ? { '--ws-color': color } as CSSProperties : undefined}><WorkspaceGlyph icon={icon} />{color && <i className="sb-ws-rail" aria-hidden="true" />}</span>
      <div><strong>{clean || t('workspaces.newTitle')}</strong>{key && <small>{key}</small>}</div>
    </header>
    <label className="bm-edit-label" htmlFor="ws-edit-name">{t('workspaces.name')}</label>
    <input id="ws-edit-name" ref={field} className="bm-edit-input" value={name} maxLength={WORKSPACE_NAME_MAX} placeholder={t('workspaces.namePlaceholder')} autoComplete="off" spellCheck={false}
      aria-invalid={!!error || undefined} aria-describedby={error ? 'ws-edit-error' : undefined} onChange={event => rename(event.target.value)} />
    {error && <p id="ws-edit-error" className="ws-edit-error" role="alert">{error}</p>}
    <span className="bm-edit-label" id="ws-edit-icon">{t('workspaces.icon')}</span>
    <div className="ws-grid" data-grid="icon" role="radiogroup" aria-labelledby="ws-edit-icon" onKeyDown={event => walk(event, 8)}>
      {WORKSPACE_GLYPHS.map(glyph => <button key={glyph} type="button" role="radio" aria-checked={icon === glyph} data-cell tabIndex={icon === glyph || !isGlyphId(icon) && glyph === WORKSPACE_GLYPHS[0] ? 0 : -1} className="ws-cell" onClick={() => choose(glyph)}><WorkspaceGlyph icon={glyph} /></button>)}
      <label className="ws-cell ws-cell-char" data-selected={!isGlyphId(icon) ? '' : undefined} title={t('workspaces.letterOrEmoji')}>
        <input data-cell aria-label={t('workspaces.letterOrEmoji')} value={isGlyphId(icon) ? '' : icon} placeholder={t('workspaces.letterOrEmoji')} autoComplete="off" spellCheck={false} onChange={event => typed(event.target.value)} onFocus={event => event.currentTarget.select()} />
      </label>
    </div>
    <span className="bm-edit-label" id="ws-edit-color">{t('workspaces.color')}</span>
    <div className="ws-swatches" data-grid="color" role="radiogroup" aria-labelledby="ws-edit-color" onKeyDown={event => walk(event, 1)}>
      <button type="button" role="radio" aria-checked={color === null} data-cell tabIndex={color === null ? 0 : -1} className="ws-swatch ws-swatch-none" aria-label={t('workspaces.colorNone')} title={t('workspaces.colorNone')} onClick={() => setColor(null)}><i aria-hidden="true" /></button>
      {WORKSPACE_COLOR_NAMES.map((swatch, at) => { const value = SWATCHES[at], on = color === value;
        return <button key={swatch} type="button" role="radio" aria-checked={on} data-cell tabIndex={on ? 0 : -1} className="ws-swatch" style={{ '--ws-color': value } as CSSProperties} aria-label={colorName[swatch]()} title={colorName[swatch]()} onClick={() => setColor(value)}>{on && <Check size={12} />}</button>; })}
    </div>
    {adding && <>
      <span className="bm-edit-label" id="ws-edit-start">{t('workspaces.startWith')}</span>
      <Segmented label={t('workspaces.startWith')} value={start} options={options} onChange={setStart} />
      <p className="ws-edit-note" aria-live="polite">{note}</p>
      <div className="ws-edit-lock"><span><strong>{t('workspaces.lockThis')} <span className="ws-beta">{t('workspaces.beta')}</span></strong><small>{t('workspaces.editorLockNote')}</small></span><button type="button" role="switch" className="shields-switch" aria-label={t('workspaces.lockThis')} aria-checked={locked} onClick={() => setLocked(value => !value)}><span aria-hidden="true" /></button></div>
      <p className="ws-edit-scope">{t('workspaces.scopeNote', { profile: profile?.name ?? '' })} <button type="button" className="ws-edit-link" onClick={() => { openSettings(state, dispatch, { section: 'Profiles' }); close(); }}>{t('workspaces.scopeLink')}</button></p>
    </>}
    <hr className="acira-sep" />
    <div className="bm-edit-actions"><button type="button" className="acira-button" onClick={close}>{t('dialog.cancel')}</button><button type="submit" className="acira-button acira-button-primary" disabled={!clean || !!error}>{adding ? t('workspaces.create') : t('workspaces.save')}</button></div>
  </form>;
}
