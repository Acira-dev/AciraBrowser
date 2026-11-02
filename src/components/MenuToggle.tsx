import { useState, type ComponentType } from 'react';

/** An on/off row in any menu (founder, 25 Oct: "turn blue if it's on … a very premium switch"). The row is one
 * menuitemcheckbox: its glyph takes the accent when on, and the panel switch (28×16, C's metrics, the accent when on)
 * sits in the menu's trailing column. A click or Enter/Space flips it with the switch's 140ms thumb motion and the menu
 * stays open. Checks remain only for "choose one of" lists. Styles: panels.css "On/off rows". */
export function MenuToggle({ icon: Icon, label, on, disabled, shortcut, onToggle }: {
  icon?: ComponentType<{ size?: number }>;
  label: string;
  on: boolean;
  disabled?: boolean;
  shortcut?: string;
  onToggle: () => void;
}) {
  return <button type="button" className="menu-row menu-toggle" role="menuitemcheckbox" aria-checked={on} disabled={disabled} onClick={onToggle}>
    {Icon ? <Icon size={16}/> : <span className="menu-toggle-blank" aria-hidden="true"/>}
    <span>{label}</span>
    {shortcut && <kbd>{shortcut}</kbd>}
    <span className="shields-switch menu-switch" aria-checked={on} aria-hidden="true"><span/></span>
  </button>;
}

/** A toggle whose state lives elsewhere and is only reported back on the next open (a website's own menu items):
 * it flips at once on screen and runs its action. */
export function LocalMenuToggle({ initial, onToggle, ...rest }: Omit<Parameters<typeof MenuToggle>[0], 'on' | 'onToggle'> & { initial: boolean; onToggle: (next: boolean) => void }) {
  const [on, setOn] = useState(initial);
  return <MenuToggle {...rest} on={on} onToggle={() => { const next = !on; setOn(next); onToggle(next); }}/>;
}
