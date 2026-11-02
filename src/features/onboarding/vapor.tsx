import { createElement, useEffect, useLayoutEffect, useRef, useState } from "react";

/* Text motion from the Acira website (Acira Website V3/motion.js §3c and site.css `enter`), set to the bible §3.9 rule:
   letters dissolve and form in a left→right sweep, in reading order — never from the centre — each into a soft blur of
   .12em, 20–30ms apart, the whole line within 600ms (exits ~60% of that), on ease-strong. Entrances use fill
   "backwards", so once they end nothing is left behind: resting text has no filter and sits on no layer of its own. */

const strong = "cubic-bezier(.23, 1, .32, 1)";
const ENTER = { letter: 240, line: 600, min: 14, max: 30 };
const LEAVE = { letter: 140, line: 360, min: 8, max: 20 };

/** Delay between letters for a sweep: 20–30ms, compressed for long lines so the whole line ends within its budget. */
function stagger(count: number, timing: typeof ENTER) {
  if (count < 2) return 0;
  return Math.max(timing.min, Math.min(timing.max, (timing.line - timing.letter) / (count - 1)));
}

function sweepIn(letters: HTMLElement[], blur: number, start: number) {
  const step = stagger(letters.length, ENTER);
  letters.forEach((letter, i) => {
    letter.animate([{ opacity: 0, filter: `blur(${blur}px)` }, { opacity: 1, filter: "blur(0px)" }], {
      duration: ENTER.letter,
      delay: start + i * step,
      easing: strong,
      fill: "backwards",
    });
  });
}

/** A display line that rises in on mount and vapor-swaps when its text changes. */
export function VaporText({
  text,
  as = "h1",
  className,
  id,
  reduced,
  delay = 0,
  focusRef,
}: {
  text: string;
  as?: "h1" | "h2" | "p" | "span";
  className?: string;
  id?: string;
  reduced: boolean;
  delay?: number;
  focusRef?: React.Ref<HTMLElement>;
}) {
  const [shown, setShown] = useState(text);
  const host = useRef<HTMLElement | null>(null),
    first = useRef(true),
    swapping = useRef(false);
  const letters = () => [...(host.current?.querySelectorAll<HTMLElement>(".vt-l") || [])];
  // Entrance: the line forms letter by letter, left to right.
  useLayoutEffect(() => {
    const node = host.current;
    if (!node || reduced || !node.animate) return;
    sweepIn(letters(), parseFloat(getComputedStyle(node).fontSize) * 0.12, delay * 1000);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Change: the line evaporates left to right, then the new line forms out of the same blur, left to right.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (text === shown) return;
    const node = host.current;
    if (!node || reduced || !node.animate) {
      setShown(text);
      return;
    }
    swapping.current = true;
    const list = letters(),
      step = stagger(list.length, LEAVE),
      blur = parseFloat(getComputedStyle(node).fontSize) * 0.12;
    let cancelled = false;
    Promise.all(
      list.map((letter, i) =>
        letter.animate([{ opacity: 1, filter: "blur(0px)" }, { opacity: 0, filter: `blur(${blur}px)` }], {
          duration: LEAVE.letter,
          delay: i * step,
          easing: strong,
          fill: "forwards",
        }).finished,
      ),
    ).then(
      () => !cancelled && setShown(text),
      () => !cancelled && setShown(text),
    );
    return () => {
      cancelled = true;
    };
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (!swapping.current) return;
    swapping.current = false;
    const node = host.current;
    if (!node) return;
    sweepIn(letters(), parseFloat(getComputedStyle(node).fontSize) * 0.12, 20);
  }, [shown]);
  const words = shown.split(" ");
  return createElement(
    as,
    {
      id,
      className,
      tabIndex: as === "h1" ? -1 : undefined,
      "aria-label": shown,
      ref: (node: HTMLElement | null) => {
        host.current = node;
        if (typeof focusRef === "function") focusRef(node);
        else if (focusRef) (focusRef as React.MutableRefObject<HTMLElement | null>).current = node;
      },
    },
    words.map((word, w) => (
      <span key={`${shown}-${w}`} aria-hidden="true">
        <span className="vt-w">
          {[...word].map((letter, l) => (
            <span key={l} className="vt-l">
              {letter}
            </span>
          ))}
        </span>
        {w < words.length - 1 ? " " : null}
      </span>
    )),
  );
}

/** ShimmeringText, ported from ElevenLabs UI by way of the website (§9): a light band sweeps the text every 2.5s. */
export function Shimmer({ children, reduced, className = "" }: { children: string; reduced: boolean; className?: string }) {
  const node = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const span = node.current;
    if (!span || reduced || !span.animate) return;
    const fade = span.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, fill: "backwards", easing: "ease" });
    const sweep = span.animate(
      [
        { backgroundPosition: "100% center", offset: 0 },
        { backgroundPosition: "0% center", offset: 0.8 },
        { backgroundPosition: "0% center", offset: 1 },
      ],
      { duration: 2500, iterations: Infinity, easing: "linear" },
    );
    return () => {
      fade.cancel();
      sweep.cancel();
    };
  }, [reduced]);
  return (
    <span ref={node} className={`vt-shimmer ${className}`} data-reduced={reduced || undefined} style={{ ["--spread" as string]: `${children.length * 2}px` }}>
      {children}
    </span>
  );
}
