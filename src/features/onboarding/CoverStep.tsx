import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { runtime } from "../../runtime/client";
import { readNewTabPreferences, updateNewTabPreferences } from "../../ui/newTabPreferences";
import { artworkCollectionChoice, collectionPreview, type ArtworkCollection } from "../../ui/artworkCollections";
import { artworkError, usePersonalArtwork } from "../../ui/usePersonalArtwork";
import { motionScale, springEasing, springFlight, springs, type MotionClass, type SpringFlight, type SpringSpec } from "../../ui/sharedMotion";
import { CheckMark } from "../../components/CheckMark";
import { ChevronLeft, ChevronRight } from "../../components/AppIcons";
import type { StepContext } from "./steps";
import { t, useT, type MessageId } from "../../i18n";
import { coverEdges, coverPageTarget, coverReveal, coverSnap } from "./coverRow";

/* R3-64: the setup step that chooses the new tab's cover. A skeleton of the browser (loading-style, not fully drawn) shows the
   new tab as it will open, with the cover exactly where it sits there; under it a row of collection cards scrolls sideways.
   Picking crossfades the preview's picture to that collection. Continue writes the same profile preference as Settings › New tab
   (collection, personal image, "Show artwork"); Skip leaves it as it was. Nothing is fetched here: the remote collections are
   drawn as local illustrations until the first new tab asks for a real picture.
   R4-51: everything that moves here is on the house springs and reads the speed setting (Off = instant):
   - the card row glides on a spring script (arrows by a page, the mouse wheel, the keyboard, a click on a half-hidden card),
     snaps to a card when it rests, and fades its edges in step with the scroll position; nothing native jumps it;
   - the preview decodes the next picture first and crossfades it over the old one (no blank frame, no size change);
   - "No image" is the real new tab without a picture: the picture fades and shrinks away while the search bar and the
     tiles glide down to the centre, and back. Only transform and opacity move. */

type Pick = ArtworkCollection | "own" | "none";
// "No image" comes first; Paintings stays the one selected by default (the new tab's own default collection).
const cards: { id: Pick; label: MessageId; line: MessageId }[] = [
  { id: "none", label: "setup.cover.none", line: "setup.cover.lineNone" },
  { id: "built-in", label: "setup.cover.paintings", line: "setup.cover.lineBuiltIn" },
  { id: "landscapes", label: "setup.cover.landscapes", line: "setup.cover.lineCommons" },
  { id: "nature", label: "setup.cover.nature", line: "setup.cover.lineCommons" },
  { id: "architecture", label: "setup.cover.architecture", line: "setup.cover.lineCommons" },
  { id: "space", label: "setup.cover.space", line: "setup.cover.lineCommons" },
  { id: "own", label: "setup.cover.own", line: "setup.cover.lineOwn" },
];

/** One bundled picture per collection (public/artwork/cover-samples, R4-05): a real photograph from that collection (a painting
 * for Paintings), so every card and the preview show a representative image with no network request. The same pictures stand
 * for the collections in Settings (ui/artworkCollections.ts). The collections are only represented by these during setup
 * (the preview says "Example"); the real picture arrives with the first new tab. Exported so setup can decode them early. */
export const coverSamples: Record<string, string> = {
  ...collectionPreview,
  own: "/artwork/cover-samples/own.jpg",
  none: "",
};
const sample = coverSamples as Record<Pick, string>;
/** Every collection's preview is an example of it (Paintings included, R4-51); a picture of your own is not. */
const example = (id: Pick) => id !== "own" && id !== "none";

/** The springs of this step (house family, research §3.2): the row glides and snaps critically damped (no overshoot jitter),
 * the wheel follows on the quick latency-bound spring, the picture crossfades in ~260 ms, the layout morph has the slight life
 * of `morph` and leaves on the shorter, damped way out. */
const glideSpring = springs.settle;
const wheelSpring = springs.quick;
const crossfade: SpringSpec = { duration: 0.26, bounce: 0 };
const fadeOut: SpringSpec = { duration: 0.17, bounce: 0 };

