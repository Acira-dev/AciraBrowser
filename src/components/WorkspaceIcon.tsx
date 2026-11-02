import { EditorGlyph,type EditorIconName } from './EditorGlyph';

const names={
 home:'Home',workflows:'Workflow',team:'Users',tasks:'tasks',approvals:'CheckCheck',
 security:'ShieldCheck',permissions:'SlidersHorizontal',accounts:'UserRound',
 connections:'Unplug',history:'history',appearance:'Palette',settings:'settings',
} satisfies Record<string,EditorIconName>;

/** Compatibility for existing workspace controls, using the same editor glyphs. */
export function WorkspaceIcon({name}:{name:keyof typeof names}){
 return <EditorGlyph name={names[name]} />;
}
