import { motion, useIsPresent } from "motion/react";
import type { ReactNode } from "react";
import { Formation } from "./Formation";
function Scene({
  children,
  reduced,
  className,
}: {
  children: ReactNode;
  reduced: boolean;
  className?: string;
}) {
  const present = useIsPresent();
  return (
    <motion.div
      className="content-transition"
      inert={!present || undefined}
      aria-hidden={!present || undefined}
      initial={false}
      exit={{ opacity: 0 }}
      // The old section leaves at once, so the new one forms on the frame of the click (round 2: nothing waits).
      transition={{ duration: 0 }}
    >
      <Formation
        variant="content"
        visible={present}
        reduced={reduced}
        className={className}
      >
        {children}
      </Formation>
    </motion.div>
  );
}
export function ContentTransition({
  scene,
  reduced,
  className,
  children,
}: {
  scene: string;
  reduced: boolean;
  className?: string;
  children: ReactNode;
}) {
  // The old section and the new one swap in one commit (round 2: no blank frame, nothing waits); the new one forms.
  return (
    <Scene key={scene} reduced={reduced} className={className}>
      {children}
    </Scene>
  );
}
