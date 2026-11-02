# Reproducibility and CI evidence

The workflow uses lockfile installation and Node24.11.1, then builds/tests on Windows/macOS/Linux runners. Those jobs are compile/unit checks, not a substitute for native UI/platform acceptance. A Windows-only job builds an isolated committed renderer/native output, requires the exact policy-qualified patched Electron44.9.3/runtime hash and dependency licenses, checks genuine first-credential crash recovery, local browsing/profile Settings, standalone launch, filtering/external-URL intake, protected session restoration and Reader assets, then compiles and extracts an explicitly unsigned installer wrapper. It uploads the unsigned portable/installer artifacts. It never signs, deploys a service, creates a hosted account, publishes a GitHub release or uploads browser/test profiles.

Ordinary cleanup lifecycle/active-worker recovery, the original no-observer private-worker regression and private cancellation/final-window/global-quit fixtures are wired for both immutable source and the exact manifest-qualified branded executable. Cleanup CI selects its fixture from the selected product's own Git commit with --committed-fixture, without ignored local snapshot files or mutable working QA. Local captured-owner mode additionally verifies the selected commit's fixture and integration source hashes before any native launch. Each multi-command PowerShell stage propagates each failure immediately. Bounded synthetic qualification JSON is preserved separately even on failure; browser profiles and credential-store files are excluded. These workflow additions are preparation, not a remote execution pass; the recorded scheduler restriction below remains unresolved.

Only contents:read permission is granted. Checkout credentials are not persisted. The three official actions are pinned to immutable commits, independently resolved through git ls-remote on23October2026UTC:

| Official action | Verified tag | Commit |
|---|---|---|
| actions/checkout | v7 | 3d3c42e5aac5ba805825da76410c181273ba90b1 |
| actions/setup-node | v7 | 949feb2413d6458794dcd2491c4babbbce0c15c1 |
| actions/upload-artifact | v7 | cf430e030ddbb5b0abf93d22962f4752f3646cd9 |

The configuration follows the respective official repository documentation. Job execution, logs and artifact identity must be checked after the workflow commit is pushed. No CI success is claimed merely because the workflow is written.

Release artifact provenance records source commit and source-file digest, renderer/native output hashes, exact lockfile hash, Node/platform/architecture and Electron runtime/dependency identities. Runtime files and all packaged files have SHA256 manifests. The source digest includes uncommitted inputs when a local experiment is made; such an experiment cannot be advertised as an exact committed-source release. The runtime archive is checksum-verified by Electron's installed fetcher or scripts/install-runtime.mjs; generated manifests record extracted file hashes, not a claim that Acira has signed the executable.

Native executable metadata/icon now use the approved canonical symbol and real product version; source/tool/icon hashes are in packaging provenance, and Windows VersionInfo plus extracted icon were checked. Signing remains absent. Ordinary-delivery work still includes installer/OS registration, signing credentials, update feed/protocol/rollback, installed profile upgrade and real native Mac/Linux UI/hardware qualification. The portable fixture confirms app.isPackaged, actual app.getVersion and resources/app path, and rejects production modules loaded from the source checkout.

Actual first run: [40034102570](https://github.com/Acira-dev/AciraBrowserNoAI/actions/runs/40034102570), commit e15daf2, was blocked before any job/step executed by the GitHub account billing/spending-limit scheduler restriction. Three source jobs have zero steps and the portable job was skipped. Account-owner intervention is required; no payment/limit was changed. This is neither a remote build/test pass nor an observed code failure. See docs/release/ci-e15daf2.json.
