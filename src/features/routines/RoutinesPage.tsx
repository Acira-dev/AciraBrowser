import { useCallback, useEffect, useRef, useState } from 'react';
import { DotMatrix } from '../../components/DotMatrix';
import type { BrowserAction, BrowserSnapshot } from '../../runtime/types';
import { formatShortcut } from '../../ui/platform';
import { LibraryEmpty, LibraryPage } from '../Library';
import { SiteMark } from '../rewind/RewindPage';
import { commandLabels, example, exportFile, host, routines, routinesAvailable, type Color, type Library, type Recipe, type RoutineRow, type Run, type Step } from './client';
import '../rewind/rewind.css';
import './routines.css';

import { t } from '../../i18n';
const COLORS: Color[] = ['none', 'grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];
const RATIOS = [{ value: .5, label: t("routinespage.halfAndHalf") }, { value: .6, label: t("routinespage.leftWider") }, { value: .4, label: t("routinespage.rightWider") }];
const blank = (): Recipe => ({ format: 'acira-routine', version: 1, name: 'New routine', steps: [{ id: 'step1', command: 'tabs.open', args: { reuse: 'exact-url-in-workspace', items: [{ ref: 'tab1', url: 'https://' }] } }] });
const nextId = (taken: string[], prefix: string) => { let n = 1; while (taken.includes(`${prefix}${n}`)) n++; return `${prefix}${n}`; };
const accelerator = (e: { ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean; key: string; code: string }) => {
  if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'].includes(e.key)) return '';
  const key = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3) : /^Digit\d$/.test(e.code) ? e.code.slice(5) : /^F\d{1,2}$/.test(e.key) ? e.key : e.key.length === 1 ? e.key.toUpperCase() : e.key;
  return [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Meta', key].filter(Boolean).join('+');
};
const refsBefore = (recipe: Recipe, index: number) => recipe.steps.slice(0, index).flatMap(s => s.command === 'tabs.open' ? s.args.items : []);
const Kbd = ({ keys }: { keys: string }) => <kbd>{formatShortcut(keys)}</kbd>;
const Icon = ({ d }: { d: string }) => <svg viewBox="0 0 16 16" aria-hidden><path d={d}/></svg>;
/** What a routine does, in plain words: "Opens 3 sites, groups them, turns on focus mode". */
export function routinePlainWords(commands: Step['command'][], sites: number) {
  const parts: string[] = [];
  if (commands.includes('tabs.open')) parts.push(`opens ${sites} ${sites === 1 ? 'site' : 'sites'}`);
  if (commands.includes('tabs.group')) parts.push('groups them');
  if (commands.includes('layout.split')) parts.push('splits two side by side');
  if (commands.includes('layout.focus')) parts.push('sets focus mode');
  const text = parts.join(', ');return text ? text[0].toUpperCase() + text.slice(1) : 'No steps yet';
}

/** Routines (ROUTINES_SPEC §2, bible §3–5): the library on the left, the editor or the import review on the right. */
export function RoutinesPage({ state, dispatch }: { state: BrowserSnapshot; dispatch: (action: BrowserAction) => unknown }) {
  const isPrivate = Boolean(state.browserProfiles.find(p => p.id === state.activeBrowserProfileId)?.private);
  const [library, setLibrary] = useState<Library | null>(null), [error, setError] = useState('');
  const [selected, setSelected] = useState<string>(''), [draft, setDraft] = useState<Recipe | null>(null), [profileId, setProfileId] = useState('');
  const [errors, setErrors] = useState<string[]>([]), [run, setRun] = useState<Run | null>(null), [dirty, setDirty] = useState(false);
  const [shortcut, setShortcut] = useState(''), [confirmDelete, setConfirmDelete] = useState(false), [review, setReview] = useState<{ text: string; recipe?: Recipe; domains?: string[]; errors?: string[] } | null>(null), [paste, setPaste] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => { if (!routinesAvailable()) { setError('Tab sets need the desktop browser.'); return; } try { setLibrary(await routines({ type: 'routines.list' })); } catch (failure) { setError(failure instanceof Error ? failure.message : 'Routines could not be read.'); } }, []);
  useEffect(() => { void load(); }, [load]);
  const open = async (id: string) => { setSelected(id); setReview(null); setErrors([]); setRun(null); setDirty(false); setConfirmDelete(false); const { routine } = await routines<{ routine: { recipe: Recipe; profileId: string; shortcut?: string } }>({ type: 'routines.get', id }); setDraft(routine.recipe); setProfileId(routine.profileId); setShortcut(routine.shortcut ?? ''); };
  const setRoutineShortcut = async (accel: string | null) => { if (!selected) return; const result = await routines<{ ok: boolean; shortcut?: string; errors?: string[] }>({ type: 'routines.shortcut', id: selected, accelerator: accel }); if (result.ok) { setShortcut(result.shortcut ?? ''); setErrors([]); void load(); } else setErrors(result.errors ?? []); };
  const create = (recipe = blank()) => { setShortcut(''); setSelected(''); setReview(null); setErrors([]); setRun(null); setConfirmDelete(false); setDraft(structuredClone(recipe)); setProfileId(state.activeBrowserProfileId); setDirty(true); };
  const edit = (change: (recipe: Recipe) => void) => setDraft(previous => { if (!previous) return previous; const next = structuredClone(previous); change(next); setDirty(true); setErrors([]); return next; });
  const save = async () => { if (!draft) return null; const result = await routines<{ ok: boolean; id?: string; errors?: string[] }>({ type: 'routines.save', ...(selected ? { id: selected } : {}), recipe: draft, profileId }); if (!result.ok) { setErrors(result.errors ?? []); return null; } setSelected(result.id!); setDirty(false); await load(); return result.id!; };
  const start = async () => { const id = dirty || !selected ? await save() : selected; if (!id) return; setRun({ status: 'running', total: draft?.steps.length ?? 0, completed: [], message: '' }); const { run: outcome } = await routines<{ run: Run }>({ type: 'routines.run', id }); setRun(outcome); void load(); };
  const stop = async () => { const { run: outcome } = await routines<{ run: Run | null }>({ type: 'routines.stop' }); if (outcome) setRun(outcome); };
  const remove = async () => { if (!selected) { setDraft(null); return; } await routines({ type: 'routines.delete', id: selected }); setSelected(''); setDraft(null); await load(); };
  const exportIt = async () => { if (!selected) return; const out = await routines<{ name: string; json: string }>({ type: 'routines.export', id: selected }); exportFile(out.name, out.json); };
  const previewText = async (text: string) => { const result = await routines<{ ok: boolean; recipe?: Recipe; domains?: string[]; errors?: string[] }>({ type: 'routines.preview', text }); setReview({ text, ...result }); setPaste(open => open && !result.ok); setProfileId(state.activeBrowserProfileId); };
  const addImported = async () => { if (!review?.recipe) return; const result = await routines<{ ok: boolean; id?: string; errors?: string[] }>({ type: 'routines.import', text: review.text, profileId }); if (!result.ok) { setReview({ ...review, errors: result.errors }); return; } await load(); setReview(null); await open(result.id!); };
  const profileName = (id: string) => library?.profiles.find(p => p.id === id)?.name ?? 'Choose a profile';
  const startImport = () => file.current?.click(), startPaste = () => { setPaste(true); setReview({ text: '' }); };

  // The Library page frame (Library.tsx): same column, heading and actions as History, Bookmarks and Downloads.
  const lead = { title: t("app.tabSets"), description: t("routinespage.aSavedSetOfTabs") };
  const actions = !isPrivate && library ? <>
    <button type="button" className="acira-button acira-button-secondary" onClick={startImport}>{t("pwp.importBtn")}</button>
    <button type="button" className="acira-button acira-button-secondary" onClick={startPaste}>{t("routinespage.paste")}</button>
    <button type="button" className="acira-button acira-button-primary" onClick={() => create()}>{t("routinespage.newRoutine")}</button>
    <input ref={file} type="file" accept=".json,application/json" hidden onChange={async e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { if (f.size > 65536) { setReview({ text: '', errors: ['This routine is larger than 64 KB.'] }); return; } await previewText(await f.text()); } }}/>
  </> : undefined;
  if (isPrivate) return <LibraryPage {...lead}><div className="rw-page"><LibraryEmpty title={t("routinespage.tabSetsArenTAvailable")} text="Open an ordinary window to use saved tab sets."/></div></LibraryPage>;
  return <LibraryPage {...lead} actions={actions}><div className="rw-page rt-page">
    {error ? <p className="rw-message" role="alert">{error}</p> : !library ? null :
      !library.routines.length && !draft && !review ? <LibraryEmpty title={t("routinespage.noRoutinesYet")} text="A routine opens your usual tabs, groups them and arranges the window in one step — from here, the command bar or its own shortcut." hint={<>{t("routinespage.runAnyRoutineWith")} <Kbd keys="Ctrl Shift K"/></>}><button type="button" className="acira-button acira-button-secondary" onClick={() => create(example)}>{t("routinespage.startFromAnExample")}</button></LibraryEmpty> :
      <div className="rw-body">
        <section className="rw-timeline" aria-label={t("routinespage.yourRoutines")}>
          <div className="rw-days" role="listbox" aria-label={t("routinespage.yourRoutines")}>
            {library.routines.map(item => <RoutineItem key={item.id} item={item} selected={item.id === selected} profile={profileName(item.profileId)} onOpen={() => void open(item.id)}/>)}
            {!library.routines.length && <p className="rw-note">{t("routinespage.yourNewRoutineAppearsHere")}</p>}
          </div>
        </section>
        <section className="rw-detail rt-editor" aria-label={review ? t("routinespage.reviewRoutine") : t("routinespage.editRoutine")}>
          {review ? <ImportReview review={review} paste={paste} profiles={library.profiles} profileId={profileId} setProfileId={setProfileId} onPreview={previewText} onCancel={() => { setReview(null); setPaste(false); }} onAdd={addImported}/>
            : !draft ? <p className="rw-note">{t("routinespage.chooseARoutineOrMake")}</p>
            : <>
              <input className="rt-name" aria-label={t("routinespage.routineName")} value={draft.name} maxLength={80} onChange={e => edit(r => { r.name = e.target.value; })}/>
              <dl className="rt-facts">
                <div><dt>{t("routinespage.runs")}</dt><dd>{shortcut ? <>{t("routinespage.whenYouPress")} <Kbd keys={shortcut}/>{t("routinespage.orFromHereAndThe")}</> : <>{t("routinespage.fromHereOrTheCommand")} <Kbd keys="Ctrl Shift K"/></>}</dd></div>
                <div><dt>{t("routinespage.opensIn")}</dt><dd><select className="rt-select" value={profileId} onChange={e => { setProfileId(e.target.value); setDirty(true); }}>{!library.profiles.some(p => p.id === profileId) && <option value="">{t("routinespage.chooseAProfile")}</option>}{library.profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></dd></div>
                <div><dt>{t("se.colShortcut")}</dt><dd>{selected ? <span className="rt-shortcut"><input className="rt-keys" readOnly value={shortcut ? formatShortcut(shortcut) : ''} placeholder={t("routinespage.pressAKeyCombination")} aria-label={t("routinespage.shortcutPressAKeyCombination")} onKeyDown={e => { if (e.key === 'Tab') return; e.preventDefault(); if (e.key === 'Escape') return; if (e.key === 'Backspace' || e.key === 'Delete') { void setRoutineShortcut(null); return; } const accel = accelerator(e); if (accel) void setRoutineShortcut(accel); }}/>{shortcut && <button type="button" className="rw-link" onClick={() => void setRoutineShortcut(null)}>{t("bm.clear")}</button>}</span> : <span className="rt-quiet">{t("routinespage.saveTheRoutineToGive")}</span>}</dd></div>
              </dl>
              <ol className="rt-steps">
                {draft.steps.map((step, index) => <li key={step.id} className="rt-step">
                  <div className="rt-step-head"><span className="tabular rt-step-n">{index + 1}</span><span className="rt-step-title">{commandLabels[step.command]}</span><span className="rt-step-sum">{summary(step)}</span>
                    <span className="rt-step-tools">
                      <button type="button" className="rt-icon" disabled={index === 0} aria-label={t("routinespage.moveStepValueUp", { value: index + 1 })} title={t("routinespage.moveUp")} onClick={() => edit(r => { [r.steps[index - 1], r.steps[index]] = [r.steps[index], r.steps[index - 1]]; })}><Icon d="M8 12.5v-9M4.5 7L8 3.5 11.5 7"/></button>
                      <button type="button" className="rt-icon" disabled={index === draft.steps.length - 1} aria-label={t("routinespage.moveStepValueDown", { value: index + 1 })} title={t("routinespage.moveDown")} onClick={() => edit(r => { [r.steps[index + 1], r.steps[index]] = [r.steps[index], r.steps[index + 1]]; })}><Icon d="M8 3.5v9M4.5 9L8 12.5 11.5 9"/></button>
                      <button type="button" className="rt-icon" disabled={draft.steps.length === 1} aria-label={t("routinespage.removeStepValue", { value: index + 1 })} title={t("routinespage.removeStep")} onClick={() => edit(r => { r.steps.splice(index, 1); })}><Icon d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></button>
                    </span></div>
                  <StepEditor step={step} earlier={refsBefore(draft, index)} onChange={change => edit(r => change(r.steps[index] as Step, r))}/>
                </li>)}
              </ol>
              {draft.steps.length < 12 && <div className="rt-add" role="group" aria-label={t("routinespage.addAStep")}><span className="rt-quiet">{t("routinespage.addAStep")}</span>
                {(Object.keys(commandLabels) as Step['command'][]).map(command => <button key={command} type="button" className="acira-button acira-button-secondary" onClick={() => edit(r => { const id = nextId(r.steps.map(s => s.id), 'step'), tabs = r.steps.flatMap(s => s.command === 'tabs.open' ? s.args.items.map(i => i.ref) : []); r.steps.push(command === 'tabs.open' ? { id, command, args: { reuse: 'exact-url-in-workspace', items: [{ ref: nextId(tabs, 'tab'), url: 'https://' }] } } : command === 'tabs.group' ? { id, command, args: { refs: tabs.slice(0, 20), name: 'Routine', color: 'blue' } } : command === 'layout.split' ? { id, command, args: { left: tabs[0] ?? '', right: tabs[1] ?? '', ratio: .5 } } : { id, command, args: { enabled: true } }); })}>{commandLabels[command]}</button>)}
              </div>}
              <footer className="rw-foot">
                <span className="rw-foot-status" role="status">{run?.status === 'running' ? <span className="rt-running"><DotMatrix preset="loader" size={13} reducedMotion={state.settings.reducedMotion}/> {t('routines.stepOf', { step: (run.current ?? 0) + 1, total: run.total })}</span> : errors.length ? <span className="rt-errors">{errors[0]}{errors.length > 1 ? ` (+${errors.length - 1} more)` : ''}</span> : run?.message || (dirty ? 'Unsaved changes' : '')}</span>
                {run?.tabIds?.length && run.status !== 'running' ? <button type="button" className="acira-button acira-button-secondary" onClick={() => dispatch({ type: 'tab.select', id: run.tabIds![0] })}>{t("routinespage.showTabs")}</button> : null}
                <button type="button" className="acira-button acira-button-secondary rw-danger" onBlur={() => setConfirmDelete(false)} onClick={() => { if (confirmDelete || !selected) { setConfirmDelete(false); void remove(); } else setConfirmDelete(true); }}>{confirmDelete ? t("routinespage.deleteRoutine") : 'Delete…'}</button>
                {selected && <button type="button" className="acira-button acira-button-secondary" onClick={exportIt}>{t("pw.dialog.exportConfirm")}</button>}
                <button type="button" className="acira-button acira-button-secondary" disabled={!dirty} onClick={() => void save()}>{t("pw.frame.save")}</button>
                {run?.status === 'running' ? <button type="button" className="acira-button acira-button-primary" onClick={stop}>{t("app.stop")}</button> : <button type="button" className="acira-button acira-button-primary" onClick={() => void start()}>{t("routinespage.run")}</button>}
              </footer>
            </>}
        </section>
      </div>}
  </div></LibraryPage>;
}

