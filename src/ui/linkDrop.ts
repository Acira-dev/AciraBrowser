/** The web link inside a drag: a link or an address dragged from a page, from the address bar, or from another app. */
export type DroppedLink = { url: string; title?: string };
type Types = { readonly types?: ArrayLike<string> | null };
type Transfer = Types & { getData: (type: string) => string };

/** While a drag is over a target the browser only reveals the kinds of data it carries, not the data itself. */
export function hasLink(transfer: Types | null | undefined): boolean {
  const types = Array.from(transfer?.types ?? []);
  return types.includes('text/uri-list') || types.includes('text/x-moz-url') || types.includes('text/plain');
}

/** The first http(s) address in the dropped data, with the title the source gave it (when it gave one). */
export function droppedLink(transfer: Transfer | null | undefined): DroppedLink | null {
  if (!transfer) return null;
  const read = (type: string) => { try { return transfer.getData(type) || ''; } catch { return ''; } };
  const lines = (text: string) => text.split(/\r?\n/).map((line) => line.trim());
  const list = lines(read('text/uri-list')).find((line) => line && !line.startsWith('#'));
  const moz = lines(read('text/x-moz-url')), plain = read('text/plain').trim();
  const url = [list, moz[0], plain].find((candidate) => candidate && /^https?:\/\/\S+$/i.test(candidate));
  if (!url) return null;
  try { new URL(url); } catch { return null; }
  const title = moz[0] === url ? moz[1] : undefined;
  return { url, ...(title ? { title: title.slice(0, 2048) } : {}) };
}
