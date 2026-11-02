'use strict';
const {createInitialState,persistedSnapshot}=require('../runtime.cjs');

/** Cleanup also visits older partial rows. Supply missing schema fields before using the same public serializer as
 * the normal window save. Only the SQL payload uses this copy; live cleanup plans retain their temporary tabs. */
function storedWindowSnapshot(snapshot){
 const base=createInitialState();
 return persistedSnapshot({...base,...snapshot,windowUi:{...base.windowUi,...snapshot.windowUi}});
}
module.exports={storedWindowSnapshot};
