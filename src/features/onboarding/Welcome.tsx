import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowRight, ChevronDown, Globe2 } from "../../components/AppIcons";
import { BrandLogo } from "../../components/BrandLogo";
import { CheckMark } from "../../components/CheckMark";
import { currentLocale, useT } from "../../i18n";
import { LOCALES, resolveLocale } from "../../i18n/locales";
import { VaporText } from "./vapor";
import "./welcome.css";

/** The welcome moment (bible §11; layout and type from I's Apple concept, step 0): no card — the lockup with a quiet
 * Beta, the hero line, the lede, Use defaults beside Get started, and a footnote near the bottom.
 *
 * One ~1.6s sequence with the light behind it (PrismField's entrance): the lockup vapors in with a left-to-right
 * sweep — blur and opacity resolving to crisp behind a soft travelling edge — then the hero forms letter by letter
 * (vapor.tsx, website motion.js §3c), then the lede, the actions and the footnote. Everything is in place and
 * interactive from the first frame (entrances only fill backwards), so input is never blocked; resting elements carry
 * no filter or mask. Reduced motion: one short fade. */

const strong = "cubic-bezier(.23, 1, .32, 1)";
// Seconds from mount: the source has ignited and the beams are reaching out when the lockup starts to form.
const LOCKUP = 0.35,
  HERO = 0.55,
  LEDE = 0.95,
  ACTIONS = 1.05;
const SWEEP = "linear-gradient(90deg, #000 0 40%, transparent 60% 100%)";

export function Welcome({
  tone,
  reduced,
  busy,
  onStart,
  onDefaults,
  onReady,
  language,
  onLanguage,
}: {
  tone: "dark" | "light";
  reduced: boolean;
  busy: boolean;
  onStart: () => void;
  onDefaults: () => void;
  /** Called on mount: Enter may begin at once. */
  onReady?: () => void;
  /** The interface language setting ("system" follows Windows) and how to change it. */
  language: string;
  onLanguage: (language: string) => void;
}) {
  const t = useT();
  const root = useRef<HTMLDivElement>(null),
    lockup = useRef<HTMLDivElement>(null),
    lede = useRef<HTMLParagraphElement>(null),
    actions = useRef<HTMLDivElement>(null),
    ready = useRef(onReady);
  ready.current = onReady;
  useEffect(() => ready.current?.(), []);
  useLayoutEffect(() => {
    const animations: Animation[] = [];
    const play = (node: Element | null, frames: Keyframe[], delay: number, duration: number) => {
      if (node?.animate) animations.push(node.animate(frames, { delay: delay * 1000, duration: duration * 1000, easing: strong, fill: "backwards" }));
    };
    if (reduced) {
      play(root.current, [{ opacity: 0 }, { opacity: 1 }], 0, 0.2);
      return () => animations.forEach((animation) => animation.cancel());
    }
    // The lockup condenses left to right: a soft edge travels across it while its blur clears.
    play(
      lockup.current,
      [
        { opacity: 0, filter: "blur(8px)", maskImage: SWEEP, webkitMaskImage: SWEEP, maskSize: "250% 100%", webkitMaskSize: "250% 100%", maskPosition: "100% 0", webkitMaskPosition: "100% 0" },
        { opacity: 1, filter: "blur(0px)", maskImage: SWEEP, webkitMaskImage: SWEEP, maskSize: "250% 100%", webkitMaskSize: "250% 100%", maskPosition: "0% 0", webkitMaskPosition: "0% 0" },
      ],
      LOCKUP,
      0.62,
    );
    const rise = [
      { opacity: 0, filter: "blur(4px)", transform: "translateY(4px)" },
      { opacity: 1, filter: "blur(0px)", transform: "none" },
    ];
    play(lede.current, rise, LEDE, 0.45);
    play(actions.current, rise, ACTIONS, 0.45);
    return () => animations.forEach((animation) => animation.cancel());
  }, [reduced]);
  return (
    <>
      <div ref={root} className="fr-w">
        <div ref={lockup} className="fr-w-lockup">
          <BrandLogo tone={tone === "dark" ? "white" : "color"} />
          <span className="fr-w-beta">{t("setup.welcome.beta")}</span>
        </div>
        <VaporText as="h1" id="fr-title" className="fr-w-hero" text={t("setup.welcome.hero")} reduced={reduced} delay={HERO} />
        {/* Each sentence holds together, so the line can only break between them. */}
        <p ref={lede} className="fr-w-lede">
          <span>{t("setup.welcome.lede")}</span>
        </p>
        <div ref={actions} className="fr-w-actions">
          <button className="fr-secondary fr-defaults" type="button" disabled={busy} onClick={onDefaults}>
            {t("setup.welcome.defaults")}
          </button>
          <button className="fr-primary fr-go" type="button" data-onboarding-next disabled={busy} onClick={onStart}>
            {t("setup.welcome.start")}
            <ArrowRight size={14} />
          </button>
        </div>
      </div>
      <LanguagePicker value={language} onChange={onLanguage} />
    </>
  );
}

