// The two-digit number field of S3 (spec 4.2: "two digits in one field; it submits by itself on the second digit"), picture 08.
//
// One real <input> sits over two drawn cells, so typing, paste, deleting, an IME and a screen reader all work as in any field; the cells only show what it holds.
// Western, Arabic-Indic and Persian digits are folded to 0-9 as they are typed (`foldDigits`), so an Arabic keyboard works and both computers see the same glyphs.
// `onComplete` is called once, with the two digits, the moment the second one is in. After that the field is read-only until `reset` changes (the owner decides
// what the answer means: the right number starts the transfer, a wrong one ends it).
//
//   <NumberDigits label="Type the number…" onComplete={n => approve(n)} dim={wrong} />
import { useEffect, useId, useRef, useState } from 'react';
import { t } from '../../i18n';
import { foldDigits } from './sendModel';
import { settleDigit } from './sheetMotion';

export const DIGITS = 2;

export interface NumberDigitsProps {
  /** What the field is for, read by a screen reader (the screen's title). */
  label: string;
  onComplete: (digits: string) => void;
  /** The cells dim (a wrong number: no shake, the card resolves into the message). */
  dim?: boolean;
  /** Stops accepting digits (the answer is being checked). */
  disabled?: boolean;
  /** Change it to clear the field and accept digits again. */
  reset?: unknown;
  reducedMotion?: boolean;
  /** The first digit takes the dialog's initial focus (spec 14.20). Default true. */
  initialFocus?: boolean;
  /** Test seam: the digits the field starts with. */
  initial?: string;
}

export function NumberDigits({ label, onComplete, dim = false, disabled = false, reset, reducedMotion, initialFocus = true, initial = '' }: NumberDigitsProps) {
  const [value, setValue] = useState(initial.slice(0, DIGITS)), [focused, setFocused] = useState(false), cells = useRef<(HTMLDivElement | null)[]>([]), done = useRef(false);
  const hint = useId(), first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } setValue(''); done.current = false; }, [reset]);
  const take = (raw: string) => {
    if (disabled || done.current) return;
    const next = foldDigits(raw).slice(0, DIGITS);
    if (next.length > value.length) settleDigit(cells.current[next.length - 1], reducedMotion);
    setValue(next);
    if (next.length === DIGITS) { done.current = true; onComplete(next); }
  };
  const active = Math.min(value.length, DIGITS - 1);
  return (
    <div className="tx-digits" role="group" aria-label={label}>
      <input className="tx-digits-input" type="text" inputMode="numeric" autoComplete="off" spellCheck={false} aria-label={label} aria-describedby={hint} value={value} disabled={disabled} data-initial-focus={initialFocus ? 'true' : undefined}
        onChange={event => take(event.target.value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} />
      {Array.from({ length: DIGITS }, (_, index) => (
        <div key={index} ref={node => { cells.current[index] = node; }} className="tx-digit" aria-hidden="true" data-focus={focused && !disabled && index === active && !done.current ? '' : undefined} data-dim={dim ? '' : undefined}>
          {value[index] ?? (focused && !disabled && index === active ? <span className="caret" /> : null)}
        </div>
      ))}
      <span className="tx-sr" id={hint}>{t('transfer.confirm.digit', { n: Math.min(value.length + 1, DIGITS) })}</span>
    </div>
  );
}
