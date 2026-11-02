import { isMac } from '../../ui/platform';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import type {
  SetupClient,
  SetupRequest,
  SetupResult,
  DefaultBrowserStatus,
  ImportBatch,
  ImportSource,
  SetupProgress,
  SetupPreferences,
} from "../../services/accounts/setup-types";
import { runtime, useBrowser } from "../../runtime/client";
import type { BrowserAction } from "../../runtime/types";
import { artworkCatalog, readNewTabPreferences, selectedArtwork, type CatalogArtwork } from "../../ui/newTabPreferences";
import { ArrowRight } from "../../components/AppIcons";
import { BrandIcon } from "../../components/BrandLogo";
import { ProfileAvatar } from "../accounts/profileModel";
import { PrismField } from "./PrismField";
import { SCENE_GRAIN } from "./sceneLook";
import { playFinale, prewarmCapture, prewarmEffects, prewarmFinale } from "./finale";
import { motionScale } from "../../ui/sharedMotion";
import { endAppearancePreview, isDarkAppearance, previewAppearance } from "../../ui/finishPreview";
import { Welcome } from "./Welcome";
import { showMakeItYours } from "./MakeItYours";
import { VaporText } from "./vapor";
import { isSkipped, nativeMoves, nextStep, visibleSteps, type Direction, type FlowFacts, type SetupStep } from "./flow";
import { AppearanceStep, DefaultStep, ImportStep, PrivacyStep, ProfileStep, SearchStep, listOf, useImporter, useProtectionFacts, type ImportRun, type StepApi, type StepContext } from "./steps";
import { CoverStep, coverSamples } from "./CoverStep";
import { t, useT, type MessageId } from "../../i18n";
import "./onboarding.css";

type OnboardingProps = {
  client: SetupClient;
  profileId: string;
  onDone: () => void;
};

/** Hero moments ease out long; UI swaps are short and precise (DESIGN_LANGUAGE: Motion). */
const hero = [0.16, 1, 0.3, 1] as const;
const precise = [0.2, 0, 0, 1] as const;
const media = (query: string) => typeof matchMedia === "function" && matchMedia(query).matches;

export function Onboarding(props: OnboardingProps) {
  return <ProfileOnboarding key={props.profileId} {...props} />;
}

/** The new tab's painting, shown only inside the appearance previews (artwork belongs to the new tab). */
function previewArtwork(profileId: string): CatalogArtwork {
  try {
    const artwork = selectedArtwork(readNewTabPreferences(profileId), profileId);
    if (artwork) return artwork;
  } catch {}
  return artworkCatalog[0];
}

