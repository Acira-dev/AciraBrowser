/* Beta 14 (toolbar prompts): the layouts of the reference design's sample for "Open an app?" (`extapp:1`) and "Save / Update password?" (`savepw:1`), in the reference sample.
 * The card, its tokens and its buttons are DialogLayer's (src/features/dialogs/dialogs.css); this file is only what sits inside a prompt: the markup is the sample's, class for class (the sample's `.g.pr` family), and
 * prompts.css holds the few rules the sample's `.tile.accent`, `.well`, `.li`, `.s` and `.k` give these two. The question and the buttons come from main (desktop/site-prompt.cjs `describe`); the answer goes back as
 * DialogLayer's `answer`. */
import { useState, type ReactNode } from 'react';
import { runtime } from '../../runtime/client';
import type { DialogSpec } from '../../runtime/dialogSpec';
import { clearRevealed, useRevealed } from './dialogStore';
import { Glyph } from './glyphs';
import './prompts.css';

export type PromptCardProps = { spec: DialogSpec; tabId: string; answer: (index: number, dismissed?: boolean) => void; muted: boolean; setMuted: (value: boolean) => void };

/** The × at the top right of an anchored prompt: answers "nobody decided" (the cancel button's answer, flagged dismissed). */
function CloseButton({ spec, answer }: Pick<PromptCardProps, 'spec' | 'answer'>) {
  return <button type="button" className="dlg-btn dlg-btn-icon dlg-x" aria-label={spec.closeLabel} onClick={() => answer(spec.cancelIndex, true)}><Glyph name="x"/></button>;
}
const buttonOf = (spec: DialogSpec, answer: PromptCardProps['answer'], index: number, kind: string, label?: ReactNode) => {
  const found = spec.buttons.find(item => item.index === index);
  return found ? <button key={index} type="button" className={`dlg-btn dlg-btn-${kind}`} data-default={index === spec.defaultIndex || undefined} onClick={() => answer(index)}>{label ?? found.label}</button> : null;
};

/** "Open Zoom?" (the sample's `extapp:1`): an accent tile with the open glyph, the app in the title, one quiet line saying who asks, "Always for this site" on the left of the row, Cancel and Open on the right. */
export function OpenAppCard({ spec, answer, muted, setMuted }: PromptCardProps) {
  const primary = spec.buttons.find(item => item.role === 'primary');
  return <>
    <div className="dlg-row" style={{ gap: 12, paddingInlineEnd: 28 }}>
      <div className="dlg-tile dlg-tile-accent"><Glyph name={spec.icon || 'external'}/></div>
      <div className="dlg-col"><div className="dlg-title dlg-title-sm">{spec.message}</div>{spec.quiet || spec.detail ? <div className="dlg-sub dlg-sub-s dlg-wrap">{spec.quiet || spec.detail}</div> : null}</div>
    </div>
    <CloseButton spec={spec} answer={answer}/>
    <div className="dlg-foot dlg-foot-p dlg-foot-wrap">
      {spec.mute ? <label className="dlg-chk"><input className="dlg-chk-input" type="checkbox" checked={muted} onChange={event => setMuted(event.target.checked)}/>{spec.mute.label}</label> : null}
      <div className="dlg-end">{buttonOf(spec, answer, spec.cancelIndex, 'glass')}{primary ? buttonOf(spec, answer, primary.index, 'primary') : null}</div>
    </div>
  </>;
}

/** "Save password?" / "Update password?" (the sample's `savepw:1`): an accent tile with the key, the title over the site, a well with the username and the password (dots; the eye shows it), "Never for this site" on
 *  the left of the row and Save (or Update) on the right. The eye asks main for the password only when it is pressed, and the card forgets it when the eye closes or the prompt goes. */
export function SavePasswordCard({ spec, tabId, answer }: PromptCardProps) {
  const save = spec.save!, shown = useRevealed(spec.token), [open, setOpen] = useState(false);
  const primary = spec.buttons.find(item => item.role === 'primary'), never = spec.buttons.find(item => item.role !== 'primary');
  const toggle = () => {
    if (open) { setOpen(false); clearRevealed(spec.token); return; }
    setOpen(true);
    void runtime.browserCommand({ type: 'dialog-reveal', tabId, id: spec.token });
  };
  const password = open && shown !== null ? shown : save.masked;
  return <>
    <div className="dlg-row" style={{ gap: 12, paddingInlineEnd: 28 }}>
      <div className="dlg-tile dlg-tile-accent"><Glyph name="key"/></div>
      <div className="dlg-col"><div className="dlg-title dlg-title-sm">{spec.message}</div><div className="dlg-sub dlg-sub-k dlg-sub-1 dlg-wrap">{spec.host}</div></div>
    </div>
    <CloseButton spec={spec} answer={answer}/>
    <div className="dlg-well dlg-mt12">
      <div className="dlg-li"><div className="dlg-ld dlg-ld-label">{save.usernameLabel}</div><div className="dlg-lt dlg-grow dlg-wrap" title={save.username || undefined}>{save.username || save.noUsername}</div></div>
      <div className="dlg-li"><div className="dlg-ld dlg-ld-label">{save.passwordLabel}</div><div className={`dlg-lt dlg-grow dlg-wrap${open && shown !== null ? '' : ' dlg-dots'}`}>{password}</div>
        {save.reveal ? <button type="button" className="dlg-btn dlg-btn-icon dlg-eye" aria-label={open ? save.hideLabel : save.showLabel} aria-pressed={open} onClick={toggle}><Glyph name={open ? 'eyeOff' : 'eye'}/></button> : null}</div>
    </div>
    <div className="dlg-foot dlg-foot-p dlg-foot-wrap">
      {never ? buttonOf(spec, answer, never.index, 'quiet') : null}
      <div className="dlg-end">{primary ? buttonOf(spec, answer, primary.index, 'primary') : null}</div>
    </div>
  </>;
}
