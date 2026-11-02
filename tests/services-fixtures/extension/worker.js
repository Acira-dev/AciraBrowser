chrome.contextMenus.create({id:'fixture-action',title:'Acira fixture extension action',contexts:['page','selection']});
chrome.contextMenus.onClicked.addListener(async()=>{await chrome.storage.local.set({contextClicked:true});});
chrome.runtime.onMessage.addListener((message,_sender,reply)=>{
 if(message?.type==='qualify'){
  Promise.all([chrome.tabs.query({}),chrome.storage.local.get('visits')]).then(async([tabs,value])=>{const visits=(value.visits||0)+1;await chrome.storage.local.set({visits});reply({visits,tabs:tabs.length,apis:{tabs:typeof chrome.tabs.query,storage:typeof chrome.storage.local.get,contextMenus:typeof chrome.contextMenus.create,scripting:typeof chrome.scripting?.executeScript}});});return true;
 }
});
