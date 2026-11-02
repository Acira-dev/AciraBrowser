import type { ReactNode } from 'react';
import type { Workspace } from '../runtime/types';
import { WorkspaceGlyph, workspaceIcon } from './WorkspaceGlyph';
import { TabSoundMeter } from './TabSound';
import './WorkspacePlaybackGlyph.css';

export function WorkspacePlaybackGlyph({ workspace, playing, reducedMotion, children }: { workspace: Workspace; playing: boolean; reducedMotion?: boolean; children?: ReactNode }) {
  return <span className="workspace-playback-glyph" data-playing={playing || undefined}>
    <span className="workspace-playback-identity"><WorkspaceGlyph icon={workspaceIcon(workspace)} /></span>
    {playing && <TabSoundMeter reducedMotion={reducedMotion} />}
    {children}
  </span>;
}
