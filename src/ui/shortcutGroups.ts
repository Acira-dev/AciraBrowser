import type {ShortcutCommand} from '../runtime/nativeCore';

const ORDER=['Tabs','Windows','Split view','Navigation','Page','Library','Browser'];
/** Group the current bindings, not the defaults. Keep registry order and command identities intact. */
export function groupShortcutCommands(commands:readonly ShortcutCommand[],include:(command:ShortcutCommand)=>boolean=()=>true):[string,ShortcutCommand[]][]{
  const groups=new Map<string,ShortcutCommand[]>(ORDER.map(name=>[name,[]])),unassigned:ShortcutCommand[]=[];
  for(const command of commands){
    if(!include(command))continue;
    if(!command.bindings.length){unassigned.push(command);continue;}
    const list=groups.get(command.category)||[];list.push(command);groups.set(command.category,list);
  }
  if(unassigned.length)groups.set('Unassigned',unassigned);
  return [...groups].filter(([,list])=>list.length>0);
}
