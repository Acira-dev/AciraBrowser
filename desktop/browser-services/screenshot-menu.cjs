'use strict';
// Beta 14: the page right-click menu's screenshot rows: "Take screenshot" with Area, Visible page and Full page under it (the same heading-and-rows layout an extension's submenu has).
// Registered through the page-menu hook (context-commands.cjs registerPageMenu); each row asks main for the screenshot of the page that was clicked.
const {registerPageMenu}=require('./context-commands.cjs');
const KINDS=[['area','screenshot.area'],['visible','screenshot.visible'],['full','screenshot.full']];
function rows(ctx){
 if(ctx.owner.preview)return [];   // a Link preview's own page is not a tab: no screenshot of it
 return [{id:'screenshot',label:ctx.tr('pagemenu.screenshot'),submenu:KINDS.map(([kind,label])=>ctx.item('screenshot-'+kind,ctx.tr(label),()=>ctx.command({type:'screenshot',tabId:ctx.tabId,kind})))}];
}
const off=registerPageMenu({id:'screenshot',slot:'page',rows});
module.exports={rows,KINDS,off};
