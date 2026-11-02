# Helium onboarding source reuse

Source: https://github.com/imputnet/helium-onboarding

Pinned commit: `64257c5ea5b04c551305120eef5a495046f4e1fa`.

License: GPL-3.0. Exact upstream LICENSE is retained here. The selected upstream files are reference source, not a Svelte dependency bundled into Acira.

Actual adaptation:

- `onboarding-flow.ts`: bounded next/previous traversal and skipping already-default browser setup, adapted in `src/features/onboarding/flow.ts` and `desktop/accounts/onboarding.cjs`.
- `ProfileImportOption.svelte`: explicit per-profile capability gating adapted in `src/features/onboarding/import-capabilities.ts`.
- App/importer/default-option files informed resume-safe page state and serialized native import handling. Acira uses its own Electron importer/SQLite APIs; Chromium/Svelte bridges are not represented as running inside Acira.

Acira's release setup is local-only and contains no Acira account, hosted authentication or cloud-sync step. Existing browser profiles/settings are preserved. Tests: `tests/accounts-onboarding.test.cjs`, `tests/onboarding-flow.test.ts`, `qa/first-run-capture.mjs` (the real app), `qa/accounts-error-states.mjs` (failure paths), `qa/accounts-scope-audit.mjs` and `qa/accounts-site-storage.mjs`. Generated test data/captures are excluded from publication.
