import { createRoot } from 'react-dom/client';
import { useId, useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import './choice-cards.css';

/** Illustrated choices (macOS Appearance, Windows 11 Personalization): a small, crisp miniature per option, a radio and a
 * label under it. One radio group: Tab reaches the chosen card, arrow keys move AND choose (so the choice applies at once,
 * like every other control here), Home and End jump. The chosen card gets a 2px accent ring and a filled radio. */
export type ChoiceCardOption<T extends string> = { value: T; label: string; art: ReactNode; theme?: CSSProperties; /** Not available in this setup: dimmed like a disabled switch and never chosen; the row says why (settings/layoutAvailability.ts). A disabled card that is the chosen one stays shown as chosen. */ disabled?: boolean };

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
    const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? count - 1 : 1;
    // A card that is not available is passed over: the arrows and Home / End land on the next one that is.
    let next = event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : (current + step) % count;
    for (let tries = 0; options[next].disabled && tries < count; tries++) next = event.key === 'Home' ? (next + 1) % count : event.key === 'End' ? (next + count - 1) % count : (next + step) % count;
    if (options[next].disabled) return;
    if (options[next].value !== value) onChange(options[next].value);
    cards[next]?.focus();
  }
  return <div ref={group} className="cc-group" role="radiogroup" aria-label={label} onKeyDown={keyboard} style={{ '--cc-count': options.length, '--cc-cols': columns ?? options.length } as CSSProperties}>
    {options.map((option) => {
      const selected = option.value === value;
      return <button type="button" role="radio" key={option.value} className="cc-card" aria-checked={selected} aria-disabled={option.disabled ? true : undefined} tabIndex={selected ? 0 : -1} data-initial-focus={selected ? 'true' : undefined} onClick={() => { if (!selected && !option.disabled) onChange(option.value); }}>
        <span className="cc-art" aria-hidden="true" style={option.theme}>{option.art}</span>
        <span className="cc-label"><span className="cc-radio" aria-hidden="true" /><span className="cc-name">{option.label}</span></span>
      </button>;
    })}
  </div>;
}

/** A miniature of the browser window, drawn in the current finish's own colors: the frame, the surface the toolbar and the
 * chosen tab share, the page, ink and the accent. Colors come from custom properties (`--cc-*`), so the same drawing is
 * Light, Dark or the live theme. `layout` is where the tab list and the address bar sit: along the top, in a sidebar (the
 * toolbar stays over the page), both in the sidebar (nothing above the page: ui/sidebarMode.ts, Sidebar + address), or along the top with a sidebar of shelves beside the page
 * (Beta 14, Top + sidebar: the tab row and the address row over the page, a column of rows on the frame). */
export type MiniLayout = 'toolbar' | 'top-sidebar' | 'sidebar' | 'sidebar-address';

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
    </> : layout === 'top-sidebar' ? <>
      {/* Top + sidebar. Exact sample parity (item18's picker.png, measured at 3x on its own card: 2.29 px per unit, the frame's 160 units; each value within half a unit): the column on the frame holds four Favorite dots (the first and third in the accent), a hairline and three rows of a dot and a line, a + at its foot;
          from x=70 the tab row stands on the frame (three tabs, the first raised with the accent) and the page card starts under the address row, whose pill is an outline. */}
      <path d="M74.5 29.5V25.5a5 5 0 0 1 5-5h27a5 5 0 0 1 5 5v4Z" className="cc-sheet" />
      <rect x="70" y="29.5" width="106.5" height="15.25" className="cc-sheet" />
      <rect x="92.3" y="31.7" width="69.6" height="10" rx="5" className="cc-field" />
      <path d="M70 44.75H176.5V101.5a5.5 5.5 0 0 1-5.5 5.5H75.5A5.5 5.5 0 0 1 70 101.5Z" className="cc-page" />
      <path d="M70 44.75H176.5" className="cc-hair" />
      <path d="M26 35.4H61.4" className="cc-hair" />
      <path d="M28.5 24.5h.01M48.5 24.5h.01" className="cc-dot cc-dot-accent" />
      <path d="M38.5 24.5h.01M58.5 24.5h.01" className="cc-dot" />
      <path d="M29.6 43.65h.01M29.6 54.15h.01M29.6 65.55h.01" className="cc-dot" />
      <path d="M35.7 43.2h18.4M35.7 54.6h14M35.7 65.6h20.2" className="cc-bar" />
      <path d="M29.8 93.5h4M31.8 91.5v4" className="cc-stroke" />
      <path d="M80 24.5h.01" className="cc-dot cc-dot-accent" />
      <path d="M120 24.5h.01M145.5 24.5h.01" className="cc-dot" />
      <path d="M85.2 25h20" className="cc-bar cc-bar-strong" />
      <path d="M125 25h14.9M150.3 25h12.2" className="cc-bar" />
      <path d="M168.8 24.9h4.8M171.2 22.5v4.8" className="cc-stroke" />
      <path d="M79.5 38.75 76.5 36.25l3-2.5M86 36.25h-9.5" className="cc-stroke" />
      <path d="M80 56.4h34" className="cc-bar cc-bar-strong cc-page-ink" />
      <path d="M80 68.6h40M80 76.5h32M80 84.7h38" className="cc-bar cc-page-ink" />
      <rect x="130.3" y="63.3" width="36.4" height="26.4" rx="5" className="cc-picture" />
    </> : layout === 'sidebar-address' ? <>
      {/* The address field, Back/Forward and the selected tab all sit in the sidebar column; the page starts at the window's top. */}
      <rect x="25" y="47" width="36" height="12" rx="4" className="cc-sheet" />
      <rect x="70" y="20" width="106" height="87" rx="5.5" className="cc-page" />
      <rect x="25" y="29" width="40" height="8" rx="4" className="cc-field" />
      <path d="M29 22.5h.01M37 22.5h.01M45 22.5h.01M62 22.5h.01" className="cc-dot" />
      <path d="M38 42h14" className="cc-bar" />
      <path d="M32 53h.01" className="cc-dot cc-dot-accent" />
      <path d="M32 68h.01M32 80h.01" className="cc-dot" />
      <path d="M38 53h17" className="cc-bar cc-bar-strong" />
      <path d="M38 68h16M38 80h19" className="cc-bar" />
      <path d="M30 96h4M32 94v4" className="cc-stroke" />
      <path d="M80 34h34" className="cc-bar cc-bar-strong cc-page-ink" />
      <path d="M80 47h40M80 55h32M80 63h38" className="cc-bar cc-page-ink" />
      <rect x="130" y="44" width="36" height="26" rx="5" className="cc-picture" />
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
  return <svg className="cc-svg" data-mini-layout={halves ? undefined : layout} viewBox="0 0 200 125" focusable="false" preserveAspectRatio="xMidYMid slice">
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
  root.render(<div className="cc-art"><MiniBrowser layout="toolbar" /><MiniBrowser layout="sidebar" halves={[{}, {}]} /><MiniBrowser layout="sidebar-address" /><MiniBrowser layout="top-sidebar" /></div>);
  window.setTimeout(() => { root.unmount(); host.remove(); }, 700);
}
