// Bring it over, and THE REVEAL (spec 5.3, moment 11): the browser becomes the sender's.
//
//   1. `transfer.apply`: main does steps 1-4 of 11.1 (profile, one transaction, settings, icons and the rest) and reports each as it goes (status.applying, R6's ticks).
//   2. `document.startViewTransition`, the pattern of the setup finale (onboarding/finale.ts). Inside its callback, and only there:
//        `transfer.applyLook` (main commits the Look, Layout and Motion keys), `applyUiPrefs` (the interface preferences, Favorites, the reading list), then the next
//        state snapshot, with a 1.5 s cap (past it the transition ends and the UI simply shows the new look). The DOM is never frozen during the slow work of step 1.
//   3. The new frame is revealed by a circle growing from the centre of the Bring it over button to the far corner: 700 ms at Premium, 420 ms at Fast, --motion-ease-expo.
//      At Animation speed Off (or reduced motion) there is no transition at all: the same steps, an instant cut.
//   4. `transfer.applied`: the batch is done. (Called as soon as the data is written, not when the circle has finished: a window closed mid-animation must not roll a finished transfer back.)
//
// Rules of the reveal: native views stay out (the page area is not in the DOM snapshot; the reveal covers the chrome, as the finale does); the R4-50 guard (no view-transition-name
// may lift chrome over setup: here every name under .app is lifted for the transition's length, receive.css, and setup is never up: the Setup variant applies the look quietly and the
// finale plays instead); a language change is never part of it.
//
// The sheet of a native Acira window lives in the OVERLAY view, a different document from the chrome (the toolbar and sidebar the circle reveals). The overlay therefore asks
// the chrome through a BroadcastChannel (same origin, same session) to run steps 2-4, and waits for it; with no chrome listening it does steps 2 and 4 itself, without the picture.
import type { IncomingUi } from '../../ui/profileUiPrefs';
import { applyUiPrefs } from '../../ui/profileUiPrefs';
import { motionSpeed } from '../../ui/sharedMotion';
import { runtime } from '../../runtime/client';
import { transferCall } from './client';
import type { TransferApplied, TransferInclude, TransferRequest, TransferResultBag } from './types';

/** How long the reveal waits for the state snapshot after the look is applied (spec 5.3 step 2). */
export const SNAPSHOT_CAP_MS = 1500;
/** The circle, 700 ms at Premium and 420 ms at Fast (spec 5.3); Off is a cut. */
export const REVEAL_MS = { premium: 700, fast: 420, off: 0 } as const;
/** The time the interface needs to draw a snapshot once it arrived: its own flush timer is 100 ms when the page draws no frames (runtime/client.ts), and a view transition's update step draws none. */
export const SNAPSHOT_SETTLE_MS = 130;
const FALLBACK_EASE = 'cubic-bezier(.16, 1, .3, 1)';
const CHANNEL = 'acira-transfer-reveal';
/** How long the overlay waits to hear that a chrome listens, then for the whole reveal. */
const ACK_MS = 800, DONE_MS = 20000;

export interface RevealOrigin { x: number; y: number }
/** What one reveal needs of the apply's receipt. */
export type RevealReceipt = Pick<TransferApplied, 'batchId' | 'profileId' | 'ui' | 'favorites' | 'readingList'>;

type ViewTransitionLike = { ready: Promise<void>; finished: Promise<void>; updateCallbackDone: Promise<void>; skipTransition(): void };
/** Everything the reveal touches outside itself, so the tests drive it whole. */
export interface RevealDeps {
  call(request: TransferRequest): Promise<TransferResultBag & { changed?: number }>;
  applyUiPrefs(profileId: string, batchId: string, incoming: IncomingUi): unknown;
  speed(): 'premium' | 'fast' | 'off';
  startViewTransition: ((update: () => Promise<void> | void) => ViewTransitionLike) | null;
  /** Resolves with the next state snapshot main sends (subscribe first, then ask main to change something). */
  nextSnapshot(): { done: Promise<void>; cancel(): void };
  wait(ms: number): Promise<void>;
  /** Plays the circle on the transition's new frame. */
  circle(origin: RevealOrigin, ms: number): void;
  /** Marks the document while the transition runs (a mode switch in force makes every other transition a plain update; the guard names are lifted). */
  mark(on: boolean): void;
  isOverlay(): boolean;
  /** From the overlay: ask the chrome view to run the reveal. True when a chrome answered and finished it, false when none was listening. */
  askChrome(receipt: RevealReceipt, origin: RevealOrigin | null): Promise<boolean>;
  viewport(): { width: number; height: number };
}

