/** The whole split container is a drop target (R3-79, founder 26 Oct): a tab dropped on the split's chip, on any member tab or
 *  between two members joins that split at that place, in the strip, the compact strip and the sidebar. A drop in the gap just
 *  outside the container stays an ordinary reorder. The container is the union of the split's chip (`data-split-group`) and its
 *  members (`data-split-member` in a strip, the rows inside `data-split-container` in the sidebar). */
export interface Box { left: number; top: number; right: number; bottom: number }
export interface Point { x: number; y: number }

export const inside = (box: Box, point: Point): boolean => point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom;
export function union(boxes: readonly Box[]): Box | null {
  const real = boxes.filter(box => box.right > box.left && box.bottom > box.top);
  if (!real.length) return null;
  return { left: Math.min(...real.map(b => b.left)), top: Math.min(...real.map(b => b.top)), right: Math.max(...real.map(b => b.right)), bottom: Math.max(...real.map(b => b.bottom)) };
}
/** Where in the members' order the drop lands: how many members (the dragged tab left out) have their centre before the
 *  pointer along the strip's axis. */
export const insertIndex = (centres: readonly number[], at: number): number => centres.filter(centre => centre < at).length;

export interface SplitContainer { id: string; box: Box; members: Array<{ id: string; box: Box }>; /** A sidebar split lists its members top to bottom. */ vertical?: boolean }
/** The split under the pointer and the member slot it points at, or null. Pure: the containers are measured by `splitContainers`. */
export function resolveSplitDrop(containers: readonly SplitContainer[], point: Point, from: string, vertical: boolean): { groupId: string; index: number } | null {
  const hit = containers.find(container => inside(container.box, point)); if (!hit) return null;
  vertical = hit.vertical ?? vertical;
  const centres = hit.members.filter(member => member.id !== from).map(member => vertical ? (member.box.top + member.box.bottom) / 2 : (member.box.left + member.box.right) / 2).sort((a, b) => a - b);
  return { groupId: hit.id, index: insertIndex(centres, vertical ? point.y : point.x) };
}

/** Measured where it lies out: a sidebar drag moves rows and split cards aside to make room (sidebarTabDrag.ts, `data-drag-room`),
 *  and measured where they were drawn the card slid from under the pointer that was aiming at it. */
const boxOf = (node: Element): Box => {
  const r = node.getBoundingClientRect(); let lift = 0;
  for (let at = node.closest<HTMLElement>('[data-drag-room]'); at; at = at.parentElement?.closest<HTMLElement>('[data-drag-room]') ?? null) { const t = getComputedStyle(at).translate; if (t !== 'none') lift += parseFloat(t.split(' ').at(-1)!) || 0; }
  return { left: r.left, top: r.top - lift, right: r.right, bottom: r.bottom - lift };
};
const shown = (node: Element) => !node.closest('[inert],[hidden],[data-leaving],.tab-drag-preview') && node.getClientRects().length > 0;
/** Every split container on screen in this document, measured now. */
export function splitContainers(doc: Document): SplitContainer[] {
  const out = new Map<string, { parts: Box[]; members: Array<{ id: string; box: Box }>; vertical?: boolean }>(), take = (id: string) => { let entry = out.get(id); if (!entry) out.set(id, entry = { parts: [], members: [] }); return entry; };
  for (const node of doc.querySelectorAll<HTMLElement>('[data-split-group]')) if (node.dataset.splitGroup && shown(node)) take(node.dataset.splitGroup).parts.push(boxOf(node));
  for (const node of doc.querySelectorAll<HTMLElement>('[data-split-member]')) if (node.dataset.splitMember && node.dataset.tabId && shown(node)) { const box = boxOf(node), entry = take(node.dataset.splitMember); entry.parts.push(box); entry.members.push({ id: node.dataset.tabId, box }); }
  for (const node of doc.querySelectorAll<HTMLElement>('[data-split-container]')) {
    const id = node.dataset.splitContainer; if (!id || !shown(node)) continue;
    const entry = take(id); entry.parts.push(boxOf(node)); entry.vertical = true;
    for (const row of node.querySelectorAll<HTMLElement>('[data-tab-id]')) if (shown(row) && !row.closest('.sb-flip-ghost')) entry.members.push({ id: row.dataset.tabId!, box: boxOf(row) });
  }
  const containers: SplitContainer[] = [];
  for (const [id, entry] of out) { const box = union(entry.parts); if (box) containers.push({ id, box, members: entry.members, ...(entry.vertical ? { vertical: true } : {}) }); }
  return containers;
}
/** The split drop at a point in a document (see `resolveSplitDrop`). */
export const splitDropAt = (doc: Document, point: Point, from: string, vertical: boolean) => resolveSplitDrop(splitContainers(doc), point, from, vertical);

/** While a tab is dragged: the split it would join shows it (its chip outlined, its members tinted, an insertion bar on the
 *  member edge where it would land: `data-drop` / `data-split-hover` / `data-split-insert`). Clears everything else. */
export function markSplitDrop(doc: Document, point: Point | null, from: string): { groupId: string; index: number } | null {
  const containers = point ? splitContainers(doc) : [], drop = point ? resolveSplitDrop(containers, point, from, false) : null;
  for (const node of doc.querySelectorAll<HTMLElement>('[data-split-group][data-drop],[data-split-hover],[data-split-insert]')) { node.removeAttribute('data-drop'); node.removeAttribute('data-split-hover'); node.removeAttribute('data-split-insert'); }
  if (!drop) return null;
  const hit = containers.find(container => container.id === drop.groupId)!;
  for (const node of doc.querySelectorAll<HTMLElement>(`[data-split-group="${CSS.escape(drop.groupId)}"]`)) node.setAttribute('data-drop', '');
  for (const node of doc.querySelectorAll<HTMLElement>(`[data-split-member="${CSS.escape(drop.groupId)}"],[data-split-container="${CSS.escape(drop.groupId)}"] [data-tab-id]`)) if (node.dataset.tabId !== from) node.setAttribute('data-split-hover', '');
  const axis = (b: Box) => hit.vertical ? (b.top + b.bottom) / 2 : (b.left + b.right) / 2;
  const members = hit.members.filter(member => member.id !== from).sort((a, b) => axis(a.box) - axis(b.box));
  const at = members[drop.index] ?? members.at(-1), edge = members[drop.index] ? 'before' : 'after';
  if (at) for (const node of doc.querySelectorAll<HTMLElement>(`[data-tab-id="${CSS.escape(at.id)}"]`)) if (!node.closest('.tab-drag-preview,.sb-flip-ghost')) node.setAttribute('data-split-insert', edge);
  return drop;
}
