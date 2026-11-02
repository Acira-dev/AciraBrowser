import type { ComponentType } from 'react';
import { Check } from 'lucide-react';

/** One of a short list of choices in a menu (the toolbar menu's Window view): one menuitemradio row, its glyph, its name, the
 * shortcut when it has one, and the accent check in the column the switches use, so rows of both kinds line up. The menu stays
 * open; Settings and the command bar use the same four names. Styles: seamless.css (on panels.css's menu metrics). */
export function MenuChoice({ icon: Icon, label, on, shortcut, onChoose }: {
  icon?: ComponentType<{ size?: number }>;
  label: string;
  on: boolean;
  shortcut?: string;
  onChoose: () => void;
}) {
  return <button type="button" className="menu-row menu-choice" role="menuitemradio" aria-checked={on} onClick={onChoose}>
    {Icon ? <Icon size={16}/> : <span className="menu-toggle-blank" aria-hidden="true"/>}
    <span>{label}</span>
    {shortcut && <kbd>{shortcut}</kbd>}
    <span className="menu-choice-check" aria-hidden="true">{on && <Check size={16} className="acira-menu-check"/>}</span>
  </button>;
}
