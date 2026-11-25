import { useLayoutEffect, type RefObject } from 'react';

/** Beta 14, section AE: the connecting line of a group that holds groups (a parent), drawn as ONE stroke from the layout.
 *
 *  The trunk runs down from under the parent's header, under the centre of the parent's folder (x 14 of the group's box, on the device-pixel grid for the
 *  stroke width), and ends INSIDE the last inner group's curve: it never runs on past it. Each inner group is reached by a small curve that leaves the trunk
 *  tangentially (a quarter circle of radius `NEST_R`) and stops `NEST_GAP` px before the inner folder. Trunk and curves are subpaths of one path with one
 *  opacity, so the joints have no gap and no darker dot where strokes overlap. The width is two device pixels (`--ng-w`: 2px at 100%, 1.3333px at 150%),
 *  the only width that is both crisp and exactly centred on the folder at 150%.
 *
 *  `drawConnector` only reads layout offsets (a running slide never moves them) and writes the path; CSS moves the path to its new shape on the sidebar's
 *  own spring (`d` transition, folders.css), so the line travels with the rows it joins. `connectorPath` is the pure part. */
export const NEST_R = 6, NEST_GAP = 3;
const K = .552;
const fmt = (value: number) => +value.toFixed(3);

export interface Elbow { /** The curve's y, the centre of the inner group's header, on the grid. */ y: number; /** Where the horizontal run ends: 3px before the inner folder. */ end: number }

/** The path of a connector: the trunk at `x` from `top` to the last elbow, and every elbow. `bottom` is where an ordinary group's trunk stops (it has no elbow). */
export function connectorPath(x: number, top: number, bottom: number, elbows: readonly Elbow[], radius = NEST_R): string {
  const sorted = [...elbows].sort((a, b) => a.y - b.y), last = sorted.at(-1);
  const elbow = (y: number, to: number) => `C${fmt(x)} ${fmt(y - radius + radius * K)} ${fmt(x + radius - radius * K)} ${fmt(y)} ${fmt(x + radius)} ${fmt(y)}H${fmt(Math.max(x + radius, to))}`;
  if (!last) return `M${fmt(x)} ${fmt(top)}V${fmt(Math.max(top, bottom))}`;
  return `M${fmt(x)} ${fmt(top)}V${fmt(Math.max(top, last.y - radius))}${elbow(last.y, last.end)}${sorted.slice(0, -1).map(item => `M${fmt(x)} ${fmt(item.y - radius)}${elbow(item.y, item.end)}`).join('')}`;
}

/** Where a stroke of width `w` has both edges on device pixels, centred as near `value` as the grid allows (`dpr` device pixels per css px). */
export const snapStroke = (value: number, w: number, dpr: number) => (Math.round(value * dpr - w * dpr / 2) + w * dpr / 2) / dpr;

/** The offset of `node` inside `box` through the offset chain: layout positions, which a running slide (a transform) does not change. */
const within = (node: HTMLElement, box: HTMLElement) => { let top = 0, left = 0; for (let at: HTMLElement | null = node; at && at !== box; at = at.offsetParent as HTMLElement | null) { top += at.offsetTop; left += at.offsetLeft; } return { top, left }; };

export interface ConnectorOptions {
  /** A carried group: how far a point of the list (in scroll-content px) is moved by the room the carry opens. */
  shift?: (y: number) => number;
  /** The centre of the gap a nest would land in (scroll-content px): an elbow into it, the trunk carried down to it. */
  preview?: number | null;
  /** A carried inner group: it leaves the trunk at once and its old elbow (and the run of trunk only it needed) is redrawn in its own path, which fades out as the group lifts (shown false) and back in when a cancel brings it home (shown true). */
  lifted?: { el: HTMLElement; shown: boolean } | null;
  /** The sidebar's own slide time (speed setting included): the path moves to its new shape as long as the rows slide, on the same spring (folders.css). */
  duration?: number;
}

