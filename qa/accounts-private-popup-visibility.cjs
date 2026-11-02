"use strict";
// Isolated QA entrypoint. Wraps the REAL app handler and changes ONLY show:false
// before Electron creates an allowed popup. Never used by the product graph.
const { app } = require("electron");
if (
  process.env.ACIRA_BROWSER_TEST_HIDDEN !== "1" ||
  process.env.ACIRA_QA_POPUP_VISIBILITY_GUARD !== "1" ||
  !/accounts-private-popup-\d+$/.test(process.env.ACIRA_BROWSER_TEST_DATA || "")
)
  throw new Error("Owned hidden private-popup fixture is required");
globalThis.accountsPrivatePopupVisibilityGuard = {
  wrapped: new Set(),
  allowed: [],
  refusedCustomWindow: 0,
};
app.on("web-contents-created", (_event, contents) => {
  const original = contents.setWindowOpenHandler.bind(contents);
  contents.setWindowOpenHandler = (handler) => {
    globalThis.accountsPrivatePopupVisibilityGuard.wrapped.add(contents.id);
    return original((details) => {
      const result = handler(details);
      if (result?.action !== "allow") return result;
      if (result.createWindow) {
        globalThis.accountsPrivatePopupVisibilityGuard.refusedCustomWindow++;
        return { action: "deny" };
      }
      globalThis.accountsPrivatePopupVisibilityGuard.allowed.push({
        sourceId: contents.id,
        show: false,
      });
      return {
        ...result,
        overrideBrowserWindowOptions: {
          ...result.overrideBrowserWindowOptions,
          show: false,
        },
      };
    });
  };
});
require("../desktop/main.cjs");
