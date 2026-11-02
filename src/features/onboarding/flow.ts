// Adapted from imputnet/helium-onboarding src/lib/onboarding-flow.ts at
// 64257c5ea5b04c551305120eef5a495046f4e1fa (GPL-3.0). See upstream/LICENSE.
//
// The native store persists one of `setupSteps` per installation (resume and never-repeat live there).
// Each step is one screen; import comes first ("bring your work"), the default-browser ask last. Everything below is pure.
export const setupSteps = [
  "welcome",
  "import",
  "profile",
  "appearance",
  "cover",
  "search",
  "privacy",
  "default",
  "finish",
] as const;
export type SetupStep = (typeof setupSteps)[number];
export type Direction = 1 | -1;

/** Steps shown on the glass panel, between the welcome and the finish. */
export const panelSteps = setupSteps.filter(
  (step) => step !== "welcome" && step !== "finish",
);

/** What the flow knows about this device. Unknown (undefined) never skips a step. */
export interface FlowFacts {
  /** Browser profiles found to import from; undefined until detection finishes. */
  sources?: readonly unknown[];
  /** Default-browser registration is available on this platform. */
  defaultSupported?: boolean;
  defaultIsDefault?: boolean;
}

/** Import is skipped only when detection found nothing; default browser when it can't or needn't be set. */
export function isSkipped(step: SetupStep, facts: FlowFacts): boolean {
  if (step === "import") return facts.sources?.length === 0;
  if (step === "default")
    return facts.defaultSupported === false || facts.defaultIsDefault === true;
  return false;
}

/** Keep steps already presented in the progress count when late discovery or a
 * successful default-browser choice makes them skippable for future navigation. */
export const visibleSteps = (facts: FlowFacts, presented: ReadonlySet<SetupStep> = new Set()) =>
  panelSteps.filter((step) => presented.has(step) || !isSkipped(step, facts));

export function getSetupPage(
  current: number,
  direction: Direction = 1,
  shouldSkip: (page: SetupStep) => boolean = () => false,
) {
  let next = current + direction;
  while (next >= 0 && next < setupSteps.length && shouldSkip(setupSteps[next]))
    next += direction;
  return Math.max(0, Math.min(next, setupSteps.length - 1));
}

/** Next step in `direction`, passing over skipped ones. Stays put at either end. */
export const nextStep = (current: SetupStep, direction: Direction, facts: FlowFacts): SetupStep =>
  setupSteps[getSetupPage(setupSteps.indexOf(current), direction, (step) => isSkipped(step, facts))];

/** How many single native moves reach `target` from `from`. */
export const nativeMoves = (from: SetupStep, target: SetupStep) =>
  setupSteps.indexOf(target) - setupSteps.indexOf(from);
