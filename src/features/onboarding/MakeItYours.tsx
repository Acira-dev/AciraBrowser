import { Segmented } from "../../components/Segmented";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AnimatePresence, motion } from "motion/react";
import { useBrowser } from "../../runtime/client";
import { appearancePalettes, palettePreference } from "../../runtime/appearancePalettes";
import { FinishSwatch } from "../../components/AppearanceControls";
import { endAppearancePreview } from "../../ui/finishPreview";
import { windowViewOf, type WindowView } from "../../runtime/windowView";
import { setTabsLayout, shownView, tabsLayoutOf, viewsOfLayout } from "../../ui/sidebarMode";
import { windowViewDetail, windowViewName } from "../../ui/windowViewText";
import { t, useT, type MessageId } from "../../i18n";
import "./onboarding.css";

/** "Make it yours": shown once, right after a completed setup, over the real browser. Appearance, finish, tab placement and
 * the window view apply live to the browser behind the panel. A finish changes only when it is chosen (click, Enter or
 * Space), never on hover or focus (founder, 24 Oct). Done or Escape closes it; everything stays changeable in
 * Settings. Mounted outside the setup tree because setup has already closed. */
let root: Root | null = null;

export function showMakeItYours({ reducedMotion, onClosed }: { reducedMotion: boolean; onClosed?: () => void }) {
  const app = document.querySelector<HTMLElement>(".app");
  if (!app || root) return;
  const host = document.createElement("div");
  host.className = "fr-yours-host";
  app.appendChild(host);
  root = createRoot(host);
  const close = () => {
    const current = root;
    root = null;
    // Let the panel evaporate before it is removed.
    setTimeout(
      () => {
        current?.unmount();
        host.remove();
        onClosed?.();
        document.querySelector<HTMLInputElement>(".address-bar input")?.focus();
      },
      reducedMotion ? 80 : 200,
    );
  };
  root.render(<MakeItYours reduced={reducedMotion} onClose={close} />);
}

/** A finish's name in the interface language (its stored id is the palette name; the English label is the fallback). */
const paletteIds: Record<string, MessageId> = {
  Porcelain: "palette.porcelain",
  Burgundy: "palette.burgundy",
  "Deep Blue": "palette.navy",
  "Ocean Blue": "palette.ocean",
  "iPhone Blue": "palette.sky",
  "Emerald Green": "palette.emeraldGreen",
  "Alpine Green": "palette.alpineGreen",
  "Deep Purple": "palette.deepPurple",
  "Desert Titanium": "palette.sand",
  "Natural Titanium": "palette.stone",
  Silver: "palette.silver",
  "Black Titanium": "palette.graphite",
};
export const paletteName = (palette: { name: string; label: string }) => (paletteIds[palette.name] ? t(paletteIds[palette.name]) : palette.label);

const strong = [0.23, 1, 0.32, 1] as const;
const precise = [0.2, 0, 0, 1] as const;

