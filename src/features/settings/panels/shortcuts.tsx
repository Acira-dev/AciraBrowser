import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Search, Undo2, X } from '../../../components/AppIcons';
import { runtime } from '../../../runtime/client';
import type { ShortcutCommand } from '../../../runtime/nativeCore';
import { isMac } from '../../../ui/platform';
import { reducedMotion, useListMotion, useSectionMotion } from '../../../ui/sharedMotion';
import { SettingNote } from '../controls';
import { native, readable } from '../nativeClient';
import type { SettingsPanel, SettingsPanelProps } from '../panels';
import { profilesAsSpaces } from '../../../runtime/workspaces';
import '../native-core.css';
import '../shortcuts.css';

import { t } from '../../../i18n';
import { commandGroup, commandLabel } from '../../../ui/shortcutKeys';
import {groupShortcutCommands} from '../../../ui/shortcutGroups';
/** Settings › Shortcuts. Every command is one row; its keys are the control. Click them (or Enter) and the row records in place:
 *  the key caps follow what you hold, Backspace clears, Esc cancels. A key another command uses asks in the row (Replace / Cancel);
 *  reserved keys are explained there and recording carries on. Main captures the keys (desktop/shortcut-registry.cjs), so nothing
 *  runs while recording. */

type Edit =
  | { id: string; state: 'recording'; held: string[]; refused?: { keys: string; reason: string }; tries: number }
  | { id: string; state: 'clash'; accelerator: string; owner: string };

const MAC_GLYPHS: Record<string, string> = { Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Cmd: '⌘' };
/** A Mac's delete key is Backspace (⌫); forward delete (fn+delete) is Delete (⌦). The caps show the key that runs the binding. */
const MAC_KEYS: Record<string, string> = { Backspace: '⌫', Delete: '⌦' };
// Key names stay as the keys are labelled, in every language (i18n-ignore).
const KEY_NAMES: Record<string, string> = { Left: '←', Right: '→', Up: '↑', Down: '↓', PageUp: 'Page Up', PageDown: 'Page Down', Delete: 'Del', Meta: 'Win', '=': '+' };
/** Recording ends by itself after this long without a key (main keeps its own limit in step). */
const IDLE_MS = 30_000;

/** One key cap per key: "Ctrl+Shift+T" → Ctrl · Shift · T (⌃ ⇧ T on Mac). */
export function keyCaps(accel: string): string[] {
  const mac = isMac();
  return accel.split('+').filter(Boolean).map((part) => (mac && (MAC_GLYPHS[part] || MAC_KEYS[part])) || KEY_NAMES[part] || part);
}
/** How keys read in text and tooltips: "Ctrl+Shift+T", "⌃⇧T" on Mac (the app's one spelling, ui/platform formatShortcut). */
const spoken = (accel: string) => keyCaps(accel).join(isMac() ? '' : '+');
const keyish = /\+|^(ctrl|alt|shift|cmd|win|f\d{1,2}|⌃|⌥|⇧|⌘)\b/i;
const squash = (text: string) => text.toLowerCase().replace(/[\s+]/g, '');

function matches(command: ShortcutCommand, query: string): boolean {
  if (!query) return true;
  if (`${command.label} ${command.category} ${commandGroup(command.bindings.length?command.category:'Unassigned')}`.toLowerCase().includes(query)) return true;
  // "ctrl+j", "ctrl j" or "f6" find the command on those keys.
  if (!keyish.test(query)) return false;
  const wanted = squash(query);
  return command.bindings.some((accel) => squash(accel).startsWith(wanted) || squash(keyCaps(accel).join('')).startsWith(wanted));
}

function Caps({ accel, parts }: { accel?: string; parts?: string[] }) {
  return <span className="sk-caps">{(parts ?? keyCaps(accel ?? '')).map((part, index) => <kbd key={index} className="sk-cap">{part}</kbd>)}</span>;
}

