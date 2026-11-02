const { tm } = require('./tm.cjs');
function createChromeEditMenu({Menu,clipboard,getWindow,getTab,navigate}){
 return async function popup(contents,params){
  if(contents.isDestroyed()||!params.isEditable&&!params.selectionText)return;
  const frame=params.frame||contents.mainFrame,tab=getTab(),url=contents.getURL();
  const valid=()=>!contents.isDestroyed()&&contents.getURL()===url&&getTab()?.id===tab?.id&&!frame.isDestroyed();
  const edit=params.editFlags||{},items=[];
  for(const [label,method,flag]of [['Undo','undo','canUndo'],['Redo','redo','canRedo'],['Cut','cut','canCut'],['Copy','copy','canCopy'],['Paste','paste','canPaste'],['Paste as plain text','pasteAndMatchStyle','canPaste'],['Select all','selectAll','canSelectAll']]){
   if(!params.isEditable&&!['copy','selectAll'].includes(method))continue;
   items.push({label,enabled:!!edit[flag],click:()=>{if(valid())contents[method]();}});
  }
  const address=params.isEditable&&await contents.executeJavaScript("Boolean(document.activeElement?.matches('.address-bar input'))").catch(()=>false);
  if(address)items.push({type:'separator'},{label:tm("chromeEditMenu.pasteAndGo"),click:()=>{if(!valid())return;const text=clipboard.readText().trim();if(text&&text.length<=4096)navigate(tab.id,text);}});
  if(valid())Menu.buildFromTemplate(items).popup({window:getWindow(),frame,sourceType:params.menuSourceType});
 };
}
module.exports={createChromeEditMenu};