const timeout = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The circle to the far corner of the viewport from `origin`. */
export const circleRadius = (origin: RevealOrigin, viewport: { width: number; height: number }) => Math.hypot(Math.max(origin.x, viewport.width - origin.x), Math.max(origin.y, viewport.height - origin.y));

/** The real thing; `call` is the service call (the sheet's own, so a test can stand in for main). */
export function realDeps(call: (request: TransferRequest) => Promise<TransferResultBag> = transferCall): RevealDeps {
  return {
    call: (request) => call(request),
    applyUiPrefs: (profileId, batchId, incoming) => applyUiPrefs(profileId, batchId, incoming),
    speed: () => motionSpeed(),
    startViewTransition: typeof document !== 'undefined' && typeof (document as Document & { startViewTransition?: unknown }).startViewTransition === 'function' && document.visibilityState === 'visible'
      ? (update) => (document as unknown as { startViewTransition(update: () => Promise<void> | void): ViewTransitionLike }).startViewTransition(update) : null,
    nextSnapshot: () => {
      let stop = () => {}, resolveDone = () => {};
      const done = new Promise<void>((resolve) => { resolveDone = resolve; });
      stop = runtime.subscribe(() => { stop(); resolveDone(); });
      return { done, cancel: () => stop() };
    },
    wait: timeout,
    circle: (origin, ms) => {
      const root = document.documentElement;
      const ease = getComputedStyle(root).getPropertyValue('--motion-ease-expo').trim() || FALLBACK_EASE;
      const radius = circleRadius(origin, { width: window.innerWidth, height: window.innerHeight });
      root.animate({ clipPath: [`circle(0px at ${origin.x}px ${origin.y}px)`, `circle(${radius}px at ${origin.x}px ${origin.y}px)`] }, { duration: ms, easing: ease, fill: 'both', pseudoElement: '::view-transition-new(root)' });
    },
    mark: (on) => {
      const root = document.documentElement;
      if (on) { root.dataset.modeSwitch = 'reveal'; root.dataset.transferReveal = ''; root.dataset.themeSettle = ''; }
      else { if (root.dataset.modeSwitch === 'reveal') delete root.dataset.modeSwitch; delete root.dataset.transferReveal; delete root.dataset.themeSettle; }
    },
    isOverlay: () => typeof location !== 'undefined' && new URLSearchParams(location.search).get('view') === 'overlay',
    askChrome: (receipt, origin) => askChrome(receipt, origin),
    viewport: () => ({ width: window.innerWidth, height: window.innerHeight })
  };
}

/**
 * Steps 2 to 4 here, in this document: the look inside the view transition's callback, then the circle. Resolves when the circle has finished (or at once with no transition).
 * Rejects when the look or the interface preferences could not be applied.
 */
export async function revealHere(receipt: RevealReceipt, origin: RevealOrigin | null, deps: RevealDeps, commit?: () => void): Promise<void> {
  const speed = deps.speed();
  const work = async () => {
    // Subscribe before asking: main broadcasts the snapshot before its answer reaches us.
    const snapshot = deps.nextSnapshot();
    try {
      const look = await deps.call({ type: 'transfer.applyLook', batchId: receipt.batchId });
      deps.applyUiPrefs(receipt.profileId, receipt.batchId, { ui: receipt.ui, favorites: receipt.favorites, readingList: receipt.readingList });
      // A look that changed nothing sends no snapshot; otherwise wait for it, never longer than the cap, then for the interface to draw it.
      if (look.changed !== 0) {
        const arrived = await Promise.race([snapshot.done.then(() => true), deps.wait(SNAPSHOT_CAP_MS).then(() => false)]);
        if (arrived) await deps.wait(SNAPSHOT_SETTLE_MS);
      }
    } finally { snapshot.cancel(); }
    commit?.();
    await deps.call({ type: 'transfer.applied', batchId: receipt.batchId });
  };
  if (speed === 'off' || !deps.startViewTransition) { await work(); return; }
  deps.mark(true);
  let transition: ViewTransitionLike;
  try { transition = deps.startViewTransition(work); } catch (error) { deps.mark(false); throw error; }
  const finished = transition.finished.then(() => undefined, () => undefined);
  void finished.then(() => deps.mark(false));
  void transition.ready.then(() => deps.circle(origin ?? centreOf(deps.viewport()), REVEAL_MS[speed]), () => undefined);
  try { await transition.updateCallbackDone; } catch (error) { deps.mark(false); throw error; }
  // The data is written; the picture may still be playing. Wait for it (it cannot take longer than its length plus a frame or two).
  await Promise.race([finished, deps.wait(REVEAL_MS[speed] + 600)]);
}
const centreOf = (viewport: { width: number; height: number }): RevealOrigin => ({ x: viewport.width / 2, y: viewport.height / 2 });

// ------------------------------------------------------------------------------------------------ across the two views of a window

