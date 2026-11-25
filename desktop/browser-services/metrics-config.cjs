'use strict';
// Where the optional anonymous usage message goes. Empty until the write-only endpoint described in docs/launch/METRICS.md is deployed;
// while it is empty nothing can be sent even if the person turned the setting on. This is an address, never a key: the client holds no secret.
// Beta 14 (the Insider build) sends to the usage function of the Insider project, so its counts are Insider counts only; the public
// 13.x builds keep their own address (the acira-usage project) and are not counted here. docs/SUPABASE_SETUP.md section 12.
module.exports = { endpoint: 'https://lzdndhalljkmqabbtruv.supabase.co/functions/v1/usage' };
