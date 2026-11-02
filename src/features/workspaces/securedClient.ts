/** R3-38: the interface's way to main's secured-workspace service (desktop/secured-workspaces.cjs via `acira:secured`). Making a workspace secured, unlocking it and stopping it each ask Windows Hello first; locking never asks. */
export type SecuredRequest = { type: 'unlock' | 'enable' | 'disable' | 'lock'; id: string };
export type SecuredResult = { ok: boolean; code?: string };
type Bridge = (request: SecuredRequest) => Promise<SecuredResult>;
const bridge = (): Bridge | undefined => (window as unknown as { acira?: { secured?: Bridge } }).acira?.secured;
export const securedAvailable = (): boolean => typeof bridge() === 'function';
export async function securedRequest(request: SecuredRequest): Promise<SecuredResult> {
  const call = bridge();
  if (!call) return { ok: false, code: 'unavailable' };
  try { return await call(request); } catch { return { ok: false, code: 'failed' }; }
}
