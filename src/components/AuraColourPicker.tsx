import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { colourWords, fieldColour, fieldPoint } from '../ui/frameField';
import { completeHexColor } from '../ui/hexColor';
import { t } from '../i18n';
import './AuraColourPicker.css';

/**
 * Acira's own colour picker (Beta 14.1, the team's "aura" picker; the team chose design 2, Creation spark). Never the system picker.
 *
 * - The Founding card's two hands (the card's own silhouette and emboss masks, src/components/aura, cut to the hands and given alpha), filled with
 *   light and standing whole with air round them; the arms dissolve into the glass rather than meeting its edge.
 * - Between the fingertips the SPARK: the colour being picked, with its soft halo. It is STILL: it changes when the colour changes and never runs
 *   an animation (the battery rule).
 * - Below, a field of light: across is the colour (the hue), down is the light. A press or a drag moves the point; the keyboard moves it too
 *   (arrows, Shift for big steps). The colour is said in words ("Amber, light 68 %") and as hex, which can be typed.
 * - `onPreview` is called with every colour on the way (the caller tints the frame live without saving anything), `onAdd` once with the colour
 *   chosen, `onCancel` to leave.
 */
/** The hands' pictures (Vite bundles a `new URL(..., import.meta.url)` asset; a Node test run just builds the file URL). */
const handsMask = new URL('./aura/hands-mask.png', import.meta.url).href, handsEmboss = new URL('./aura/hands-emboss.png', import.meta.url).href;
const STEP = 2, BIG = 20, LIGHT_STEP = .02, LIGHT_BIG = .1;
export function auraColourName(hex: string, light?: number) {
  const words = colourWords(hex), pct = Math.round((light ?? words.light / 100) * 100);
  return t('owncolours.colourWords', { name: t(`owncolours.hue.${words.hue}`), light: pct });
}

export function AuraColourPicker({ initial, title, addLabel, onPreview, onAdd, onCancel }: { initial?: string; title?: string; addLabel?: string; onPreview?: (hex: string) => void; onAdd: (hex: string) => void; onCancel: () => void }) {
  const start = fieldPoint(initial && /^#[\da-f]{6}$/i.test(initial) ? initial : '#8b5cf6');
  const [hue, setHue] = useState(start.hue), [light, setLight] = useState(start.light);
  const colour = fieldColour(hue, light);
  const [hexDraft, setHexDraft] = useState(colour), [typing, setTyping] = useState(false);
  const field = useRef<HTMLDivElement>(null), dragging = useRef(false), moved = useRef(false), hexId = useId();
  useEffect(() => { if (!typing) setHexDraft(colour); if (moved.current) onPreview?.(colour); }, [colour]);   // the frame follows only once the person has moved the point   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { field.current?.focus({ preventScroll: true }); }, []);
  const setFrom = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setHue(Math.round(Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)) * 360) % 360);
    setLight(Math.min(1, Math.max(0, 1 - (event.clientY - box.top) / box.height)));
    setTyping(false); moved.current = true;
  };
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    const big = event.shiftKey;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') setHue(value => ((value + (event.key === 'ArrowRight' ? 1 : -1) * (big ? BIG : STEP)) % 360 + 360) % 360);
    else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') setLight(value => Math.min(1, Math.max(0, value + (event.key === 'ArrowUp' ? 1 : -1) * (big ? LIGHT_BIG : LIGHT_STEP))));
    else if (event.key === 'Enter') onAdd(colour);
    else return;
    event.preventDefault(); event.stopPropagation(); setTyping(false); moved.current = true;
  };
  const takeHex = (text: string) => { setHexDraft(text); setTyping(true); moved.current = true; const hex = completeHexColor(text); if (hex) { const point = fieldPoint(hex); setHue(point.hue); setLight(point.light); } };
  const words = auraColourName(colour);   // the colour's own lightness, the same number its swatch says
  return <div className="aura-picker" role="dialog" aria-label={title || t('owncolours.newColour')} style={{ '--aura-colour': colour, '--aura-x': `${hue / 360 * 100}%`, '--aura-y': `${(1 - light) * 100}%`, '--aura-hands': `url(${handsMask})`, '--aura-emboss': `url(${handsEmboss})` } as CSSProperties}
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel(); } }}>
    <div className="aura-head"><span className="aura-title">{title || t('owncolours.newColour')}</span><span className="aura-hex-shown" aria-hidden="true">{colour.toUpperCase()}</span></div>
    <div className="aura-creation" aria-hidden="true">
      <span className="aura-hands" /><span className="aura-hands aura-hands-emboss" /><span className="aura-spark" />
    </div>
    <div ref={field} className="aura-field" role="slider" tabIndex={0} aria-label={t('owncolours.fieldLabel')} aria-valuetext={words} aria-valuemin={0} aria-valuemax={360} aria-valuenow={hue}
      onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); dragging.current = true; setFrom(event); }}
      onPointerMove={event => { if (dragging.current) setFrom(event); }}
      onPointerUp={event => { dragging.current = false; event.currentTarget.releasePointerCapture(event.pointerId); }}
      onPointerCancel={() => { dragging.current = false; }}
      onKeyDown={keys}>
      <span className="aura-point" />
    </div>
    <div className="aura-words">
      <span className="aura-name" aria-live="polite">{words}</span>
      <label className="aura-hex" htmlFor={hexId}><span className="aura-hex-label">{t('owncolours.hex')}</span>
        <input id={hexId} className="ab-input aura-hex-input" value={typing ? hexDraft : hexDraft.toUpperCase()} maxLength={9} spellCheck={false} autoComplete="off"
          onChange={event => takeHex(event.target.value)} onBlur={() => setTyping(false)}
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); const hex = completeHexColor(hexDraft); if (hex) onAdd(hex); } }} />
      </label>
    </div>
    <div className="aura-foot">
      <button type="button" className="aura-button" onClick={onCancel}>{t('owncolours.cancel')}</button>
      <button type="button" className="aura-button" data-primary onClick={() => onAdd(colour)}>{addLabel || t('owncolours.addColour')}</button>
    </div>
  </div>;
}
