import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { FocusEvent } from "react";
import type {
  CleanupCategory,
  ProfileCleanupChoice,
  ProfileCleanupClient,
  ProfileCleanupDraft,
  ProfileCleanupStatus,
} from "./cleanup-types";
import {
  checkedCleanupStatus,
  cleanupCategories,
  cleanupErrorDetail,
  draftFromChoice,
  draftChanged,
  isCleanupCancellation,
  maxKeepText,
  sameCleanupChoice,
  validateCleanupDraft,
} from "./cleanup-model";
import { Switch } from "../settings/controls";
import { useT, type MessageId } from "../../i18n";
import "./profile-cleanup.css";

export type {
  CleanupCategory,
  ProfileCleanupChoice,
  ProfileCleanupClient,
  ProfileCleanupSaveResult,
  ProfileCleanupStatus,
} from "./cleanup-types";
export interface ProfileCleanupSettingsProps {
  client: ProfileCleanupClient;
  profileId: string;
  profileName?: string;
  privateMode: boolean;
}

function keepCleanupFocusVisible(event: FocusEvent<HTMLElement>) {
  const control = event.target;
  if (!(control instanceof HTMLElement)) return;
  const group = control.closest<HTMLElement>(".st-row");
  (group ?? control).scrollIntoView({ block: "nearest", inline: "nearest" });
}

export function ProfileCleanupSettings(props: ProfileCleanupSettingsProps) {
  const t = useT();
  const heading = useId();
  return (
    <section
      className="profile-cleanup" data-form-item
      aria-labelledby={heading}
      onFocusCapture={keepCleanupFocusVisible}
    >
      <header className="profile-cleanup__heading">
        <div>
          <h3 id={heading}>{t("cleanup.title")}</h3>
          {!props.privateMode && (
            <p>
              {props.profileName
                ? t("cleanup.appliesNamed", { name: props.profileName })
                : t("cleanup.appliesThis")}
            </p>
          )}
        </div>
      </header>
      {props.privateMode ? (
        <p className="profile-cleanup__private" role="note">
          {t("cleanup.privateNote")}
        </p>
      ) : (
        <CleanupForm key={props.profileId} {...props} />
      )}
    </section>
  );
}

const labelIds: Record<CleanupCategory, { title: MessageId; note: MessageId }> = {
  cookies: { title: "cleanup.cookies", note: "cleanup.cookiesNote" },
  storage: { title: "cleanup.storage", note: "cleanup.storageNote" },
  history: { title: "cleanup.history", note: "cleanup.historyNote" },
  permissions: { title: "cleanup.permissions", note: "cleanup.permissionsNote" },
};
const emptyDraft = (): ProfileCleanupDraft => ({
  enabled: false,
  categories: [],
  originsText: "",
});

type Field = "enabled" | "categories" | "origins";
const savedFlash = 1800;

/** Every change applies as soon as it is made, like the rest of Settings. A change that cannot be saved yet (switched on with
 *  nothing selected, or a site list with a typo) stays on screen with the reason and is never half-applied; failures put the
 *  controls back to what is really saved. */
