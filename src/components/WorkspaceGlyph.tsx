import { EditorGlyph, type EditorIconName } from './EditorGlyph';
import { LEGACY_WORKSPACE_GLYPH, WORKSPACE_GLYPHS, type WorkspaceGlyphId } from '../runtime/workspaces';
import type { Workspace } from '../runtime/types';

/** The glyphs a workspace can wear, drawn from the one 16px icon family (bible §3.6): no emoji bubbles, no second set.
 * The default is the family's own "workspace" mark (a window with its panels), not the layers stack, which is Rewind's. */
const SHAPES: Record<WorkspaceGlyphId, EditorIconName> = {
  workspace: 'workspace', home: 'House', code: 'Code2', palette: 'Palette', book: 'BookOpen', flask: 'FlaskConical', bag: 'ShoppingBag', globe: 'Globe2',
  users: 'Users', headphones: 'Headphones', video: 'Video', mail: 'Mail', star: 'Star', bolt: 'Zap', terminal: 'Terminal', file: 'FileText',
};
export const isGlyphId = (icon: string): icon is WorkspaceGlyphId => (WORKSPACE_GLYPHS as readonly string[]).includes(icon);
/** What a workspace shows: its chosen icon, else the first letter of its name, else the workspace glyph (the unnamed first workspace).
 * An icon saved as the old "layers" id shows the workspace glyph too. */
export const workspaceIcon = (workspace: Pick<Workspace, 'icon' | 'name'>): string => {
  const icon = workspace.icon === LEGACY_WORKSPACE_GLYPH ? 'workspace' : workspace.icon;
  return icon || ([...workspace.name][0]?.toUpperCase() ?? 'workspace');
};

/** A workspace's icon in a 16px box: a glyph of the family, or one letter or emoji set in the same box. */
export function WorkspaceGlyph({ icon }: { icon: string }) {
  return isGlyphId(icon) ? <EditorGlyph name={SHAPES[icon]} /> : <span className="ws-char" aria-hidden="true">{icon}</span>;
}
