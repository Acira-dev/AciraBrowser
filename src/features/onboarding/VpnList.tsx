import { useCallback, useEffect, useRef, useState } from "react";
import type { VpnCommand, VpnProviderId, VpnProviderStatus, VpnState } from "../../runtime/vpn";
import { ArrowUpRight } from "../../components/AppIcons";
import { DotMatrix } from "../../components/DotMatrix";
import { reducedMotion, scaled } from "../../ui/sharedMotion";
import { showSetupToast } from "./setupToast";
import "./connection-sheet.css";
import { SettingInfo } from "../../components/SettingInfo";
import { useVpn } from "../connection/useVpn";
import { t, useT, type MessageId } from "../../i18n";

/* The VPN side of setup's Connection sheet (R3-06), in the card's own house style: one inset group of rows, each with the
   provider's mark, its name, one plain state line and one action. The shared VpnPanel still serves Settings and the toolbar
   popup; this draws only the setup sheet. State comes from the same service (useVpn), never inferred from a running process. */

/** Marks from Simple Icons (https://simpleicons.org, CC0-1.0, simple-icons@13.21.0): Mullvad and Proton VPN. IVPN has none
 * there, so it keeps a letter tile. Drawn in the row's ink so they sit on the glass in either tone. Nominative use only. */
const marks: Partial<Record<VpnProviderId, string>> = {
  mullvad:
    "M12 0C5.371 0 0 5.362 0 12c0 6.629 5.381 12 12 12s12-5.371 12-12S18.629 0 12 0zm1.651 3.363c1.908-.02 4.059 1.28 4.701 2.951.381 1 .267 2.086-.057 3.086-.266.819-1.238 2-.876 2.886-.143-.038-3.124-1.048-3.98-1.505-1.344-.838-2.544-1.867-3.448-2.657l-.03-.029-3.047-1.447a1.037 1.037 0 0 1-.104-.058c.419.029 2.085.23 2.828.058-.143-.39-.105-.896.095-1.372.286-.657.83-1.095 1.343-1.095.105 0 .2.019.296.057A3.411 3.411 0 0 1 12.39 3.6a3.49 3.49 0 0 1 1.26-.237zm-2.499.97c-.457 0-.962.42-1.228 1.02-.2.447-.229.933-.086 1.304a.813.813 0 0 0 .41.457.696.696 0 0 0 .285.058c.457 0 .962-.42 1.22-1.02.161-.362.209-.742.152-1.076a.91.91 0 0 0-.467-.676.6.6 0 0 0-.286-.067zm0 .286c.057 0 .115.01.172.038.152.067.266.238.304.467.048.276.01.6-.133.905-.21.485-.619.838-.962.838a.444.444 0 0 1-.162-.029c-.142-.057-.219-.19-.257-.295-.114-.286-.085-.705.076-1.086.21-.495.62-.838.962-.838zM3.01 6.362 2.943 7.79l.133.037.943-1.123-.648 1.104c1.01-.2 2.658-.247 4.42-.114l1.837.895c.915.8 2.124 1.839 3.486 2.686l3.553 1.4.438.638h-.372l.781.943-.714-.114c.01.066.714.876.714.876l-.562.076c.02.067.572.753.572.753l-.42-.03c.03.106.677 1.153.677 1.163 0 .01-.229-.057-.381-.105.543 1.21 1.324 1.448 1.362 1.943-2.667 3.419-9.667 3.952-12.771.124-.067-.314.619-.838 1.057-1.429.21-.286.4-.59.533-.905.19-.58-.21-.533-.476-1.028-.047-.086-.086-.2-.047-.305.057-.19.38-.324.438-.286 1.314.877 3.762.59 5.266-1.142 0 0 .458.114.696.18l-.686-.457-.048-.028c-.028.019-.067.038-.095.057-3.124 2.38-5.152 1.352-5.152 1.352a3.243 3.243 0 0 0-.438-.39c-2.124-1.495-3.639-3.505-4.324-4.81l-.257 1.381.057-1.838-.914 1.276.676-1.371c-.505-.067-.79-.572-.676-.981.094-.426.63-.738 1.096-.527z",
  proton:
    "m10.176 20.058.858-1.28 6.513-9.838c.57-.86.026-2.014-1.005-2.131L.378 4.95l8.373 15.055a.84.84 0 0 0 1.424.052h.001zM23.586 7.14l-9.662 14.61c-1.036 1.567-3.38 1.478-4.293-.162l-.093-.168c.3-.01.594-.086.855-.235a1.85 1.85 0 0 0 .612-.57l.86-1.28 6.516-9.844c.46-.694.525-1.56.173-2.314a2.375 2.375 0 0 0-1.899-1.364L.493 3.956l-.476-.054C-.163 2.392 1.101.95 2.784 1.143l18.991 2.16c1.856.21 2.835 2.289 1.812 3.838z",
};

