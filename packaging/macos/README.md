# Local macOS install and first launch

Build on an Apple Silicon Mac using the checked-in Electron dependency:

```sh
npm run build
npm test
# Commit the reviewed source locally first.
node scripts/release-build-mac-head.mjs qa/artifacts/release-mac-setup-committed
node scripts/package-mac.mjs qa/artifacts/release-mac-setup-committed
```

The packager creates a fresh, ignored `release/Acira-mac-*` directory containing
`Acira Browser.app`, `Install Acira.app`, a setup DMG and a provenance manifest.
The installer uses the same Creation artwork, typography and completion motion
as the Windows installer. Its progress comes from hashing, copying and verifying
the actual app, rather than a timed demonstration.

Open the DMG and then **Install Acira**. Installation goes to
`~/Applications/Acira Browser.app` without requiring administrator access. Choose
**Open Acira** to begin the shared first-run setup, including imports, default
browser selection and personalization. macOS handles confirmation of a default
browser change. Acira never chooses itself silently. Browser data is separate
from the installed app and is never cleared by the installer; replacing an app
keeps the previous bundle beside it as a hidden recovery copy.

An upgrade checks the target bundle's running browser and helper processes before
copying and immediately before replacement. Quit Acira and choose **Try again**
if it is running. The installer never terminates the browser or overwrites its
live bundle. If checking processes fails, the existing application stays in place.

For an isolated end-to-end test, launch the installer executable with
`ACIRA_INSTALLER_TEST_MODE=1`, an `ACIRA_INSTALLER_TEST_ROOT` under the system temp
directory whose basename begins `acira-install-`, and
`ACIRA_BROWSER_TEST_DATA` pointing to a fresh browser-profile directory there.
The installed test app and installer data then stay inside that test root.
Use the native UI to install, open, complete setup, quit and reopen the app.
Never reuse or clear a personal profile for this test. The Electron preview and
the branded application have different macOS signing identities; encrypted
profile migration between those identities requires separate qualification.
Test-root installations are not registered with Launch Services, so disposable
copies do not become application choices on the user's Mac.

