import { type CSSProperties, type KeyboardEvent } from 'react';
import './Segmented.css';

/** The one segmented control (premium components §3): 32px, a single indicator that slides between equal-width segments in 100ms,
 *  weight fixed at 500 so nothing reflows on selection. A radio group: one tab stop (the chosen segment), arrows move AND choose,
 *  Home and End jump. Colours come from `--seg-*` so a host (setup, Settings) can tone it without a second control. */
export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly (readonly [T, string])[]; onChange: (value: T) => void }) {
  const index = Math.max(0, options.findIndex(([option]) => option === value));
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + step + options.length) % options.length;
    onChange(options[next][0]);
    event.currentTarget.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
  };
  return <div className="acira-seg" role="radiogroup" aria-label={label} onKeyDown={keys} style={{ '--seg-count': options.length, '--seg-index': index } as CSSProperties}>
    <span className="acira-seg-thumb" aria-hidden="true" />
    {options.map(([option, text]) => <button key={option} type="button" role="radio" aria-checked={value === option} tabIndex={value === option ? 0 : -1} onClick={() => onChange(option)}>{text}</button>)}
  </div>;
}
