'use strict';
// Where "Move or copy this profile to another computer" with a code talks to: the `transfer` Edge Function in the relay's OWN Supabase project, which
// holds only locked bytes and deletes them as soon as the other computer has them. THIS IS THE ONE CONFIGURATION PLACE: the project reference below,
// and nothing else, decides where the app goes. It is a reference, never a key: the app holds no secret. It is empty until the team have created that project and run
// scripts/deploy-transfer.mjs --write, which puts the reference here. While it is empty "Move with a code" says it is not available yet and offers the profile file.
// A test profile (ACIRA_BROWSER_TEST_DATA) never reaches the project: it uses only an address QA names itself in ACIRA_TRANSFER_ENDPOINT, which may be
// plain http on 127.0.0.1 or localhost (the local stand-in, qa/transfer-relay/local-relay.mjs), and has none when QA names none.
const config = { projectRef: 'iyvdsbtbhiibtqrtbwnl' };

/** A Supabase project reference: 20 lowercase letters and digits (Project Settings > General). */
const PROJECT_REF = /^[a-z0-9]{20}$/;
/** The relay's address for a project reference, or '' when the reference is empty or not one. */
const endpointFor = (ref) => (PROJECT_REF.test(String(ref || '')) ? `https://${ref}.supabase.co/functions/v1/transfer` : '');

/** https only (plain http only for a local test server), no credentials, no query string, no fragment. Returns the address, or '' if it is not acceptable. */
function checkedEndpoint(value, { allowLocal = false } = {}) {
  if (!value) return '';
  let url;
  try { url = new URL(value); } catch { return ''; }
  const local = allowLocal && url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !local) || url.username || url.password || url.search || url.hash) return '';
  return url.href.replace(/\/+$/, '');
}

/** The address this process uses: the shipped one, or, in a test profile, only the one QA named. '' means "not available". */
function resolveEndpoint(env = process.env) {
  if (env.ACIRA_BROWSER_TEST_DATA) return checkedEndpoint(env.ACIRA_TRANSFER_ENDPOINT, { allowLocal: true });
  return checkedEndpoint(endpointFor(config.projectRef));
}

module.exports = { projectRef: config.projectRef, endpoint: endpointFor(config.projectRef), configured: Boolean(endpointFor(config.projectRef)), PROJECT_REF, endpointFor, checkedEndpoint, resolveEndpoint };