function Shortcuts({ state: browser }: SettingsPanelProps) {
  const spaces = profilesAsSpaces(browser);
  const [commands, setCommands] = useState<ShortcutCommand[]>([]);
  const [query, setQuery] = useState('');
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [error, setError] = useState('');
  const current = useRef<Edit | null>(null);
  current.current = edit;
  const idle = useRef(0);
  const groupsRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    native({ type: 'shortcuts.list' }).then((result) => setCommands((result.shortcuts?.commands ?? []).map((command) => ({ ...command, label: commandLabel(command.id, command.label, spaces) }))), (failure) => setError(readable(failure)));
  }, [spaces]);

  const finish = useCallback(() => {
    const was = current.current;
    current.current = null;
    setEdit(null);
    window.clearTimeout(idle.current);
    if (was?.state === 'recording') void native({ type: 'shortcuts.record-stop' }).catch(() => undefined);
  }, []);

  const keepAlive = useCallback(() => {
    window.clearTimeout(idle.current);
    idle.current = window.setTimeout(() => { if (current.current?.state === 'recording') finish(); }, IDLE_MS);
  }, [finish]);

  const begin = useCallback((id: string) => {
    setError('');
    const next: Edit = { id, state: 'recording', held: [], tries: 0 };
    current.current = next;
    setEdit(next);
    keepAlive();
    void native({ type: 'shortcuts.record-start' }).catch((failure) => { setError(readable(failure)); finish(); });
  }, [finish, keepAlive]);

  const assign = useCallback(async (id: string, accelerator: string, replace = false) => {
    try {
      const result = (await native({ type: 'shortcuts.set', id, accelerator, replace })).shortcuts;
      if (result?.ok) { finish(); load(); return; }
      if (result?.code === 'conflict' && result.conflict) { const next: Edit = { id, state: 'clash', accelerator, owner: commandLabel(result.conflict.id, result.conflict.label) }; current.current = next; setEdit(next); return; }
      // Refused after all (the registry changed under us): say why and listen again.
      const next: Edit = { id, state: 'recording', held: [], refused: { keys: accelerator, reason: result?.message ?? t('shortcuts.keysRefused') }, tries: Date.now() };
      current.current = next; setEdit(next);
      void native({ type: 'shortcuts.record-start' }).catch(() => undefined);
    } catch (failure) { finish(); setError(readable(failure)); }
  }, [finish, load]);

  const clear = useCallback((id: string) => {
    finish();
    void native({ type: 'shortcuts.clear', id }).then(load, (failure) => setError(readable(failure)));
  }, [finish, load]);

  useEffect(() => {
    load();
    const off = runtime.subscribeBrowser((event) => {
      if (event.type === 'shortcuts-changed') load();
      const editing = current.current;
      if (event.type !== 'shortcut-recorded' || editing?.state !== 'recording') return;
      keepAlive();
      if (event.pending) { const next: Edit = { ...editing, held: event.held ?? [] }; current.current = next; setEdit(next); return; }
      if (event.cancel) return finish();
      if (event.clear) return clear(editing.id);
      if (!event.valid || !event.accelerator) {
        const next: Edit = { ...editing, held: [], refused: { keys: event.accelerator ?? '', reason: event.reason ?? t('shortcuts.keysRefused') }, tries: editing.tries + 1 };
        current.current = next; setEdit(next); return;
      }
      if (event.conflict && event.conflict.id !== editing.id) { const next: Edit = { id: editing.id, state: 'clash', accelerator: event.accelerator, owner: commandLabel(event.conflict.id, event.conflict.label) }; current.current = next; setEdit(next); return; }
      void assign(editing.id, event.accelerator);
    });
    return () => {
      off();
      window.clearTimeout(idle.current);
      if (current.current?.state === 'recording') void native({ type: 'shortcuts.record-stop' }).catch(() => undefined);
    };
  }, [load, finish, clear, assign, keepAlive]);

  // Leaving the window, clicking elsewhere, or Esc on a clash ends the edit, so keys never stay captured behind your back.
  useEffect(() => {
    if (!edit) return;
    const away = () => finish();
    const outside = (event: PointerEvent) => { if (!(event.target as Element | null)?.closest?.(`[data-shortcut="${CSS.escape(edit.id)}"]`)) finish(); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && current.current?.state === 'clash') { event.preventDefault(); finish(); } };
    window.addEventListener('blur', away);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    return () => { window.removeEventListener('blur', away); document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escape, true); };
  }, [edit?.id, finish]);

  const run = (request: Parameters<typeof native>[0]) => native(request).then(() => load(), (failure) => setError(readable(failure)));
  const changed = commands.filter((command) => command.customized).length;
  useEffect(() => { if (!changed) setOnlyChanged(false); }, [changed]);

  const visible = useMemo(() => {
    const wanted = query.trim().toLowerCase();
    const groups = groupShortcutCommands(commands,command=>(!onlyChanged||command.customized)&&matches(command,wanted));
    // The Extensions group is always there to be found (and to be jumped to from Settings › Extensions and the extensions menu): empty, it says so.
    if (!wanted && !onlyChanged && commands.length && !groups.some(([name]) => name === 'Extensions')) {
      const at = groups.findIndex(([name]) => name === 'Tab sets' || name === 'Unassigned');
      groups.splice(at < 0 ? groups.length : at, 0, ['Extensions', []]);
    }
    return groups;
  }, [commands, query, onlyChanged]);
  useListMotion(groupsRef, visible.map(([name]) => name).join('|'));

  return (
    <div className="sk-editor">
      <div className="sk-toolbar" data-setting="shortcuts-editor">
        <label className="sk-search">
          <Search size={16} />
          <input type="search" aria-label={t("shortcuts.searchShortcuts")} placeholder={t("shortcuts.searchCommandsOrKeys")} spellCheck={false} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape' && query) { event.preventDefault(); setQuery(''); } }} />
          {query && <button type="button" className="st-search-clear" aria-label={t("shortcuts.clearSearch")} onClick={() => setQuery('')}><X size={14} /></button>}
        </label>
        {changed > 0 && <button type="button" className="sk-chip" aria-pressed={onlyChanged} onClick={() => setOnlyChanged((value) => !value)}>{t("shortcuts.changed")} <span className="tabular">{changed}</span></button>}
        <button type="button" className="st-button" disabled={!changed} onClick={() => void run({ type: 'shortcuts.reset-all' })}>{t("shortcuts.resetAll")}</button>
        <button type="button" className="st-button" onClick={() => void native({ type: 'shortcuts.export' }).then((result) => runtime.exportData('acira-shortcuts.json', result.shortcuts?.json ?? '{}'), (failure) => setError(readable(failure)))}>{t("shortcuts.export")}</button>
      </div>
      {error && <p className="sk-error" role="alert">{error}</p>}
      <div ref={groupsRef} className="sk-groups">
        {visible.map(([category, list]) => (
          <ShortcutGroup key={category} title={category} id={category === 'Extensions' ? 'shortcuts-extensions' : undefined} signature={list.map((command) => command.id).join('|')}>
            {list.length === 0 && category === 'Extensions' && <div className="st-row"><div className="st-copy"><p>{t("shortcuts.noExtensionShortcuts")}</p></div></div>}
            {list.map((command) => (
              <ShortcutRow key={command.id} command={command} edit={edit?.id === command.id ? edit : null}
                onBegin={() => { if (current.current?.id !== command.id || current.current.state === 'clash') begin(command.id); }}
                onReset={() => void run({ type: 'shortcuts.reset', id: command.id })}
                onReplace={(accelerator) => void assign(command.id, accelerator, true)}
                onCancel={finish} />
            ))}
          </ShortcutGroup>
        ))}
      </div>
      {visible.length === 0 && commands.length > 0 && <p className="sk-empty">{onlyChanged && !query ? t("shortcuts.noChangedShortcuts") : t("shortcuts.noShortcutMatches", { query: query.trim() })}</p>}
      <SettingNote>{t("shortcuts.systemKeysNote", { keys: isMac() ? t("shortcuts.cmdCtrlOrOption") : t("shortcuts.ctrlOrAlt") })}</SettingNote>
    </div>
  );
}

