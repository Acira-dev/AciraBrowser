Acira Browser 0.1.0-beta.10 for Linux x86_64

This is an unsigned Linux beta. Validation coverage is Ubuntu 24.04 x86_64
under WSL2 on this Windows laptop, with WSLg window rendering. Do not infer
testing on ARM64, other distributions or a physical Linux installation.

INSTALL
Download the AppImage and the setup-support ZIP from the same private release.
Extract the ZIP beside the AppImage, then run:
  chmod +x Install-Acira.sh
  ./Install-Acira.sh

The installer verifies release checksums, installs a user-owned AppImage and
application-menu entry, and asks through PolicyKit before installing Acira's
system authentication policy. That policy requires the current user's own
authentication for protected browser items; it grants no administrator access.
A working desktop PolicyKit agent and a secure OS keyring are required for
protected items. Linux password and keyring dialogs belong to your operating
system. Acira does not receive your login password.

The AppImage is installed at:
  ~/.local/share/acira-browser/AciraBrowser.AppImage
It must remain user-owned and writable for automatic updates. AppImages are
not Windows EXE files. This beta targets x86_64 Linux.

UNINSTALL
Run ./Install-Acira.sh --uninstall from the extracted setup files.
Browser profiles/passwords are preserved. The shared PolicyKit action is not
removed automatically because another Acira installation may still need it.

UPDATES / DEPLOYMENT HANDOFF
The AppImage contains the real Linux updater. An actual lower-version QA
AppImage -> beta 10 install/relaunch must pass before this release is uploaded.
The generated beta-linux.yml/latest-linux.yml assets are deployment metadata,
not evidence that the public Linux update feed is live. A private GitHub
download cannot serve anonymous public update clients.

After hosting the AppImage at a permanent public HTTPS URL, prepare metadata:
  node scripts/prepare-linux-feed.mjs <AppImage> --asset-url <public-HTTPS-URL>
This verifies the local build hash and anonymous download availability, then
writes beta-linux.yml/latest-linux.yml. It uploads nothing.
The configured Linux feed is:
  https://raw.githubusercontent.com/Acira-dev/AciraBrowserUpdates/main/feed/linux/
Publish the prepared metadata there only when the public payload is available.
No public repository or website is changed by this private release handoff.

REBUILD
Use the private Linux source branch/patch named in the validation receipt.
Inside Linux x86_64, with Node.js 24 and the desktop build dependencies:
  npm ci
  ACIRA_TEST_CONCURRENCY=4 npm test
  npm run build:linux
The Tor fetcher verifies pinned hashes and Tor Project signatures. Linux Tor
native libraries, transports, geographic data and licenses ship with the app.
The existing Windows installer and macOS packaging are not replaced.

WSL TEST HOST ONLY
This laptop needed the Mesa d3d12 backend for WebGL2. QA also used an explicit
GL renderer flag and an active login-session PolicyKit agent. Those host
settings are not forced on ordinary Linux desktops by the shipped app.

See VALIDATION.json for exact tests, limitations and source provenance.
