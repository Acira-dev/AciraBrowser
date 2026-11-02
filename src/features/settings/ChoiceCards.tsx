import { createRoot } from 'react-dom/client';
import { useId, useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import './choice-cards.css';

/** Illustrated choices (macOS Appearance, Windows 11 Personalization): a small, crisp miniature per option, a radio and a
 * label under it. One radio group: Tab reaches the chosen card, arrow keys move AND choose (so the choice applies at once,
 * like every other control here), Home and End jump. The chosen card gets a 2px accent ring and a filled radio. */
export type ChoiceCardOption<T extends string> = { value: T; label: string; art: ReactNode; theme?: CSSProperties };

/** `columns` keeps a short row at the card size of a longer one (R4-56: the two Tabs cards are as wide as the four Window view cards). */
export function ChoiceCards<T extends string>({ label, value, options, onChange, columns }: { label: string; value: T; options: ChoiceCardOption<T>[]; onChange: (value: T) => void; columns?: number }) {
  const group = useRef<HTMLDivElement>(null);
  const index = Math.max(0, options.findIndex((option) => option.value === value));
  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const cards = Array.from(group.current?.querySelectorAll<HTMLButtonElement>('[role=radio]') ?? []), count = options.length;
    const focused = cards.indexOf(document.activeElement as HTMLButtonElement), current = focused < 0 ? index : focused;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : (current + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? count - 1 : 1)) % count;
    if (options[next].value !== value) onChange(options[next].value);
    cards[next]?.focus();
  }
  return <div ref={group} className="cc-group" role="radiogroup" aria-label={label} onKeyDown={keyboard} style={{ '--cc-count': options.length, '--cc-cols': columns ?? options.length } as CSSProperties}>
    {options.map((option) => {
      const selected = option.value === value;
      return <button type="button" role="radio" key={option.value} className="cc-card" aria-checked={selected} tabIndex={selected ? 0 : -1} data-initial-focus={selected ? 'true' : undefined} onClick={() => { if (!selected) onChange(option.value); }}>
        <span className="cc-art" aria-hidden="true" style={option.theme}>{option.art}</span>
        <span className="cc-label"><span className="cc-radio" aria-hidden="true" /><span className="cc-name">{option.label}</span></span>
      </button>;
    })}
  </div>;
}

/** A miniature of the browser window, drawn in the current finish's own colors: the frame, the surface the toolbar and the
 * chosen tab share, the page, ink and the accent. Colors come from custom properties (`--cc-*`), so the same drawing is
 * Light, Dark or the live theme. `tabs` is where the tab list sits. */
export type MiniLayout = 'toolbar' | 'sidebar';

