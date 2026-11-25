/* Beta 14: the card of a dialog (centred, radius 16) or a prompt (hung under the address field, radius 20), drawn inside the pop-up system's frosted surface. The look is the reference design's sample
 * (the reference sample): his markup, tokens and values; see dialogs.css. The question comes from main (desktop/site-prompt.cjs `describe`) as a DialogSpec; the answer goes back as a
 * `dialog-answer` command. Esc answers "nobody decided" (the cancel button), Enter the default, Tab turns the keyboard ring on (and only the keyboard does: never after a click). */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { runtime } from '../../runtime/client';
import type { DialogButton, DialogIcon, DialogSpec } from '../../runtime/dialogSpec';
import { dialogWidthOf } from './dialogStore';
import './dialogs.css';
import { OpenAppCard, SavePasswordCard } from './PromptCards';
import { GLYPHS as SHARED_GLYPHS } from './glyphs';

/* The sample's line icons (dlg-lab.html `P`): 24 x 24, 1.5-1.6 stroke, round caps and joins, drawn in the text colour. */
const GLYPHS: Record<string, string> = {
  camera: '<path d="M14.5 4h-5L7.5 6.5h-3a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h15a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3.5"/>',
  mic: '<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/>',
  pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21z"/><circle cx="12" cy="10" r="2.4"/>',
  bell: '<path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z"/><path d="M10.3 20a2 2 0 0 0 3.4 0"/>',
  key: '<circle cx="7.5" cy="15.5" r="4"/><path d="M10.4 12.6 19 4M15.5 7.5l2.5 2.5M13.5 9.5l2 2"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.7-4.3L3.5 9M3.5 4.5V9H8M4 13a8 8 0 0 0 14.7 4.3l1.8-2.3M20.5 19.5V15H16"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4.5h6V7"/>',
  alert: '<path d="M12 3.5 2.8 19.5h18.4z"/><path d="M12 10v4M12 16.8h.01"/>',
  lock: '<rect x="5" y="11" width="14" height="9.5" rx="2.5"/><path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
};
function Glyph({ name, className = '' }: { name: string; className?: string }) {
  return <svg className={`dlg-ico ${className}`} viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: GLYPHS[name] || SHARED_GLYPHS[name] || '' }}/>;
}
const letter = (host: string) => (host.replace(/^www\./, '')[0] || '?').toUpperCase();
function Fav({ item }: { item: DialogIcon }) {
  return <span className="dlg-fav">{item.favicon ? <img className="dlg-fav-img" src={item.favicon} alt="" draggable={false}/> : letter(item.host)}</span>;
}
const clamp = (low: number, value: number, high: number) => Math.min(high, Math.max(low, value));