function RoutineItem({ item, selected, profile, onOpen }: { item: RoutineRow; selected: boolean; profile: string; onOpen: () => void }) {
  return <div className="rw-row rt-row" role="option" aria-selected={selected} tabIndex={0} onClick={onOpen} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}>
    <span className="rw-row-main">
      <span className="rt-row-top"><span className="rw-row-title">{item.name}</span>{item.shortcut && <kbd>{formatShortcut(item.shortcut)}</kbd>}</span>
      <span className="rw-row-meta"><span className="rw-marks">{item.domains.slice(0, 4).map(d => <SiteMark key={d} url={`https://${d}`} size={14}/>)}</span><span>{routinePlainWords(item.commands ?? [], item.sites ?? item.domains.length)} · {profile}{item.lastRun?.status === 'interrupted' ? t("routinespage.interrupted") : ''}</span></span>
    </span>
  </div>;
}

function StepEditor({ step, earlier, onChange }: { step: Step; earlier: { ref: string; url: string }[]; onChange: (change: (step: Step, recipe: Recipe) => void) => void }) {
  const label = (ref: string) => { const url = earlier.find(e => e.ref === ref)?.url ?? '', name = host(url); if (earlier.filter(e => host(e.url) === name).length < 2) return name || ref; try { return name + new URL(url).pathname; } catch { return name || ref; } };
  if (step.command === 'tabs.open') return <div className="rt-step-body">
    {step.args.items.map((item, i) => <div key={item.ref} className="rt-url"><SiteMark url={item.url}/><input aria-label={t("routinespage.addressValue", { value: i + 1 })} value={item.url} maxLength={4096} spellCheck={false} onChange={e => onChange(s => { if (s.command === 'tabs.open') s.args.items[i].url = e.target.value.trim(); })}/>{step.args.items.length > 1 && <button type="button" className="rt-icon" aria-label={t("routinespage.removeAddressValue", { value: i + 1 })} title={t("routinespage.removeAddress")} onClick={() => onChange(s => { if (s.command === 'tabs.open') s.args.items.splice(i, 1); })}><Icon d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></button>}</div>)}
    {step.args.items.length < 8 && <button type="button" className="rw-link rt-more" onClick={() => onChange((s, r) => { if (s.command === 'tabs.open') s.args.items.push({ ref: nextId(r.steps.flatMap(x => x.command === 'tabs.open' ? x.args.items.map(i => i.ref) : []), 'tab'), url: 'https://' }); })}>{t("routinespage.addAnAddress")}</button>}
    <p className="rt-hint">{t("routinespage.aTabAlreadyOpenAt")}</p>
  </div>;
  if (step.command === 'tabs.group') return <div className="rt-step-body">
    <div className="rt-inline"><input aria-label={t("tabgrouptray.groupName")} value={step.args.name} maxLength={80} onChange={e => onChange(s => { if (s.command === 'tabs.group') s.args.name = e.target.value; })}/>
      <select className="rt-select" aria-label={t("tabgroupcontrols.groupColor")} value={step.args.color} onChange={e => onChange(s => { if (s.command === 'tabs.group') s.args.color = e.target.value as Color; })}>{COLORS.map(c => <option key={c} value={c}>{c === 'none' ? t("tabgroupcontrols.noColor") : c[0].toUpperCase() + c.slice(1)}</option>)}</select></div>
    {earlier.length ? <div className="rt-checks">{earlier.map(e => <label key={e.ref}><input type="checkbox" checked={step.args.refs.includes(e.ref)} onChange={() => onChange(s => { if (s.command === 'tabs.group') s.args.refs = s.args.refs.includes(e.ref) ? s.args.refs.filter(r => r !== e.ref) : [...s.args.refs, e.ref]; })}/>{label(e.ref)}</label>)}</div> : <p className="rt-hint">{t("routinespage.addAnOpenTabsStep")}</p>}
  </div>;
  if (step.command === 'layout.split') return <div className="rt-step-body rt-inline">
    {(['left', 'right'] as const).map(side => <select className="rt-select" key={side} aria-label={t(side === 'left' ? "routinespage.leftTabLabel" : "routinespage.rightTabLabel")} value={step.args[side]} onChange={e => onChange(s => { if (s.command === 'layout.split') s.args[side] = e.target.value; })}><option value="">{t("routinespage.chooseATab")}</option>{earlier.map(e => <option key={e.ref} value={e.ref}>{label(e.ref)}</option>)}</select>)}
    <select className="rt-select" aria-label={t("routinespage.splitRatio")} value={step.args.ratio} onChange={e => onChange(s => { if (s.command === 'layout.split') s.args.ratio = Number(e.target.value); })}>{RATIOS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}</select>
  </div>;
  return <div className="rt-step-body rt-inline"><select className="rt-select" aria-label={t("browsermenu.focusMode")} value={String(step.args.enabled)} onChange={e => onChange(s => { if (s.command === 'layout.focus') s.args.enabled = e.target.value === 'true'; })}><option value="true">{t("routinespage.turnFocusModeOn")}</option><option value="false">{t("routinespage.turnFocusModeOff")}</option></select></div>;
}

