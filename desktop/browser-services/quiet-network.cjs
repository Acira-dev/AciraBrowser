'use strict';
// QA only: ACIRA_TEST_QUIET_NETWORK=1 on a disposable test profile (ACIRA_BROWSER_TEST_DATA) keeps Acira's own scheduled
// downloads from starting (the filter and threat lists, refreshed 6 s and 30 s after launch, then every 6 hours), so a packet
// capture (qa/r9-tor-packets.mjs) sees what Tor does alone. Everything a page or the person starts still runs. Ignored without
// a test profile: an installed Acira can never be quietened by its environment.
function quietNetwork(env=process.env){return Boolean(env.ACIRA_BROWSER_TEST_DATA)&&env.ACIRA_TEST_QUIET_NETWORK==='1';}
// QA only: a QA run (ACIRA_QA_RUN=1, which every qa/ rig sets) cannot reach Google's search and sign-in pages or YouTube.
// Automated runs carry navigator.webdriver=true, and this PC has one address, so what QA does to Google lands on the founder's own
// browsing too. Rigs use local fixtures. A rig's own --host-resolver-rules wins (a fixture mapped to www.google.com), and
// ACIRA_QA_LIVE_GOOGLE=1 is the deliberate opt-in. Extension store and update hosts stay open. A test profile alone is not QA: the
// preview and "npm start" run on one (ACIRA_BROWSER_TEST_DATA), and the person browsing there must reach every site. Ignored without
// a test profile, so an installed Acira can never be restricted by its environment.
const LIVE_GOOGLE_HOSTS=Object.freeze(['google.com','www.google.com','accounts.google.com','consent.google.com','myaccount.google.com','mail.google.com','youtube.com','www.youtube.com','m.youtube.com','accounts.youtube.com']);
function qaRun(env=process.env){return Boolean(env.ACIRA_BROWSER_TEST_DATA)&&env.ACIRA_QA_RUN==='1';}
function qaHostRules(env=process.env){return qaRun(env)&&env.ACIRA_QA_LIVE_GOOGLE!=='1'?LIVE_GOOGLE_HOSTS.map(host=>`MAP ${host} ~NOTFOUND`).join(', '):'';}
module.exports={quietNetwork,qaRun,qaHostRules,LIVE_GOOGLE_HOSTS};
