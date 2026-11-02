'use strict';
// Apple requires a numeric build version that advances on each distribution.
// Keep it independent of the Windows version and of prerelease marketing text.
function macBuildVersion(date=new Date()){
 if(!(date instanceof Date)||!Number.isFinite(date.getTime()))throw Error('A valid Mac build date is required.');
 const value=date.toISOString().slice(0,19).replace(/\D/g,'');
 if(!/^\d{14}$/.test(value))throw Error('Mac build version must be a numeric UTC timestamp.');
 return value;
}
module.exports={macBuildVersion};
