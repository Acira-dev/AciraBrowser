'use strict';
const corrected=new WeakSet();
/** electron-chrome-extensions4.9.0 routes getCurrent to the last active tab.
 * Chrome requires the caller's containing tab, or undefined in popups/workers.
 * No public override is exposed, so this bounded adapter replaces only that
 * pinned handler callback, retaining its native extension/session/permission gates.
 */
function correctCurrentTab(runtime){
 if(!runtime||typeof runtime!=='object')return false;if(corrected.has(runtime))return true;
 const context=runtime.ctx,router=context?.router,store=context?.store;if(!(router?.handlers instanceof Map)||!(store?.tabs instanceof Set))return false;
 const current=router.handlers.get('tabs.getCurrent'),get=router.handlers.get('tabs.get');if(typeof current?.callback!=='function'||typeof get?.callback!=='function')return false;
 router.handlers.set('tabs.getCurrent',{...current,callback:event=>{const sender=event?.sender;if(event?.type!=='frame'||!sender||!store.tabs.has(sender)||sender.session!==context.session||typeof sender.isDestroyed!=='function'||sender.isDestroyed())return undefined;return get.callback(event,sender.id);}});corrected.add(runtime);return true;
}
const currentTabCorrected=runtime=>!!runtime&&corrected.has(runtime);
module.exports={correctCurrentTab,currentTabCorrected};
