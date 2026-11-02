import { useId, type ReactNode } from 'react';
import './window-view.css';
import { MiniBrowser, type MiniLayout } from './ChoiceCards';

/** Thin-line miniatures for the four Window views (R3-68): the same drawing language as the Tab layout cards (choice-cards.css),
 * so the four cards read as one set. Full is the Tab layout miniature itself; the others take chrome away, in the order
 * Compact, Focus, Seamless. `layout` is where the tabs live, so the picture matches the person's window. */
export type MiniView = 'full' | 'compact' | 'focus' | 'seamless';

function Frame({ ids, children }: { ids: { wall: string }; children: ReactNode }) {
  return <>
    <rect width="200" height="125" className="cc-wall" />
    <rect width="200" height="125" fill={`url(#${ids.wall})`} />
    <rect x="18" y="19" width="164" height="100" rx="10" className="cc-shadow" opacity=".05" />
    <rect x="21" y="18.5" width="158" height="96" rx="7.5" className="cc-shadow" opacity=".1" />
    <rect x="20" y="14" width="160" height="97" rx="7.5" className="cc-frame" />
    {children}
    <rect x="20.25" y="14.25" width="159.5" height="96.5" rx="7.25" className="cc-rim" />
  </>;
}

/** The page under a chrome of `top` px (window y 14), square at the top, round at the bottom like the Tab layout cards. */
const Page = ({ top }: { top: number }) => <path d={`M20 ${top}H180V103.5a7.5 7.5 0 0 1-7.5 7.5H27.5a7.5 7.5 0 0 1-7.5-7.5Z`} className="cc-page" />;

function PageText({ x = 34, y = 0 }: { x?: number; y: number }) {
  return <>
    <path d={`M${x} ${y}h52`} className="cc-bar cc-bar-strong cc-page-ink" />
    <path d={`M${x} ${y + 13}h88M${x} ${y + 21}h74M${x} ${y + 29}h82`} className="cc-bar cc-page-ink" />
    <rect x="132" y={y - 3} width="34" height="28" rx="5" className="cc-picture" />
  </>;
}

function Compact({ layout }: { layout: MiniLayout }) {
  return <>
    <rect x="20" y="14" width="160" height="20" className="cc-sheet" />
    <Page top={34} />
    <path d="M20 34.25H180" className="cc-hair" />
    {layout === 'toolbar' ? <>
      <path d="M32 24h.01" className="cc-dot cc-dot-accent" />
      <path d="M42 24h14M64 24h10" className="cc-bar" />
      <rect x="86" y="19" width="80" height="10" rx="5" className="cc-field" />
      <path d="M172 24h.01" className="cc-dot" />
    </> : <>
      <path d="M31 24h.01" className="cc-dot" />
      <path d="M44 24h.01M54 24h.01" className="cc-dot" />
      <rect x="66" y="19" width="94" height="10" rx="5" className="cc-field" />
      <path d="M170 24h.01" className="cc-dot" />
    </>}
    <PageText y={50} />
  </>;
}

function Focus({ layout }: { layout: MiniLayout }) {
  return <>
    <rect x="20" y="14" width="160" height="20" className="cc-sheet" />
    <Page top={34} />
    <path d="M20 34.25H180" className="cc-hair" />
    {layout === 'sidebar' ? <path d="M31 24h.01" className="cc-dot" /> : null}
    <path d="M42 24h.01M52 24h.01" className="cc-dot" />
    <rect x="62" y="19" width="98" height="10" rx="5" className="cc-field" />
    <path d="M170 24h.01" className="cc-dot cc-dot-accent" />
    <PageText y={50} />
  </>;
}

function Seamless() {
  return <>
    <path d="M20 14H180V103.5a7.5 7.5 0 0 1-7.5 7.5H27.5a7.5 7.5 0 0 1-7.5-7.5Z" className="cc-page" />
    <PageText y={40} />
    {/* The edges that answer the pointer: a hairline of accent along the top and the left, the way the app shows them once. */}
    <path d="M30 15h140" className="cc-edge" />
    <path d="M21 26v70" className="cc-edge" />
    <path d="M88 15l-4 6 6 1.4Z" className="cc-pointer" />
  </>;
}

export function MiniView({ view, layout }: { view: MiniView; layout: MiniLayout }) {
  const id = useId().replace(/:/g, ''), ids = { wall: `${id}-wall` };
  if (view === 'full') return <MiniBrowser layout={layout} />;
  return <svg className="cc-svg" viewBox="0 0 200 125" focusable="false" preserveAspectRatio="xMidYMid slice">
    <defs><linearGradient id={ids.wall} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".12" /><stop offset="1" stopColor="#000" stopOpacity=".08" /></linearGradient></defs>
    <Frame ids={ids}>
      {view === 'compact' ? <Compact layout={layout} /> : view === 'focus' ? <Focus layout={layout} /> : <Seamless />}
    </Frame>
  </svg>;
}
