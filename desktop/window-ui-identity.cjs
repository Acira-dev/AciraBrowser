'use strict';
const {randomUUID}=require('node:crypto');
/** Renderer routing lives for one process only. Database/Rewind window IDs keep their existing stable identity. */
const createWindowUiIdentity=(lifetime=randomUUID())=>windowId=>`${lifetime}:${windowId}`;
module.exports={createWindowUiIdentity};
