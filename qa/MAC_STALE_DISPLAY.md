# Stale native page frame

The 120 ms screenshot hold deadline could fire during the 32 ms first-frame
settle wait. At that point `setVisible(true)` had run, but `job.shown` was still
false. The fallback released the page swap without hiding this newly visible
picture or scheduling its fade/release. It could then cover Settings, navigation
and the live website indefinitely. A failed replacement had the same gap.

The fallback now hides any current picture, invalidates late callbacks, clears
the abandoned job so future priming can run, and bounds idle layer retention.
It checks ownership after flushing page swaps so it cannot hide a replacement.
No page reload, session reset, motion disabling or recurring restart is used.

`node --test tests/page-still.test.cjs` contains two controlled regressions that
fail on the previous source. `node qa/mac-display-lifecycle.mjs [candidate]`
replays actual website/Settings/new-tab/navigation cycles with normal motion and
production throttling in a disposable profile. It checks native layer visibility,
not just renderer text. `DISPLAY_QA_SLOW_SETTLE=1` delays the source factory's
first-frame callback to reproduce the deadline deterministically; bundled
candidate runs use the normal native timing without that source hook.
`DISPLAY_QA_VISIBLE=1` permits a bounded native screenshot check, then waits for
`visible-done` in the run's output directory before closing the test window.
The canonical browser and profile are never used by this runner.

`DISPLAY_QA_COMPLETE=1` seeds completed setup and uses sidebar tabs, avoiding
first-run overlays as a prerequisite. Combine it with
`DISPLAY_QA_VISIBLE=1 DISPLAY_QA_FULLSCREEN=1 DISPLAY_QA_LIGHT=1` for the
light Porcelain/40% fullscreen configuration. `D_APP_EXE` selects a signed
package; its key preparation still belongs only to the disposable profile.
Native visibility checks do not replace a physical desktop check while macOS is
locked or the window is not on the active Space.