function ImportReview({ review, paste, profiles, profileId, setProfileId, onPreview, onCancel, onAdd }: { review: { text: string; recipe?: Recipe; domains?: string[]; errors?: string[] }; paste: boolean; profiles: { id: string; name: string }[]; profileId: string; setProfileId: (id: string) => void; onPreview: (text: string) => void; onCancel: () => void; onAdd: () => void }) {
  const [text, setText] = useState(review.text);
  return <div className="rt-review" onKeyDown={e => { if (e.key === 'Escape') onCancel(); }}>
    <h2 className="section-title">{t("routinespage.reviewRoutine")}</h2>
    <p className="rt-hint">{t("routinespage.nothingRunsAndNoWebsite")}</p>
    {paste && <><textarea className="rt-paste" aria-label={t("routinespage.routineJson")} value={text} spellCheck={false} onChange={e => setText(e.target.value)} placeholder={t("routinespage.formatAciraRoutineVersion1")} autoFocus/><div><button type="button" className="acira-button acira-button-secondary" disabled={!text.trim()} onClick={() => onPreview(text)}>{t("routinespage.checkRoutine")}</button></div></>}
    {review.errors?.length ? <ul className="rt-errors" role="alert">{review.errors.map((e, i) => <li key={i}>{e}</li>)}</ul> : null}
    {review.recipe && <>
      <p className="rt-review-name">{review.recipe.name}</p>
      {review.recipe.description && <p className="rt-hint">{review.recipe.description}</p>}
      <ol className="rt-summary">{review.recipe.steps.map(s => <li key={s.id}>{reviewLine(s)}</li>)}</ol>
      <p className="rt-hint">{t('routines.websitesOpened', { domains: review.domains?.join(', ') ?? '' })}</p>
      <label className="rt-field"><span>{t("routinespage.opensIn")}</span><select className="rt-select" value={profileId} onChange={e => setProfileId(e.target.value)}>{profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    </>}
    <div className="rt-review-actions"><button type="button" className="acira-button acira-button-secondary" onClick={onCancel}>{t("ext.dlgCancel")}</button>{review.recipe && <button type="button" className="acira-button acira-button-primary" onClick={onAdd}>{t("routinespage.addRoutine")}</button>}</div>
  </div>;
}
/** Import review shows the exact addresses (ROUTINES_SPEC §7: review the actual URLs before adding). */
function reviewLine(step: Step) {
  if (step.command === 'tabs.open') return `Open ${step.args.items.map(i => i.url).join(', ')}`;
  if (step.command === 'tabs.group') return `Group ${summary(step)}`;
  if (step.command === 'layout.split') return 'Show two tabs side by side';
  return step.args.enabled ? 'Turn focus mode on' : 'Turn focus mode off';
}
function summary(step: Step) {
  switch (step.command) {
    case 'tabs.open': { const sites = step.args.items.map(i => host(i.url)).filter(Boolean); return sites.length ? sites.slice(0, 3).join(', ') + (sites.length > 3 ? ` and ${sites.length - 3} more` : '') : 'No address yet'; }
    case 'tabs.group': return `${step.args.refs.length} ${step.args.refs.length === 1 ? 'tab' : 'tabs'} as “${step.args.name}”`;
    case 'layout.split': return 'Two tabs side by side';
    default: return step.args.enabled ? 'On' : 'Off';
  }
}
