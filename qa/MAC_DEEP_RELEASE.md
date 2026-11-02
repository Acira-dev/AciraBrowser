# Additional Mac release journeys

These checks complement `mac-interface-release.mjs`; opening Settings sections does not establish real website behavior.
Run from the repository root on macOS with the native Electron fixture permissions. Each runner creates a new owned `.qa-profiles` directory, serves only loopback data, stays hidden, reports failures with a nonzero exit, and closes its own process. The installed browser and profile are not used.

```sh
node qa/mac-deep-release.mjs /absolute/path/to/immutable/candidate
node qa/mac-download-resume.mjs /absolute/path/to/immutable/candidate
MAC_RESUME_WITH_PRIVATE=1 node qa/mac-download-resume.mjs /absolute/path/to/immutable/candidate
node qa/mac-private-download.mjs /absolute/path/to/immutable/candidate
```

`MAC_DEEP_OUT` selects an evidence directory. Without a candidate argument the runners exercise current built sources; a final release receipt must rerun against the immutable committed candidate.

- `mac-deep-release`: mounted Find and native Mac Cmd+F; actual match navigation; local Reader sanitization and Cmd-click profile ownership; native site confirm/text cards and Unicode/cancel/text safety; actual denied geolocation and permission reset; unsaved draft Stay/Leave; real HTTP Basic through the mounted form; real native PDF bytes/permissions and stale-output refusal; real muted media pause/resume/volume.
- `mac-download-resume`: actual download progress/pause, owned main-process SIGKILL, persisted partial record, mounted Resume with no ordinary website renderer, real HTTP Range/If-Range and owning-profile cookie, same download ID and exact full-file SHA256. The private-present variant leaves a background private website open with a different cookie jar, proving it cannot supply an ordinary transfer's source.
- `mac-private-download`: actual private transfer, mounted Pause/Resume while viewing ordinary Downloads, native private retirement, no misleading Retry, and no private record ID/filename in the real recovery journal or saved browser database.

OS file-picker destinations are supplied inside the owned profile for the PDF check; this does not qualify the physical picker. Synthetic HTTP Basic is a website challenge, not an OS credential prompt. No Keychain, biometric, passkey or external-provider decision is operated or faked. Hidden native input is not a full physical keyboard/display qualification. Native fullscreen transitions, other Mac hardware, Intel, real DRM/VPN/OAuth accounts and notarization remain separate device/service checks.