function CleanupForm({ client, profileId }: ProfileCleanupSettingsProps) {
  const t = useT();
  const id = useId(),
    [status, setStatus] = useState<ProfileCleanupStatus | null>(null),
    [draft, setDraft] = useState(emptyDraft),
    [phase, setPhase] = useState<"loading" | "idle" | "refreshing">("loading"),
    [error, setError] = useState<{ message: string; detail: string } | null>(
      null,
    ),
    [notice, setNotice] = useState(""),
    [pendingSave, setPendingSave] = useState(false),
    [failureSerial, setFailureSerial] = useState(0),
    [uncertain, setUncertain] = useState(false),
    [originsChecked, setOriginsChecked] = useState(false),
    [detailOpen, setDetailOpen] = useState(false),
    [inputError, setInputError] = useState<string | null>(null),
    [savedField, setSavedField] = useState<Field | null>(null);
  const generation = useRef(0),
    alive = useRef(false),
    busy = useRef(false),
    saving = useRef(false),
    saved = useRef<ProfileCleanupChoice | null>(null),
    inFlight = useRef<ProfileCleanupChoice | null>(null),
    currentDraft = useRef(draft),
    queued = useRef<{ choice: ProfileCleanupChoice; field: Field } | null>(null),
    flashTimer = useRef<number | undefined>(undefined),
    currentClient = useRef(client),
    errorFeedback = useRef<HTMLDivElement>(null);
  currentClient.current = client;
  currentDraft.current = draft;
  const current = (token: number, startedClient: ProfileCleanupClient) =>
    alive.current &&
    generation.current === token &&
    currentClient.current === startedClient;

  const adopt = (next: ProfileCleanupStatus, options: {keepDraft?: boolean; keepOrigins?: boolean} = {}) => {
    saved.current = next.choice;
    setStatus(next);
    setDraft(previous => options.keepDraft ? previous : {
      ...draftFromChoice(next.choice),
      ...(options.keepOrigins ? {originsText: previous.originsText} : {}),
    });
    if (!options.keepDraft && !options.keepOrigins) {
      setInputError(null);
      setOriginsChecked(false);
    }
  };
  const flash = (field: Field) => {
    window.clearTimeout(flashTimer.current);
    setSavedField(field);
    flashTimer.current = window.setTimeout(
      () => setSavedField(null),
      savedFlash,
    );
  };

  useEffect(() => {
    const token = ++generation.current;
    alive.current = true;
    busy.current = true;
    saving.current = false;
    setPendingSave(false);
    inFlight.current = null;
    queued.current = null;
    saved.current = null;
    setPhase("loading");
    setStatus(null);
    setError(null);
    setNotice("");
    setUncertain(false);
    setInputError(null);
    setOriginsChecked(false);
    void Promise.resolve()
      .then(() => client.status())
      .then((value) => {
        if (current(token, client)) adopt(checkedCleanupStatus(value, profileId));
      })
      .catch((reason) => {
        if (current(token, client))
          setError({
            message: t("cleanup.loadFailed"),
            detail: cleanupErrorDetail(reason),
          });
      })
      .finally(() => {
        if (current(token, client)) {
          busy.current = false;
          setPhase("idle");
        }
      });
    return () => {
      alive.current = false;
      generation.current++;
      window.clearTimeout(flashTimer.current);
    };
  }, [client, profileId]);

  useLayoutEffect(() => {
    if (!failureSerial) return;
    errorFeedback.current?.focus({ preventScroll: true });
    errorFeedback.current?.scrollIntoView({ block: "nearest" });
  }, [failureSerial]);

  const locked =
      !!status &&
      (status.running || status.networkBlocked || !!status.recoveryError),
    working = phase !== "idle",
    originsValidation = validateCleanupDraft({
      enabled: false,
      categories: [],
      originsText: draft.originsText,
    }),
    originsError =
      inputError || (originsChecked ? originsValidation.originsError : undefined),
    needsCategory = draft.enabled && !draft.categories.length;

  async function refresh() {
    if (busy.current || saving.current) return;
    const token = generation.current,
      startedClient = client;
    busy.current = true;
    setPhase(status ? "refreshing" : "loading");
    setNotice("");
    setError(null);
    try {
      const result = await client.status();
      if (!current(token, startedClient)) return;
      const keepDraft = !!saved.current && draftChanged(currentDraft.current, saved.current);
      adopt(checkedCleanupStatus(result, profileId), {keepDraft});
      setUncertain(false);
      setNotice(keepDraft ? t("cleanup.statusUpdatedKeepEdits") : t("cleanup.statusUpdated"));
    } catch (reason) {
      if (current(token, startedClient)) {
        setFailureSerial((value) => value + 1);
        setUncertain(!!status);
        setError({
          message: t("cleanup.statusFailed"),
          detail: cleanupErrorDetail(reason),
        });
      }
    } finally {
      if (current(token, startedClient)) {
        busy.current = false;
        setPhase("idle");
      }
    }
  }

  /** Saves one change on top of what is already saved. Changes made while a save is running are folded into one
   *  follow-up save, so quick clicks never race. */
  async function commit(patch: Partial<ProfileCleanupChoice>, field: Field) {
    const base = queued.current?.choice ?? inFlight.current ?? saved.current;
    if (!base || uncertain || locked || busy.current) return;
    const choice: ProfileCleanupChoice = { ...base, ...patch };
    if (sameCleanupChoice(choice, base)) return;
    queued.current = { choice, field };
    if (saving.current) return;
    const token = generation.current,
      startedClient = client;
    saving.current = true;
    setPendingSave(true);
    setError(null);
    setNotice("");
    try {
      while (queued.current) {
        const { choice: next, field: changed } = queued.current;
        queued.current = null;
        inFlight.current = next;
        const result = await client.set(next);
        if (!current(token, startedClient)) return;
        if (isCleanupCancellation(result))
          throw Error(t("cleanup.notSaved"));
        const verified = checkedCleanupStatus(result, profileId);
        if (!sameCleanupChoice(verified.choice, next))
          throw Error(t("cleanup.differs"));
        saved.current = verified.choice;
        inFlight.current = null;
        setStatus(verified);
        flash(changed);
      }
    } catch (reason) {
      if (current(token, startedClient)) {
        setFailureSerial((value) => value + 1);
        setUncertain(true);
        queued.current = null;
        setError({
          message: t("cleanup.changeFailed"),
          detail: cleanupErrorDetail(reason),
        });
        try {
          const verified = checkedCleanupStatus(await client.status(), profileId);
          if (!current(token, startedClient)) return;
          setUncertain(false);
          adopt(verified, {keepOrigins: currentDraft.current.originsText !== verified.choice.keepOrigins.join("\n")});
        } catch {
          if (current(token, startedClient)) setUncertain(true);
        }
      }
    } finally {
      if (current(token, startedClient)) {
        inFlight.current = null;
        saving.current = false;
        setPendingSave(false);
      }
    }
  }

  function changeEnabled(enabled: boolean) {
    setDraft((previous) => ({ ...previous, enabled }));
    if (enabled && !draft.categories.length) return;
    void commit({ enabled, categories: draft.categories }, "enabled");
  }
  function changeCategory(category: CleanupCategory, on: boolean) {
    const categories = cleanupCategories.filter((value) =>
      value === category ? on : draft.categories.includes(value),
    );
    // Clearing the last selection turns the setting off, so what is shown is always what will happen at exit.
    const enabled = draft.enabled && categories.length > 0;
    setDraft((previous) => ({ ...previous, categories, enabled }));
    void commit({ enabled, categories }, "categories");
  }
  function commitOrigins() {
    const base = queued.current?.choice ?? inFlight.current ?? saved.current;
    if (!base || inputError) return;
    setOriginsChecked(true);
    const parsed = validateCleanupDraft({
      enabled: base.enabled,
      categories: base.categories,
      originsText: draft.originsText,
    });
    if (!parsed.choice) return;
    setDraft((previous) => ({
      ...previous,
      originsText: parsed.choice!.keepOrigins.join("\n"),
    }));
    void commit({ keepOrigins: parsed.choice.keepOrigins }, "origins");
  }
  const tag = (field: Field) => (
    <span className="profile-cleanup__tag" role="status">
      {savedField === field ? t("cleanup.saved") : ""}
    </span>
  );

  return (
    <div className="profile-cleanup__body st-group-body" aria-busy={working || pendingSave}>
      {status ? (
        <>
          {uncertain && (
            <div className="profile-cleanup__saved">
              <span>
                {t("cleanup.stale", { state: status.choice.enabled ? t("cleanup.on") : t("cleanup.off") })}
              </span>
            </div>
          )}
          {locked && (
            <div
              className={`profile-cleanup__state${status.recoveryError ? " profile-cleanup__state--error" : ""}`}
              role={status.recoveryError ? "alert" : "status"}
            >
              <strong>
                {status.recoveryError
                  ? t("cleanup.recoveryAttention")
                  : status.running
                    ? t("cleanup.inProgress")
                    : status.networkBlocked
                      ? t("cleanup.paused")
                      : t("cleanup.queued")}
              </strong>
              <p>{t("cleanup.locked")}</p>
              {status.recoveryError && (
                <details>
                  <summary>{t("cleanup.recoveryDetails")}</summary>
                  <p>{cleanupErrorDetail(new Error(status.recoveryError))}</p>
                </details>
              )}
            </div>
          )}
          <fieldset
            className="profile-cleanup__controls"
            disabled={working || locked || uncertain}
            aria-describedby={locked ? `${id}-lock` : undefined}
          >
            {locked && (
              <p id={`${id}-lock`} className="profile-cleanup__sr">
                {t("cleanup.lockedSr")}
              </p>
            )}
            <div className="st-row profile-cleanup__enable" data-setting="cleanup-enabled">
              <div className="st-copy">
                <span className="st-title">{t("cleanup.enable")}</span>
                <p>{t("cleanup.enableNote")}</p>
              </div>
              <div className="st-control">
                {tag("enabled")}
                <Switch
                  label={t("cleanup.enable")}
                  checked={draft.enabled}
                  onChange={changeEnabled}
                />
              </div>
            </div>
            <details className="profile-cleanup__fold" open={draft.enabled || detailOpen} onToggle={(event) => setDetailOpen(event.currentTarget.open)}>
            <summary>
              <span>{t("cleanup.whatToClear")}</span>
              <span className="profile-cleanup__fold-summary">{draft.categories.length ? t("cleanup.kinds", { count: draft.categories.length }) : t("cleanup.nothingChosen")}</span>
            </summary>
            <fieldset
              className="profile-cleanup__categories"
              data-setting="cleanup-categories"
              aria-describedby={needsCategory ? `${id}-categories-error` : undefined}
            >
              <legend>{t("cleanup.dataToClear")} {tag("categories")}</legend>
              {cleanupCategories.map((category) => (
                <div key={category} className="st-row profile-cleanup__category">
                  <div className="st-copy">
                    <span className="st-title">{t(labelIds[category].title)}</span>
                    <p>{t(labelIds[category].note)}</p>
                  </div>
                  <div className="st-control">
                    <Switch
                      label={t(labelIds[category].title)}
                      checked={draft.categories.includes(category)}
                      onChange={(on) => changeCategory(category, on)}
                    />
                  </div>
                </div>
              ))}
            </fieldset>
            {needsCategory && (
              <p
                className="profile-cleanup__validation"
                role="status"
                id={`${id}-categories-error`}
              >
                {t("cleanup.chooseOne")}
              </p>
            )}
            <div
              className="st-row profile-cleanup__origins"
              data-setting="cleanup-keep-sites"
              data-stacked
            >
              <div className="st-copy">
                <label className="st-title" htmlFor={`${id}-origins`}>
                  {t("cleanup.sitesToKeep")} {tag("origins")}
                </label>
                <p id={`${id}-origins-help`}>{t("cleanup.sitesHelp")}</p>
              </div>
              <div className="st-control">
                <textarea
                  id={`${id}-origins`}
                  className="st-textarea"
                  rows={3}
                  value={draft.originsText}
                  placeholder="https://mail.example.com"
                  spellCheck={false}
                  autoCapitalize="none"
                  autoCorrect="off"
                  aria-invalid={!!originsError}
                  aria-describedby={`${id}-origins-help${originsError ? ` ${id}-origins-error` : ""}`}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (value.length > maxKeepText) {
                      setInputError(t("cleanup.listTooLong"));
                      return;
                    }
                    setInputError(null);
                    setOriginsChecked(false);
                    setDraft((previous) => ({
                      ...previous,
                      originsText: value,
                    }));
                  }}
                  onBlur={commitOrigins}
                  onKeyDown={(event) => {
                    if (event.key !== "Escape" || !saved.current) return;
                    event.preventDefault();
                    setInputError(null);
                    setOriginsChecked(false);
                    setDraft((previous) => ({
                      ...previous,
                      originsText: saved.current!.keepOrigins.join("\n"),
                    }));
                  }}
                />
                {originsError && (
                  <p
                    className="profile-cleanup__validation"
                    role="alert"
                    id={`${id}-origins-error`}
                  >
                    {/^Line \d+:/.test(originsError) ? t("cleanup.originLine", { line: Number(/^Line (\d+):/.exec(originsError)![1]) }) : originsError}
                  </p>
                )}
              </div>
            </div>
            </details>
          </fieldset>
          {status.pending && !locked && (
            <p className="profile-cleanup__pending" role="status">
              {t("cleanup.pending")}
            </p>
          )}
          <details className="profile-cleanup__details" id="cleanup-help" data-setting="cleanup-help">
            <summary>{t("cleanup.howTitle")}</summary>
            <p>{t("cleanup.how1")}</p>
            <p>{t("cleanup.how2")}</p>
            <p>{t("cleanup.how3")}</p>
            <p>{t("cleanup.how4")}</p>
          </details>
        </>
      ) : phase === "loading" ? (
        <p role="status" className="profile-cleanup__loading">
          {t("cleanup.loading")}
        </p>
      ) : null}
      {error && (
        <div className="profile-cleanup__error" role="alert" ref={errorFeedback} tabIndex={-1}>
          <strong>{error.message}</strong>
          <details>
            <summary>{t("cleanup.errorDetails")}</summary>
            <p>{error.detail}</p>
          </details>
        </div>
      )}
      <div className="profile-cleanup__status-row">
        <p role="status" className="profile-cleanup__feedback">
          {notice}
        </p>
        <button
          type="button"
          className="st-button"
          aria-disabled={working || pendingSave}
          onClick={() => {
            void refresh();
          }}
        >
          {phase === "refreshing"
            ? t("cleanup.checking")
            : status
              ? t("cleanup.checkStatus")
              : t("cleanup.reload")}
        </button>
      </div>
    </div>
  );
}
