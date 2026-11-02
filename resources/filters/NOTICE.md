# Offline filter baseline

Downloaded on 2026-11-01 by `scripts/fetch-baseline-filters.mjs` (run by every release build) from the official list sources, the same endpoints the in-app updater uses:

- EasyList: https://easylist.to/easylist/easylist.txt (202611010838; sha256 71a133b341d99402…)
- EasyPrivacy: https://easylist.to/easylist/easyprivacy.txt (202611010838; sha256 874a991cb0f550ac…)
- uBlock filters – Ads: https://ublockorigin.github.io/uAssets/filters/filters.min.txt (Sun, 01 Nov 2026 05:25:35 +0000; sha256 f19ef59455790eb3…)
- uBlock filters – Badware risks: https://ublockorigin.github.io/uAssets/filters/badware.min.txt (Sat, 31 Oct 2026 03:36:09 +0000; sha256 8ad637b77a9e15a5…)
- uBlock filters – Privacy: https://ublockorigin.github.io/uAssets/filters/privacy.min.txt (Fri, 30 Oct 2026 19:03:49 +0000; sha256 3c7a80e52214b825…)
- uBlock filters – Unbreak: https://ublockorigin.github.io/uAssets/filters/unbreak.min.txt (Sat, 31 Oct 2026 14:06:58 +0000; sha256 bd380cb5ec5effe5…)
- uBlock filters – Quick fixes: https://ublockorigin.github.io/uAssets/filters/quick-fixes.min.txt (Sun, 01 Nov 2026 02:39:02 +0000; sha256 53ce78b79b507ce4…)
- Peter Lowe's Ad and tracking server list: https://pgl.yoyo.org/adservers/serverlist.php?hostformat=hosts&showintro=1&mimetype=plaintext (unknown; sha256 b7804f27a8bec641…)
- uBlock Origin scriptlet resources: https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/resources.json (sha256 5ce0ce483f0e5514…)

- The uBlock Origin lists are uBlock's compiled `.min.txt` files with the rules for other browsers (Firefox, Safari, uBlock Origin Lite) removed. EasyList, EasyPrivacy and the uBlock Origin lists keep their original authors and license declarations (GPL-3.0-or-later / CC-BY-SA where specified upstream) in the list headers.
- Peter Lowe's list is a hosts file; its entries are converted to network rules, the way uBlock Origin reads it.
- Ghostery Electron integration: MPL-2.0.

These lists block ads and trackers. They are not a phishing/malware reputation service and they do not reject or accept cookie consent. The baseline works without an account or network refresh; Acira checks the same endpoints in the background on every start and every few hours (only downloading what changed) unless turned off.
