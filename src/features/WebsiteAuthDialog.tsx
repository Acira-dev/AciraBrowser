import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import "../styles/neutral-primary.css";
import "./website-auth.css";

import { t } from '../i18n';
export type WebsiteAuthRequest = {
  id: string;
  kind?: "origin" | "proxy";
  destinationOrigin?: string;
  origin: string;
  host: string;
  port: number;
  realm: string;
  scheme: "basic";
  profileId: string;
  tabId: string;
  privateMode: boolean;
  insecure: boolean;
  retry: boolean;
  createdAt: number;
};
export type WebsiteAuthState = {
  revision: number;
  requests: WebsiteAuthRequest[];
};
export type WebsiteAuthResponse =
  | { id: string; action: "cancel" }
  | { id: string; action: "submit"; username: string; password: string };
export type WebsiteAuthClient = {
  snapshot: () => Promise<WebsiteAuthState>;
  subscribe: (listener: (state: WebsiteAuthState) => void) => () => void;
  respond: (
    response: WebsiteAuthResponse,
  ) => Promise<{ ok: boolean; code?: string }>;
};

export function WebsiteAuthDialog({
  client,
  onVisibilityChange,
}: {
  client: WebsiteAuthClient;
  onVisibilityChange?: (visible: boolean) => void;
}) {
  const [state, setState] = useState<WebsiteAuthState>({
    revision: 0,
    requests: [],
  });
  useEffect(() => {
    let alive = true,
      revision = -1;
    const take = (next: WebsiteAuthState) => {
      if (alive && next.revision >= revision) {
        revision = next.revision;
        setState(next);
      }
    };
    const unsubscribe = client.subscribe(take);
    void client
      .snapshot()
      .then(take)
      .catch(() => {});
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [client]);
  const visible = state.requests.length > 0;
  useLayoutEffect(() => {
    onVisibilityChange?.(visible);
    return () => onVisibilityChange?.(false);
  }, [visible, onVisibilityChange]);
  const request = state.requests[0];
  // A refused sign-in comes back as a new request: keep the username that was just tried (memory only, read once)
  // so the person retypes only the password.
  const tried = useRef(new Map<string, string>());
  const triedKey = request
    ? [request.kind || "origin", request.profileId, request.origin, request.realm].join("|")
    : "";
  const [retryUsername] = useState(() => new Map<string, string>());
  if (request && !retryUsername.has(request.id)) {
    retryUsername.set(request.id, request.retry ? tried.current.get(triedKey) || "" : "");
    tried.current.delete(triedKey);
  }
  return request ? (
    <WebsiteAuthForm
      key={request.id}
      request={request}
      count={state.requests.length}
      client={client}
      initialUsername={retryUsername.get(request.id) || ""}
      onTried={(name) => tried.current.set(triedKey, name)}
    />
  ) : null;
}

function WebsiteAuthForm({
  request,
  count,
  client,
  initialUsername,
  onTried,
}: {
  request: WebsiteAuthRequest;
  count: number;
  client: WebsiteAuthClient;
  initialUsername: string;
  onTried: (username: string) => void;
}) {
  const proxy = request.kind === "proxy";
  const [username, setUsername] = useState(initialUsername);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const panel = useRef<HTMLDivElement>(null),
    userInput = useRef<HTMLInputElement>(null),
    passwordInput = useRef<HTMLInputElement>(null);
  const alive = useRef(true),
    label = useId();
  useLayoutEffect(() => {
    alive.current = true;
    const previous = document.activeElement;
    const element = panel.current;
    const frame = requestAnimationFrame(() =>
      (initialUsername ? passwordInput : userInput).current?.focus(),
    );
    return () => {
      alive.current = false;
      cancelAnimationFrame(frame);
      if (previous instanceof HTMLElement && previous.isConnected)
        requestAnimationFrame(() => {
          if (
            previous.isConnected &&
            !previous.closest("[inert]") &&
            (document.activeElement === document.body ||
              element?.contains(document.activeElement))
          )
            previous.focus({ preventScroll: true });
        });
    };
  }, []);
  useLayoutEffect(() => {
    if (busy) panel.current?.focus({ preventScroll: true });
    else if (document.activeElement === panel.current)
      userInput.current?.focus({ preventScroll: true });
  }, [busy]);
  async function answer(action: "cancel" | "submit") {
    if (busy) return;
    if (action === "submit" && username.includes(":")) {
      setError("The username cannot contain a colon for this sign-in method.");
      return;
    }
    const response: WebsiteAuthResponse =
      action === "cancel"
        ? { id: request.id, action }
        : { id: request.id, action, username, password };
    if (action === "submit") onTried(username);
    setPassword("");
    setBusy(true);
    setError("");
    try {
      const result = await client.respond(response);
      if (alive.current && !result.ok)
        setError(
          "This sign-in request is no longer available. Cancel it or reload the site to try again.",
        );
    } catch {
      if (alive.current)
        setError(
          "The response could not be sent. Enter your details again or cancel.",
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      void answer("cancel");
    } else if (event.key === "Tab") {
      const controls = [
        ...(panel.current?.querySelectorAll<HTMLElement>(
          "input:not(:disabled),button:not(:disabled)",
        ) || []),
      ];
      const first = controls[0],
        last = controls.at(-1);
      if (!first) {
        event.preventDefault();
        panel.current?.focus();
      } else if (
        event.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === panel.current)
      ) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void answer("submit");
  }
  return (
    <div className="website-auth-backdrop">
      <div
        className="website-auth-dialog"
        role="dialog"
        aria-modal="true"
        aria-busy={busy}
        aria-labelledby={label + "-title"}
        aria-describedby={label + "-description"}
        tabIndex={-1}
        ref={panel}
        onKeyDown={keyDown}
      >
        <header>
          <h2 id={label + "-title"}>
            {proxy ? t("websiteauthdialog.signInToThisProxy") : t("websiteauthdialog.signInToThisSite")}
          </h2>
        </header>
        <p className="website-auth-origin">
          <bdi dir="ltr">{request.origin}</bdi>
        </p>
        <p id={label + "-description"}>
          {proxy
            ? t("websiteauthdialog.theHttpProxyIsRequesting")
            : t("websiteauthdialog.theSiteIsRequestingA")}
        </p>
        {proxy && request.destinationOrigin && (
          <p className="website-auth-realm">
            {t("websiteauthdialog.destinationSite")} <bdi dir="ltr">{request.destinationOrigin}</bdi>
          </p>
        )}
        {request.realm && (
          <p className="website-auth-realm">
            {proxy ? t("websiteauthdialog.theProxySays") : t("websiteauthdialog.theSiteSays")}{" "}
            <span>{request.realm}</span>
          </p>
        )}
        {request.insecure && (
          <p className="website-auth-warning">
            {proxy
              ? t("websiteauthdialog.thisProxyConnectionUsesUnencrypted")
              : t("websiteauthdialog.thisSiteUsesAnUnencrypted")}
          </p>
        )}
        {request.retry && (
          <p role="alert" className="website-auth-warning">
            {proxy
              ? t("websiteauthdialog.theProxyDidNotAccept")
              : t("websiteauthdialog.theSiteDidNotAccept")}
          </p>
        )}
        {count > 1 && (
          <p className="website-auth-queue">
            {t("websiteauth.queue", { count: count - 1 })}
          </p>
        )}
        <form onSubmit={submit} autoComplete="off">
          <label htmlFor={label + "-user"}>{t("pw.frame.username")}</label>
          <input
            id={label + "-user"}
            ref={userInput}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            disabled={busy}
            maxLength={1024}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
          />
          <label htmlFor={label + "-password"}>{t("pw.frame.password")}</label>
          <input
            id={label + "-password"}
            type="password"
            ref={passwordInput}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={busy}
            maxLength={4096}
            autoComplete="off"
          />
          {error && (
            <p role="alert" className="website-auth-warning">
              {error}
            </p>
          )}
          <footer>
            <button
              type="button"
              className="acira-button acira-button-secondary acira-button-prominent"
              disabled={busy}
              onClick={() => void answer("cancel")}
            >
              {t("main.cancel")}
            </button>
            <button
              type="submit"
              className="acira-button acira-button-primary acira-button-prominent"
              disabled={busy}
            >
              {busy ? "Sending…" : t("websiteauthdialog.signIn")}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