This package has a verified local ad-hoc code signature. Public distribution
still requires a Developer ID certificate and Apple notarization; this command
neither publishes nor bypasses Gatekeeper. Electron's packaged protocol handling
is declared in the browser's Info.plist, as required by the
[Electron default protocol client API](https://www.electronjs.org/docs/latest/api/app#appsetasdefaultprotocolclientprotocol-path-args).

For a public distribution candidate, set `ACIRA_MAC_SIGN_IDENTITY` to the full
`Developer ID Application: … (TEAMID)` certificate name already available to
codesign, and pass `--distribution`. This mode refuses the local ad-hoc default
and development certificates. The certificate subject and Team ID must match
the verified legal signer in `desktop/browser-services/mac-distribution-identity.cjs`.
This release uses the individual Apple membership of Khaled Kaed Beyh,
Team ID `2MGLP3QV9X`; macOS shows that legal signer while the product remains
Acira Browser. Both packaging and automatic updates require that exact identity.
It enables hardened runtime, signs nested code,
and preserves that same identity when resealing the final Tor manifest. Set
`ACIRA_MAC_NOTARY_PROFILE` to an existing local `notarytool` credential profile.
No password, private key or access token belongs in source or command arguments.
The packager refuses a distribution build without that profile name.

The distribution sequence notarizes and staples the browser first, then hashes
that final payload into the installer, notarizes/staples the installer, and signs,
notarizes and staples the final DMG. Each ticket is validated and each artifact
must pass Gatekeeper assessment. Apple requires the separate payload step for
[custom installers](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow).
A rejected or unavailable Apple response fails the build; it cannot produce a
manifest claiming public readiness. This never publishes or installs credentials,
enrolls an Apple account, operates security prompts or disables Gatekeeper.

Distribution builds also produce the signed/stapled browser ZIP and
`beta-mac.yml` or `latest-mac.yml`, with the ZIP's actual SHA-512 and architecture.
The installed app contains the matching public GitHub feed configuration.
The Mac updater uses Electron's native Squirrel signature validation and the
same download/channel/restart controls as Windows. Local ad-hoc builds cannot
activate automatic delivery and emit no public update feed. Uploading release
assets remains a separate human-authorized release action; this workflow is local.

The current package uses the host architecture. An Apple Silicon package is
labelled `arm64`; it must not be presented as an Intel package. Intel execution
and a genuinely clean external Mac download remain separate device checks.

## Developer ID signed beta DMGs

`release-build-mac-head.mjs` captures the release-target module and its JSON from
Git alongside the application source. It is a separate macOS entry point; the
shared/Windows build script and release target are unchanged.

For an explicitly unnotarized beta, `package-mac-beta.mjs` accepts an existing
verified Developer ID signed Mac template with the exact Electron version and
architecture. It replaces the application payload from the committed candidate,
verifies all source files and native architectures, and signs the final app and
DMG with the configured legal signer. For example:

```sh
node scripts/package-mac-beta.mjs qa/artifacts/release-mac-setup-committed "/owned/verified/Acira Browser.app" arm64 0.1.0-beta.2
```

The Mac prerelease version is applied only to that Mac payload; the shared
`package.json`, Windows installer and Windows update target are untouched. Output
is kept under an ignored `.noindex` release folder to avoid extra launcher icons.
This beta command performs no notarization submission, never modifies the
installed browser or its profile, and never activates an automatic-update offer.
Its DMG and embedded app are truthfully marked signed but unnotarized. The app
retains the public Mac update configuration for future signed updates. Use the
notarized distribution workflow above to qualify and publish a later update ZIP
and its Mac-only channel manifest. Never replace Windows channel metadata as part
of a Mac release.

Beta DMGs now contain **Install Acira.app**, with the browser inside its verified
payload archive. Open that installer to see actual copying and integrity-check
progress, then choose **Open Acira** for first-run setup. A separate browser app
and drag-to-Applications shortcut are not included in the disk image. Both the
browser and installer remain unnotarized in this explicitly local beta workflow;
building them never submits anything to Apple or publishes an update. The
notarized distribution workflow above retains its existing gates.

Repeated Keychain prompts across local rebuilds can result from ad-hoc signing:
macOS cannot consistently recognize the rebuilt code as the same application.
Use a consistent valid signing identity for packaged encryption/upgrade
qualification. Do not disable encryption or broaden a Keychain item's access
to work around this. See [Electron's signing and Keychain guidance](https://www.electronjs.org/docs/latest/tutorial/code-signing#macos-apis-that-require-code-signing).

## Website session encryption

The browser runtime enables Electron’s cookie-encryption fuse before signing, then reads it back from the signed bundle. Packaging fails if it is disabled. The installer runtime is unchanged. Verify an upgrade and normal relaunch using an owned HTTP-only test cookie, inspect value/encrypted_value lengths after normal shutdown, and confirm the session survives. Keep real profiles intact; never clear sessions to make this check pass. Keychain approval remains a human OS decision.

## OS verification on Mac

Protected password actions, the Tor vault and secured workspaces use Apple's
`LAPolicyDeviceOwnerAuthentication` through the signed universal native bridge.
macOS chooses Touch ID, a paired Apple Watch or the account password, including
on Macs without Touch ID. The password stays inside Apple's prompt; Acira receives
only the verification result. Cancellation, unavailable verification, errors and
timeouts keep protected items locked. See [Apple's device-owner policy](https://developer.apple.com/documentation/localauthentication/lapolicy/deviceownerauthentication).

Automated tests probe native availability and rejection without opening a security
prompt, and test result handling through an explicit fixture port. Real human
verification and device-specific methods remain separate acceptance checks. Test
bypass switches work only in an unpackaged owned test profile, never an installed
distribution build.

## Installer language

The native installer follows the first supported macOS preferred language: English, Spanish, French, German, Portuguese, Italian, Japanese or Chinese, matching the Windows installer catalog. Unknown languages fall back to English. Shared progress labels reuse the Windows source; Mac destinations, actions and recovery messages use the Mac catalog. Browser setup language remains independent.

## Bundled Tor on Mac

Immutable Mac candidates include the official pinned Tor Expert Bundle for the host architecture, verified with both its recorded SHA-256 and the pinned Tor Browser Developers OpenPGP key. Tor, libevent, the native lyrebird and conjure transport clients, their configuration/licenses, and GeoIP tables are extracted from that verified archive. Native executables are locally signed before launch; the package seals their final hashes in native-manifest.json after signing. Runtime verifies the executable, its library and both native transport clients before bridge launch. Bridge commands use native Mac filenames and POSIX paths; Moat uses the same verified native lyrebird. The Mac updater follows the official Mac feed and verifies/signs a platform-appropriate update before selecting it; invalid updates keep the bundled engine. Tor sessions retain the shared fail-closed SOCKS policy and ephemeral profile. Public signing/notarization and human vault verification remain separate release gates.

## Extension hosts and installed web apps

Native messaging checks the standard Mac user and system directories for Chrome,
Chromium, Edge and Brave, plus Acira's existing profile directory. Manifests must
allow the exact calling extension origin, and Mac host executables must have an
absolute executable path. Hosts receive the extension origin and run beside their
executable; the Windows parent-window argument stays Windows-only.

Installing a website as an app creates a Finder launcher under
`~/Applications/Acira Apps`. It opens the existing Acira browser with the saved app
ID, so its original profile/session and standalone window remain authoritative.
The launcher contains no password or browser profile copy. Titles are escaped as
data, unrelated applications are preserved on name collisions, and failed
replacement restores the previous owned launcher. Test profiles create launchers
inside their owned directory. Uninstall removes only an Acira-owned matching stub.
