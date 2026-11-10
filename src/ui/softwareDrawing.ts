import { useEffect, useState } from 'react';
import { runtime } from '../runtime/client';

/** True while the window is drawn in software (no graphics acceleration), told by main at start and on a fallback mid-session. Always false in a preview. */
export function useSoftwareDrawing(): boolean {
  const [software, setSoftware] = useState<boolean>(() => { try { return runtime.softwareDrawing?.() === true; } catch { return false; } });
  useEffect(() => runtime.subscribeSoftwareDrawing?.(setSoftware), []);
  return software;
}