/** A category. Its rows move on A's list motion as a search narrows; the groups themselves come and go on the same motion. */
function ShortcutGroup({ title, signature, id, children }: { title: string; signature: string; id?: string; children: ReactNode }) {
  const heading = useId();
  const body = useRef<HTMLDivElement>(null);
  useListMotion(body, signature);
  return (
    <section className="st-group sk-group" aria-labelledby={heading} data-setting={id}>
      <h2 id={heading}>{commandGroup(title)}</h2>
      <div ref={body} className="st-group-body">{children}</div>
    </section>
  );
}

function ShortcutRow({ command, edit, onBegin, onReset, onReplace, onCancel }: { command: ShortcutCommand; edit: Edit | null; onBegin: () => void; onReset: () => void; onReplace: (accelerator: string) => void; onCancel: () => void }) {
  const state = edit?.state ?? 'idle';
  const noteId = useId();
  const field = useRef<HTMLButtonElement>(null);
  const note = useRef<HTMLDivElement>(null);
  const replace = useRef<HTMLButtonElement>(null);
  const refused = edit?.state === 'recording' ? edit.refused : undefined;
  // The note under the keys settles in when it changes (A's section motion); a refused key nudges the field.
  useSectionMotion(note, edit ? (edit.state === 'clash' ? `clash:${edit.accelerator}` : refused ? `refused:${edit.tries}` : 'recording') : 'idle');
  useLayoutEffect(() => {
    if (!refused || reducedMotion()) return;
    field.current?.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(3px)' }, { transform: 'translateX(-1px)' }, { transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.16,1,.3,1)' });
  }, [edit?.state === 'recording' ? edit.tries : -1]);
  useEffect(() => { if (state === 'clash') replace.current?.focus({ preventScroll: true }); else if (state === 'recording') field.current?.focus({ preventScroll: true }); }, [state]);

  const [first, ...more] = command.bindings;
  const keysLabel = first ? command.bindings.map(spoken).join(', ') : t("shortcuts.notSet");
  const mac = isMac();
  return (
    <div className="st-row sk-row" data-setting={`shortcut-${command.id}`} data-shortcut={command.id} data-state={state} data-changed={command.customized || undefined}>
      <div className="st-copy">
        <span className="st-title">{command.label}</span>
        {command.customized && <p>{t("shortcuts.defaultKeys", { keys: command.defaults.length ? command.defaults.map(spoken).join(', ') : t("shortcuts.none") })}</p>}
      </div>
      <div className="sk-control">
        {command.customized && state === 'idle' && (
          <button type="button" className="sk-reset" aria-label={t("shortcuts.resetCommand", { command: command.label })} title={command.defaults.length ? t("shortcuts.resetTo", { keys: spoken(command.defaults[0]) }) : t("shortcuts.resetToNoShortcut")} onClick={onReset}><Undo2 size={14} /></button>
        )}
        <button ref={field} type="button" className="sk-keys" data-state={state} aria-label={t("shortcuts.changeKeysFor", { command: command.label, keys: keysLabel })} aria-describedby={state === 'idle' ? undefined : noteId} onClick={onBegin}>
          {edit?.state === 'recording' ? (
            <span className="sk-field" data-bad={refused && !edit.held.length ? true : undefined}>
              {edit.held.length ? <Caps parts={edit.held.map((key) => (mac && MAC_GLYPHS[key]) || KEY_NAMES[key] || key)} /> : refused?.keys ? <Caps accel={refused.keys} /> : <span className="sk-placeholder">{t("shortcuts.pressKeys")}</span>}
              <i className="sk-caret" aria-hidden="true" />
            </span>
          ) : edit?.state === 'clash' ? (
            <span className="sk-field" data-clash><Caps accel={edit.accelerator} /></span>
          ) : first ? (
            <>
              <Caps accel={first} />
              {more.length > 0 && <span className="sk-more" title={t("shortcuts.alsoKeys", { keys: more.map(spoken).join(', ') })}>+{more.length}</span>}
            </>
          ) : <span className="sk-unset">{t("shortcuts.notSet")}</span>}
        </button>
      </div>
      {edit && (
        <div ref={note} id={noteId} className="sk-note" data-tone={edit.state === 'clash' ? 'clash' : refused ? 'bad' : undefined} role={refused || edit.state === 'clash' ? 'alert' : 'status'}>
          {edit.state === 'clash' ? (
            <>
              <span>{t("shortcuts.alreadyUsed", { owner: edit.owner })}</span>
              <span className="sk-note-actions">
                <button ref={replace} type="button" className="st-button primary" onClick={() => onReplace(edit.accelerator)}>{t("shortcuts.replace3")}</button>
                <button type="button" className="st-button" onClick={onCancel}>{t("dialog.cancel")}</button>
              </span>
            </>
          ) : refused ? <span>{refused.reason}</span> : (
            <span><KeySentence text={t("shortcuts.recordHint")} keys={{ clear: mac ? '⌫' : t("shortcuts.backspace"), cancel: t("app.esc") }} /></span>
          )}
        </div>
      )}
    </div>
  );
}

/** A catalog sentence with key caps where its {placeholders} are, so each language keeps its own word order. */
function KeySentence({ text, keys }: { text: string; keys: Record<string, string> }) {
  return <>{text.split(/(\{\w+\})/).map((part, index) => { const name = /^\{(\w+)\}$/.exec(part)?.[1]; return name && keys[name] ? <kbd key={index} className="sk-cap">{keys[name]}</kbd> : part; })}</>;
}

const panel: SettingsPanel = { section: 'Shortcuts', icon: 'keyboard', order: 60, Component: Shortcuts };
export default panel;