export function CoverStep({ profileId, artwork, reducedMotion, stepApi }: StepContext) {
  useT();
  const initial = readNewTabPreferences(profileId);
  const modules = initial.modules;
  const start: Pick = !initial.modules.artwork ? "none" : initial.artwork.startsWith("personal:") ? "own" : initial.collection;
  const [pick, setPick] = useState<Pick>(start);
  const personal = usePersonalArtwork(profileId, false, Boolean(runtime.platform));
  const [ownId, setOwnId] = useState(initial.artwork.startsWith("personal:") ? initial.artwork.slice(9) : "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const row = useRef<HTMLDivElement>(null);
  const before = useRef<HTMLButtonElement>(null);
  const after = useRef<HTMLButtonElement>(null);
  const page = useRef<HTMLDivElement>(null);
  const layers = useRef<HTMLDivElement>(null);
  const ownUrl = personal.assets.find((asset) => asset.id === ownId)?.url;
  const scaleOf = (cls: MotionClass) => (reducedMotion ? 0 : motionScale(cls));
  const scaleRef = useRef(scaleOf);
  scaleRef.current = scaleOf;
  // Continue writes the profile's own preference (the same one Settings › New tab edits); Skip never calls this.
  const commit = () => {
    const now = readNewTabPreferences(profileId);
    const modules = { ...now.modules, artwork: pick !== "none" };
    if (pick === "none") updateNewTabPreferences(profileId, { modules });
    else if (pick === "own") {
      if (ownId) updateNewTabPreferences(profileId, { artwork: "personal:" + ownId, daily: false, modules });
    } else updateNewTabPreferences(profileId, { ...artworkCollectionChoice(pick, now.artwork), modules });
  };
  if (stepApi) stepApi.current.apply = commit;
  useEffect(
    () => () => {
      if (stepApi) stepApi.current.apply = undefined;
    },
    [stepApi],
  );
  const choose = async (id: Pick) => {
    setProblem("");
    if (id !== "own") return setPick(id);
    // Your image: use the picture already added, or open the system's file chooser (the same service as Settings).
    const latest = ownId || personal.assets[personal.assets.length - 1]?.id || "";
    if (latest && pick !== "own") {
      setOwnId(latest);
      return setPick("own");
    }
    // The row's radios are disabled while the chooser is open, which drops focus to the page: put it back where it was, so the arrow keys keep working.
    const focused = document.activeElement;
    setBusy(true);
    try {
      const result = await runtime.service({ type: "artwork.import" });
      if (result.artwork?.addedId) {
        await personal.refresh();
        setOwnId(result.artwork.addedId);
        setPick("own");
      }
    } catch (reason) {
      setProblem(artworkError(reason, t("ntp.addFailed")));
    } finally {
      setBusy(false);
      requestAnimationFrame(() => { if (focused instanceof HTMLElement && focused.isConnected && document.activeElement === document.body) focused.focus({ preventScroll: true }); });
    }
  };

  /* ── The row: one spring in flight at a time, retargeted with its velocity kept, so repeated clicks, wheel notches and
     keys chain into one continuous glide. Positions are distances from the row's start (scrollLeft is negative in RTL). ── */
  const glide = useRef<{ flight: SpringFlight; target: number; frame: number } | null>(null);
  const known = useRef(0);
  const restTimer = useRef(0);
  const rowSign = () => (row.current && getComputedStyle(row.current).direction === "rtl" ? -1 : 1);
  const at = () => Math.abs(row.current?.scrollLeft ?? 0);
  const reach = () => (row.current ? Math.max(0, row.current.scrollWidth - row.current.clientWidth) : 0);
  const place = (value: number, sign: number) => {
    if (row.current) row.current.scrollLeft = sign * value;
  };
  const stopGlide = () => {
    if (glide.current) cancelAnimationFrame(glide.current.frame);
    glide.current = null;
  };
  const glideTo = (target: number, spec: SpringSpec, cls: MotionClass) => {
    const node = row.current;
    if (!node) return;
    const sign = rowSign();
    target = Math.min(reach(), Math.max(0, target));
    const now = performance.now();
    const scale = scaleRef.current(cls);
    const state = glide.current ? glide.current.flight.at(now) : { value: at(), velocity: 0 };
    stopGlide();
    if (!scale || (Math.abs(target - state.value) < 0.5 && Math.abs(state.velocity) < 20)) {
      place(target, sign);
      return;
    }
    const flight = springFlight(spec, state.value, target, now, scale, state.velocity);
    const tick = (time: number) => {
      const current = glide.current;
      if (!current || current.flight !== flight) return;
      if (flight.done(time)) {
        place(target, sign);
        glide.current = null;
        return;
      }
      place(flight.at(time).value, sign);
      current.frame = requestAnimationFrame(tick);
    };
    glide.current = { flight, target, frame: requestAnimationFrame(tick) };
  };
  const snapPoints = () => {
    const node = row.current;
    if (!node) return [0];
    const box = node.getBoundingClientRect();
    const sign = rowSign();
    const offset = at();
    // Each card's start, measured from the row's start; the row's own 4px padding stays in view so the ring is never cut.
    const starts = [...node.querySelectorAll<HTMLElement>(".fr-cover-card")].map((card) => {
      const r = card.getBoundingClientRect();
      return offset + (sign > 0 ? r.left - box.left : box.right - r.right) - 4;
    });
    return [...starts, reach()];
  };
  // The arrows move the row by most of its width, landing on a card's edge, so the rest needs no correction.
  const scrollRow = (direction: 1 | -1) => {
    const from = glide.current?.target ?? at();
    glideTo(coverPageTarget(snapPoints(), from, direction, row.current?.clientWidth ?? 0, reach()), glideSpring, "S");
  };
  // After the wheel or a touchpad rests, the row settles on the nearest card, on the same spring (it never fights a glide).
  const settleLater = () => {
    window.clearTimeout(restTimer.current);
    restTimer.current = window.setTimeout(() => {
      const from = glide.current?.target ?? at();
      const target = coverSnap(snapPoints(), from, reach());
      if (Math.abs(target - from) > 0.5) glideTo(target, glideSpring, "S");
    }, 180);
  };
  // Edges: the fade on each side grows with the distance left to scroll (so it is gone exactly when the end arrives) and the
  // round arrow on that side fades in or out. Written straight to the elements: scrolling never re-renders the step.
  const paintEdges = () => {
    const node = row.current;
    if (!node) return;
    const edges = coverEdges(at(), reach());
    known.current = at();
    node.style.setProperty("--fr-fade-l", edges.fadeStart + "px");
    node.style.setProperty("--fr-fade-r", edges.fadeEnd + "px");
    before.current?.toggleAttribute("data-shown", edges.start);
    after.current?.toggleAttribute("data-shown", edges.end);
    // While the row moves the cards don't lift under a resting pointer (that read as a flicker on the ring).
    node.dataset.moving = "";
    window.clearTimeout(movingTimer.current);
    movingTimer.current = window.setTimeout(() => node.removeAttribute("data-moving"), 140);
  };
  const movingTimer = useRef(0);
  useLayoutEffect(() => {
    const node = row.current;
    if (!node) return;
    paintEdges();
    node.removeAttribute("data-moving");
    const resize = new ResizeObserver(() => paintEdges());
    resize.observe(node);
    // The mouse wheel turns the row (a vertical notch becomes a glide, not a 100px jump); a touchpad's own sideways scroll is
    // already smooth, so it is left alone and only snapped when it rests. At either end the wheel goes back to the page.
    const wheel = (event: WheelEvent) => {
      const limit = reach();
      if (limit <= 0) return;
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
        stopGlide();
        settleLater();
        return;
      }
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? node.clientWidth : 1;
      const from = glide.current?.target ?? at();
      const target = Math.min(limit, Math.max(0, from + event.deltaY * unit));
      if (Math.abs(target - from) < 0.5) return;
      event.preventDefault();
      glideTo(target, wheelSpring, "L");
      settleLater();
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => {
      resize.disconnect();
      node.removeEventListener("wheel", wheel);
      stopGlide();
      window.clearTimeout(restTimer.current);
      window.clearTimeout(movingTimer.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Bring a card fully into view on the glide (keyboard, Tab, or a click on a half-hidden card).
  const reveal = (card: Element | null) => {
    const node = row.current;
    if (!node || !card) return;
    const box = node.getBoundingClientRect();
    const r = card.getBoundingClientRect();
    const sign = rowSign();
    const from = glide.current?.target ?? at();
    const start = at() + (sign > 0 ? r.left - box.left : box.right - r.right);
    const target = coverReveal(start, r.width, from, node.clientWidth, reach());
    if (Math.abs(target - from) > 0.5) glideTo(target, glideSpring, "S");
  };
  // Focus moves the row natively, at once (Chromium scrolls a focused control into view). Put it back where it was in the same
  // task (nothing is painted in between) and glide there instead.
  const onFocus = (event: React.FocusEvent<HTMLInputElement>) => {
    const node = row.current;
    if (node && !glide.current && Math.abs(at() - known.current) > 0.5) place(known.current, rowSign());
    reveal(event.currentTarget.closest("label"));
  };
  // ←/→ (and ↑/↓, as radios do) move the selection and keep it in view on the glide; the native radio keys would jump the row.
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const steps: Record<string, number> = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };
    let move = steps[event.key];
    if (!move || busy || event.altKey || event.ctrlKey || event.metaKey || !(event.target instanceof HTMLInputElement)) return;
    if (rowSign() < 0 && (event.key === "ArrowLeft" || event.key === "ArrowRight")) move = -move;
    event.preventDefault();
    const index = cards.findIndex((card) => card.id === pick);
    const next = (index + move + cards.length) % cards.length;
    const input = row.current?.querySelectorAll<HTMLInputElement>("input[type=radio]")[next];
    input?.focus({ preventScroll: true });
    void choose(cards[next].id);
  };

  /* ── The preview ── */
  const painting = artwork.id === "met-436535" ? sample["built-in"] : artwork.thumb || artwork.src;
  const lineId = cards.find((card) => card.id === pick)?.line ?? "setup.cover.lineBuiltIn";
  // The picture the preview holds: under "No image" it keeps the last one (the frame fades away with it, and comes back with it).
  const lastArt = useRef<Pick>(start === "none" ? "built-in" : start);
  if (pick !== "none") lastArt.current = pick;
  const artPick = lastArt.current;
  const artSrc = artPick === "built-in" ? painting : artPick === "own" ? ownUrl || sample.own : sample[artPick];
  const shownSrc = useRef("");
  const ticket = useRef(0);
  const shownPick = useRef(pick);
  useLayoutEffect(() => {
    const host = layers.current;
    if (!host || !artSrc || artSrc === shownSrc.current) return;
    const mine = ++ticket.current;
    // The frame is hidden or only now coming back: swap at once (the old picture must not show through); otherwise the new one
    // is decoded first and crossfades over the old one, which stays in place until it is covered.
    const hidden = shownPick.current === "none" || !host.firstElementChild;
    const image = new Image();
    image.className = "fr-cover-img";
    image.alt = "";
    image.draggable = false;
    image.src = artSrc;
    const put = (fade: boolean) => {
      if (mine !== ticket.current) return;
      shownSrc.current = artSrc;
      const layer = document.createElement("div");
      layer.className = "fr-cp-layer";
      layer.append(image);
      host.append(layer);
      const below = () => {
        while (host.firstElementChild && host.firstElementChild !== layer) host.firstElementChild.remove();
      };
      const scale = fade ? scaleRef.current("E") : 0;
      if (!scale) return below();
      const { duration, easing } = springEasing(crossfade, scale);
      layer.animate([{ opacity: 0 }, { opacity: 1 }], { duration, easing, fill: "backwards" }).finished.then(below, () => undefined);
    };
    if (hidden) {
      while (host.firstElementChild) host.firstElementChild.remove();
      if (image.complete && image.naturalWidth) return put(false);
    }
    image.decode().then(
      () => put(true),
      () => put(true),
    );
  }, [artSrc]);
  useLayoutEffect(() => {
    shownPick.current = pick;
  }, [pick]);
  // How far the search bar and tiles drop to sit in the middle of the page when there is no picture (layout offsets ignore
  // transforms, so this is the same mid-flight).
  useLayoutEffect(() => {
    const node = page.current;
    if (!node) return;
    const measure = () => {
      const lifts = [...node.querySelectorAll<HTMLElement>(":scope > .fr-cp-lift")];
      if (!lifts.length) return;
      const style = getComputedStyle(node);
      const padTop = Number.parseFloat(style.paddingTop) || 0;
      const padBottom = Number.parseFloat(style.paddingBottom) || 0;
      const top = lifts[0].offsetTop;
      const last = lifts[lifts.length - 1];
      const height = last.offsetTop + last.offsetHeight - top;
      const centre = padTop + (node.clientHeight - padTop - padBottom - height) / 2;
      node.style.setProperty("--fr-cp-drop", Math.max(0, Math.round(centre - top)) + "px");
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(node);
    return () => resize.disconnect();
  }, []);
  const moveIn = springEasing(springs.morph, scaleOf("S"));
  const moveOut = springEasing(glideSpring, scaleOf("S"));
  const fadeIn = springEasing(springs.settle, scaleOf("E"));
  const fadeAway = springEasing(fadeOut, scaleOf("E"));
  const timing = {
    "--fr-cp-in-ms": moveIn.duration + "ms",
    "--fr-cp-in-ease": moveIn.easing,
    "--fr-cp-out-ms": moveOut.duration + "ms",
    "--fr-cp-out-ease": moveOut.easing,
    "--fr-cp-fade-in-ms": fadeIn.duration + "ms",
    "--fr-cp-fade-in-ease": fadeIn.easing,
    "--fr-cp-fade-out-ms": fadeAway.duration + "ms",
    "--fr-cp-fade-out-ease": fadeAway.easing,
    "--fr-cp-follow": 30 * scaleOf("S") + "ms",
  } as CSSProperties;
  const tiles = modules.shortcuts || modules.saved || modules.recent;
  const lineScale = scaleOf("E");
  const thumb = (id: Pick) =>
    id === "built-in" ? (
      <img className="fr-cover-img" src={painting} alt="" draggable={false} decoding="async" />
    ) : id === "own" ? (
      <>
        <img className="fr-cover-img" src={ownUrl || sample.own} alt="" draggable={false} decoding="async" />
        {!ownUrl && <span className="fr-cover-plus" />}
      </>
    ) : id === "none" ? (
      // A new tab with no picture: its search bar and tiles, nothing else.
      <span className="fr-cover-none">
        <i className="fr-cover-none-search" />
        <span className="fr-cover-none-tiles">
          <i />
          <i />
          <i />
          <i />
        </span>
      </span>
    ) : (
      <img className="fr-cover-img" src={sample[id]} alt="" draggable={false} decoding="async" />
    );
  return (
    <div className="fr-cover" style={timing}>
      <div className="fr-cover-preview" aria-hidden="true">
        <div className="fr-cp-chrome">
          <div className="fr-cp-tabs">
            <i className="fr-skel fr-cp-tab" data-on="" />
            <i className="fr-skel fr-cp-tab" />
            <i className="fr-skel fr-cp-plus" />
          </div>
          <div className="fr-cp-bar">
            <i className="fr-skel fr-cp-dot" />
            <i className="fr-skel fr-cp-dot" />
            <i className="fr-skel fr-cp-dot" />
            <i className="fr-skel fr-cp-address" />
          </div>
        </div>
        <div ref={page} className="fr-cp-page" data-none={pick === "none" || undefined}>
          {(modules.mark || modules.name) && (
            <div className="fr-cp-head fr-cp-lift">
              {modules.mark && <i className="fr-skel fr-cp-mark" />}
              {modules.name && <i className="fr-skel fr-cp-name" />}
            </div>
          )}
          {modules.search && <i className="fr-skel fr-cp-search fr-cp-lift" />}
          {tiles && (
            <div className="fr-cp-tiles fr-cp-lift" data-follow="">
              {[0, 1, 2, 3, 4, 5].map((index) => (
                <i key={index} className="fr-skel" />
              ))}
            </div>
          )}
          <div className="fr-cp-art">
            <div ref={layers} className="fr-cp-layers" />
            <span className="fr-cp-tag" data-shown={example(artPick) || undefined}>
              {t("setup.cover.example")}
            </span>
          </div>
        </div>
      </div>
      <p className="fr-cover-line" role="status">
        <AnimatePresence initial={false}>
          <motion.span
            key={lineId}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 * lineScale, ease: [0.2, 0, 0, 1] }}
          >
            {t(lineId)}
          </motion.span>
        </AnimatePresence>
      </p>
      <fieldset className="fr-cover-set">
        <legend className="fr-visually-hidden">{t("setup.cover.legend")}</legend>
        <div ref={row} className="fr-cover-row" onScroll={paintEdges} onKeyDown={onKeyDown}>
          {cards.map((card) => (
            <label key={card.id} className="fr-cover-card" data-busy={busy && card.id === "own" ? "" : undefined}>
              <input
                className="fr-visually-hidden"
                type="radio"
                name="fr-cover"
                checked={pick === card.id}
                disabled={busy}
                onChange={() => void choose(card.id)}
                onClick={() => card.id === "own" && pick === "own" && void choose("own")}
                onFocus={onFocus}
              />
              <span className="fr-cover-thumb">
                {thumb(card.id)}
                <span className="fr-cover-tick" aria-hidden="true">
                  <CheckMark size={12} />
                </span>
              </span>
              <span className="fr-cover-ring" aria-hidden="true" />
              <span className="fr-cover-name">{t(card.label)}</span>
            </label>
          ))}
        </div>
        <button ref={before} type="button" className="fr-cover-more" data-side="start" tabIndex={-1} aria-hidden="true" onClick={() => scrollRow(-1)}>
          <ChevronLeft size={14} />
        </button>
        <button ref={after} type="button" className="fr-cover-more" data-side="end" tabIndex={-1} aria-hidden="true" onClick={() => scrollRow(1)}>
          <ChevronRight size={14} />
        </button>
      </fieldset>
      {problem && (
        <p className="fr-note" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
