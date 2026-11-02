import { lazy, Suspense, useState, type ComponentProps, type ComponentType } from 'react';

/** Screens that most launches never open load as their own chunk, so the first paint parses and runs less script.
 *  Each wrapper keeps the component's name and props, so call sites are unchanged.
 *
 *  Once a chunk has been fetched (preloadScreens does it when the browser is idle) the screen renders directly. Going through
 *  Suspense even for a ready chunk costs the first open of every screen ~300ms: React keeps a revealed boundary behind its
 *  fallback for that long ("throttled reveal"), measured as 317-339ms for Settings, History and Rewind before this change.
 *  The choice is made once per mounted screen, so a screen never remounts when the chunk arrives later. */
function screen<C extends ComponentType<any>>(load: () => Promise<C>) { // eslint-disable-line @typescript-eslint/no-explicit-any
  let ready: C | null = null;
  const Lazy = lazy(() => load().then((component) => { ready = component; return { default: component }; }));
  const preload = () => load().then((component) => { ready = component; });
  function Screen(props: ComponentProps<C>) {
    const [Direct] = useState<C | null>(() => ready);
    const Pending = Lazy as unknown as ComponentType<ComponentProps<C>>;
    return Direct ? <Direct {...props} /> : <Suspense fallback={null}><Pending {...props} /></Suspense>;
  }
  return { Screen, preload };
}

const onboarding = screen(() => import('../features/onboarding/Onboarding').then((module) => module.Onboarding));
const settings = screen(() => import('../features/BrowserSettings').then((module) => module.BrowserSettings));
const history = screen(() => import('../features/BrowserHistory').then((module) => module.BrowserHistory));
const rewind = screen(() => import('../features/rewind/RewindPage').then((module) => module.RewindPage));
const routines = screen(() => import('../features/routines/RoutinesPage').then((module) => module.RoutinesPage));

export const Onboarding = onboarding.Screen;
export const BrowserSettings = settings.Screen;
export const BrowserHistory = history.Screen;
export const RewindPage = rewind.Screen;
export const RoutinesPage = routines.Screen;

/** After the window has shown and the browser is idle, load the pages people open often and paint what would otherwise stall their first
 *  open (the Settings miniatures cost ~150ms of GPU time the first time they are drawn). */
export function preloadScreens() {
  const run = () => {
    performance.mark('acira-preload-run');
    void settings.preload().then(() => performance.mark('acira-preload-settings'));
    void import('../features/BrowserSettings').then((module) => module.warmSettingsPaint?.());
    void history.preload().then(() => performance.mark('acira-preload-history'));
    void rewind.preload().then(() => performance.mark('acira-preload-rewind'));
  };
  const idle = (window as unknown as { requestIdleCallback?: (task: () => void, options?: { timeout: number }) => number }).requestIdleCallback;
  window.setTimeout(() => (idle ? idle(run, { timeout: 4000 }) : run()), 1200);
}
