// @ts-nocheck
// Supabase Edge Function `allowlist`: the read-only list of hosts the team cleared after reviewing site reports. See docs/SUPABASE_SETUP.md.
// JWT verification is off (supabase/config.toml and --no-verify-jwt): the app holds no key, and the answer is public (host names only).
// It reads with the service role key that the platform provides to the function, which never leaves the server.
import { createHandler } from './handler.mjs';
import { restStore } from './store.mjs';

const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
Deno.serve(createHandler({ store: restStore({ url: Deno.env.get('SUPABASE_URL'), key }) }));