export function DialogLayer({ spec, tabId, glass, onNaturalHeight }: { spec: DialogSpec; tabId: string; glass: number; onNaturalHeight?: (height: number) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const [muted, setMuted] = useState(false), [text, setText] = useState(spec.input?.value ?? ''), [keys, setKeys] = useState(false);
  const [typed, setTyped] = useState<Record<string, string>>(() => Object.fromEntries((spec.fields ?? []).map(field => [field.name, field.value])));
  const anchored = spec.mode === 'anchored';
  // the theme is the app's own (the same attribute every surface reads); the surface and the card both carry it
  const theme = typeof document !== 'undefined' && document.querySelector('.app')?.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  useLayoutEffect(() => {
    const surface = root.current?.closest('.acira-popup-surface') as HTMLElement | null; if (!surface) return;
    // his rule: the glass slider moves the tint by (g - 64) x .009, clamped .2 to .9; at the ends the surface is solid (the pop-up's own opaque provider does that)
    const base = theme === 'light' ? .36 : .32;
    surface.setAttribute('data-dlg', theme); surface.setAttribute('data-dlg-family', anchored ? 'prompt' : 'dialog');
    surface.style.setProperty('--dlg-tint', String(clamp(.2, base + (glass - 64) * .009, .9)));
    return () => { surface.removeAttribute('data-dlg'); surface.removeAttribute('data-dlg-family'); surface.style.removeProperty('--dlg-tint'); };
  }, [theme, glass, anchored]);
  // The card's height is told to the pop-up system after every render (its text, its icons or its fields can change it), but only when it CHANGED: telling it again, with the same number, set the parent's state again and
  // re-rendered the card, for ever (React error #185, "Maximum update depth exceeded", at every dialog show; the card was reported late or not at all on Windows).
  const told = useRef({ token: -1, height: -1 });
  useLayoutEffect(() => { const box = root.current; if (!box) return; const height = Math.ceil(box.getBoundingClientRect().height); if (told.current.token === spec.token && told.current.height === height) return; told.current = { token: spec.token, height }; onNaturalHeight?.(height); });
  useEffect(() => { root.current?.focus({ preventScroll: true }); }, [spec.token]);
  // a sign-in card: the first empty field takes the cursor (the user name, or the password when the name is remembered)
  // (the popup is not focusable until it is shown: try again for a moment)
  useEffect(() => {
    if (!spec.fields?.length) return;
    const empty = spec.fields.find(field => !field.value) ?? spec.fields[0];
    let tries = 0, timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = () => {
      const input = root.current?.querySelector<HTMLInputElement>(`input[data-field="${empty.name}"]`);
      if (!input) return;
      input.focus({ preventScroll: true });
      if (document.activeElement !== input && tries++ < 20) timer = setTimeout(attempt, 40);
    };
    attempt();
    return () => clearTimeout(timer);
  }, [spec.token]);
  const answer = (index: number, dismissed = false) => void runtime.browserCommand({ type: 'dialog-answer', tabId, id: spec.token, index, ...(dismissed ? { dismissed: true } : {}), ...(spec.input ? { text } : {}), ...(spec.mute ? { muted } : {}), ...(spec.fields?.length && index !== spec.cancelIndex ? { values: { username: typed.username ?? '', password: typed.password ?? '' } } : {}) });
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Tab') { setKeys(true); return; }
    if (event.key === 'Escape') { event.preventDefault(); answer(spec.cancelIndex, true); return; }
    if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement) && !(event.target instanceof HTMLInputElement && event.target.type === 'checkbox')) { event.preventDefault(); answer(spec.defaultIndex); }
  };
  const width = dialogWidthOf(spec), style: CSSProperties = { width };
  // the sample shows seven icons and then "+N" for the rest of the tabs
  const allSites = spec.strip?.items ?? [], sites = allSites.slice(0, 7), moreSites = (spec.strip?.more ?? 0) + Math.max(0, allSites.length - 7);
  // a centred card: the primary last; a destructive answer that is not the default is glass with red text (the sample's Leave), the default one is the red flat button
  const says = !anchored && spec.variant !== 'close' && !!spec.says;
  // a tall block of text (an extension's list of what it can access, a long explanation): the tile sits at the top beside the title, not in the middle of the block
  const tallText = (spec.detail || '').split('\n').length > 3 || (spec.detail || '').length > 150;
  // a destructive confirm (the sample's delete): the safe answer is the default and stays glass, the red button is last; otherwise the primary is last
  const destructive = spec.tone === 'danger';
  const lastRole = (b: DialogButton) => destructive ? Number(b.role === 'danger') : Number(b.role === 'primary');
  const orderedOf = [...spec.buttons].sort((a, b) => lastRole(a) - lastRole(b));
  const ordered = orderedOf.map(b => <button key={b.index} type="button" className={`dlg-btn dlg-btn-${b.role === 'primary' && !destructive ? 'primary' : b.role === 'danger' && (b.index === spec.defaultIndex || spec.tone === 'danger') ? 'danger' : 'glass'}${b.role === 'danger' && b.index !== spec.defaultIndex && spec.tone !== 'danger' ? ' dlg-btn-red' : ''}`} data-default={b.index === spec.defaultIndex || undefined} onClick={() => answer(b.index)}>{b.label}</button>);
  const buttons = spec.buttons.map(button => <button key={button.index} type="button" className={`dlg-btn dlg-btn-${button.role === 'primary' ? 'primary' : button.role === 'danger' ? 'danger' : 'glass'}`} data-default={button.index === spec.defaultIndex || undefined} onClick={() => answer(button.index)}>{button.label}</button>);
  // a prompt: the cancel answer is a quiet button on the left; the rest sit on the right, the quiet-glass ones first and the primary last
  const roleOf = (b: DialogButton) => b.role === 'primary' ? 'primary' : b.role === 'danger' ? 'danger' : 'glass';
  const promptButton = (b: DialogButton, kind: string) => <button key={b.index} type="button" className={`dlg-btn dlg-btn-${kind}`} data-default={b.index === spec.defaultIndex || undefined} onClick={() => answer(b.index)}>{b.label}</button>;
  const cancelButton = spec.buttons.filter(b => b.index === spec.cancelIndex).map(b => promptButton(b, 'quiet'));
  const others = [...spec.buttons.filter(b => b.index !== spec.cancelIndex)].sort((a, b) => Number(a.role === 'primary') - Number(b.role === 'primary')).map(b => promptButton(b, roleOf(b)));
  return <div ref={root} className={`dlg ${anchored ? 'dlg-pad-p' : 'dlg-pad'}`} data-theme={theme} data-keys={keys || undefined} data-family={anchored ? 'prompt' : 'dialog'} style={style} tabIndex={-1} role="dialog" aria-modal={anchored ? undefined : true} aria-label={spec.message} onKeyDown={onKeyDown}>
    {spec.variant === 'close' ? <>
      <div className="dlg-row" style={{ gap: 14 }}>
        <div className="dlg-tile dlg-tile-app">{spec.appIcon ? <img className="dlg-mark" src={spec.appIcon} alt="" draggable={false}/> : null}</div>
        <div className="dlg-col"><div className="dlg-title">{spec.message}</div>{spec.detail ? <div className="dlg-sub">{spec.detail}</div> : null}</div>
      </div>
      {sites.length ? <div className="dlg-sites">{sites.map((item, at) => <Fav key={at} item={item}/>)}{moreSites > 0 ? <span className="dlg-more">+{moreSites}</span> : null}</div> : null}
      <div className="dlg-foot">
        {spec.mute ? <label className="dlg-chk"><input className="dlg-chk-input" type="checkbox" checked={muted} onChange={event => setMuted(event.target.checked)}/>{spec.mute.label}</label> : null}
        <div className="dlg-end">{buttons}</div>
      </div>
    </> : anchored && spec.prompt === 'extapp' ? <OpenAppCard key={spec.token} spec={spec} tabId={tabId} answer={answer} muted={muted} setMuted={setMuted}/>
    : anchored && spec.prompt === 'savepw' ? <SavePasswordCard key={spec.token} spec={spec} tabId={tabId} answer={answer} muted={muted} setMuted={setMuted}/>
    : anchored ? <>
      <div className="dlg-row dlg-row-start" style={{ gap: spec.badge ? 14 : 12, paddingRight: 28 }}>
        {spec.badge ? <div className="dlg-tilewrap"><span className="dlg-fav dlg-fav-lg">{spec.favicon ? <img className="dlg-fav-img dlg-fav-img-lg" src={spec.favicon} alt="" draggable={false}/> : letter(spec.host)}</span><span className="dlg-badge"><Glyph name={spec.badge} className="dlg-ico-badge"/></span></div>
          : <div className="dlg-tile dlg-tile-accent"><Glyph name={spec.icon || 'key'}/></div>}
        <div className="dlg-col">
          <div className="dlg-title dlg-title-sm">{spec.host && spec.message.startsWith(spec.host) ? <><b className="dlg-host">{spec.host}</b>{spec.message.slice(spec.host.length)}</> : spec.message}</div>
          {spec.quiet || spec.detail ? <div className="dlg-sub dlg-sub-k">{spec.quiet || spec.detail}</div> : null}
        </div>
      </div>
      <button type="button" className="dlg-btn dlg-btn-icon dlg-x" aria-label={spec.closeLabel} onClick={() => answer(spec.cancelIndex, true)}><Glyph name="x"/></button>
      <div className="dlg-foot dlg-foot-p">
        {spec.mute ? <label className="dlg-chk"><input className="dlg-chk-input" type="checkbox" checked={muted} onChange={event => setMuted(event.target.checked)}/>{spec.mute.label}</label> : null}
        {cancelButton}
        <div className="dlg-end">{others}</div>
      </div>
    </> : spec.fields?.length ? <>
      <div className="dlg-row" style={{ gap: 14 }}>
        <div className="dlg-tile dlg-tile-plain"><Glyph name={spec.icon || 'key'}/></div>
        <div className="dlg-col"><div className="dlg-title">{spec.message}</div>{spec.detail ? <div className="dlg-sub">{spec.detail}</div> : null}</div>
      </div>
      {(spec.warns ?? []).map((note, index) => <div key={index} className="dlg-warn" role={index ? 'alert' : undefined}><Glyph name="alert" className="dlg-warn-ico"/>{note}</div>)}
      {spec.fields.map(field => <div key={field.name} className="dlg-group">
        <label className="dlg-lbl" htmlFor={`dlg-f-${spec.token}-${field.name}`}>{field.label}</label>
        <div className="dlg-field"><input className="dlg-field-input" id={`dlg-f-${spec.token}-${field.name}`} data-field={field.name} type={field.secret ? 'password' : 'text'} value={typed[field.name] ?? ''} maxLength={field.secret ? 4096 : 1024} autoComplete="off" autoCapitalize="none" spellCheck={false}
          onChange={event => setTyped(old => ({ ...old, [field.name]: event.target.value }))}/></div>
      </div>)}
      <div className="dlg-foot"><div className="dlg-end">{ordered}</div></div>
    </> : says ? <>
      <div className="dlg-row dlg-row-start" style={{ gap: 14 }}>
        <span className="dlg-fav dlg-fav-xl">{spec.favicon ? <img className="dlg-fav-img dlg-fav-img-xl" src={spec.favicon} alt="" draggable={false}/> : letter(spec.host)}</span>
        <div className="dlg-col"><div className="dlg-k">{spec.message}</div><div className="dlg-title dlg-title-md">{spec.detail}</div></div>
      </div>
      {spec.input ? <div className="dlg-field"><input className="dlg-field-input" value={text} autoFocus onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); answer(spec.defaultIndex); } }}/></div> : null}
      <div className="dlg-foot">
        {spec.mute ? <label className="dlg-chk"><input className="dlg-chk-input" type="checkbox" checked={muted} onChange={event => setMuted(event.target.checked)}/>{spec.mute.label}</label> : null}
        <div className="dlg-end">{ordered}</div>
      </div>
    </> : <>
      <div className={`dlg-row${tallText ? ' dlg-row-start' : ''}`} style={{ gap: 14 }}>
        {spec.icon === 'favicon' ? <span className="dlg-fav dlg-fav-xl">{spec.favicon ? <img className="dlg-fav-img dlg-fav-img-xl" src={spec.favicon} alt="" draggable={false}/> : letter(spec.host)}</span>
          : <div className={`dlg-tile dlg-tile-plain${spec.tone === 'danger' ? ' dlg-tile-danger' : ''}`}><Glyph name={spec.icon || 'file'}/></div>}
        <div className="dlg-col"><div className="dlg-title">{spec.message}</div>{spec.detail || spec.caption || spec.body ? <div className="dlg-sub">{spec.detail || spec.body || spec.caption}</div> : null}</div>
      </div>
      <div className="dlg-foot"><div className="dlg-end">{ordered}</div></div>
    </>}
  </div>;
}
