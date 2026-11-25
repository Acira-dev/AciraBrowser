import { LineIcon, type LineIconName } from '../LineIcon';

/** The now-playing card's icons (Beta 14): the shared single-line set (section G, earlier work: components/LineIcon). Every button in
 * NowPlaying.tsx names an icon from this file, never a path, so the set can change without touching the card. The set draws
 * itself: Previous / Next nudge on a press, the close cross redraws, Play and Pause morph into each other (same element), and
 * Volume and Muted morph the same way; Fast / Premium / Off are followed there. */
export type IconName = 'prev' | 'next' | 'pip' | 'close' | 'goto';
const NAME: Record<IconName, LineIconName> = { prev: 'prev', next: 'next', pip: 'pip', close: 'x', goto: 'goto' };

export function Line({ name, className = '', size = 16 }: { name: IconName; className?: string; size?: number }) {
  return <LineIcon name={NAME[name]} size={size} className={`np-ic ${className}`.trim()}/>;
}

/** Play and pause morph into each other: the element stays mounted and the name changes. */
export function PlayPause({ playing }: { playing: boolean }) {
  return <LineIcon name={playing ? 'pause' : 'play'} size={16} className="np-ic np-pp"/>;
}

/** The speaker: a cross when silent (a morph from the waves), one wave below half, two from half up. The low level is the same
 * drawing with its outer wave faded out (now-playing.css). */
export function Speaker({ level }: { level: 'mute' | 'low' | 'high' }) {
  return <span className="np-spk" data-level={level}><LineIcon name={level === 'mute' ? 'muted' : 'volume'} size={16} className="np-ic"/></span>;
}
