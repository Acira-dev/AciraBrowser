/** Trusted-UI channel to the main-process password service (desktop/passwords/passwords.cjs). Only the chrome can call it. */
export interface PwItem { id: string; origin: string; host: string; username: string; updatedAt: number }
export interface PwNever { id: string; origin: string }
export interface PwDenied { code: string; message: string }
export interface PwFlags { strength: 'weak' | 'fair' | 'strong'; reused: number }
export interface PwStatus { private?: boolean; ok?: boolean; available?: boolean; count?: number; unreadable?: number; code?: string; message?: string; enabled?: boolean }
export interface PwImportPreview { cancelled?: boolean; unreadable?: string; token?: string; total?: number; new?: number; update?: number; same?: number; skipped?: number; name?: string }
type Request =
  | { type: 'passwords.status' | 'passwords.list' | 'passwords.check' | 'passwords.deleteAll' | 'passwords.export' | 'passwords.import.preview' }
  | { type: 'passwords.settings'; enabled: boolean }
  | { type: 'passwords.detail' | 'passwords.reveal' | 'passwords.delete' | 'passwords.never.remove'; id: string }
  | { type: 'passwords.copy'; id: string; field: 'password' | 'username' }
  | { type: 'passwords.generate'; length?: number; symbols?: boolean }
  | { type: 'passwords.save'; origin: string; username: string; password: string; note?: string }
  | { type: 'passwords.update'; id: string; origin?: string; username?: string; password?: string; note?: string }
  | { type: 'passwords.import.apply' | 'passwords.import.delete-file' | 'passwords.import.trash-file'; token: string };
const bridge = () => (window as unknown as { acira?: { passwords?: (request: Request) => Promise<{ passwords: unknown }> } }).acira?.passwords;
export const passwordsAvailable = () => Boolean(bridge());
export async function pw<T = Record<string, unknown>>(request: Request): Promise<T> {
  const call = bridge(); if (!call) throw new Error('Passwords need the desktop browser.');
  return (await call(request)).passwords as T;
}
/** IPC errors arrive as "Error invoking remote method '…': Error: <message>". */
export const readable = (error: unknown) => String((error as Error)?.message ?? error).replace(/^Error invoking remote method '[^']*':\s*(?:\w*Error:\s*)?/, '');
