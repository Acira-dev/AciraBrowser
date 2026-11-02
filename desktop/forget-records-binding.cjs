const {prepareForgetRecords,commitForgetRecords}=require('./browser-services/forget-site.cjs');

function createForgetRecordsBinding({database,controllers,getOwner}) {
  function live(scope) {
    const owner=getOwner();
    if (!owner || owner.privateMode!==scope.privateMode) throw Error('The local browsing scope changed.');
    const candidates=scope.privateMode?[owner]:[...controllers].filter(item=>!item.privateMode);
    return candidates.filter(item=>item.state.browserProfiles.some(profile=>profile.id===scope.profileId))
      .map(item=>({id:item.windowId,snapshot:item.state}));
  }
  return {
    preview(scope) { return prepareForgetRecords(scope.privateMode?null:database,live(scope),scope.profileId,scope.origin).counts; },
    commit(scope) {
      const windows=live(scope),plan=scope.privateMode
        ?prepareForgetRecords(null,windows,scope.profileId,scope.origin)
        :commitForgetRecords(database,windows,scope.profileId,scope.origin);
      // Apply every committed live state before publishing shared history; saved-only windows
      // already changed in the service transaction and must never become live controllers.
      const changed=[];
      for (const item of plan.windows) {
        const controller=[...controllers].find(candidate=>candidate.windowId===item.id&&candidate.privateMode===scope.privateMode);
        if(controller){controller.replaceRecords(item.snapshot);changed.push(controller);}
      }
      for(const controller of changed)controller.publishRecords();
      return {counts:plan.counts,filesDeleted:false};
    }
  };
}
module.exports={createForgetRecordsBinding};
