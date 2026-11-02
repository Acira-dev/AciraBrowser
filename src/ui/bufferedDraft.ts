/** The input owns each keystroke; delayed store echoes cannot replace an unfinished edit. */
export function createBufferedDraft(initial:string,send:(value:string)=>void){
 let value=initial,dirty=false,pending:string|undefined;
 const edit=(next:string)=>{value=next;dirty=true;return value;};
 const flush=()=>{if(dirty){dirty=false;pending=value;send(value);}return value;};
 const receive=(remote:string,focused=false)=>{if(remote===pending)pending=undefined;if(!dirty&&pending===undefined&&!focused)value=remote;return value;};
 return{edit,flush,receive,read:()=>value,dirty:()=>dirty};
}
export function composingEnter(event:{key:string;shiftKey?:boolean;isComposing?:boolean;keyCode?:number}){return event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&event.keyCode!==229;}
