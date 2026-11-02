/** Consume at most one movement per OS event; holding accelerates without a queue. */
export function createNavigationRepeat(initialDelay = 220, repeatInterval = 90, fastestInterval = 32, fullSpeedAfter = 1200) {
  let held = '', started = 0, last = 0;
  return {
    accept(key: string, repeat: boolean, now: number) {
      if (!repeat || held !== key) {
        held = key; started = last = now;
        return true;
      }
      const elapsed = now - started;
      const progress = Math.max(0, Math.min(1, (elapsed - initialDelay) / Math.max(1, fullSpeedAfter - initialDelay)));
      const eased = progress * progress * (3 - 2 * progress);
      const minimum = Math.max(16, Math.min(repeatInterval, fastestInterval));
      const interval = repeatInterval - (repeatInterval - minimum) * eased;
      if (elapsed < initialDelay || now - last < interval) return false;
      last = now;
      return true;
    },
    release(key?: string) { if (!key || key === held) held = ''; },
  };
}

export function tabCursorIndex(index: number, count: number, key: string) {
  if (!count) return -1;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  const direction = key === 'ArrowDown' || key === 'ArrowRight' ? 1 : -1;
  return Math.max(0, Math.min(count - 1, index < 0 ? 0 : index + direction));
}
