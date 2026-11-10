/** A local file path typed or pasted into the address bar (13.5, hunt-f 11).
 *
 * Explorer's "Copy as path" gives `"C:\Users\me\Documents\salary 2026.xlsx"`, and people type `C:\temp\a.html`. The address bar read those as a search
 * (the file's name and folders went to the search provider) or, for `\\server\share\x.txt`, as the plain-http address `http://server/share/x.txt`.
 * Now a path that names a file that exists is opened like a file dropped on the window (main's openDroppedFile checks the kind), a network share path is
 * refused, and anything else is left to the address bar exactly as before (a search such as `C:\Windows\System32\foo.dll missing` is still a search).
 * Pure: the caller says which platform it is and whether a path is a file, so it is tested without a disk. */
export type TypedLocalPath = { kind: 'drive' | 'unc' | 'posix'; path: string };
export type TypedLocalFile = { action: 'open'; file: string } | { action: 'refuse' } | { action: 'none' };

/** The path the text is made of (one pair of surrounding double quotes removed), or null when the text does not start like a local path: a drive letter and a
 *  slash (`C:\`, `c:/`), two backslashes and a server and share (`\\server\share`), or one slash and a name (`/Users/me/a.pdf`, not `//host`). */
export function typedLocalPath(input: unknown): TypedLocalPath | null {
  if (typeof input !== 'string' || input.length > 4096 || /[\u0000-\u001f]/.test(input)) return null;
  let text = input.trim();
  if (text.length > 2 && text.startsWith('"') && text.endsWith('"') && !text.slice(1, -1).includes('"')) text = text.slice(1, -1).trim();
  if (/^[A-Za-z]:[\\/]./.test(text)) return { kind: 'drive', path: text };
  if (/^\\\\[^\\/\s]+[\\/][^\\/]/.test(text)) return { kind: 'unc', path: text };
  if (/^\/[^/\s]/.test(text)) return { kind: 'posix', path: text };
  return null;
}

/** What to do with typed text, on this platform. Windows reads drive paths and refuses network shares; Mac and Linux read absolute paths with forward slashes
 *  (a backslash path there is just text). A share is never opened or looked up (no network access from the address bar), and a path that is not a file
 *  that exists (a folder, a missing file, a search that happens to start with a path) is `none`. */
export function typedLocalFile(input: unknown, options: { platform: string; isFile: (path: string) => boolean }): TypedLocalFile {
  const found = typedLocalPath(input);
  if (!found) return { action: 'none' };
  const windows = options.platform === 'win32';
  if (found.kind === 'unc') return windows ? { action: 'refuse' } : { action: 'none' };
  if (windows ? found.kind !== 'drive' : found.kind !== 'posix') return { action: 'none' };
  let exists = false;
  try { exists = options.isFile(found.path); } catch { exists = false; }
  return exists ? { action: 'open', file: found.path } : { action: 'none' };
}
