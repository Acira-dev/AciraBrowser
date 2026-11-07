/** A release's notes as the update popups show them. Main hands over plain text (every tag stripped, bullets written "• "); this only lays it out:
 *  each bullet is its own item with room around it and a hanging indent (a wrapped line stays under the words, not under the dot), and a blank line
 *  in the notes (a new heading's worth) leaves a little more. Nothing here is HTML: every line is rendered as text. */
export type NoteBlock = { kind: 'list'; items: string[]; gap: boolean } | { kind: 'text'; text: string; gap: boolean };

const BULLET = /^•\s*/;

export function noteBlocks(notes: string): NoteBlock[] {
  const blocks: NoteBlock[] = [];
  let gap = false;
  for (const raw of notes.split('\n')) {
    const line = raw.trim();
    if (!line) { gap = blocks.length > 0; continue; }
    const last = blocks[blocks.length - 1];
    if (BULLET.test(line)) {
      const text = line.replace(BULLET, '');
      if (!text) continue;
      // bullets in a row are one list; a blank line between two of them starts a new one a little lower
      if (last?.kind === 'list' && !gap) last.items.push(text); else blocks.push({ kind: 'list', items: [text], gap });
    } else blocks.push({ kind: 'text', text: line, gap });
    gap = false;
  }
  return blocks;
}

export function NoteList({ notes }: { notes: string }) {
  return (
    <>
      {noteBlocks(notes).map((block, index) => block.kind === 'list'
        ? <ul className="update-pop-list" key={index} data-gap={block.gap || undefined}>{block.items.map((item, at) => <li key={at}>{item}</li>)}</ul>
        : <p className="update-pop-line" key={index} data-gap={block.gap || undefined}>{block.text}</p>)}
    </>
  );
}
