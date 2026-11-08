Acira Browser 0.1.0-beta.11 for Linux x86_64

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

SYSTEM THEME
Settings > Appearance > Theme > "Match my system theme" (Linux only, off by default). On, Acira follows your
desktop's light or dark setting and its accent colour; its own finishes, layout and fonts stay as they are.
GNOME 47 or newer and KDE Plasma 6 share an accent colour. Plasma 5 shares its colour scheme's highlight.
GNOME 46 (Ubuntu 24.04) and desktops without a portal share light or dark only, so Acira keeps its own accent.
Checks for a real GNOME and KDE desktop: docs/launch/LINUX_THEME_CHECKS.md.

UPDATES / DEPLOYMENT HANDOFF
The AppImage contains the real Linux updater. An actual lower-version QA
AppImage -> beta 10 install/relaunch must pass before this release is uploaded.
The generated beta-linux.yml/latest-linux.yml assets are deployment metadata,
not evidence that the public Linux update feed is live. A private GitHub
download cannot serve anonymous public update clients.

From beta.11 the release is not published from this machine. After building, run
  npm run handoff:linux
It checks the AppImage (hash, version, the update address inside it), records the result in
HANDOFF.json and uploads everything to a PRIVATE release of the private source repository.
The Mac then collects it and publishes all three platforms with one command (docs/launch/UPDATE_HOST.md).
The Linux feed an installed copy asks is:
  https://update.acirabrowser.com/linux/      (first)
  https://raw.githubusercontent.com/Acira-dev/AciraBrowserUpdates/main/feed/linux/      (frozen fallback)
scripts/prepare-linux-feed.mjs (beta.10) is no longer the way to publish.
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