/** Follows the resolved light/dark tone of the surrounding `.app`, including finishes that force a tone. */
function useTone(node: React.RefObject<HTMLElement | null>, fallback: "light" | "dark") {
  const [tone, setTone] = useState<"light" | "dark">(fallback);
  useLayoutEffect(() => {
    const app = node.current?.closest<HTMLElement>(".app");
    if (!app) return;
    const read = () => setTone(app.dataset.theme === "dark" ? "dark" : "light");
    read();
    const observer = new MutationObserver(read);
    observer.observe(app, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, [node]);
  return tone;
}

type PanelStep = Exclude<SetupStep, "welcome">;
/** A subtitle as its sentences, each kept on one line (bible §3.11: non-breaking spaces inside fixed phrases), so the
 * balanced subtitle breaks only between sentences ("…the address bar. / You can switch any time."), never inside a
 * phrase. Every English sentence fits the 440px measure on its own; a longer translated one (over 56 characters, as
 * German and French often are) may wrap inside itself rather than overflow. */
const nbsp = String.fromCharCode(0xa0),
  joiner = String.fromCharCode(0x2060); // after a hyphen ("sign-ins"): keeps the phrase together in any face
const sentences = (...parts: string[]) =>
  parts.map((part) => (part.length > 56 ? part : part.split(" ").join(nbsp).split("-").join("-" + joiner))).join(" ");
/** One short sentence for the title; the line says what happens, then the reassurance (I's Apple concept). */
const stepIds: Record<PanelStep, [MessageId, ...MessageId[]]> = {
  import: ["setup.import.title", "setup.import.line1", "setup.import.line2"],
  profile: ["setup.profile.title", "setup.profile.line1", "setup.profile.line2"],
  appearance: ["setup.look.title", "setup.look.line1", "setup.look.line2"],
  cover: ["setup.cover.title", "setup.cover.line1"],
  search: ["setup.search.title", "setup.search.line1", "setup.search.line2"],
  privacy: ["setup.privacy.title", "setup.privacy.line1"],
  default: ["setup.default.title", "setup.default.line1", "setup.default.line2"],
  finish: ["setup.finish.title", "setup.finish.line1", "setup.finish.line2"],
};
const stepCopy = (step: PanelStep) => {
  const [title, ...lines] = stepIds[step];
  return { title: t(title), line: sentences(...lines.map((id) => t(isMac() && id === 'setup.look.line1' ? 'setup.look.line1.mac' : isMac() && id === 'setup.default.line2' ? 'setup.default.line2.mac' : id))) };
};
/** A profile made from another browser's profile sets these three when it is first opened. */
const quickSteps = ["appearance", "search", "privacy"] as const;
/** Card condense and step change (concept MOTION): strong ease in, quick precise ease out. */
const strong = [0.23, 1, 0.32, 1] as const;
/** One restrained light pose for each decision, independent of skipped steps. The renderer settles in 800ms. */
const lightPoses: Record<SetupStep, readonly [number, number, number]> = {
  welcome: [0, 0, 0], import: [.34, -.06, .02], profile: [.40, .03, -.04],
  appearance: [.31, -.08, -.03], cover: [.37, .02, -.05], search: [.42, .06, .02], privacy: [.36, -.03, .06],
  default: [.43, .07, -.04], finish: [.34, 0, 0],
};

function ProfileOnboarding({ client, profileId, onDone }: OnboardingProps) {
  const { state, dispatch } = useBrowser();
  useT();
  const settings = state.settings;
  const reducedMotion = settings.reducedMotion || media("(prefers-reduced-motion: reduce)");
  const reducedTransparency =
    settings.reducedTransparency || media("(prefers-reduced-transparency: reduce)") || media("(prefers-contrast: more)");
  // The card's material springs read the speed setting (effects class: 1.4 Premium, 1 Fast); Off is as quiet as reduced.
  const cardScale = motionScale("E"),
    quietMotion = reducedMotion || cardScale === 0;
  const [progress, setProgress] = useState<SetupProgress | null>(null);
  const [defaults, setDefaults] = useState<DefaultBrowserStatus>();
  const [preferences, setPreferences] = useState<SetupPreferences>({});
  const [sources, setSources] = useState<ImportSource[] | null>(null);
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [leaving, setLeaving] = useState(false);
  const leavingRef = useRef(false);
  const [welcomeReady, setWelcomeReady] = useState(false);
  const [settle, setSettle] = useState(false);
  const generation = useRef(0),
    onDoneRef = useRef(onDone),
    stageRef = useRef<HTMLElement>(null);
  onDoneRef.current = onDone;
  const artwork = useMemo(() => previewArtwork(profileId), [profileId]);
  // Setup starts dark whatever Windows is set to; the stage follows the app's resolved tone (the stored choice), and the
  // Look step changes it. A change is ONE crossfade of the whole frame, a view transition: the old frame is a snapshot
  // the compositor fades out over the new one, so the scene and the card move on one progress and nothing can stop
  // halfway while the page is busy (the theme commit, the native round trip). The Look step starts it from the click
  // itself, painting the new theme as a preview in the same update, instead of waiting for the setting to come back.
  const resolvedTone = useTone(stageRef, "dark");
  const [tone, setTone] = useState(resolvedTone);
  const born = useRef(performance.now());
  // The crossfade in flight and the tone it is heading to. The saved setting comes back from main while the first
  // crossfade is still capturing (its update has not run yet): starting a second one then aborted the first, and the
  // second captured the already-new frame as its "old" one, so the Look step landed as a hard cut. One crossfade per
  // change now; the attribute that times it belongs to the crossfade that set it.
  const switching = useRef<{ to: "light" | "dark"; id: number } | null>(null);
  const switchId = useRef(0);
  const toneSwitch = useRef<{ skipTransition(): void } | null>(null);
  const latestSettings = useRef(settings); latestSettings.current = settings;
  useEffect(() => () => { ++switchId.current; toneSwitch.current?.skipTransition(); switching.current = null; delete document.documentElement.dataset.frSwitch; endAppearancePreview(latestSettings.current); }, []);
  useEffect(() => {
    const interrupt = () => toneSwitch.current?.skipTransition();
    for (const event of ['pointermove', 'pointerdown', 'keydown']) window.addEventListener(event, interrupt, true);
    return () => { for (const event of ['pointermove', 'pointerdown', 'keydown']) window.removeEventListener(event, interrupt, true); };
  }, []);
  const switchTone = useCallback(
    (next: "light" | "dark", paint?: () => void) => {
      const start = (document as Document & { startViewTransition?: (update: () => void) => { finished: Promise<void>; ready: Promise<void>; skipTransition(): void } })
        .startViewTransition;
      if (switching.current?.to === next) {
        // Already crossfading to it: its update paints this too.
        paint?.();
        return;
      }
      if (reducedMotion || motionScale("E") === 0 || !start || performance.now() - born.current < 600) {
        paint?.();
        setTone(next);
        return;
      }
      toneSwitch.current?.skipTransition();
      const root = document.documentElement,
        id = ++switchId.current;
      switching.current = { to: next, id };
      root.dataset.frSwitch = "";
      const transition = start.call(document, () => flushSync(() => { paint?.(); setTone(next); }));
      toneSwitch.current = transition;
      void transition.ready.catch(() => {});
      void transition.finished.catch(() => {}).finally(() => {
        if (switching.current?.id !== id) return;
        switching.current = null;
        delete root.dataset.frSwitch;
        toneSwitch.current = null;
      });
    },
    [reducedMotion],
  );
  useLayoutEffect(() => {
    if (resolvedTone !== tone && switching.current?.to !== resolvedTone) switchTone(resolvedTone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedTone]);

  const takeResult = useCallback((response: SetupResult) => {
    if (response.progress) setProgress(response.progress);
    if (response.defaults || response.defaultResult) setDefaults(response.defaultResult || response.defaults);
    if (response.preferences) setPreferences(response.preferences);
    if (response.sources) setSources(response.sources);
    if (response.batches) setBatches(response.batches);
  }, []);
  const act = useCallback(
    async (request: SetupRequest) => {
      const current = generation.current;
      setBusy(true);
      setError("");
      try {
        const response = await client.request(request);
        if (current !== generation.current) return null;
        if (!response.ok) {
          setError(response.error?.message || t("setup.error.step"));
          return null;
        }
        takeResult(response);
        return response;
      } catch {
        if (current === generation.current) setError(t("setup.error.step"));
        return null;
      } finally {
        if (current === generation.current) setBusy(false);
      }
    },
    [client, takeResult],
  );

  useEffect(() => {
    const current = ++generation.current;
    void client
      .request({ type: "status" })
      .then((response) => {
        if (current !== generation.current) return;
        if (!response.ok) {
          setError(response.error?.message || t("setup.error.open"));
          return;
        }
        // A profile made from another browser (multi-account import) gets its short setup the first time it opens.
        if (response.progress?.complete && !response.progress.pendingSetup) onDoneRef.current();
        else takeResult(response);
      })
      .catch(() => {
        if (current === generation.current) setError(t("setup.error.openNow"));
      });
    return () => {
      generation.current++;
    };
  }, [client, profileId, takeResult]);

  /** The short setup of a profile made from another browser's profile: Look, Search and Privacy, all skippable. */
  const quick = !!progress?.complete && !!progress.pendingSetup;
  const [quickIndex, setQuickIndex] = useState(0);
  const step: SetupStep = quick ? quickSteps[quickIndex] : progress?.step || "welcome";
  const facts: FlowFacts = {
    sources: sources ?? undefined,
    defaultSupported: defaults?.supported,
    defaultIsDefault: defaults?.isDefault,
  };
  // Detect other browsers early, so an empty import step can be passed over instead of shown.
  useEffect(() => {
    if (!progress || sources !== null || quick) return;
    const current = generation.current;
    void client
      .request({ type: "imports.discover" })
      .then((response) => {
        if (current === generation.current && response.ok && response.sources) setSources(response.sources);
      })
      .catch(() => {});
  }, [client, progress, sources]);
  const moving = useRef(false);
  /** One native move per step passed, so resume always lands on a step that is really shown. The short setup moves
   * locally (nothing to resume: it simply starts again if it is closed half way). */
  const move = async (to: Direction) => {
    if (quick) {
      const next = quickIndex + to;
      if (next >= 0 && next < quickSteps.length) setQuickIndex(next);
      return null;
    }
    // One move at a time: a second key press (Enter twice on Welcome) before the first answer would be worked out from the same
    // step, move again from the new one, and pass over a card that was never shown.
    if (moving.current) return null;
    moving.current = true;
    try {
      const target = nextStep(step, to, facts);
      let count = Math.max(1, Math.abs(nativeMoves(step, target)));
      let response = null;
      while (count-- > 0) {
        response = await act({ type: "move", direction: to });
        if (!response || response.progress?.step === target) break;
      }
      return response;
    } finally {
      moving.current = false;
    }
  };
  /** Setup ends with the browser arriving (finale.ts): from the click, the live browser, already laid out and painted
   * underneath, rises out of the setup light in a view transition. Setup closes (`close`) one frame in, or at once on
   * a key or click during that first frame. */
  const leave = async (skip: boolean, defaults = false) => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    const offerImportUndo = importUndo(importer.run, dispatch);
    const offerSignIn = signInOffer(importer.run, dispatch);
    // Over the arriving browser: what was imported (with Undo), then, if there is anything to sign in to, a nudge to do it.
    const offerUndo = offerImportUndo || offerSignIn ? () => { offerImportUndo?.(); void offerSignIn?.(); } : undefined;
    // Synchronous, so a key that closes it finds the browser's own key handling already in place.
    const close = () =>
      flushSync(() => {
        setLeaving(true);
        onDoneRef.current();
      });
    if (quick) {
      // Done or skipped: either way this profile is set up now, and its window is the browser.
      void client.request({ type: "profile.ready" }).catch(() => {});
      playFinale(stageRef.current, { reduced: reducedMotion, onStart: close, mark: true });
      return;
    }
    if (skip) {
      // Skipping is never blocked on the native write; a failed write only means setup is offered again next launch.
      void client.request({ type: "skip" }).catch(() => {});
      // Skipping still ends on the mark: the short version of the same moment (R4-18).
      playFinale(stageRef.current, { reduced: reducedMotion, onStart: close, onArrive: offerUndo, mark: true, short: true });
      return;
    }
    // Preferences were saved on their own steps. Save the completion marker alongside the click-frame handoff,
    // exactly as Skip does; a failed marker write is reported over the usable browser and setup can reopen next time.
    void client.request({ type: "finish" }).then((response) => {
      if (!response.ok) dispatch({ type: "toast", text: response.error?.message || t("setup.error.step") });
    }).catch(() => dispatch({ type: "toast", text: t("setup.error.step") }));
    // As the browser lands, offer finish and layout live over it ("Make it yours"), after a finished setup only.
    // An import made during setup can still be undone: H's toast over the live browser, once the panel is gone (both
    // sit bottom-centre, so they never stack).
    playFinale(stageRef.current, {
      reduced: reducedMotion,
      mark: true,
      onStart: close,
      onArrive: defaults ? offerUndo : () => showMakeItYours({ reducedMotion, onClosed: offerUndo }),
    });
  };

  const profiles = state.browserProfiles.filter((profile) => !profile.private);
  const importer = useImporter({
    act,
    dispatch,
    sources,
    active: step === "import",
    profile: profiles.find((profile) => profile.id === profileId),
  });
  // In a profile's short setup, Look and Search are that profile's own (profileSettings.ts); the rest stays shared.
  const profileDispatch = useCallback(
    (action: BrowserAction) => {
      if (action.type !== "settings.update") return dispatch(action);
      const { appearance, searchEngine, searchProviders: _shared, ...rest } = action.patch;
      if (appearance || searchEngine)
        dispatch({ type: "browser.profile.settings", id: profileId, patch: { ...(appearance ? { appearance } : {}), ...(searchEngine ? { searchEngine } : {}) } });
      if (Object.keys(rest).length) dispatch({ type: "settings.update", patch: rest });
    },
    [dispatch, profileId],
  );
  // The Look step's choice: the crossfade starts on the click with the new theme previewed on the app, and the setting
  // is saved alongside; when it comes back the preview is dropped (it already shows the same values).
  const chooseAppearance = useCallback(
    (appearance: typeof settings.appearance) => {
      const next = isDarkAppearance({ appearance }) ? "dark" : "light";
      switchTone(next, () => {
        previewAppearance(settings, { appearance });
        (quick ? profileDispatch : dispatch)({ type: "settings.update", patch: { appearance } });
      });
    },
    [settings, dispatch, switchTone, quick, profileDispatch],
  );
  useEffect(() => endAppearancePreview(settings), [settings.appearance]); // eslint-disable-line react-hooks/exhaustive-deps
  const context: StepContext = {
    act,
    busy,
    dispatch: quick ? profileDispatch : dispatch,
    chooseAppearance,
    settings,
    profiles,
    profileId,
    preferences,
    setPreferences,
    defaults,
    sources,
    batches,
    progress,
    artwork,
    reducedMotion,
    importer,
  };

  const presented = useRef(new Set<SetupStep>());
  // Native persistence moves through skipped steps; those transient responses were never shown.
  if (!isSkipped(step, facts)) presented.current.add(step);
  const shown: readonly SetupStep[] = quick ? quickSteps : visibleSteps(facts, presented.current),
    index = shown.indexOf(step);
  const quickProfile = quick ? profiles.find((profile) => profile.id === profileId) : undefined;
  const stage = step === "welcome" ? "welcome" : "dialog";
  // If opening stalls for a second, offer Skip setup anyway. Not from the first frame, so a stall that clears at once
  // never flashes it. (The setup host focuses the dialog itself, App.tsx, so Enter never lands on Skip.)
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    if (progress || error) return;
    const timer = setTimeout(() => setStalled(true), 1000);
    return () => clearTimeout(timer);
  }, [progress, error]);
  // R4-01: on a first run the window stays hidden until setup is ready to be seen; say so once its first frame is drawn
  // (the scene paints on mount). A hidden window may not run frames, so a short timer answers too.
  const painted = useRef(false);
  useEffect(() => {
    if (painted.current || (!progress && !error && !stalled)) return;
    painted.current = true;
    let sent = false;
    const send = () => {
      if (sent) return;
      sent = true;
      void client.request({ type: "painted" }).catch(() => {});
    };
    requestAnimationFrame(() => requestAnimationFrame(send));
    setTimeout(send, 50);
  }, [progress, error, stalled, client]);
  // Escape closes the dialog the way Skip does, except while typing in a field; also while setup is still opening, so a
  // status call that never answers can't trap anyone.
  useEffect(() => {
    if (leaving || (!progress && error)) return;
    const listener = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // A field where text is typed (or a list that Escape closes) keeps the key; a radio, checkbox or switch is not one.
      if ((event.target as HTMLElement | null)?.closest?.("textarea,select,input:not([type=radio],[type=checkbox],[type=button],[type=submit],[type=range])")) return;
      event.preventDefault();
      void leave(true);
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  });
  // Enter begins once the mark has formed, without parking a focus ring on the button during the entrance.
  useEffect(() => {
    if (stage !== "welcome" || !progress) return;
    const listener = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.defaultPrevented) return;
      if ((document.activeElement as HTMLElement | null)?.closest("button,input,a")) return;
      event.preventDefault();
      // Input is never blocked: Enter during the entrance completes it and begins at once.
      if (!welcomeReady) setSettle(true);
      void move(1);
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  });
  // Before the browser arrives (finale.ts), let the GPU draw it once under the stage while nothing moves: on a fresh
  // profile its first raster compiles GPU programs for tens of milliseconds, which would otherwise drop the arrival's
  // first frames. The stage lets a trace of the browser through (opacity .998: invisible) on the last card and on the
  // welcome (Skip setup); the browser keeps its real column under setup (onboarding.css) so there is something to draw.
  const prewarmWanted = !reducedMotion && !leaving && (step === "finish" || (quick && index === shown.length - 1) || (stage === "welcome" && welcomeReady));
  const [prewarm, setPrewarm] = useState(false);
  useEffect(() => {
    if (!prewarmWanted) return setPrewarm(false);
    const timer = setTimeout(() => setPrewarm(true), 600);
    return () => clearTimeout(timer);
  }, [prewarmWanted]);
  // And the arrival's own captures, once, when the last card has settled (finale.ts) — usually already warm by then:
  // the effects warm on the resting welcome, the captures on the first card once it has settled and input is quiet
  // (a view transition briefly takes the pointer, so never right after a click or key). Nothing warms on the last card
  // or on an input frame, so arriving there and the finale's start stay smooth.
  useEffect(() => {
    if (!prewarm || stage !== "dialog") return;
    const timer = setTimeout(() => prewarmFinale(stageRef.current), 300);
    return () => clearTimeout(timer);
  }, [prewarm, stage]);
  // The welcome's own entrance is mostly drawn by 1.5 s; warm then (or as soon as it is ready), before a quick "Yes,
  // start" can reach the card.
  useEffect(() => {
    if (reducedMotion || leaving || stage !== "welcome" || !progress) return;
    const timer = setTimeout(() => {
      // The first card, rehearsed invisibly at its real size and scale under the same blur sweep the transition runs
      // (traced: its clip, text, picture and each blur radius band are GPU programs built on first draw, ~260 ms that
      // landed on the welcome click). Then the finale's veil and mark.
      if (!rehearsed.current) {
        rehearsed.current = true;
        // Its picture decoded first, so the rehearsal really draws it (a still-loading image draws nothing).
        const picture = new Image();
        picture.src = coverSamples["built-in"];
        void picture.decode().catch(() => {}).finally(() => setRehearse(true));
      }
      prewarmEffects(stageRef.current);
    }, welcomeReady ? 150 : 1500);
    return () => clearTimeout(timer);
  }, [reducedMotion, leaving, stage, welcomeReady, !progress]); // eslint-disable-line react-hooks/exhaustive-deps
  const rehearsed = useRef(false);
  const [rehearse, setRehearse] = useState(false);
  const rehearsal = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!rehearse) return;
    // The welcome's own exit (its layer blurring 0 -> 4 px and lifting as it fades) is rehearsed too, on a still copy of
    // it: the welcome text drawn under a blur builds its own GPU programs.
    const source = stageRef.current?.querySelector<HTMLElement>(".fr-welcome"),
      host = rehearsal.current;
    let copy: HTMLElement | null = null;
    if (source && host) {
      copy = source.cloneNode(true) as HTMLElement;
      unhook(copy);
      copy.removeAttribute("style");
      host.appendChild(copy);
      copy.animate(
        [{ opacity: 1, filter: "blur(0px)", transform: "none" }, { opacity: 0, filter: "blur(4px)", transform: "translateY(-8px)" }, { opacity: 1, filter: "blur(0px)", transform: "none" }],
        { duration: REHEARSAL_MS, easing: "linear", fill: "both" },
      );
    }
    // Gone as soon as the sweep has drawn its last frame: nothing of it lingers for automation or assistive tech.
    const timer = setTimeout(() => setRehearse(false), REHEARSAL_MS + 50);
    return () => {
      clearTimeout(timer);
      copy?.remove();
    };
  }, [rehearse]);
  // Before the rehearsal's first paint, and for anything it mounts later: no ids, names or data-onboarding-* hooks.
  useLayoutEffect(() => {
    const host = rehearsal.current;
    if (!rehearse || !host) return;
    unhook(host);
    const watch = new MutationObserver((records) => {
      for (const record of records) record.addedNodes.forEach((node) => node instanceof Element && unhook(node));
    });
    watch.observe(host, { childList: true, subtree: true });
    return () => watch.disconnect();
  }, [rehearse]);
  // The cover step's pictures are decoded while the Look step rests (on a fresh profile their first decode and upload
  // dropped frames on the move to the cover step).
  const decoded = useRef<HTMLImageElement[]>([]);
  useEffect(() => {
    if (step !== "appearance" || decoded.current.length) return;
    const timer = setTimeout(() => {
      const urls = [...new Set([...Object.values(coverSamples), artwork.id === "met-436535" ? "" : artwork.thumb || artwork.src])].filter(Boolean);
      decoded.current = urls.map((url) => {
        const image = new Image();
        image.decoding = "async";
        image.src = url;
        void image.decode().catch(() => {});
        return image;
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [step, artwork]);
  useEffect(() => {
    if (reducedMotion || leaving || stage !== "dialog" || step === "finish") return;
    let input = performance.now(),
      timer = 0;
    const touched = () => (input = performance.now());
    const attempt = () => {
      const quiet = performance.now() - input;
      if (quiet < 700) timer = window.setTimeout(attempt, 700 - quiet + 50);
      else if (typeof requestIdleCallback === "function") requestIdleCallback(() => (performance.now() - input >= 700 ? prewarmCapture(stageRef.current) : attempt()), { timeout: 800 });
      else prewarmCapture(stageRef.current);
    };
    for (const type of ["pointerdown", "pointermove", "keydown", "wheel"]) addEventListener(type, touched, { capture: true, passive: true });
    timer = window.setTimeout(attempt, 1400);
    return () => {
      clearTimeout(timer);
      for (const type of ["pointerdown", "pointermove", "keydown", "wheel"]) removeEventListener(type, touched, { capture: true });
    };
  }, [reducedMotion, leaving, stage, step]);
  // On the card, Enter is the primary action from the first frame (typing a name included), never blocked.
  useEffect(() => {
    if (stage !== "dialog" || leaving) return;
    const listener = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.defaultPrevented || event.isComposing) return;
      if ((event.target as HTMLElement | null)?.closest?.("button,a,textarea")) return;
      const primary = stageRef.current?.querySelector<HTMLButtonElement>("[data-onboarding-primary]");
      if (!primary || primary.disabled) return;
      event.preventDefault();
      primary.click();
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  });

  return (
    <section
      ref={stageRef}
      className="fr-stage"
      aria-labelledby="fr-title"
      data-stage={stage}
      data-tone={tone}
      data-leaving={leaving || undefined}
      data-reduced-motion={reducedMotion || undefined}
      data-reduced-transparency={reducedTransparency || undefined}
      data-prewarm={prewarm || undefined}
    >
      <PrismField
        tone={tone}
        strength={1}
        clearCenter={stage === "welcome"}
        swing={lightPoses[step][0]}
        shiftX={lightPoses[step][1]}
        shiftY={lightPoses[step][2]}
        reducedMotion={reducedMotion}
        className="fr-stage-light"
      />
      {/* The film-grain overlay follows SCENE_GRAIN (sceneLook.ts): absent at 0, the original opacity at 1. */}
      {SCENE_GRAIN > 0 && <div className="fr-grain" aria-hidden="true" style={SCENE_GRAIN === 1 ? undefined : { opacity: 0.045 * SCENE_GRAIN }} />}
      <div className="fr-drag" aria-hidden="true" />
      {/* Also offered once opening has stalled, so a status call that never answers can be skipped. */}
      {(progress ? stage === "welcome" : stalled && !error) && (
        <button className="fr-skip" type="button" disabled={busy || leaving} onClick={() => void leave(true)}>
          {t("setup.skipSetup")}
        </button>
      )}
      {!progress ? (
        <div className="fr-center">
          {error ? (
            <div className="fr-fallback">
              <p role="alert">{error}</p>
              <p className="fr-quiet">{t("setup.unchanged")}</p>
              <button className="fr-primary" type="button" onClick={() => onDoneRef.current()}>
                {t("setup.startBrowsing")}
              </button>
            </div>
          ) : (
            <p role="status" className="fr-visually-hidden">
              {t("setup.opening")}
            </p>
          )}
        </div>
      ) : (
        // "sync": the card forms while the welcome leaves, from the click frame, in step with the light's move (R4-02):
        // waiting for the welcome to finish leaving made the frosted card cut in after the lights had already risen.
        // Both layers are absolutely placed (.fr-center), so they overlap without moving each other.
        <AnimatePresence mode="sync" initial={!reducedMotion}>
          {stage === "welcome" ? (
            <motion.div
              key="welcome"
              className="fr-center fr-welcome"
              exit={
                reducedMotion
                  ? { opacity: 0, transition: { duration: 0.08 } }
                  : { opacity: 0, y: -8, filter: "blur(4px)", transition: { duration: 0.2, ease: precise } }
              }
            >
              <Welcome
                tone={tone}
                reduced={reducedMotion}
                busy={busy}
                onStart={() => void move(1)}
                onDefaults={() => void leave(false, true)}
                onReady={() => setWelcomeReady(true)}
                language={settings.language ?? "system"}
                onLanguage={(language) => dispatch({ type: "settings.update", patch: { language } })}
              />
            </motion.div>
          ) : (
            <motion.div
              key="dialog"
              className="fr-center"
              // The card condenses out of the light: its frost (drawn by the scene, following this opacity every frame),
              // tint and words grow in together on one spring from the first frame, honouring the speed setting; it
              // leaves the same way when Back returns to the welcome.
              initial={quietMotion ? { opacity: 0 } : { opacity: 0, filter: "blur(8px)", scale: 0.97 }}
              animate={{ opacity: 1, filter: "blur(0px)", scale: 1, transitionEnd: { filter: "none" } }}
              exit={quietMotion ? { opacity: 0, transition: { duration: 0.08 } } : { opacity: 0, filter: "blur(6px)", scale: 0.98, transition: { type: "spring", duration: 0.3 * cardScale, bounce: 0 } }}
              transition={quietMotion ? { duration: 0.12 } : { type: "spring", duration: 0.55 * cardScale, bounce: 0 }}
            >
              <Dialog
                step={step as PanelStep}
                reduced={reducedMotion}
                error={error}
                busy={busy || leaving}
                index={index}
                total={shown.length}
                onBack={() => void move(-1)}
                onNext={() => void (step === "finish" || (quick && index === shown.length - 1) ? leave(false) : move(1))}
                context={context}
                quick={quick ? { name: quickProfile?.name || "", onSkip: () => void leave(true) } : undefined}
              />
            </motion.div>
          )}
        </AnimatePresence>
      )}
      {rehearse && stage === "welcome" && progress && (
        // A still, inert copy for the GPU only: hidden from assistive tech, out of focus and input, and marked
        // data-rehearsal with no ids, names or data-onboarding-* hooks, so QA and screen readers only ever find the real card.
        <div ref={rehearsal} className="fr-rehearsal" aria-hidden="true" inert data-rehearsal="">
          <motion.div
            className="fr-center"
            // As the real layer does it: opacity, blur and scale together on the same layer.
            initial={{ opacity: 0, filter: "blur(8px)", scale: 0.97 }}
            animate={{ opacity: [0, 1, 0.6, 1], filter: ["blur(8px)", "blur(0px)", "blur(4px)", "blur(0px)"], scale: [0.97, 1, 0.98, 1] }}
            transition={{ duration: REHEARSAL_MS / 1000, ease: "linear" }}
          >
            <Dialog
              step={(shown.find((item) => item !== "welcome") ?? "profile") as PanelStep}
              rehearsal
              reduced={false}
              error=""
              busy={false}
              index={0}
              total={shown.length}
              onBack={() => {}}
              onNext={() => {}}
              context={context}
            />
          </motion.div>
        </div>
      )}
    </section>
  );
}
/** How long the welcome's rehearsal of the first card sweeps its blur (ms). */
const REHEARSAL_MS = 1200;
/** The rehearsal's copies keep their look but lose every hook automation and assistive tech find things by: ids, form
 * names, label targets and the data-onboarding-* attributes (the real card keeps them; there is only ever one of each). */
function unhook(root: Element) {
  for (const node of [root, ...root.querySelectorAll("*")])
    for (const { name } of [...node.attributes])
      if (name === "id" || name === "name" || name === "for" || name.startsWith("data-onboarding")) node.removeAttribute(name);
}

/** "Imported 1,204 bookmarks from Chrome · Undo": the run's own batches, reverted by main (`import.undo`). */
function importUndo(run: ImportRun | null, dispatch: StepContext["dispatch"]) {
  if (!run?.finished || run.failed || !run.batchIds.length) return undefined;
  const { bookmarks, history, spaces, favorites } = run.counts;
  // Arc: "Imported 3 Spaces, 8 favorites and history from Arc" (its bookmarks are the Spaces' pinned tabs).
  const what =
    spaces || favorites
      ? listOf([spaces ? t("setup.count.spaces", { count: spaces }) : "", favorites ? t("setup.count.favorites", { count: favorites }) : "", history ? t("setup.kindLower.history") : ""].filter(Boolean))
      : bookmarks
        ? listOf([t("setup.count.bookmarks", { count: bookmarks }), history ? t("setup.kindLower.history") : ""].filter(Boolean))
        : history
          ? t("setup.count.historyItems", { count: history })
          : "";
  // Several profiles: "Imported 3 profiles from Chrome and Arc"; Undo also removes the ones made for them.
  const profiles = Object.values(run.rows).filter((row) => row.finished && !row.failed).length;
  const label = run.profileIds.length ? t("setup.count.profiles", { count: profiles }) : what;
  if (!label) return undefined;
  const batchIds = [...run.batchIds],
    profileIds = [...run.profileIds];
  return () =>
    dispatch({
      type: "toast",
      text: t("setup.toast.imported", { what: label, from: run.from }),
      action: { label: t("toast.undo"), labelId: "toast.undo", command: { type: "import.undo", batchIds, ...(profileIds.length ? { profileIds } : {}) } },
    });
}

/** "Sign back in to your sites": sign-ins stay in the old browser, so after an import the checklist (Settings › Import & export) is
 * offered once, if the profile has any site worth signing back in to. */
function signInOffer(run: ImportRun | null, dispatch: StepContext["dispatch"]) {
  if (!run?.finished || run.failed || !run.batchIds.length) return undefined;
  return async () => {
    try {
      const { signin } = await runtime.service({ type: "signin.plan", refresh: true });
      if (!signin?.items.length) return;
    } catch {
      return;
    }
    dispatch({
      type: "toast",
      text: t("signin.toast"),
      action: { label: t("signin.toastAction"), labelId: "signin.toastAction", command: { type: "tab.new", url: "acira://settings" }, settings: "import-signin" },
    });
  };
}

function Reveal({
  show,
  reduced,
  delay,
  interactive = false,
  children,
}: {
  show: boolean;
  reduced: boolean;
  delay: number;
  /** Clickable even before it has fully appeared (the welcome's actions: input is never blocked). */
  interactive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      className="fr-reveal"
      initial={false}
      animate={
        show
          ? { opacity: 1, filter: "blur(0px)", y: 0, transitionEnd: { filter: "none" } }
          : reduced
            ? { opacity: 0 }
            : { opacity: 0, filter: "blur(6px)", y: 6 }
      }
      transition={{ duration: reduced ? 0.1 : 0.5, ease: hero, delay: show && !reduced ? delay : 0 }}
      style={{ pointerEvents: show || interactive ? undefined : "none" }}
      aria-hidden={show || interactive ? undefined : true}
    >
      {children}
    </motion.div>
  );
}

/** One glyph per step, 32px, drawn on the same 24 grid as the concept; the last step carries the Acira mark. */
const glyphs: Record<Exclude<PanelStep, "finish">, React.ReactNode> = {
  import: (
    <>
      <path d="M12 3.5v11" />
      <path d="m7.5 10 4.5 4.5 4.5-4.5" />
      <path d="M4 15.5v4.5h16v-4.5" />
    </>
  ),
  profile: (
    <>
      <circle cx="12" cy="8.5" r="4" />
      <path d="M4.5 20.5c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5" />
    </>
  ),
  appearance: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5v17" />
      <path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none" />
    </>
  ),
  cover: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="1" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m4 17 5-4.5 3.5 3L15.5 12.5 20 17" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 5 5" />
    </>
  ),
  privacy: (
    <>
      <path d="M12 3.5 5 6v5.5c0 4.4 3 7.6 7 9 4-1.4 7-4.6 7-9V6z" />
      <path d="m9 12 2.2 2.2L15.5 10" />
    </>
  ),
  default: (
    <>
      <path d="M13.5 4.5h6v6" />
      <path d="M19.5 4.5 11 13" />
      <path d="M17 14v5.5H4.5V7H10" />
    </>
  ),
};

/** The setup primary's trailing arrow (concept): 14px, moves 2px on hover. */
function Arrow() {
  return (
    <svg className="fr-arrow" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" aria-hidden="true">
      <path d="M3 8h9" />
      <path d="m8.5 4.5 3.5 3.5-3.5 3.5" />
    </svg>
  );
}

function StepGlyph({ step }: { step: PanelStep }) {
  if (step === "finish") return <BrandIcon size={32} className="fr-glyph" />;
  return (
    <svg className="fr-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" aria-hidden="true">
      {glyphs[step]}
    </svg>
  );
}

/** One centred, fixed card for every step (I's Apple concept): glyph, title, one line, one decision; Back, progress and
 * the action in the footer. Nothing in it scrolls or resizes. */
function Dialog({
  step,
  reduced,
  error,
  busy,
  index,
  total,
  onBack,
  onNext,
  context,
  quick,
  rehearsal = false,
}: {
  step: PanelStep;
  reduced: boolean;
  error: string;
  busy: boolean;
  index: number;
  total: number;
  onBack: () => void;
  onNext: () => void;
  context: StepContext;
  /** The short setup of a profile made from another browser's profile: its name, and Skip. */
  quick?: { name: string; onSkip: () => void };
  /** The welcome's invisible rehearsal of this card (see `rehearse` in ProfileOnboarding): the real card's layers, text,
   * clip and a picture, with no focus, no frost tracking and no step body side effects. */
  rehearsal?: boolean;
}) {
  const title = useRef<HTMLElement | null>(null),
    card = useRef<HTMLDivElement>(null),
    stepApi = useRef<StepApi>({}),
    current = useRef(step);
  current.current = step;
  // The step's heading takes focus, so a screen reader announces each step. On a step change the new heading mounts
  // only after the old step has left (AnimatePresence "wait"), so it is focused from onExitComplete.
  useEffect(() => {
    if (!rehearsal) title.current?.focus({ preventScroll: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const focusTitle = () =>
    requestAnimationFrame(() => card.current?.querySelector<HTMLElement>(".fr-card-title")?.focus({ preventScroll: true }));
  useT();
  const copy =
    quick && index === 0
      ? {
          title: quick.name ? t("setup.quick.title", { name: quick.name }) : t("setup.quick.titleNoName"),
          line: sentences(t("setup.quick.line1"), t("setup.quick.line2")),
        }
      : stepCopy(step);
  const finish = step === "finish";
  const Body = rehearsal
    ? RehearsalBody
    : finish
      ? Summary
      : { profile: ProfileStep, appearance: AppearanceStep, cover: CoverStep, search: SearchStep, import: ImportStep, privacy: PrivacyStep, default: DefaultStep }[step];
  const number = finish ? total + 1 : index + 1;
  const { importer } = context;
  // Import runs from the footer; once it lands the card moves on by itself.
  const runImport = async () => {
    if (!(await importer.start())) return;
    setTimeout(() => current.current === "import" && onNext(), reduced ? 0 : 500);
  };
  const actions = quick ? (
    <>
      <button className="fr-btn fr-btn-text" type="button" disabled={busy} onClick={quick.onSkip}>
        {t("setup.skip")}
      </button>
      <button className="fr-btn fr-btn-primary" type="button" data-onboarding-next data-onboarding-primary disabled={busy} onClick={onNext}>
        {index === total - 1 ? t("setup.done") : t("setup.continue")}
        <Arrow />
      </button>
    </>
  ) : step === "cover" ? (
    // Continue writes the chosen cover (the same profile preference as Settings › New tab); Skip leaves it as it was.
    <>
      <button className="fr-btn fr-btn-text" type="button" data-onboarding-next disabled={busy} onClick={onNext}>
        {t("setup.skip")}
      </button>
      <button
        className="fr-btn fr-btn-primary"
        type="button"
        data-onboarding-primary
        data-onboarding-cover
        disabled={busy}
        onClick={() => {
          stepApi.current.apply?.();
          onNext();
        }}
      >
        {t("setup.continue")}
        <Arrow />
      </button>
    </>
  ) : step === "import" && !importer.imported ? (
      <>
        <button className="fr-btn fr-btn-text" type="button" data-onboarding-next disabled={busy || importer.running} onClick={onNext}>
          {t("setup.skip")}
        </button>
        <button
          className="fr-btn fr-btn-primary"
          type="button"
          data-onboarding-primary
          data-onboarding-import
          disabled={busy || importer.running || !importer.selected.length}
          onClick={() => void runImport()}
        >
          {importer.running ? t("setup.importing") : importer.selected.length > 1 ? t("setup.importCount", { count: importer.selected.length }) : t("setup.import")}
          <Arrow />
        </button>
      </>
    ) : (
      <button className="fr-btn fr-btn-primary" type="button" data-onboarding-next data-onboarding-primary disabled={busy} onClick={onNext}>
        {finish ? t("setup.startBrowsing") : t("setup.continue")}
        <Arrow />
      </button>
    );
  return (
    // data-prism-glass: K's scene draws this card's frosting itself (PrismField glass contract).
    <div
      ref={card}
      className="fr-card"
      role={rehearsal ? undefined : "group"}
      aria-roledescription={rehearsal ? undefined : t("setup.roleStep")}
      aria-labelledby={rehearsal ? undefined : "fr-title"}
      data-prism-glass={rehearsal ? undefined : ""}
      // The rehearsal is never frosted by the scene, so it must not run the CSS backdrop blur either (the real card does not).
      style={rehearsal ? { backdropFilter: "none", WebkitBackdropFilter: "none" } : undefined}
    >
      <div className="fr-card-main">
        <AnimatePresence mode="wait" initial={false} onExitComplete={focusTitle}>
          <motion.div
            key={step}
            className="fr-stepwrap"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0, transition: { duration: reduced ? 0.12 : 0.28, ease: strong } }}
            exit={reduced ? { opacity: 0, transition: { duration: 0.08 } } : { opacity: 0, y: -6, transition: { duration: 0.14, ease: precise } }}
          >
            <StepGlyph step={step} />
            <VaporText as="h1" id={rehearsal ? undefined : "fr-title"} className="fr-card-title" text={copy.title} reduced={reduced} focusRef={title} />
            <p className="fr-sub">{finish ? finishLine(context) : copy.line}</p>
            <div className="fr-content">
              <Body {...context} stepApi={stepApi} />
            </div>
          </motion.div>
        </AnimatePresence>
        {error && (
          <p role="alert" className="fr-card-error">
            {error}
          </p>
        )}
      </div>
      <footer className="fr-foot">
        <div className="fr-foot-start">
          <button
            className="fr-btn fr-btn-text"
            type="button"
            disabled={busy}
            style={{ visibility: !finish && index <= 0 ? "hidden" : undefined }}
            onClick={onBack}
          >
            {t("setup.back")}
          </button>
        </div>
        {/* Visible "2 of 6"; announced as "Step 2 of 6" when it changes. */}
        <span className="fr-counter" role="status">
          <span className="fr-visually-hidden">{t("setup.counterLabel")} </span>
          {t("setup.counter", { n: quick ? index + 1 : number, total: quick ? total : total + 1 })}
        </span>
        <div className="fr-foot-end">{actions}</div>
      </footer>
    </div>
  );
}

/** The rehearsal's body: the rows a card is made of (inset group, rows, a picture), with no step logic behind them. */
function RehearsalBody(_: StepContext & { stepApi?: unknown }) {
  // Never shown (the rehearsal draws at ~1% opacity to warm GPU shaders): sample glyphs, not copy.
  const glyphs = String.fromCharCode(65, 97);
  return (
    <div className="fr-group">
      <div className="fr-row fr-noicon fr-fact">
        <span>{glyphs}</span>
        <span className="fr-val">{glyphs}</span>
      </div>
      <div className="fr-row fr-noicon fr-fact">
        <img className="fr-cover-img" src={coverSamples["built-in"]} alt="" style={{ width: 64, height: 40 }} />
        <span className="fr-val">{glyphs}</span>
      </div>
    </div>
  );
}

/** What actually transferred, from the native import batches (undone batches don't count). */
function importedCounts(batches: ImportBatch[]) {
  const imported = { bookmarks: 0, history: 0 };
  for (const batch of batches)
    if (!batch.undone)
      for (const item of batch.results)
        if (item.status === "imported" && (item.category === "bookmarks" || item.category === "history"))
          imported[item.category] += item.count || 0;
  return imported;
}

/** The last line says what actually transferred, in numbers, then where it lives. */
function finishLine({ batches }: StepContext) {
  const { bookmarks, history } = importedCounts(batches);
  const parts = [bookmarks ? t("setup.count.bookmarks", { count: bookmarks }) : "", history ? t("setup.finish.yourHistory") : ""].filter(Boolean);
  const line = stepCopy("finish").line;
  return parts.length ? `${sentences(t("setup.finish.imported", { what: listOf(parts) }))} ${line}` : line;
}

const engineNames = { google: "Google", duckduckgo: "DuckDuckGo", bing: "Bing" } as const; // i18n-ignore: product names
const modeIds: Record<string, MessageId> = { system: "setup.mode.auto", light: "setup.mode.light", dark: "setup.mode.dark" };

/** The last step lists what setup actually changed, so the person leaves knowing where things stand. */
function Summary({ settings, profiles, profileId, batches, preferences, defaults }: StepContext) {
  useT();
  const facts = useProtectionFacts();
  const profile = profiles.find((item) => item.id === profileId);
  const { bookmarks, history } = importedCounts(batches);
  const importLine =
    bookmarks || history
      ? [bookmarks ? t("setup.count.bookmarks", { count: bookmarks }) : "", history ? t("setup.kind.history") : ""].filter(Boolean).join(" · ")
      : t("setup.summary.nothing");
  const rows: [string, React.ReactNode][] = [
    [
      t("setup.summary.profile"),
      profile ? (
        <span className="fr-summary-profile">
          <ProfileAvatar name={profile.name} color={profile.color} avatar={profile.avatar} picture={profile.picture} size={18} />
          {profile.name}
        </span>
      ) : (
        t("setup.personal")
      ),
    ],
    [t("setup.summary.appearance"), modeIds[settings.appearance] ? t(modeIds[settings.appearance]) : settings.appearance],
    [t("setup.summary.search"), engineNames[settings.searchEngine as keyof typeof engineNames] || settings.searchEngine],
    [t("setup.summary.imported"), importLine],
    // Each protection says what it does, not just "On" (R3-15): ads and trackers blocked or allowed, warnings on or off.
    [t("setup.summary.ads"), preferences.blocking === false ? t("setup.summary.allowed") : t("setup.summary.blocked")],
    [t("setup.phishing"), facts.phishing === "off" ? t("setup.off") : facts.phishing === "preparing" ? t("setup.gettingReady") : t("setup.summary.warned")],
  ];
  if (facts.aiFree) rows.push([t("setup.aiFree.title"), t("setup.on")]);
  if (defaults?.isDefault) rows.push([t("setup.summary.defaultBrowser"), "Acira"]);
  return (
    <>
      <dl className="fr-group">
        {rows.map(([label, value]) => (
          <div key={label} className="fr-row fr-noicon fr-fact">
            <dt>{label}</dt>
            <dd className="fr-val">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="fr-note">{t("setup.summary.note")}</p>
    </>
  );
}
