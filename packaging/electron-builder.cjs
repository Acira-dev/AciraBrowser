'use strict';
// electron-builder entry point: unsigned unless signing environment variables are set (see signing-config.cjs and docs/launch/CODE_SIGNING.md).
module.exports=require('./signing-config.cjs').createConfig();
