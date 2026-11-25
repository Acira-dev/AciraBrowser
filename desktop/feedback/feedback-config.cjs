'use strict';
// Where the Beta 14 feedback messages go: Acira's feedback server: its `report` and `contributor` functions.
// Empty on purpose: the addresses are filled in when the server side is ready. While they are empty the report pop-up's Send is not offered ("Reports are not available in this version") and no
// request is ever made; the marks, ranks and the viewer still show what is on the device. A test profile uses only addresses QA names itself
// (ACIRA_FEEDBACK_REPORT_ENDPOINT, ACIRA_FEEDBACK_CONTRIBUTOR_ENDPOINT, ACIRA_FEEDBACK_DISCORD_INVITE). These are addresses, never keys.
// `discordInvite` is the public invitation to Acira's Discord ("Want to talk to us directly? Join our Discord."): empty until the team give it.
// 16 Nov 2026 (reported: "people get their ranks in Beta 14 right now"): the `feedback` function of Acira's server, and
// Acira's public Discord invitation from the website.
module.exports = {
  reportEndpoint: 'https://lzdndhalljkmqabbtruv.supabase.co/functions/v1/feedback/report',
  contributorEndpoint: 'https://lzdndhalljkmqabbtruv.supabase.co/functions/v1/feedback/contributor',
  discordInvite: 'https://discord.gg/EpBCE4vtzU',
};
