/** The setup light's pose moves between steps on a critically damped spring (R4-12): it leaves on the click frame,
 * eases into a long soft settle with no hard stop, and a move that starts while another is under way keeps the light's
 * velocity instead of restarting from rest. Exact for any frame time, so it is the same at 60, 75, 120 or 240 Hz.
 *
 * x is the value, v its velocity per second, goal where it is heading, omega the spring's stiffness (rad/s). */
export function settle(x: number, v: number, goal: number, omega: number, dt: number): [number, number] {
  const delta = x - goal,
    decay = Math.exp(-omega * dt),
    lead = (v + omega * delta) * dt;
  return [goal + (delta + lead) * decay, (v - omega * lead) * decay];
}

/** Stiffness at the Fast speed: within 2% of the pose in ~0.8s, then a soft tail. Premium (motion class S, 1.7) stretches
 * it to ~1.3s; Off and reduced motion do not move. */
export const POSE_OMEGA = 7.5;
export const poseOmega = (scale: number) => POSE_OMEGA / Math.max(0.6, scale);

/** The pose never freezes once it arrives: a very slow drift (17–27 s periods, a fraction of a degree) that the spring
 * carries the move's last velocity into. Offsets for swing (radians), shiftX and shiftY (scene-height units). */
export function poseDrift(seconds: number): [number, number, number] {
  return [
    0.011 * Math.sin(seconds * 0.37) + 0.005 * Math.sin(seconds * 0.23 + 1.3),
    0.007 * Math.sin(seconds * 0.29 + 0.7),
    0.005 * Math.sin(seconds * 0.31 + 2.1),
  ];
}
