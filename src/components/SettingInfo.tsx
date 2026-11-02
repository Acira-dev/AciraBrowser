import {Info} from './AppIcons';
import './setting-info.css';

/** The (i) button beside a setting. Hover and keyboard focus show its explanation in the one tooltip (TooltipHost, a
 * wrapped 300px card); a click keeps it open until a second click, Esc, scrolling or any other click (`data-tip-pin`).
 * Hover and click are the same tooltip in the same place, not two designs (R3-05). */
export function SettingInfo({text}: {text: string}) {
  return <span className="setting-info">
    <button type="button" className="setting-info-button" data-tip={text} data-tip-wrap="" data-tip-pin="" aria-label={text}><Info size={14} aria-hidden="true"/></button>
  </span>;
}