/** The setup's language, on the welcome only (bottom left, opposite nothing that competes with Get started): a quiet
 * button with the language's own name, opening a short list — "Same as Windows" first (the default), then each
 * language in its own name. Choosing applies at once (the whole setup re-renders in it) and is the same setting as
 * Settings › Languages. While the list is open it owns Escape, Enter and the arrows, ahead of setup's own keys. */
function LanguagePicker({ value, onChange }: { value: string; onChange: (language: string) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null),
    list = useRef<HTMLUListElement>(null);
  const system = resolveLocale("system", navigator.language);
  const nativeOf = (code: string) => LOCALES.find((locale) => locale.code === code)?.native ?? code;
  const options = [{ value: "system", label: t("language.system"), detail: nativeOf(system) }, ...LOCALES.map((locale) => ({ value: locale.code as string, label: locale.native, detail: "" }))];
  const chosen = options.some((option) => option.value === value) ? value : "system";
  const close = (focus = true) => {
    setOpen(false);
    if (focus) button.current?.focus({ preventScroll: true });
  };
  const choose = (next: string) => {
    if (next !== chosen) onChange(next);
    close();
  };
  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus({ preventScroll: true });
    const keys = (event: KeyboardEvent) => {
      const items = [...(list.current?.querySelectorAll<HTMLElement>('[role="option"]') || [])],
        at = items.indexOf(document.activeElement as HTMLElement);
      if (event.key === "Escape" || event.key === "Tab") {
        if (event.key === "Escape") event.preventDefault();
        event.stopImmediatePropagation();
        close(event.key === "Escape");
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (at >= 0) choose(items[at].dataset.value || "system");
      } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : Math.max(0, Math.min(items.length - 1, at + (event.key === "ArrowDown" ? 1 : -1)));
        items[next]?.focus({ preventScroll: true });
      }
    };
    const outside = (event: PointerEvent) => {
      if (!list.current?.contains(event.target as Node) && !button.current?.contains(event.target as Node)) close(false);
    };
    window.addEventListener("keydown", keys, true);
    window.addEventListener("pointerdown", outside, true);
    return () => {
      window.removeEventListener("keydown", keys, true);
      window.removeEventListener("pointerdown", outside, true);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="fr-w-lang">
      {open && (
        <ul ref={list} className="fr-w-lang-list" role="listbox" aria-label={t("language.title")}>
          {options.map((option) => (
            <li
              key={option.value}
              role="option"
              tabIndex={-1}
              data-value={option.value}
              aria-selected={option.value === chosen}
              onClick={() => choose(option.value)}
            >
              <span>{option.label}</span>
              {option.detail && <small>{option.detail}</small>}
              <CheckMark className="fr-check" data-on={option.value === chosen || undefined} size={14} />
            </li>
          ))}
        </ul>
      )}
      <button
        ref={button}
        className="fr-w-lang-button"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${t("language.title")}: ${nativeOf(currentLocale())}`}
        onClick={() => setOpen((value) => !value)}
      >
        <Globe2 size={14} aria-hidden="true" />
        <span>{nativeOf(currentLocale())}</span>
        <ChevronDown size={12} aria-hidden="true" />
      </button>
    </div>
  );
}
