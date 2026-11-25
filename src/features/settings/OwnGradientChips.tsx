import type { CSSProperties } from 'react';
import type { Settings } from '../../runtime/types';
import { GRADIENT_EXTRA, frameColours } from '../../runtime/ownColours';
import { frameStop } from '../../ui/frameField';
import { auraColourName } from '../../components/AuraColourPicker';
import { t } from '../../i18n';

/** 14.1 Your colours, Settings > Appearance > Gradient colours: the frame's colours corner to corner. The first is the colour in use (it stays);
 *  the person's other colours can be added after it, three at most (14.3), in the order pressed; + opens Acira's own picker for a new one. */
export function OwnGradientChips({ settings, onChange, onAdd }: { settings: Settings; onChange: (patch: Partial<Settings>) => void; onAdd: (anchor: HTMLElement) => void }) {
  const field = frameColours(settings), main = field[0], chosen = field.slice(1);
  const others = (settings.ownColours ?? []).map(hex => hex.toLowerCase()).filter(hex => hex !== main);
  const dark = document.querySelector('.app')?.getAttribute('data-appearance') === 'dark';
  const chip = (hex: string) => ({ '--chip': frameStop(hex, dark), '--chip-pure': hex } as CSSProperties);
  const toggle = (hex: string) => onChange({ frameGradient: chosen.includes(hex) ? chosen.filter(item => item !== hex) : [...chosen, hex].slice(-GRADIENT_EXTRA) });
  return <div className="own-gradient" role="group" aria-label={t('owncolours.gradientColours')}>
    <span className="own-chip" data-main style={chip(main)} title={auraColourName(main)}><span className="own-chip-order" aria-hidden="true">1</span></span>
    {others.map(hex => { const at = chosen.indexOf(hex); return <button key={hex} type="button" className="own-chip" aria-pressed={at >= 0} aria-label={auraColourName(hex)} title={auraColourName(hex)} style={chip(hex)} onClick={() => toggle(hex)}>
      {at >= 0 && <span className="own-chip-order" aria-hidden="true">{at + 2}</span>}
    </button>; })}
    <button type="button" className="own-chip own-chip-add" aria-label={t('owncolours.addAColour')} title={t('owncolours.addAColour')} onClick={event => onAdd(event.currentTarget)}>
      <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.5v9M1.5 6h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
    </button>
  </div>;
}
