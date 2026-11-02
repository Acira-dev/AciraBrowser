import type { BrowserAction,ToastAction as Action } from '../../runtime/types';
import { formatShortcut } from '../../ui/platform';
import { settingsTargetAction } from '../../ui/settingsView';
import './toast-action.css';
/** The keyboard path for an action, shown beside it: Ctrl+Shift+T reopens the last closed tab or group as a whole. */
const keyHint=(action:Action)=>action.command.type==='tab.restore.batch'?formatShortcut('Ctrl Shift T'):'';
/** The toast's one text action (bible §4 / §8b-5: "Tab closed · Undo"). Never takes focus on appear. */
export function ToastAction({action,dispatch,onDone}:{action?:Action;dispatch:(action:BrowserAction)=>unknown;onDone?:()=>void}){
 if(!action)return null;const hint=keyHint(action);
 return <button type="button" className="toast-action" aria-keyshortcuts={hint?'Control+Shift+T':undefined} onClick={()=>{void dispatch(action.settings?settingsTargetAction(action.command,{setting:action.settings}):action.command);onDone?.();}}>{action.label}{hint&&<kbd aria-hidden>{hint}</kbd>}</button>;
}
/** The key cap shown beside a toast's action (shared with the transient Toast geometry). */
export const toastActionKey=keyHint;
/** Toasts with an action stay 8s, plain ones 4s (bible §4); a notice (the engine cannot do something) stays 12s and has a ×. */
export const toastDuration=(toast:{action?:Action;tone?:string}|null|undefined)=>toast?.tone==='info'?12000:toast?.action?8000:4000;
/** Width for the native overlay toast: text plus room for the action and its key hint. */
export const toastActionWidth=(toast:{action?:Action}|null|undefined)=>toast?.action?28+toast.action.label.length*8+(keyHint(toast.action)?keyHint(toast.action).length*7+14:0):0;
