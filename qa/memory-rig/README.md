# Memory rig

Measures every process of a dev build on a throwaway profile (`/tmp/acira-qa/memory-rig/<run>`), never a real profile.

    export NODE_OPTIONS="--require /tmp/acira-qa/mock-keychain-hook.cjs"   # mock keychain, mute-audio, invisible windows
    RIG_KEEP=0 qa/memory-rig/launch.sh seven            # 5 pinned tabs + 2 tabs linked to Favorites, restored (asleep except the active one)
    RIG_KEEP=0 qa/memory-rig/launch.sh one              # a single plain tab
    qa/memory-rig/ev.sh -f qa/memory-rig/wake.js        # select each tab in turn so every page loads
    qa/memory-rig/ev.sh -f qa/memory-rig/measure.js | python3 qa/memory-rig/table.py
    qa/memory-rig/ev.sh -f qa/memory-rig/churn.js       # 7 same-site navigations + Back: renderer memory and back/forward-cache restore
    qa/memory-rig/ev.sh '' ; curl -s -X POST --data x http://127.0.0.1:9831/quit

Env: `RAM_UNPIN=1` seeds the five tabs unpinned; `RIG_FLAGS="--disable-features=BackForwardCache"` adds Chromium switches;
`ACIRA_MEMORY_SAVER_{FREEZE,IDLE,TICK}_MS` + `ACIRA_MEMORY_SAVER_DEBUG=1` make the sleep sweep fast and print its report
(`mainLog` in the driver collects it: `ev.sh 'return mainLog.filter(l=>l.includes("tab-sleep")).slice(-5)'`).
`bare-electron.cjs` is the control: the same Chromium with seven bare views and no Acira.

Columns: `ws` = working set (Windows Task Manager's Details "Working set"; on macOS = resident size, includes shared framework pages),
`foot` = macOS `footprint` (Activity Monitor "Memory", the private/compressed figure; Electron reports privateBytes only on Windows).
Footprint of the GPU process swings by hundreds of MB with compositor surfaces: trust `ws` for comparisons, `foot` for private cost of renderers.

13.2 additions: `launch.sh fixture` starts five pinned tabs and a plain active tab on local pages served by the driver (port `RAM_FIX`, default 9834): /tall (scroll restore), /ambient (muted looping video, generated in the page), /loud (unmuted loop), /form (typed draft), /plain; nothing audible, no live sites.
`ev.sh -f qa/memory-rig/tab-churn.js` (fixture run) opens and closes 40 tabs and reports processes, web contents and main heap before and after.
Before/after builds: `git checkout <base> -- desktop/main.cjs desktop/tab-sleep.cjs`, run, `git checkout HEAD -- ...`, run again; same timers (`ACIRA_MEMORY_SAVER_FREEZE_MS=120000 ..._IDLE_MS=900000 ..._TICK_MS=5000 ..._DEBUG=1`).

13.3 additions (the main process's own text):
`RAM_LOCAL=1 qa/memory-rig/launch.sh seven` runs the 5 pinned + 2 Favorites setup on seven local pages (no network); `RAM_LANG=es` seeds another interface language.
`measure.js` / `table.py` also print the main process's script source (`v8.getHeapCodeStatistics().external_script_source_size`, the exact figure: V8 keeps every script's text for the life of the process), bytecode and V8 heap.
The packaged app runs ONE main bundle, so compare bundles, not the dev layout: `git checkout -- desktop/main.cjs; node qa/memory-rig/bundle-main.mjs . /tmp/acira-qa/<name>/new` (and the same on the base commit), then
`qa/memory-rig/main-footprint.sh <label> <bundle main.cjs>` launches it with NO inspector and prints main's footprint at 75 s and 90 s (it overwrites desktop/main.cjs: `git checkout -- desktop/main.cjs` after). Footprint moves about 10 MB between launches; alternate the two builds three times and compare medians.
Look inside the main process's heap with `app.evaluate` + `v8.writeHeapSnapshot('/tmp/...')` and a small script that sums string nodes by size (a string twice the size of its file is two-byte). Delete the snapshot afterwards (38 MB).
