// Device glyph, the wide 3 x 13 grid, device glyph (pictures 08-10, 13-14, 16). Used by the sending screens S3-S4 and the receiving screens R3-R6.
import { ProgressLine } from './ProgressLine';
import { Laptop, Monitor } from 'lucide-react';
import { t, type MessageId } from '../../i18n';
import { TransferGrid } from './TransferGrid';
import type { TransferPlatform } from './types';

export interface PairStripProps {
  /** The two computers: lucide Laptop for darwin, Monitor otherwise; `label` is "This computer" / the cleaned name the other computer sent. */
  left: { platform: TransferPlatform; label: string };
  right: { platform: TransferPlatform; label: string };
  /** pairing: scan across the grid; progress: layers light with `fraction`; check: the grid rests fully lit (the done mark itself is the 7 x 7 CheckGrid above the text). */
  mode: 'pairing' | 'progress' | 'check';
  fraction?: number;
  held?: boolean;
  /** Animation speed Off: the grid rests on a still frame. */
  reducedMotion?: boolean;
}

/** "macOS", "Windows", "Linux", or '' when the other computer did not say. */
export function platformName(platform: TransferPlatform | string | undefined): string {
  return platform === 'darwin' || platform === 'win32' || platform === 'linux' ? t(`transfer.platform.${platform}` as MessageId) : '';
}
/** The label for this computer under its glyph. */
export const thisComputer = () => t('transfer.pair.thisComputer');

/** One device: the glyph (24 px, 1.5 stroke) and its name. A Mac is drawn as a laptop; everything else as a monitor. */
export function Device({ platform, label }: { platform: TransferPlatform; label: string }) {
  const Glyph = platform === 'darwin' ? Laptop : Monitor;
  return <div className="tx-dev"><Glyph className="tx-dev-icon" size={24} strokeWidth={1.5} aria-hidden="true" /><small className="tx-dev-name">{label}</small></div>;
}

export function PairStrip({ left, right, mode, fraction = 0, held = false, reducedMotion }: PairStripProps) {
  const preset = mode === 'pairing' ? 'scan' : 'progress';
  return (
    <div className="tx-pair" data-mode={mode}>
      <Device {...left} />
      {mode === 'progress'
        ? <div className="tx-wire tx-wire-line"><ProgressLine fraction={fraction} held={held} reducedMotion={reducedMotion} /></div>
        : <div className="tx-wire"><TransferGrid preset={preset} rows={3} cols={13} fraction={mode === 'check' ? 1 : fraction} held={held} reducedMotion={reducedMotion} className="tx-wire-grid" /></div>}
      <Device {...right} />
    </div>
  );
}
