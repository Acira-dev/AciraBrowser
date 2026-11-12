<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/acira-logo-light.svg">
    <img src="public/acira-logo.svg" alt="Acira Browser" width="260">
  </picture>
</h1>

<p align="center"><strong>The browser you asked for.</strong></p>

<p align="center">
  A calm desktop browser for Windows, Mac and Linux, with private and Tor tabs, workspaces and a sidebar, and no account.
</p>

<p align="center">
  <a href="https://acirabrowser.com/download/"><strong>Download</strong></a>
  &nbsp;·&nbsp;
  <a href="https://acirabrowser.com/docs/">Docs</a>
  &nbsp;·&nbsp;
  <a href="https://acirabrowser.com/">Website</a>
  &nbsp;·&nbsp;
  <a href="https://discord.gg/EpBCE4vtzU">Discord</a>
  &nbsp;·&nbsp;
  <a href="https://www.reddit.com/r/AciraBrowser/">Reddit</a>
</p>

---

Acira Browser is a desktop web browser built on Electron and Chromium, the engine behind Chrome and Edge, so pages load and run the way they do in other Chromium browsers. A private or Tor tab opens right next to the one you're on, workspaces keep things apart, and ads and trackers are blocked from the first page. There is no Acira account and no cloud service: your bookmarks, history and settings stay on your computer.

Acira is in beta. We're a small team, and we're shaping Acira with you. Try it, break it, and tell us what's wrong.

## Highlights

### Private and Tor, right next to your tabs

- **Private tabs** (Ctrl+Shift+P) open beside the tab you're on. Each one is its own session, so you can be signed in to the same site twice, and closing it keeps no history.
- **Tor is built in**, with nothing to install. Open a single Tor tab from the menu, or a Tor window (Alt+Shift+N) where every page goes through Tor. It hides your IP address from sites. If your safety depends on staying anonymous, use Tor Browser.

### Tabs, workspaces and views

- Tabs along the top or in a sidebar, on the left or the right, with tab groups, pinned tabs and Favorites.
- Up to eight **workspaces** per profile, one key apart (Alt+1 to Alt+8). **Lock one** (beta) and its tabs leave the window, sealed in an encrypted file, until your computer confirms it's you (Windows Hello on Windows).
- **Split view** with up to four pages in one tab (Ctrl+Shift+S), **link previews** (Alt+click), a **volume for each tab**, and **command search** (Ctrl+Shift+K) that finds tabs in every workspace.
- Four window views: Full, Compact, Focus and Seamless, which shows just the page until you point at an edge.
- **Tab sleep** frees the memory of tabs you aren't using. **Rewind** (Ctrl+Shift+H) keeps the tabs and windows you close for up to a week, and your session comes back after a crash or restart.

### Make it yours

- 12 finishes, or your own colors for pages, sidebar, toolbar and tabs. Light, dark or system, with window opacity from 40% to 100%.
- Museum paintings on new tabs, or landscapes, your own picture, or nothing at all.
- Rearrange the toolbar and menu, change any keyboard shortcut, and set animations to Premium, Fast or Off.

### Protection that's on from the start

- Built-in ad and tracker blocking, with a count for each tab and an off switch for any site that breaks.
- Hidden trackers and third-party cookies blocked, tracking parameters removed, tracking redirects skipped, and AMP pages opened as the original. Fingerprint protection is on at a standard level.
- Warnings for dangerous pages, checked on your computer against public phishing and malware lists.
- A local password vault with a generator, secure DNS, a proxy per profile, and control of the VPN app you already use.

### You choose what's on

Acira never pushes AI on you: you choose what's on. If you'd like less AI on the web too, **AI-free mode** (Ctrl+Shift+X, off by default) folds away AI answers and AI buttons on Google, Bing, Brave Search and DuckDuckGo.

### Moving in

- Bring your bookmarks and history from Chrome, Edge, Brave, Helium, Arc, Firefox or Zen. Arc Spaces become workspaces.
- Add extensions from the Chrome Web Store with the **Add to Acira** button. Of 26 popular extensions we checked, 20 work and 4 work with limits. Working ones include uBlock Origin Lite, Bitwarden, 1Password, Proton Pass, Dark Reader and Vimium.
- The interface comes in 13 languages.

### For developers

- Developer tools (F12), unpacked extensions for testing your own, and an optional sidebar folder that lists your open GitHub pull requests.

