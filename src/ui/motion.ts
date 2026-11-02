/** Critically damped response, following SAT Timer's position/velocity continuity. */
export function aciraSpring(reduced = false, speed = 1) {
  return reduced ? {duration: 0} : {type: 'spring' as const, stiffness: 324 * speed * speed, damping: 36 * speed, mass: 1, restDelta: .15, restSpeed: .15};
}

/** Website bounds use the same duration and easing in the main process. */
export function browserTransition(reduced = false) {
  return {duration: reduced ? 0 : .28, ease: nativeEaseInOut};
}

// Matches the interruptible main-process bounds coordinator.
export function nativeEaseInOut(t: number) { return 1-Math.pow(1-t,3); }
