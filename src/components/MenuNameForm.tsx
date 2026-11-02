import { useId, useState } from 'react';
import { t } from '../i18n';

/** The same complete name form for folders and other short menu edits. */
export function MenuNameForm({ label, initial = '', action, submit, cancel }: {
  label: string; initial?: string; action: string; submit: (name: string) => void; cancel: () => void;
}) {
  const id = useId(), [value, setValue] = useState(initial);
  const name = value.trim().slice(0, 200);
  return <form className="menu-form-fields" onSubmit={event => { event.preventDefault(); if (name) submit(name); }}>
    <label htmlFor={id}>{label}<input id={id} autoFocus value={value} maxLength={200} onFocus={event => event.currentTarget.select()} onChange={event => setValue(event.target.value)}/></label>
    <div className="menu-form-actions"><button type="button" className="acira-button" onClick={cancel}>{t('dialog.cancel')}</button><button type="submit" className="acira-button acira-button-primary" disabled={!name}>{action}</button></div>
  </form>;
}
