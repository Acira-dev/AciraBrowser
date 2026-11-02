import { _electron } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { poll } from "./native-helpers.mjs";

// Credential-free compatibility probe only. Never enter email/password, choose an
// account, accept consent, solve CAPTCHA, spoof UA or bypass TLS/provider policy.
const root = process.cwd(),
  run = Date.now(),
  data = path.join(root, ".qa-profiles/accounts-google-signed-out-" + run),
  out = path.join(root, "qa/artifacts/accounts-google-signed-out-" + run);
await fs.mkdir(data, { recursive: true });
await fs.mkdir(out, { recursive: true });
const requested =
  "https://accounts.google.com/ServiceLogin?service=mail&continue=https%3A%2F%2Fmail.google.com%2Fmail%2F&hl=en";
let app;
try {
  app = await _electron.launch({
    executablePath:
      process.env.ACIRA_TEST_EXECUTABLE ||
      path.join(root, "node_modules/electron/dist/electron.exe"),
    args: [path.join(root, "desktop/main.cjs")],
    env: {
      ...process.env,
      ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data,
      ACIRA_BROWSER_TEST_HIDDEN: "1",
      ACIRA_MATERIAL: "none",
    },
    timeout: 30000,
  });
  const ui = await poll(
    async () => {
      for (const page of app.context().pages())
        try {
          if (
            await page.evaluate(
              () => !!window.acira?.getSnapshot && !!window.acira?.setup,
            )
          )
            return page;
        } catch {}
    },
    Boolean,
    "isolated Acira UI",
    15000,
  );
  const skip = ui.getByRole("button", { name: "Skip setup", exact: true });
  if (await skip.count()) await skip.click();
  const state = await ui.evaluate(() => window.acira.getSnapshot()),
    tabId = state.activeTabId,
    partition = state.browserProfiles.find(
      (profile) => profile.id === state.activeBrowserProfileId,
    ).partition;
  await ui.evaluate(
    ({ tabId, url }) =>
      window.acira.browserCommand({ type: "navigate", tabId, url }),
    { tabId, url: requested },
  );
  let observation;
  try {
    observation = await poll(
      async () =>
        app.evaluate(async ({ webContents, session }, partition) => {
          for (const contents of webContents.getAllWebContents())
            if (
              !contents.isDestroyed() &&
              contents.session === session.fromPartition(partition) &&
              /^https:\/\//.test(contents.getURL())
            ) {
              try {
                const page = await contents.executeJavaScript(
                  '({url:location.href,title:document.title,text:document.body?.innerText?.slice(0,6000)||"",emailInput:!!document.querySelector("input[type=email]"),passwordInput:!!document.querySelector("input[type=password]"),captchaFrame:!!document.querySelector("iframe[src*=recaptcha],iframe[src*=captcha]"),userAgent:navigator.userAgent,platform:navigator.platform,ready:document.readyState})',
                );
                if (page.ready !== "loading" && page.text.trim().length > 20)
                  return { ...page, loading: contents.isLoading() };
              } catch {}
            }
        }, partition),
      Boolean,
      "Google signed-out document",
      22000,
    );
  } catch (error) {
    observation = { url: requested, text: "", probeError: error.message };
  }
  const browserState = await ui.evaluate(() => window.acira.getSnapshot()),
    tab = browserState.tabs.find((item) => item.id === tabId);
  let classification = "unclassified-provider-state",
    boundary = "No further interaction attempted.";
  if (tab?.error) {
    classification = "native-navigation-failed";
    boundary = "Stopped at native network/TLS error; no bypass attempted.";
  } else if (
    /this browser or app may not be secure|couldn.t sign you in|disallowed.useragent|unsupported browser|use a supported browser/i.test(
      observation.text,
    )
  ) {
    classification = "provider-preauth-rejected";
    boundary = "Stopped at provider restriction; no spoof or bypass.";
  } else if (
    observation.captchaFrame ||
    /unusual traffic|verify you are human|complete the captcha/i.test(
      observation.text,
    )
  ) {
    classification = "provider-challenge";
    boundary = "Stopped at CAPTCHA/human-verification boundary.";
  } else if (
    /before you continue to google|accept all|reject all/i.test(
      observation.text,
    ) &&
    /cookie|privacy/i.test(observation.text)
  ) {
    classification = "provider-consent-required";
    boundary = "Stopped at consent boundary; no choice submitted.";
  } else if (
    observation.emailInput ||
    /email or phone/i.test(observation.text)
  ) {
    classification = "provider-sign-in-presented";
    boundary =
      "Real email/account input requested. Stopped without entering any identifier.";
  } else if (
    observation.passwordInput ||
    /choose an account/i.test(observation.text)
  ) {
    classification = "provider-account-interaction-required";
    boundary = "Stopped before account choice or credentials.";
  }
  assert.equal(
    await app.evaluate(({ BaseWindow }) =>
      BaseWindow.getAllWindows().every((window) => !window.isVisible()),
    ),
    true,
  );
  const result = {
    classification,
    boundary,
    requested,
    observation,
    nativeError: tab?.error || null,
    runtime: await app.evaluate(() => process.versions),
    nativeRendererIdentity: createHash("sha256")
      .update(await fs.readFile(path.join(root, "desktop/main.cjs")))
      .update(await fs.readFile(path.join(root, "dist/index.html")))
      .digest("hex"),
    visibleWindows: false,
    credentialsEntered: false,
    consentSubmitted: false,
    authenticatedSignIn: false,
    authenticatedGmailRestart: false,
    chromeSync: "deferred/unavailable; not implied by website sign-in",
    at: new Date().toISOString(),
  };
  await fs.writeFile(
    path.join(out, "result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        classification,
        boundary,
        finalUrl: observation.url,
        title: observation.title,
        visibleMessage: observation.text?.slice(0, 700),
        nativeError: result.nativeError,
        artifacts: out,
        authenticatedSignIn: false,
        authenticatedGmailRestart: false,
      },
      null,
      2,
    ),
  );
} finally {
  await app?.close().catch(() => {});
}
