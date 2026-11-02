# Chromium extension API definitions (vendored)

Unmodified copies of Chromium's extension API schema and feature files, used by `scripts/gen-extension-api.mjs` to generate
`desktop/browser-services/extension-api-surface.gen.cjs`.

- Source: `https://chromium.googlesource.com/chromium/src`, tag **152.0.7977.167** (the Chromium inside Electron 44.9.3; see `REVISION`).
- Files: every `*.json`, `*.idl` and `*.webidl` in `chrome/common/extensions/api/` (plus its `devtools/` folder) and
  `extensions/common/api/`, including `_api_features.json`, `_permission_features.json` and `_manifest_features.json` from both folders.
  `extensions/renderer/bindings/api_invocation_errors.cc` is kept as the reference for the error strings that
  `extension-api-signature.cjs` reproduces.
- License: Chromium's BSD-style license, in `LICENSE` (copied from the root of chromium/src).
- Not shipped: nothing in the app reads this folder at runtime; only the generated module is bundled.

To move to a newer Chromium: replace these files with the same paths from the new tag, update `REVISION`, run
`node scripts/gen-extension-api.mjs`, then `node --test tests/extension-api-surface.test.cjs`.