interface AskMessage { kind: 'ask'; id: string; receipt: RevealReceipt; origin: RevealOrigin | null; space: 'overlay' }
interface ReplyMessage { kind: 'ack' | 'done' | 'failed'; id: string; error?: string }
const openChannel = (): BroadcastChannel | null => { try { return typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL) : null; } catch { return null; } };

/** The chrome's half: when an overlay asks, run the reveal here and answer. Call once, in the chrome view (the team wires it: recover.ts `startTransferBackground`). */
export function watchTransferReveal(deps: () => RevealDeps = () => realDeps()): () => void {
  const channel = openChannel();
  if (!channel) return () => {};
  channel.onmessage = async (event: MessageEvent<AskMessage>) => {
    const ask = event.data;
    if (!ask || ask.kind !== 'ask' || !ask.id) return;
    channel.postMessage({ kind: 'ack', id: ask.id } satisfies ReplyMessage);
    try {
      // The origin was measured in the overlay's own document: place it in the chrome's by the overlay's bounds (the layout the chrome itself sent main).
      let origin = ask.origin;
      try {
        const bounds = (await runtime.getBrowserLayout())?.overlay?.bounds;
        if (origin && bounds) origin = { x: bounds.x + origin.x, y: bounds.y + origin.y };
      } catch { /* the origin stays as it was measured */ }
      await revealHere(ask.receipt, origin, deps());
      channel.postMessage({ kind: 'done', id: ask.id } satisfies ReplyMessage);
    } catch (error) {
      channel.postMessage({ kind: 'failed', id: ask.id, error: String((error as Error)?.message || error) } satisfies ReplyMessage);
    }
  };
  return () => { channel.onmessage = null; channel.close(); };
}

/** Asks the chrome (from the overlay) to run the reveal. True when a chrome answered and finished it; false when none was listening; throws when it failed. */
async function askChrome(receipt: RevealReceipt, origin: RevealOrigin | null): Promise<boolean> {
  const channel = openChannel();
  if (!channel) return false;
  const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
  try {
    return await new Promise<boolean>((resolve, reject) => {
      const ackTimer = setTimeout(() => resolve(false), ACK_MS), doneTimer = setTimeout(() => reject(new Error('The reveal did not finish.')), DONE_MS);
      channel.onmessage = (event: MessageEvent<ReplyMessage>) => {
        const reply = event.data;
        if (!reply || reply.id !== id) return;
        if (reply.kind === 'ack') { clearTimeout(ackTimer); return; }
        clearTimeout(ackTimer); clearTimeout(doneTimer);
        if (reply.kind === 'done') resolve(true); else reject(new Error(reply.error || 'The reveal failed.'));
      };
      channel.postMessage({ kind: 'ask', id, receipt, origin, space: 'overlay' } satisfies AskMessage);
    });
  } finally { channel.close(); }
}

// ------------------------------------------------------------------------------------------------ Bring it over

export interface BringRequest { target: 'current' | 'new'; include?: Partial<TransferInclude>; safety: string[] }
export interface BringOptions {
  /** The centre of the Bring it over button (the circle starts there), in this document. */
  origin: RevealOrigin | null;
  /** Called with the receipt as soon as steps 1-4 are done, before the look: R6 ticks whatever is still waiting, and may hold the reveal (return a promise) until it has. */
  stepsDone?: (applied: TransferApplied) => void | Promise<void>;
  /** Runs inside the transition's callback, after the look is applied: the sheet shows its Done screen in the new frame (this document only). */
  commit?: () => void;
  /** The setup variant: the look is applied quietly (no circle; the finale plays next). */
  quiet?: boolean;
  deps?: RevealDeps;
}
/** Steps 1 to 4 then the reveal. Resolves with the receipt; a throw means nothing was changed (main rolled back) or, if it came after step 4, that the caller must take the batch back. */
export async function bringItOver(request: BringRequest, options: BringOptions): Promise<TransferApplied> {
  const deps = options.deps ?? realDeps();
  const bag = await deps.call({ type: 'transfer.apply', target: request.target, ...(request.include ? { include: request.include } : {}), safety: request.safety });
  const applied = bag.applied;
  if (!applied) throw new Error('Something went wrong, so nothing was changed.');
  await options.stepsDone?.(applied);
  if (options.quiet) await revealHere(applied, null, { ...deps, speed: () => 'off', startViewTransition: null }, options.commit);
  else if (deps.isOverlay()) {
    const answered = await deps.askChrome(applied, options.origin);
    if (!answered) await revealHere(applied, null, { ...deps, speed: () => 'off', startViewTransition: null }, options.commit);
    else options.commit?.();
  } else await revealHere(applied, options.origin, deps, options.commit);
  return applied;
}
