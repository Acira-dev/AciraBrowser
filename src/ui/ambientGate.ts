/** Whether Ambient light is on: its own switch, and a view that has something to light. NOTHING ELSE enters it: Settings > Site color (Off, Soft or Rich) does not (reported 19 Nov, "ambient is its own switch";
 * this undoes D16's link of 18 Nov and the 14 Nov one before it). With Site color Off the frame is neutral and only the light's own layers colour it (the top bar's, the sidebar's, the corner pieces); the sampler needs none
 * of the site colour's machinery (it reads the page's own edges). Seamless has nothing to tint, so no light there (F1). desktop/main.cjs holds the same rule (`ambientOn`) for the sampler; tests/site-color-ambient-link.test.ts (its name is the old rule's: it now pins that there is none) keeps them together. */
export const ambientOn = (settings: { ambientMode?: unknown } | null | undefined, view?: string | null): boolean =>
  settings?.ambientMode === true && view !== 'seamless';   // `view` is the window's effective view, left out = not Seamless