function MakeItYours({ reduced, onClose }: { reduced: boolean; onClose: () => void }) {
  const { state, dispatch } = useBrowser();
  useT();
  const settings = state.settings;
  const [open, setOpen] = useState(true);
  const [tone, setTone] = useState<"light" | "dark">("dark");
  const title = useRef<HTMLHeadingElement>(null);
  const finish = appearancePalettes.find(
    (palette) => palette.name === settings.colorPreset && palette.tint.toLowerCase() === settings.browserTint.toLowerCase(),
  );
  useLayoutEffect(() => {
    const app = document.querySelector<HTMLElement>(".app");
    if (!app) return;
    const read = () => setTone((app.dataset.previewTheme || app.dataset.theme) === "dark" ? "dark" : "light");
    read();
    const observer = new MutationObserver(read);
    observer.observe(app, { attributes: true, attributeFilter: ["data-theme", "data-preview-theme"] });
    return () => observer.disconnect();
  }, []);
  const done = () => {
    endAppearancePreview(settings);
    setOpen(false);
    onClose();
  };
  // The title takes focus once, when the panel opens (refocusing it on every render pulled Tab back to it), unless the
  // person already started typing somewhere (Ctrl+L right after Start browsing skips the finale): their text stays theirs.
  useEffect(() => {
    const active = document.activeElement as HTMLElement | null;
    // An empty field is only where the new tab parked focus (the address field always holds it here), so the title still takes it;
    // text in a field is the person's own.
    if (active?.matches("input, textarea, [contenteditable]:not([contenteditable='false'])") && ((active as HTMLInputElement).value ?? active.textContent ?? "") !== "") return;
    title.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        done();
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  });
  const update = (patch: Partial<typeof settings>) => dispatch({ type: "settings.update", patch });
  // The same window-view setting as Settings › Window view. Focus is a mode of its own and is not offered here, so it reads as Comfortable.
  const current = windowViewOf(settings);
  const layout = tabsLayoutOf(settings);
  // With the address bar in the sidebar Compact and Focus look like Full (ui/sidebarMode.ts), so only the views that differ are listed.
  const view = shownView(layout, current === "focus" ? "full" : current) as Exclude<WindowView, "focus">;
  const views = viewsOfLayout(layout, ["full", "compact", "seamless"]) as readonly Exclude<WindowView, "focus">[];
  const choose = (palette: (typeof appearancePalettes)[number]) => update(palettePreference(palette));
  // One row of finishes: arrows and Home/End only move focus; Enter, Space or a click chooses.
  const keys = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")],
      current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (current < 0) return;
    event.preventDefault();
    event.stopPropagation();
    const step = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (current + step + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };
  return (
    <div className="fr-yours" data-tone={tone} data-reduced-motion={reduced || undefined}>
      <AnimatePresence>
        {open && (
          <motion.section
            className="fr-yours-panel"
            role="dialog"
            aria-modal="false"
            aria-labelledby="fr-yours-title"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)", transitionEnd: { filter: "none" } }}
            exit={reduced ? { opacity: 0, transition: { duration: 0.08 } } : { opacity: 0, y: 8, transition: { duration: 0.12, ease: precise } }}
            transition={{ duration: reduced ? 0.12 : 0.32, ease: strong, delay: reduced ? 0 : 0.3 }}
          >
            <h2 id="fr-yours-title" ref={title} tabIndex={-1}>
              {t("yours.title")}
            </h2>
            <p className="fr-yours-sub">{t("yours.sub")}</p>
            <div className="fr-yours-row">
              <span>{t("app.appearance")}</span>
              <Segmented
                label={t("app.appearance")}
                value={settings.appearance}
                options={[["light", t("setup.mode.light")], ["dark", t("setup.mode.dark")], ["system", t("setup.mode.auto")]] as const}
                onChange={(appearance) => update({ appearance })}
              />
            </div>
            <div className="fr-yours-row">
              <span>
                {t("yours.color")}
                <em>{finish ? paletteName(finish) : t("yours.custom")}</em>
              </span>
              <div className="fr-yours-finishes" role="radiogroup" aria-label={t("yours.color")} onKeyDown={keys}>
                {appearancePalettes.map((palette, index) => (
                  <FinishSwatch
                    key={palette.name}
                    finish={palette}
                    selected={palette === finish}
                    tabIndex={palette === finish || (!finish && index === 0) ? 0 : -1}
                    onSelect={() => choose(palette)}
                  />
                ))}
              </div>
            </div>
            <div className="fr-yours-row">
              <span>{t("yours.tabs")}</span>
              <Segmented
                label={t("yours.tabs")}
                value={layout}
                options={[["top", t("yours.tabsTop")], ["sidebar", t("yours.tabsSide")], ["sidebar-address", t("yours.tabsSideAddress")]] as const}
                onChange={(value) => setTabsLayout(state, dispatch, value)}
              />
            </div>
            <div className="fr-yours-row" data-hint="">
              <span>{t("yours.view")}</span>
              <Segmented
                label={t("yours.view")}
                value={view}
                options={views.map((mode) => [mode, windowViewName(mode)] as const)}
                onChange={(windowView) => update({ windowView })}
              />
              <small className="fr-yours-hint" aria-live="polite">{windowViewDetail(view)}</small>
            </div>
            <footer className="fr-yours-foot">
              <button
                className="fr-btn fr-btn-text"
                type="button"
                onClick={() => {
                  dispatch({ type: "tab.new", url: "acira://settings" });
                  done();
                }}
              >
                {t("yours.openSettings")}
              </button>
              <button className="fr-btn fr-btn-primary" type="button" data-yours-done onClick={done}>
                {t("setup.done")}
              </button>
            </footer>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}