function VpnMark({ id, name }: { id: string; name: string }) {
  const path = marks[id as VpnProviderId];
  return path ? (
    <svg className="fr-vpn-mark" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path d={path} fill="currentColor" />
    </svg>
  ) : (
    <span className="fr-vpn-mark fr-vpn-letter" aria-hidden="true">
      {[...name.trim()][0]?.toLocaleUpperCase() || "?"}
    </span>
  );
}

const lineIds: Record<VpnState, MessageId> = {
  connected: "setup.vpn.line.connected",
  disconnected: "setup.vpn.line.disconnected",
  connecting: "setup.vpn.line.working",
  disconnecting: "setup.vpn.line.working",
  paused: "setup.vpn.line.paused",
  error: "setup.vpn.line.error",
  unknown: "setup.vpn.line.unknown",
};
/** One plain line per state: "Not installed", "Installed · Not connected"… (never the repeated "not found in standard locations"). */
const vpnLine = (provider: VpnProviderStatus): MessageId =>
  !provider.installed ? "setup.vpn.line.notInstalled" : !provider.verified ? "setup.vpn.line.unverified" : lineIds[provider.state];
const providerNote = (id: string) => (["mullvad", "proton", "ivpn"].includes(id) ? t(`vpn.note.${id}` as MessageId) : "");

/** Get it (R4-08b): the button shows the classic dot-matrix loader while the browser opens the provider's download page in a
 * BACKGROUND tab (setup covers the browser, so a front tab would look like nothing happened), then morphs to a dot-matrix check
 * and "Added", and a status pop-up says where the page is waiting. The loader stays at least a beat so it can be seen. */
type GetPhase = "idle" | "loading" | "added";
const LOADING_MS = 360;

