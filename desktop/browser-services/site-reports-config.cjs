'use strict';
// Where "Report a problem with this site" sends a report (write-only) and where the reviewed allow-list is read (read-only). Both are Supabase Edge
// Functions in Acira's own project (supabase/functions/report, supabase/functions/allowlist). Empty until scripts/deploy-site-reports.mjs --write has
// deployed them: while a value is empty the report row is not offered and no allow-list is fetched. These are addresses, never keys.
module.exports = { reportEndpoint: 'https://kqioquxkyprnaupqocnx.supabase.co/functions/v1/report', allowlistEndpoint: 'https://kqioquxkyprnaupqocnx.supabase.co/functions/v1/allowlist' };