/** Where an inner group starts, in px from its parent's rows: 21, and 21.3333 at 150% (a whole 32 device pixels; item24 groupNest.css). */
const nestX = () => (window.devicePixelRatio >= 1.4 && window.devicePixelRatio <= 1.6 ? 21.3333 : 21);

/** Draw the connector of a group: `root` is its `.sb-group`. Ported from item24's nestRail.ts `drawConnector`: it reads the visible inner groups' headers and writes the paths of the
 *  group's `.sb-group-rail` svg: `.ng-trunk` (the trunk and every elbow), `.ng-preview` (the elbow into the gap of a carried group) and `.ng-lifted` (the elbow of a carried inner group, fading). A group
 *  with no inner group and no preview has no connector: its own line is the folder's plain line (folders.css). */
export function drawConnector(root: HTMLElement, options: ConnectorOptions = {}): void {
  const members = root.querySelector<HTMLElement>(':scope>.sb-group-members'), svg = members?.querySelector<SVGSVGElement>(':scope>.sb-group-rail>svg.ng-conn');
  const trunk = svg?.querySelector<SVGPathElement>('.ng-trunk'), preview = svg?.querySelector<SVGPathElement>('.ng-preview'), liftedPath = svg?.querySelector<SVGPathElement>('.ng-lifted');
  if (!members || !svg || !trunk) return;
  const style = getComputedStyle(svg), w = parseFloat(style.getPropertyValue('--cw')) || 2, dpr = window.devicePixelRatio || 1;
  const scroller = members.closest<HTMLElement>('.sb-scroll'), base = scroller ? within(members, scroller).top : 0, shift = options.shift ?? (() => 0);
  const move = (y: number) => y + shift(base + y);
  const x = snapStroke(14, w, dpr), top = move(0);
  const elbows = [...members.querySelectorAll<HTMLElement>(':scope>.sb-group[data-nested-group]:not([data-hidden])')].flatMap(group => {
    if (options.lifted && group === options.lifted.el) return [];
    const header = group.querySelector<HTMLElement>(':scope>.sb-group-header'), icon = header?.querySelector<HTMLElement>('.sb-group-folder');
    if (!header || !icon || !header.offsetHeight) return [];
    // y from the layout offsets (whole px, a running slide's transform does not move them); x from the inner group's own margin (a fraction of a px at 150%, which the offset chain rounds away) plus the icon's offset inside the group.
    const at = within(header, members), iconAt = within(icon, group), start = parseFloat(getComputedStyle(group).marginLeft) || 0;
    return [{ y: snapStroke(move(at.top + header.offsetHeight / 2), w, dpr), end: start + iconAt.left - NEST_GAP }];
  }).sort((a, b) => a.y - b.y);
  const last = elbows.at(-1), end = last?.end ?? nestX() + 6 - NEST_GAP;
  const p = options.preview != null ? snapStroke(options.preview - base, w, dpr) : null;
  const elbow = (y: number, to: number) => `C${fmt(x)} ${fmt(y - NEST_R + NEST_R * K)} ${fmt(x + NEST_R - NEST_R * K)} ${fmt(y)} ${fmt(x + NEST_R)} ${fmt(y)}H${fmt(Math.max(x + NEST_R, to))}`;
  // Where the trunk's straight run stops: in the last elbow, or at the preview below it.
  const stem = last ? last.y - NEST_R : p != null ? p - NEST_R : top;
  trunk.setAttribute('d', last || p != null ? `M${fmt(x)} ${fmt(top)}V${fmt(Math.max(top, stem))}` + (last ? elbow(last.y, last.end) + elbows.slice(0, -1).map(e => `M${fmt(x)} ${fmt(e.y - NEST_R)}${elbow(e.y, e.end)}`).join('') : '') : '');
  // The carried group's old elbow, unshifted (its own place closes under it), fading.
  if (liftedPath && options.lifted) {
    const header = options.lifted.el.querySelector<HTMLElement>(':scope>.sb-group-header'), icon = header?.querySelector<HTMLElement>('.sb-group-folder');
    if (header && icon) {
      const y = snapStroke(within(header, members).top + header.offsetHeight / 2, w, dpr), to = (parseFloat(getComputedStyle(options.lifted.el).marginLeft) || 0) + within(icon, options.lifted.el).left - NEST_GAP, from = last && last.y < y ? last.y - NEST_R : y - NEST_R;
      if (liftedPath.dataset.lift === undefined) { liftedPath.setAttribute('d', `M${fmt(x)} ${fmt(from)}V${fmt(y - NEST_R)}${elbow(y, to)}`); liftedPath.style.transition = 'none'; liftedPath.style.strokeOpacity = '1'; liftedPath.getBoundingClientRect(); liftedPath.style.transition = ''; liftedPath.dataset.lift = ''; }
      liftedPath.style.strokeOpacity = options.lifted.shown ? '1' : '0';
    }
  } else if (liftedPath && liftedPath.dataset.lift !== undefined) { delete liftedPath.dataset.lift; liftedPath.style.strokeOpacity = '0'; liftedPath.style.transition = 'none'; }
  if (preview) {
    if (p != null) { const from = last ? Math.min(last.y - NEST_R, p - NEST_R) : p - NEST_R; preview.setAttribute('d', `M${fmt(x)} ${fmt(from)}V${fmt(p - NEST_R)}${elbow(p, end)}`); preview.dataset.on = ''; }
    else delete preview.dataset.on;
  }
  // The divider fade (item24): in at the top over --cf, following the trunk's top; a connector ends in an elbow, so it has no fade at the bottom.
  const grad = svg.querySelector<SVGLinearGradientElement>('linearGradient'), stops = grad ? [...grad.querySelectorAll('stop')] : [];
  if (grad && stops.length >= 4 && (last || p != null)) {
    const fade = parseFloat(style.getPropertyValue('--cf')) || 12, length = Math.max(1, Math.max(stem + NEST_R, p ?? 0) - top);
    grad.setAttribute('y1', String(fmt(top))); grad.setAttribute('y2', String(fmt(top + length)));
    stops[1].setAttribute('offset', String(fmt(Math.min(.5, fade / length)))); stops[2].setAttribute('offset', '1'); stops[3].setAttribute('stop-opacity', '1');
  }
  if (options.duration !== undefined) svg.style.setProperty('--ng-dms', Math.max(0, Math.round(options.duration)) + 'ms');
  svg.dataset.elbows = String(elbows.length);
}