function Window({ layout, ids }: { layout: MiniLayout; ids: { wall: string } }) {
  // Few elements on purpose: bars and dots are stroked lines in one path per kind, so the first paint stays cheap.
  return <>
    <rect width="200" height="125" className="cc-wall" />
    <rect width="200" height="125" fill={`url(#${ids.wall})`} />
    <rect x="18" y="19" width="164" height="100" rx="10" className="cc-shadow" opacity=".05" />
    <rect x="21" y="18.5" width="158" height="96" rx="7.5" className="cc-shadow" opacity=".1" />
    <rect x="20" y="14" width="160" height="97" rx="7.5" className="cc-frame" />
    {layout === 'toolbar' ? <>
      <path d="M28 34V25a5 5 0 0 1 5-5H71a5 5 0 0 1 5 5V34Z" className="cc-sheet" />
      <rect x="20" y="34" width="160" height="18" className="cc-sheet" />
      <rect x="60" y="37" width="104" height="10" rx="5" className="cc-field" />
      <path d="M20 52H180V103.5a7.5 7.5 0 0 1-7.5 7.5H27.5a7.5 7.5 0 0 1-7.5-7.5Z" className="cc-page" />
      <path d="M20 52.25H180" className="cc-hair" />
      <path d="M36 27h.01" className="cc-dot cc-dot-accent" />
      <path d="M87 27h.01M127 27h.01M48 41h.01M68 42h.01M172 42h.01" className="cc-dot" />
      <path d="M42 27h22" className="cc-bar cc-bar-strong" />
      <path d="M93 27h20M133 27h16M73 42h34" className="cc-bar" />
      <path d="M160 27h6M163 24v6M32 43.5 29 41l3-2.5M42 41h-6" className="cc-stroke" />
      <path d="M34 65h52" className="cc-bar cc-bar-strong cc-page-ink" />
      <path d="M34 78h88M34 86h74M34 94h82" className="cc-bar cc-page-ink" />
      <rect x="132" y="62" width="34" height="28" rx="5" className="cc-picture" />
    </> : <>
      <rect x="25" y="22" width="36" height="12" rx="4" className="cc-sheet" />
      <rect x="70" y="20" width="106" height="87" rx="5.5" className="cc-page" />
      <rect x="93" y="22.5" width="68" height="9" rx="4.5" className="cc-field" />
      <path d="M70 37.25H176" className="cc-hair" />
      <path d="M32 28h.01" className="cc-dot cc-dot-accent" />
      <path d="M32 43h.01M32 57h.01M32 71h.01M100 27h.01" className="cc-dot" />
      <path d="M38 28h17" className="cc-bar cc-bar-strong" />
      <path d="M38 43h16M38 57h19M38 71h13M105 27h26" className="cc-bar" />
      <path d="M30 94h4M32 92v4M79.5 29.5 76.5 27l3-2.5M86 27h-9.5" className="cc-stroke" />
      {/* R3-47: the text column ends at x=120 (stroke caps to 121.3), the picture starts at x=130, so nothing overlaps. */}
      <path d="M80 50h34" className="cc-bar cc-bar-strong cc-page-ink" />
      <path d="M80 62h40M80 70h32M80 78h38" className="cc-bar cc-page-ink" />
      <rect x="130" y="60" width="36" height="26" rx="5" className="cc-picture" />
    </>}
    <rect x="20.25" y="14.25" width="159.5" height="96.5" rx="7.25" className="cc-rim" />
  </>;
}

/** `halves` draws two themes split down the middle (Auto). Otherwise one drawing in `theme` (or the live theme). */
export function MiniBrowser({ layout, halves }: { layout: MiniLayout; halves?: [CSSProperties, CSSProperties] }) {
  const id = useId().replace(/:/g, ''), ids = { wall: `${id}-wall` };
  return <svg className="cc-svg" viewBox="0 0 200 125" focusable="false" preserveAspectRatio="xMidYMid slice">
    <defs>
      {/* A fixed sheen over the flat desktop color; a gradient cannot read per-half colors, the flat rect can. */}
      <linearGradient id={ids.wall} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".12" /><stop offset="1" stopColor="#000" stopOpacity=".08" /></linearGradient>

    </defs>
    {halves ? <>
      {/* Nested svgs clip each half without a clip-path (clip-path stalled the first paint of Settings). */}
      <svg x="0" y="0" width="100" height="125" viewBox="0 0 100 125" style={halves[0]}><Window layout={layout} ids={ids} /></svg>
      <svg x="100" y="0" width="100" height="125" viewBox="100 0 100 125" style={halves[1]}><Window layout={layout} ids={ids} /></svg>
    </> : <Window layout={layout} ids={ids} />}
  </svg>;
}

/** The first time the GPU paints these miniatures it stalls the frame for ~150ms. Paint one, nearly invisible, once at idle (after the
 *  window shows) so opening Settings for the first time finds the paths ready. */
export function warmMiniBrowser() {
  const host = document.createElement('div');
  Object.assign(host.style, { position: 'fixed', left: '0', top: '0', width: '160px', height: '100px', opacity: '0.01', pointerEvents: 'none', zIndex: '-1' });
  host.setAttribute('aria-hidden', 'true');
  document.body.appendChild(host);
  const root = createRoot(host);
  root.render(<div className="cc-art"><MiniBrowser layout="toolbar" /><MiniBrowser layout="sidebar" halves={[{}, {}]} /></div>);
  window.setTimeout(() => { root.unmount(); host.remove(); }, 700);
}
