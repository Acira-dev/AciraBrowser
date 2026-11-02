/** A strip's selected tab as a tiny store (D, Round 2): the rows and the selection pill subscribe to it, so a select
 * re-renders those three alone and never the Reorder.Group, whose items would all re-render through its context. */
export function createSelectedStore(initial: string) {
  let id = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => id,
    set(next: string) { if (next === id) return; id = next; listeners.forEach(listener => listener()); },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
export type SelectedStore = ReturnType<typeof createSelectedStore>;