/** Keep a parent's connector drawn: after every render of the group, and whenever its rows change size. */
export function useNestConnector(root: RefObject<HTMLElement | null>, hasInner: boolean, signature: string, duration: () => number): void {
  useLayoutEffect(() => {
    const group = root.current;
    if (!group || !hasInner) return;
    if (!group.closest('[data-ng-carry]')) drawConnector(group, { duration: duration() });
  }, [root, hasInner, signature]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const group = root.current, members = group?.querySelector<HTMLElement>(':scope>.sb-group-members');
    if (!group || !members || !hasInner || typeof ResizeObserver === 'undefined') return;
    const redraw = () => { if (!group.closest('[data-ng-carry]')) drawConnector(group, { duration: duration() }); };
    const watch = new ResizeObserver(redraw);
    watch.observe(members);
    // The device scale changes the grid the strokes are snapped to and the width (two device pixels): a window moved to another monitor, or the interface zoomed, redraws.
    let scale: MediaQueryList | null = null;
    const bind = () => { scale?.removeEventListener('change', onScale); scale = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`); scale.addEventListener('change', onScale); };
    const onScale = () => { redraw(); bind(); };
    bind();
    return () => { watch.disconnect(); scale?.removeEventListener('change', onScale); };
  }, [root, hasInner]); // eslint-disable-line react-hooks/exhaustive-deps
}
