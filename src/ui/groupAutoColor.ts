import type { IconColor } from './siteIconColor';

/** Beta 14, section M: the automatic colour of a tab-group folder.
 *
 *  A folder takes the strongest colour among the icons of the sites inside it, drawn in its lines and its name (nothing behind it). Two
 *  folders that sit near each other must not look alike, so the colours are settled for the whole sidebar at once. Pure: icons in, hues out;
 *  `siteIconColor.ts` reads the icons and `useGroupAutoColors` (components/sidebar/groupAutoColors.ts) feeds this.
 *
 *  What it promises (tests/group-auto-color.test.ts):
 *  - A folder's colour is always one of its own sites' colours, or at most `NUDGE_MAX` degrees from one. The old failing was "kept apart"
 *    ending in a colour that matched none of the sites (most brand icons are red, so a second red folder was thrown to the far side of the wheel).
 *  - Away from any neighbour, the strongest family wins: the one most sites share, then the more vivid.
 *  - When the strongest family is too close to a neighbour, a clear family with real support is taken instead; if there is none, the
 *    strongest family is turned the smallest step away from the neighbour, which is still the colour of its sites.
 *  - A folder with no coloured site (grey, black or white icons, or none read yet) gets `null`: the caller keeps the neutral look.
 *  - The answer depends only on the folders, in the order they are shown, and the sites inside them: the sidebar and the colour menu agree. */

export interface SiteColor { site: string; color: IconColor | null | undefined }
/** One colour a folder's sites share: its hue and chroma and how many different sites wear it. */
export interface Family extends IconColor { support: number }
export interface FolderColorInput {
  id: string;
  /** Picked by hand: the palette hue it wears (`null` for grey or no colour). Such a folder keeps its colour and the automatic ones keep away from it. */
  fixed?: number | null;
  /** Automatic: the sites inside it. */
  sites?: readonly SiteColor[];
}

/** Hues within this many degrees are one colour family (YouTube's and Gmail's reds are one red). */
export const FAMILY_MERGE = 24;
/** The farthest a folder's hue is turned from a colour its sites really wear, to keep it apart from a neighbour. */
export const NUDGE_MAX = 30;
const NUDGE_STEP = 5;
/** How far apart two colours must be to read as two: next to each other in the list, and anywhere else in the sidebar. */
export const SEPARATION = { near: 30, far: 20 } as const;
/** A family that is not the strongest still counts as "this folder's colour" when it has at least this share of the strongest one's support. */
const REAL_SUPPORT = 0.4;

/** The hue of each palette colour on the sidebar (OKLCH degrees, as the folder's lines show them), for folders picked by hand. */
export const PALETTE_HUES: Readonly<Record<string, number | null>> = { none: null, grey: null, blue: 255, red: 25, yellow: 90, green: 150, pink: 350, purple: 300, cyan: 210, orange: 55 };

const wrap = (h: number) => ((h % 360) + 360) % 360;
/** The shortest way round the wheel between two hues, 0 to 180. */
export const hueDistance = (a: number, b: number) => { const d = Math.abs(wrap(a) - wrap(b)); return d > 180 ? 360 - d : d; };

/** The colour families of a folder's sites, strongest first. A site counts once, however many of its tabs are open, and a site with no real colour counts for nothing. */
export function autoFamilies(sites: readonly SiteColor[]): Family[] {
  const bySite = new Map<string, IconColor>();
  for (const { site, color } of sites) if (color) { const known = bySite.get(site); if (!known || color.c > known.c) bySite.set(site, color); }
  const items = [...bySite.values()].sort((a, b) => a.h - b.h || a.c - b.c);
  if (!items.length) return [];
  // Walk the wheel in order, closing a family where the gap to the next hue is wider than FAMILY_MERGE; the last and the first meet round the wheel.
  // A family also never spans more than twice the merge distance, so a long run of neighbouring hues (a rainbow of sites) is several colours, not one grey-brown mean.
  const groups: IconColor[][] = [];
  for (const item of items) { const last = groups.at(-1); if (last && item.h - last.at(-1)!.h <= FAMILY_MERGE && item.h - last[0].h <= FAMILY_MERGE * 2) last.push(item); else groups.push([item]); }
  if (groups.length > 1) { const first = groups[0], end = groups.at(-1)!; if (first[0].h + 360 - end.at(-1)!.h <= FAMILY_MERGE && first.at(-1)!.h + 360 - end[0].h <= FAMILY_MERGE * 2) groups[0] = [...groups.pop()!, ...groups[0]]; }
  return groups.map(members => {
    // Hue as the circle's mean, weighted by how vivid each site is; chroma as the plain mean.
    let x = 0, y = 0, c = 0;
    for (const m of members) { x += m.c * Math.cos(m.h * Math.PI / 180); y += m.c * Math.sin(m.h * Math.PI / 180); c += m.c; }
    return { h: Math.round(wrap(Math.atan2(y, x) * 180 / Math.PI)) % 360, c: Math.round(c / members.length * 1000) / 1000, support: members.length };
  }).sort((a, b) => b.support - a.support || b.c - a.c || a.h - b.h);
}