Every feature has a page in the [docs](https://acirabrowser.com/docs/) that shows how to turn it on and what you can change. What Acira doesn't do, such as cloud sync or a phone app, is in [the known limits](https://acirabrowser.com/docs/limits/).

## Download

Get the latest beta from **[acirabrowser.com/download](https://acirabrowser.com/download/)**. Installers, checksums and release notes for every version are also on the [AciraBrowserUpdates releases page](https://github.com/Acira-dev/AciraBrowserUpdates/releases).

| Computer | File | Needs |
| --- | --- | --- |
| Windows | `AciraBrowserSetup.exe` | Windows 11, or Windows 10 version 1809 or later, on a 64-bit Intel or AMD processor |
| Mac, Apple silicon | Disk image (`.dmg`, arm64) | macOS 13 or later, on M1 or newer |
| Mac, Intel | Disk image (`.dmg`, x64) | macOS 13 or later |
| Linux | AppImage plus the setup files | A 64-bit Intel or AMD processor (x86_64). Tested on Ubuntu 24.04. |

- **Windows:** this beta isn't code-signed yet, so Windows may show an unknown-publisher warning. Choose **More info**, then **Run anyway**.
- **Mac:** current downloads are signed with an Apple Developer ID and notarized by Apple.
- **Linux:** unzip the setup files next to the AppImage and run `bash Install-Acira.sh` to add Acira to your app menu. AppImages need FUSE 2: `sudo apt install libfuse2t64` (on Ubuntu 22.04, `libfuse2`).
- An installed Acira updates itself, and checks every update against a SHA-512 hash before installing it. To check a download yourself, compare it with `SHA256SUMS.txt` ([here's how](https://acirabrowser.com/docs/updates/)).

There is no phone or tablet version. The full guide is in [Install Acira](https://acirabrowser.com/docs/install/).

## Privacy, in plain words

- **No account.** There's no Acira account, sign-up or cloud sync. Your bookmarks, history, passwords and settings live in one folder on your computer. Signing in to websites works as usual.
- **Suggestions are made on your computer.** Address bar suggestions come from your own tabs, bookmarks and history. Acira doesn't send what you type to a suggestion service.
- **Anonymous usage counts, with an off switch.** New setups start with them on, and you can turn them off on that same screen or any time in Settings › Privacy. While they're on, Acira sends at most one message a day: a random ID, the app version, your system, your language and coarse counts. Never web addresses, history, searches or accounts. Settings shows you the exact message. Acira sends no crash reports.
- **A few things in the background.** Acira fetches updates, its blocking and phishing lists, and a few other things on its own. [Privacy settings](https://acirabrowser.com/docs/privacy/#what-acira-fetches-in-the-background) lists each one and how often.

## This repository

This is the source code of Acira as we ship it. Each release lands here as one commit, authored by Acira-dev, so the history reads as a list of releases rather than day-to-day changes.

Every release commit is tagged once for each platform that shipped it: `mac-v<version>`, `windows-v<version>` and `linux-v<version>`, for example `windows-v0.1.0-beta.13.6`. When platforms ship the same source, their tags point to the same commit. Your own version is in Settings › About.

```sh
git checkout windows-v0.1.0-beta.13.6
```

| Folder | What's in it |
| --- | --- |
| `src/` | The interface: React and TypeScript, with its translations in `src/i18n/` |
| `desktop/` | Electron's main process: windows, tabs, blocking, Tor, extensions, passwords and updates |
| `public/` | Icons, fonts and artwork |
| `resources/filters/` | The filter lists bundled with the app |
| `scripts/`, `packaging/` | Build, packaging and release tooling |
| `supabase/` | Server functions Acira talks to, such as the one that receives anonymous usage counts |
| `tests/`, `qa/` | Unit tests and QA scripts |

## Building from source

You'll need:

- [Node.js](https://nodejs.org/) 22.12 or later, with npm. Our automated build uses Node 24.
- Git.
- On a Mac, the Xcode Command Line Tools (`xcode-select --install`) for the small native module behind the window glass, and Node's development headers, which come with Node from nodejs.org or Homebrew.

```sh
git clone https://github.com/Acira-dev/AciraBrowser.git
cd AciraBrowser
npm ci
npm start
```

`npm start` builds Acira and opens it. `npm run build` only builds. To build one release exactly, check out its tag first.

Good to know:

- **Same profile as an installed Acira.** A run from source uses the same profile folder (`AciraBrowser` in your system's app-data folder). Only one Acira can use it at a time, so quit an installed Acira first, and keep a copy of the folder if your data matters to you.
- **Tor.** Tor tabs need the Tor program, which isn't kept in Git. On Windows, `npm start` fetches it the first time. On a Mac or Linux, run `node scripts/fetch-tor-mac.mjs` or `node scripts/fetch-tor-linux.mjs` once. Each one downloads a pinned Tor release from the Tor Project and checks its hash and signature first.
- **Protected video.** A build from source runs on the standard Electron runtime from npm, so Widevine-protected video (Netflix, Spotify and the like) won't play. Our Windows and Mac releases use castlabs' Widevine-enabled Electron, which has to be signed with a castlabs EVS account of your own.
- **Tests.** `npm test` runs the test suite. Some tests read internal documents that aren't part of this public snapshot, and some start a real Electron window, so expect some failures on a plain checkout.
- **Installers.** The packaging and release scripts are in `scripts/` and `packaging/`. We haven't written them up for outside use yet, and signed release builds need signing identities and accounts that aren't in this repository.

## Feedback and community

We read what you send us, and it shapes what we fix and build next.

- **Found a bug?** Post it on [r/AciraBrowser](https://www.reddit.com/r/AciraBrowser/) with the **Bug** flair, or tell us on [Discord](https://discord.gg/EpBCE4vtzU). Please include your system (Windows, Mac or Linux, plus the distribution and desktop on Linux), your Acira version from Settings › About, what you did and what happened. A screenshot or short video helps a lot.
- **Ideas and wishes** go to the same places.
- **On GitHub,** you can also open an [issue](https://github.com/Acira-dev/AciraBrowser/issues) on this repository.
- **Security problems:** please email [support@acirai.com](mailto:support@acirai.com) instead of posting them publicly.
- **What's next:** follow along on [Discord](https://discord.gg/EpBCE4vtzU) and [r/AciraBrowser](https://www.reddit.com/r/AciraBrowser/).

Thanks for trying Acira 💙

## License

Acira's own code is open source under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0-only).

Acira is built on Electron and Chromium and includes other open-source parts, such as the Ghostery ad-blocking engine, public filter lists, Tor and the Inter typeface. Each keeps its own license and notices: see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
