import { t } from '../../i18n';
/** Routines over the trusted Rewind channel (desktop/rewind/routines.cjs validates everything again). */
export type Color = 'none' | 'grey' | 'blue' | 'red' | 'yellow' | 'green' | 'pink' | 'purple' | 'cyan' | 'orange';
export type Step =
  | { id: string; command: 'tabs.open'; args: { reuse: 'exact-url-in-workspace'; items: { ref: string; url: string }[] } }
  | { id: string; command: 'tabs.group'; args: { refs: string[]; name: string; color: Color } }
  | { id: string; command: 'layout.split'; args: { left: string; right: string; ratio: number } }
  | { id: string; command: 'layout.focus'; args: { enabled: boolean } };
export interface Recipe { format: 'acira-routine'; version: 1; name: string; description?: string; steps: Step[] }
export interface Run { runId?: string; routineId?: string; status: 'running' | 'completed' | 'partial' | 'cancelled' | 'failed' | 'interrupted'; current?: number; total: number; completed: string[]; message: string; tabIds?: string[]; busy?: boolean }
export interface RoutineRow { id: string; name: string; description: string; steps: number; domains: string[]; profileId: string; shortcut?: string; commands?: Step['command'][]; sites?: number; lastRun: { status: string; at: number; message?: string } | null }
export interface Library { private?: boolean; routines: RoutineRow[]; profiles: { id: string; name: string }[]; activeProfileId?: string; run?: Run | null }
type Request = { type: 'routines.list' | 'routines.stop' } | { type: 'routines.get' | 'routines.delete' | 'routines.export' | 'routines.run'; id: string } | { type: 'routines.save'; id?: string; recipe: Recipe; profileId: string } | { type: 'routines.preview'; text: string } | { type: 'routines.import'; text: string; profileId: string } | { type: 'routines.shortcut'; id: string; accelerator: string | null };
const bridge = () => (window as unknown as { acira?: { rewind?: (request: Request) => Promise<{ routines: unknown }>; exportData?: (name: string, content: string) => void } }).acira;
export const routinesAvailable = () => Boolean(bridge()?.rewind);
export async function routines<T = Library>(request: Request): Promise<T> {
  const call = bridge()?.rewind; if (!call) throw new Error('Routines need the desktop browser.');
  return (await call(request)).routines as T;
}
export const exportFile = (name: string, content: string) => bridge()?.exportData?.(name, content);
export const commandLabels: Record<Step['command'], string> = { 'tabs.open': 'Open tabs', 'tabs.group': 'Group tabs', 'layout.split': 'Split two tabs', 'layout.focus': 'Focus mode' };
export const host = (url: string) => { try { return new URL(url).host.replace(/^www\./, ''); } catch { return url || 'New address'; } };
export const example: Recipe = { format: 'acira-routine', version: 1, name: 'Start work', description: t("client.bringMyDailyPagesTogether"), steps: [
  { id: 'open', command: 'tabs.open', args: { reuse: 'exact-url-in-workspace', items: [{ ref: 'tab1', url: 'https://calendar.google.com/' }, { ref: 'tab2', url: 'https://mail.google.com/' }] } },
  { id: 'group', command: 'tabs.group', args: { refs: ['tab1', 'tab2'], name: 'Daily work', color: 'blue' } },
  { id: 'focus', command: 'layout.focus', args: { enabled: true } },
] };