interface Candidate { h: number; c: number; support: number; nudge: number }

/** The colours of every automatic folder in `folders` (listed in the order they are shown), or `null` for one with no coloured site. Folders picked by hand are not in the answer. */
export function folderColors(folders: readonly FolderColorInput[]): Map<string, IconColor | null> {
  const out = new Map<string, IconColor | null>();
  const hues = new Map<string, number>(); // what each folder wears so far: fixed ones from the start, automatic ones as they are settled
  folders.forEach(folder => { if (folder.fixed !== undefined && folder.fixed !== null) hues.set(folder.id, wrap(folder.fixed)); });
  const index = new Map(folders.map((folder, i) => [folder.id, i]));
  const automatic = folders.filter(folder => folder.fixed === undefined).map(folder => ({ id: folder.id, families: autoFamilies(folder.sites ?? []) }));
  // The most constrained folder chooses first: one with a single family has no choice, so the ones with options work round it.
  const queue = automatic.filter(folder => folder.families.length).sort((a, b) => a.families.length - b.families.length || index.get(a.id)! - index.get(b.id)!);
  for (const folder of automatic) if (!folder.families.length) out.set(folder.id, null);
  /** 0 to 1: how far this hue is from everything settled so far, as a share of what is needed (near neighbours need more). */
  const clearance = (id: string, h: number) => {
    let worst = 1;
    for (const [other, hue] of hues) {
      if (other === id) continue;
      const need = Math.abs(index.get(other)! - index.get(id)!) === 1 ? SEPARATION.near : SEPARATION.far;
      worst = Math.min(worst, hueDistance(h, hue) / need);
    }
    return Math.min(1, worst);
  };
  for (const folder of queue) {
    const top = folder.families[0];
    const plain: Candidate[] = folder.families.map(f => ({ h: f.h, c: f.c, support: f.support, nudge: 0 }));
    // The strongest family turned a little toward either side, only ever within NUDGE_MAX of a colour the sites wear.
    const turned: Candidate[] = [];
    for (let step = NUDGE_STEP; step <= NUDGE_MAX; step += NUDGE_STEP) for (const sign of [1, -1]) turned.push({ h: wrap(top.h + sign * step), c: top.c, support: top.support, nudge: step });
    const value = (c: Candidate) => (c.support / top.support) * 0.9 - (c.nudge / NUDGE_MAX) * 0.25;
    const score = (c: Candidate) => clearance(folder.id, c.h) * 2 + value(c);
    const clear = plain.filter(c => clearance(folder.id, c.h) >= 1);
    let pick: Candidate | undefined;
    // 1. the strongest family, when it is clear of its neighbours
    if (clearance(folder.id, top.h) >= 1) pick = plain[0];
    // 2. another family the sites really share, when it is clear
    else pick = clear.find(c => c.support >= top.support * REAL_SUPPORT);
    // 3. the strongest family turned the smallest step that makes it clear
    if (!pick) pick = turned.filter(c => clearance(folder.id, c.h) >= 1).sort((a, b) => a.nudge - b.nudge || score(b) - score(a))[0];
    // 4. any clear family; 5. nothing is clear: the best of everything on offer (the most room, then the strongest, then the smallest turn)
    if (!pick) pick = clear[0];
    if (!pick) pick = [...plain, ...turned].sort((a, b) => score(b) - score(a))[0];
    hues.set(folder.id, pick.h);
    out.set(folder.id, { h: Math.round(pick.h) % 360, c: pick.c });
  }
  return out;
}
