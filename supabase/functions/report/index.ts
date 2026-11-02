// @ts-nocheck
// Supabase Edge Function `report`: the write-only endpoint for "Report a problem with this site". See docs/SUPABASE_SETUP.md.
// JWT verification is off (supabase/config.toml and --no-verify-jwt): the app holds no key, so the function must accept unsigned calls.
// Its safety is the strict schema, the 4 KB limit and the rate limits in handler.mjs; it writes with the service role key that
// the platform provides to the function, which never leaves the server. ACIRA_USAGE_SALT (the same random function secret the usage
// function uses) salts the daily address hash used only for rate limiting; without it the service role key is the salt.
import { createHandler } from './handler.mjs';
import { restStore } from './store.mjs';

const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const salt = Deno.env.get('ACIRA_USAGE_SALT') || key;
Deno.serve(createHandler({ store: restStore({ url: Deno.env.get('SUPABASE_URL'), key }), secret: salt }));