export function VpnList({ openSite, detected }: { openSite: (url: string, options?: { background?: boolean }) => Promise<unknown> | void; detected: { name: string; how: string }[] }) {
  useT();
  const vpn = useVpn();
  const root = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<VpnProviderId | null>(null);
  // A button that disables itself while its command runs would drop focus to the page: give it back to the row afterwards.
  useEffect(() => {
    if (vpn.busy || !pendingFocus.current) return;
    const id = pendingFocus.current;
    pendingFocus.current = null;
    requestAnimationFrame(() => {
      if (document.activeElement === document.body) root.current?.querySelector<HTMLButtonElement>(`[data-provider="${id}"] button:not(:disabled)`)?.focus({ preventScroll: true });
    });
  }, [vpn.busy, vpn.status]);
  const command = (id: VpnProviderId, action: VpnCommand) => {
    pendingFocus.current = id;
    void vpn.command(id, action);
  };
  const [phases, setPhases] = useState<Record<string, GetPhase>>({});
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const getIt = useCallback(
    async (provider: VpnProviderStatus) => {
      const phase = (id: string, next: GetPhase) => live.current && setPhases((all) => ({ ...all, [id]: next }));
      phase(provider.id, "loading");
      const started = performance.now();
      try {
        await openSite(provider.site, { background: true });
        const wait = scaled(LOADING_MS) - (performance.now() - started);
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        phase(provider.id, "added");
        showSetupToast(t("setup.vpn.waiting", { name: provider.name }));
      } catch {
        phase(provider.id, "idle");
        showSetupToast(t("setup.vpn.openFailed", { name: provider.name }), { tone: "error" });
      }
    },
    [openSite],
  );
  const providers = vpn.status?.providers ?? [];
  // Other VPN apps this computer shows (J's local detection) that Acira has no control over: listed so "Use my VPN app" is honest.
  const known = providers.map((provider) => provider.name.toLowerCase());
  const others = detected.filter((app) => !known.some((name) => app.name.toLowerCase().includes(name.split(" ")[0])));
  const blocked = providers.some((provider) => provider.blocked);
  return (
    <div ref={root} className="fr-vpn">
      <p className="fr-glabel">
        <span>{t("setup.vpn.group")}</span>
        <button className="fr-glabel-more" type="button" disabled={vpn.busy} onClick={() => void vpn.refresh()}>
          {t("vpn.control.refresh")}
        </button>
      </p>
      <div className="fr-group">
        {!vpn.status && (
          <div className="fr-row fr-noicon fr-fact" role="status">
            <span className="fr-row-text">
              <small>{t("vpn.control.reading")}</small>
            </span>
          </div>
        )}
        {providers.map((provider) => {
          const action: [VpnCommand, MessageId] | null = !provider.installed || !provider.verified
            ? null
            : provider.canDisconnect
              ? ["disconnect", "vpn.control.disconnect"]
              : provider.canConnect
                ? ["connect", "vpn.control.connect"]
                : provider.canOpen
                  ? ["open", "setup.vpn.open"]
                  : null;
          const note = providerNote(provider.id);
          return (
            <div className="fr-row" data-two="" data-provider={provider.id} data-state={provider.installed ? provider.state : "absent"} key={provider.id}>
              <span className="fr-ico">
                <VpnMark id={provider.id} name={provider.name} />
              </span>
              <span className="fr-row-text">
                <span className="fr-row-heading">
                  <b>{provider.name}</b>
                  {note && <SettingInfo text={note} />}
                </span>
                <small>{t(vpnLine(provider))}</small>
              </span>
              {!provider.installed ? (
                <GetItButton phase={phases[provider.id] ?? "idle"} onGet={() => void getIt(provider)} />
              ) : action ? (
                <button className="fr-btn fr-btn-secondary fr-btn-row" type="button" disabled={vpn.busy} onClick={() => command(provider.id, action[0])}>
                  {t(action[1])}
                </button>
              ) : null}
            </div>
          );
        })}
        {others.map((app) => (
          <div className="fr-row" data-two="" key={app.name}>
            <span className="fr-ico">
              <VpnMark id="other" name={app.name} />
            </span>
            <span className="fr-row-text">
              <b>{app.name}</b>
              <small>{t("setup.vpn.line.other")}</small>
            </span>
          </div>
        ))}
      </div>
      {/* The scope sits under the list, where it reads as the rule for everything above it (not squeezed under the switch). */}
      <p className="fr-note fr-vpn-note">{t("vpn.control.scope")}</p>
      {blocked && <p className="fr-note fr-vpn-note">{t("vpn.control.blocked")}</p>}
      {vpn.problem && (
        <p className="fr-note fr-vpn-note" role="alert">
          {vpn.problem}
        </p>
      )}
    </div>
  );
}

function GetItButton({ phase, onGet }: { phase: GetPhase; onGet: () => void }) {
  const still = reducedMotion();
  return (
    <button className="fr-btn fr-btn-secondary fr-btn-row fr-get" type="button" data-phase={phase} aria-busy={phase === "loading" || undefined} onClick={() => phase === "idle" && onGet()}>
      <span className="fr-get-face" data-face="get" aria-hidden={phase !== "idle" || undefined}>
        {t("setup.vpn.get")}
        <ArrowUpRight size={12} aria-hidden="true" />
      </span>
      {/* One matrix serves both states, so the loader's lights cross-fade into the check dot by dot (DotMatrix keeps the last frame). */}
      <span className="fr-get-face" data-face="status" aria-hidden={phase === "idle" || undefined}>
        {phase !== "idle" && <DotMatrix preset={phase === "added" ? "check" : "loader"} size={16} reducedMotion={still} label={phase === "added" ? undefined : t("setup.vpn.adding")} />}
        <span className="fr-get-label" data-shown={phase === "added" || undefined}>
          {t("setup.vpn.added")}
        </span>
      </span>
    </button>
  );
}
