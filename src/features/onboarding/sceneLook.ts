/** The setup scene's look in two numbers, so the original look is one edit away.
 *
 * SCENE_GRAIN: the film grain over the light-ray scene — the shader's per-pixel PCG grain (prismRenderer.ts, composite
 * pass) and the `.fr-grain` tiled overlay (Onboarding.tsx). 0 = clean (the founder's R4 pick), 1 = the original grainy
 * look (shader amplitude .075 dark / .05 light, overlay opacity .045). In between scales both. An invisible dither of
 * half a level stays at every value: it is what keeps the dark gradients free of banding once the grain is gone.
 *
 * SCENE_BLACKS: how deep the dark scene's haze falls away between the beams. 1 = near-black (R4), 0 = the original,
 * lighter haze. The beams keep their colour, brightness and glow at every value.
 *
 * To get the original grainy look back: SCENE_GRAIN = 1 and SCENE_BLACKS = 0. */
export const SCENE_GRAIN: number = 0;
export const SCENE_BLACKS: number = 1;
