// The frame every receiving screen sits in, in the sheet's look or in first-run setup's own card (spec 4.4, pictures 11-17 and 20-21).
//   sheet: `.tx-body` with a 16 px title, the content, and the button row of picture 11 (`.tx-foot`).
//   setup: the setup card (`.fr-card`: glyph, 32 px title, line, content, then Back and the primary in the footer), so the card looks like every other step of setup.
// A screen says what it has (title, line, content, actions); the frame decides how each variant wears it.
import { type ReactNode } from 'react';
import { useT } from '../../i18n';

export type ReceiveVariant = 'sheet' | 'setup';
export interface FrameAction {
  id: string;
  label: string;
  kind: 'primary' | 'secondary' | 'quiet';
  onClick?: () => void;
  disabled?: boolean;
  /** Takes the dialog's first focus (spec 14.20). */
  initialFocus?: boolean;
  /** The button the reveal grows from: its centre is measured when it is pressed. */
  revealOrigin?: boolean;
}
export interface FrameProps {
  variant: ReceiveVariant;
  /** The title: in the sheet an h2 of 16 px, in setup the card's h1. */
  title: ReactNode;
  /** Setup's line under its title; the sheet shows it as `.tx-sub` right under the title only when `subInSheet` (R5 gives it as the title instead). */
  sub?: ReactNode;
  subInSheet?: boolean;
  /** R3 and R4: the title and the content are centred (`.tx-center`), and so is the button row. */
  center?: boolean;
  children?: ReactNode;
  actions?: FrameAction[];
  /** Status changes (the Connecting line, rows ticking) are read out politely. */
  live?: 'polite' | 'assertive';
  /** For tests and the reveal: names the screen. */
  screen: string;
  onActionPress?: (action: FrameAction, node: HTMLButtonElement) => void;
}

/** The arrow of setup's primary button, the same drawing as the other steps (Onboarding.tsx `Arrow`). */
function Arrow() {
  return (
    <svg className="fr-arrow" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" aria-hidden="true">
      <path d="M3 8h9" /><path d="m8.5 4.5 3.5 3.5-3.5 3.5" />
    </svg>
  );
}
/** Two arrows passing: the glyph of setup's receive cards (picture 20). */
const SWAP = 'M8 3 4 7l4 4M4 7h16M16 21l4-4-4-4M20 17H4';

function SheetButton({ action, onPress }: { action: FrameAction; onPress?: FrameProps['onActionPress'] }) {
  const cls = `acira-button acira-button-${action.kind}${action.kind === 'primary' ? ' acira-button-prominent' : ''}`;
  return (
    <button type="button" className={cls} disabled={action.disabled} data-action={action.id} data-initial-focus={action.initialFocus ? 'true' : undefined}
      onClick={(event) => { onPress?.(action, event.currentTarget); action.onClick?.(); }}>{action.label}</button>
  );
}
function SetupButton({ action, onPress }: { action: FrameAction; onPress?: FrameProps['onActionPress'] }) {
  const primary = action.kind === 'primary';
  return (
    <button type="button" className={`fr-btn ${primary ? 'fr-btn-primary' : 'fr-btn-text'}`} disabled={action.disabled} data-action={action.id} data-onboarding-primary={primary ? '' : undefined}
      onClick={(event) => { onPress?.(action, event.currentTarget); action.onClick?.(); }}>{action.label}{primary && <Arrow />}</button>
  );
}

export function ReceiveFrame({ variant, title, sub, subInSheet = false, center = false, children, actions = [], live, screen, onActionPress }: FrameProps) {
  useT();
  if (variant === 'setup') {
    const start = actions.filter((action) => action.kind !== 'primary'), end = actions.filter((action) => action.kind === 'primary');
    return (
      <div className="fr-card rx-setup-card" role="group" aria-labelledby="fr-title" data-prism-glass="" data-screen={screen} aria-live={live}>
        <div className="fr-card-main">
          <div className="fr-stepwrap">
            <svg className="fr-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" aria-hidden="true"><path d={SWAP} /></svg>
            <h1 className="fr-card-title" id="fr-title" tabIndex={-1}>{title}</h1>
            {sub != null && <p className="fr-sub">{sub}</p>}
            <div className="fr-content rx-content">{children}</div>
          </div>
        </div>
        <footer className="fr-foot">
          <div className="fr-foot-start">{start.map((action) => <SetupButton key={action.id} action={action} onPress={onActionPress} />)}</div>
          <span className="fr-counter" />
          <div className="fr-foot-end">{end.map((action) => <SetupButton key={action.id} action={action} onPress={onActionPress} />)}</div>
        </footer>
      </div>
    );
  }
  const head = <h2 className="tx-title" tabIndex={-1}>{title}</h2>;
  return (
    <div className="tx-body rx-body" data-screen={screen} aria-live={live}>
      {center ? <div className="tx-center">{head}{sub != null && subInSheet && <p className="tx-sub">{sub}</p>}{children}</div> : <>{head}{sub != null && subInSheet && <p className="tx-sub">{sub}</p>}{children}</>}
      {actions.length > 0 && (
        <div className="tx-foot" style={center ? { justifyContent: 'center' } : undefined}>
          {actions.map((action) => <SheetButton key={action.id} action={action} onPress={onActionPress} />)}
        </div>
      )}
    </div>
  );
}

/** The measured centre of a pressed button, for the reveal's circle. */
export const centreOf = (node: Element | null | undefined): { x: number; y: number } | null => {
  if (!node || typeof node.getBoundingClientRect !== 'function') return null;
  const box = node.getBoundingClientRect();
  return box.width || box.height ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : null;
};
