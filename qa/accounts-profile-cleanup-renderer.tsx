import "../src/fonts.css";
import "../src/styles.css";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ProfileCleanupSettings } from "../src/features/profile-privacy/ProfileCleanupSettings";
import type {
  ProfileCleanupChoice,
  ProfileCleanupClient,
  ProfileCleanupSaveResult,
  ProfileCleanupStatus,
} from "../src/features/profile-privacy/cleanup-types";
import { createInitialState } from "../src/runtime/core";
import {
  appearancePalettes,
  palettePreference,
} from "../src/runtime/appearancePalettes";
import { themeTokens } from "../src/ui/theme";
import { installDesignVariables } from "../src/ui/designSystem";

type Call = {
  type: "status" | "set";
  owner: string;
  choice?: ProfileCleanupChoice;
};
type Mode = "success" | "cancel" | "error" | "applied-error" | "defer";
const scenario =
    new URLSearchParams(location.search).get("scenario") || "default",
  copy = <T,>(value: T): T => structuredClone(value);
const base = (profileId: string): ProfileCleanupStatus => ({
  profileId,
  choice: { enabled: false, categories: [], keepOrigins: [] },
  pending: false,
  running: false,
  networkBlocked: false,
  recoveryError: null,
});
const states = {
  a: base("a"),
  b: {
    ...base("b"),
    choice: {
      enabled: true,
      categories: ["history"],
      keepOrigins: ["https://b.example"],
    },
    pending: true,
  },
} as Record<string, ProfileCleanupStatus>;
if (["configured", "pending", "running", "recovery"].includes(scenario))
  states.a = {
    ...states.a,
    choice: {
      enabled: true,
      categories: ["cookies", "storage"],
      keepOrigins: ["https://mail.example.com"],
    },
    pending: scenario !== "configured",
  };
if (scenario === "running")
  Object.assign(states.a, { running: true, networkBlocked: true });
if (scenario === "recovery")
  Object.assign(states.a, {
    networkBlocked: true,
    recoveryError: "A native cleanup job remains pending <not markup>.",
  });
let nativeProfile = "a",
  mode: Mode =
    scenario === "cancel"
      ? "cancel"
      : scenario === "save-error"
        ? "error"
        : scenario === "applied-error"
          ? "applied-error"
          : scenario === "defer-save"
            ? "defer"
            : "success",
  readError = scenario === "load-error",
  deferRead = scenario === "defer-status",
  pendingRead: (() => void) | null = null,
  pendingSave: ((result: "success" | "cancel" | "error") => void) | null = null;
const calls: Call[] = [];
function apply(owner: string, choice: ProfileCleanupChoice) {
  states[owner] = {
    ...states[owner],
    choice: copy(choice),
    pending: choice.enabled,
  };
  return copy(states[owner]);
}
const client: ProfileCleanupClient = {
  status() {
    const owner = nativeProfile;
    calls.push({ type: "status", owner });
    if (readError) {
      readError = false;
      return Promise.reject(Error("Controlled native status failure"));
    }
    if (deferRead) {
      deferRead = false;
      return new Promise((resolve) => {
        pendingRead = () => resolve(copy(states[owner]));
      });
    }
    if (scenario === "wrong-status") return Promise.resolve(base("foreign"));
    return Promise.resolve(copy(states[owner]));
  },
  set(choice) {
    const owner = nativeProfile;
    calls.push({ type: "set", owner, choice: copy(choice) });
    if (mode === "cancel") return Promise.resolve({ cancelled: true });
    if (mode === "error" || mode === "applied-error") {
      if (mode === "applied-error") apply(owner, choice);
      return Promise.reject(Error("Controlled uncertain save failure"));
    }
    if (mode === "defer")
      return new Promise<ProfileCleanupSaveResult>((resolve, reject) => {
        pendingSave = (result) =>
          result === "cancel"
            ? resolve({ cancelled: true })
            : result === "error"
              ? reject(Error("Deferred save failure"))
              : resolve(apply(owner, choice));
      });
    return Promise.resolve(apply(owner, choice));
  },
};
const emit = (name: string, detail: unknown) =>
  window.dispatchEvent(new CustomEvent(name, { detail }));
Object.assign(window, {
  cleanupQa: {
    snapshot: () => copy({ calls, states }),
    setMode: (value: Mode) => {
      mode = value;
    },
    switchProfile: (id: string, privateMode = false) => {
      nativeProfile = id;
      emit("cleanup-context", { id, privateMode });
    },
    unmount: () => emit("cleanup-mounted", false),
    releaseRead: () => {
      pendingRead?.();
      pendingRead = null;
    },
    releaseSave: (result = "success") => {
      pendingSave?.(result as "success");
      pendingSave = null;
    },
    statusFlags: (flags: Partial<ProfileCleanupStatus>) =>
      Object.assign(states[nativeProfile], flags),
    setTheme: (name: string, dark: boolean) =>
      emit("cleanup-theme", { name, dark }),
    paletteNames: appearancePalettes.map((palette) => palette.name),
  },
});
const initialSettings = createInitialState().settings;
function Fixture() {
  const [context, setContext] = useState({
      id: "a",
      privateMode: scenario === "private",
    }),
    [mounted, setMounted] = useState(true),
    [theme, setTheme] = useState({ name: "Porcelain", dark: false });
  useEffect(() => {
    const context = (event: Event) => setContext((event as CustomEvent).detail),
      mount = (event: Event) => setMounted((event as CustomEvent).detail),
      colors = (event: Event) => setTheme((event as CustomEvent).detail);
    window.addEventListener("cleanup-context", context);
    window.addEventListener("cleanup-mounted", mount);
    window.addEventListener("cleanup-theme", colors);
    return () => {
      window.removeEventListener("cleanup-context", context);
      window.removeEventListener("cleanup-mounted", mount);
      window.removeEventListener("cleanup-theme", colors);
    };
  }, []);
  const palette = appearancePalettes.find(
      (palette) => palette.name === theme.name,
    )!,
    colors = themeTokens(
      { ...initialSettings, ...palettePreference(palette) },
      theme.dark,
    );
  return (
    <div
      className="app style-solid"
      data-theme={colors["--surface-tone"]}
      style={colors}
    >
      <div className="cleanup-qa-scale">
        <main className="cleanup-qa-host">
          <h2>Privacy and data</h2>
          {mounted ? (
            <ProfileCleanupSettings
              client={client}
              profileId={context.id}
              profileName={
                context.id === "b"
                  ? "Second local profile"
                  : "Personal local profile"
              }
              privateMode={context.privateMode}
            />
          ) : (
            <p>Panel closed</p>
          )}
        </main>
      </div>
    </div>
  );
}
installDesignVariables();
createRoot(document.getElementById("root")!).render(
  scenario === "strict" ? (
    <StrictMode>
      <Fixture />
    </StrictMode>
  ) : (
    <Fixture />
  ),
);
