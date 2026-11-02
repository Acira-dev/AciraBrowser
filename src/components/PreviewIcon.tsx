import type { LucideIcon } from 'lucide-react';

/** The drawing grid changes size, but the optical stroke weight stays constant. */
export function PreviewIcon({ icon: Icon, size = 16, className = '' }: { icon: LucideIcon; size?: number; className?: string }) {
  return <Icon size={size} strokeWidth={1.5} absoluteStrokeWidth className={className} aria-hidden="true" focusable="false" />;
}
