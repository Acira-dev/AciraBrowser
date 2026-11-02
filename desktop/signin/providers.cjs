'use strict';
// Sign-in providers: one account often covers many sites (Google covers YouTube, Gmail, Drive, Maps), so the "Sign back in"
// checklist shows one row per account, not one per site. Each entry lists the registrable domains it owns, the official
// sign-in page, the services it covers (name + host) and, where the site has a recognisable session cookie, its name.
// Nothing here is ever sent anywhere: it only helps this computer turn a browsing history into a short list.

/** [name, host]: a service of the account, matched by host or any subdomain of it. */
const covers = (...pairs) => pairs.map(([name, host]) => ({ name, host }));

const PROVIDERS = [
  {
    id: 'google',
    name: 'Google',
    signIn: 'https://accounts.google.com/signin',
    domains: ['google.com', 'youtube.com', 'gmail.com', 'googleusercontent.com', 'blogger.com', 'withgoogle.com'],
    // google.co.uk, google.de, ...
    labels: ['google'],
    covers: covers(['YouTube', 'youtube.com'], ['Gmail', 'mail.google.com'], ['Gmail', 'gmail.com'], ['Drive', 'drive.google.com'], ['Maps', 'maps.google.com'], ['Docs', 'docs.google.com'], ['Photos', 'photos.google.com'], ['Calendar', 'calendar.google.com']),
    cookieDomains: ['google.com', 'youtube.com'],
    session: /^(SID|HSID|SSID|APISID|SAPISID|LSID|__Secure-(1|3)PSID|__Secure-(1|3)PAPISID|__Host-GAPS)$/,
    pin: 3,
  },
  {
    id: 'microsoft',
    name: 'Microsoft',
    signIn: 'https://login.live.com/',
    domains: ['microsoft.com', 'live.com', 'outlook.com', 'office.com', 'microsoftonline.com', 'office365.com', 'xbox.com', 'skype.com', 'msn.com', 'hotmail.com', 'sharepoint.com', 'onedrive.com', 'azure.com'],
    covers: covers(['Outlook', 'outlook.live.com'], ['Outlook', 'outlook.office.com'], ['Outlook', 'outlook.com'], ['OneDrive', 'onedrive.live.com'], ['Office', 'office.com'], ['Teams', 'teams.microsoft.com'], ['Xbox', 'xbox.com']),
    cookieDomains: ['live.com', 'microsoft.com', 'microsoftonline.com', 'office.com', 'outlook.com'],
    session: /^(ESTSAUTH|ESTSAUTHPERSISTENT|ESTSAUTHLIGHT|MSPAuth|MSPProf|WLSSC|RPSSecAuth|ANON|NAP)$/,
    pin: 2,
  },
  {
    id: 'apple',
    name: 'Apple',
    signIn: 'https://appleid.apple.com/sign-in',
    domains: ['apple.com', 'icloud.com'],
    covers: covers(['iCloud', 'icloud.com'], ['Apple Music', 'music.apple.com'], ['App Store Connect', 'appstoreconnect.apple.com']),
    cookieDomains: ['apple.com', 'icloud.com'],
    session: /^(myacinfo|acn01|aasp|DSID|X-APPLE-WEBAUTH-USER|X-APPLE-WEBAUTH-TOKEN)$/,
    pin: 1,
  },
  { id: 'github', name: 'GitHub', signIn: 'https://github.com/login', domains: ['github.com'], covers: covers(['Gists', 'gist.github.com']), session: /^(user_session|__Host-user_session_same_site|logged_in)$/ },
  { id: 'gitlab', name: 'GitLab', signIn: 'https://gitlab.com/users/sign_in', domains: ['gitlab.com'], session: /^(_gitlab_session|remember_user_token)$/ },
  {
    id: 'amazon',
    name: 'Amazon',
    // The sign-in page is the shop the person uses (amazon.co.uk, amazon.de, ...): {domain} is its own address.
    signIn: 'https://www.{domain}/ap/signin',
    domains: ['amazon.com'],
    labels: ['amazon'],
    covers: covers(['Prime Video', 'primevideo.com'], ['Audible', 'audible.com'], ['Kindle', 'read.amazon.com']),
    session: /^(at-main|sess-at-main|x-main|sst-main|session-token)$/,
  },
  { id: 'aws', name: 'Amazon Web Services', signIn: 'https://signin.aws.amazon.com/', domains: ['aws.amazon.com', 'console.aws.amazon.com', 'signin.aws.amazon.com', 'awsapps.com'], session: /^(aws-userInfo|aws-creds|noflush_awsccs_sc)$/ },
  { id: 'facebook', name: 'Facebook', signIn: 'https://www.facebook.com/login', domains: ['facebook.com', 'fb.com', 'messenger.com', 'fbcdn.net'], covers: covers(['Messenger', 'messenger.com']), session: /^(c_user|xs)$/ },
  { id: 'instagram', name: 'Instagram', signIn: 'https://www.instagram.com/accounts/login/', domains: ['instagram.com'], covers: covers(['Threads', 'threads.net']), session: /^(sessionid|ds_user_id)$/ },
  { id: 'whatsapp', name: 'WhatsApp', signIn: 'https://web.whatsapp.com/', domains: ['whatsapp.com'] },
  { id: 'x', name: 'X', signIn: 'https://x.com/i/flow/login', domains: ['x.com', 'twitter.com'], session: /^(auth_token|twid)$/ },
  { id: 'linkedin', name: 'LinkedIn', signIn: 'https://www.linkedin.com/login', domains: ['linkedin.com'], session: /^(li_at|JSESSIONID)$/ },
  { id: 'reddit', name: 'Reddit', signIn: 'https://www.reddit.com/login', domains: ['reddit.com'], session: /^(reddit_session|token_v2)$/ },
  { id: 'pinterest', name: 'Pinterest', signIn: 'https://www.pinterest.com/login/', domains: ['pinterest.com'], session: /^(_pinterest_sess)$/ },
  { id: 'tumblr', name: 'Tumblr', signIn: 'https://www.tumblr.com/login', domains: ['tumblr.com'] },
  { id: 'tiktok', name: 'TikTok', signIn: 'https://www.tiktok.com/login', domains: ['tiktok.com'], session: /^(sessionid|sid_tt|sid_guard)$/ },
  { id: 'discord', name: 'Discord', signIn: 'https://discord.com/login', domains: ['discord.com', 'discordapp.com'] },
  { id: 'slack', name: 'Slack', signIn: 'https://slack.com/signin', domains: ['slack.com'], session: /^(d|d-s)$/ },
  { id: 'zoom', name: 'Zoom', signIn: 'https://zoom.us/signin', domains: ['zoom.us'] },
  { id: 'notion', name: 'Notion', signIn: 'https://www.notion.so/login', domains: ['notion.so', 'notion.com'], session: /^(token_v2|notion_user_id)$/ },
  { id: 'figma', name: 'Figma', signIn: 'https://www.figma.com/login', domains: ['figma.com'] },
  { id: 'canva', name: 'Canva', signIn: 'https://www.canva.com/login', domains: ['canva.com'] },
  { id: 'adobe', name: 'Adobe', signIn: 'https://account.adobe.com/', domains: ['adobe.com'] },
  { id: 'dropbox', name: 'Dropbox', signIn: 'https://www.dropbox.com/login', domains: ['dropbox.com'], session: /^(jar|lid)$/ },
  { id: 'atlassian', name: 'Atlassian', signIn: 'https://id.atlassian.com/login', domains: ['atlassian.com', 'atlassian.net', 'trello.com', 'bitbucket.org'], covers: covers(['Jira', 'atlassian.net'], ['Trello', 'trello.com'], ['Bitbucket', 'bitbucket.org']), session: /^(cloud\.session\.token|atl\.xsrf\.token)$/ },
  { id: 'stackexchange', name: 'Stack Overflow', signIn: 'https://stackoverflow.com/users/login', domains: ['stackoverflow.com', 'stackexchange.com', 'superuser.com', 'serverfault.com', 'askubuntu.com'] },
  { id: 'cloudflare', name: 'Cloudflare', signIn: 'https://dash.cloudflare.com/login', domains: ['cloudflare.com'] },
  { id: 'vercel', name: 'Vercel', signIn: 'https://vercel.com/login', domains: ['vercel.com'] },
  { id: 'npm', name: 'npm', signIn: 'https://www.npmjs.com/login', domains: ['npmjs.com'] },
  { id: 'stripe', name: 'Stripe', signIn: 'https://dashboard.stripe.com/login', domains: ['stripe.com'] },
  { id: 'paypal', name: 'PayPal', signIn: 'https://www.paypal.com/signin', domains: ['paypal.com'], session: /^(LANDING_PAGE|X-PP-SILOVER|nsid)$/ },
  { id: 'ebay', name: 'eBay', signIn: 'https://signin.ebay.com/', domains: ['ebay.com'], labels: ['ebay'] },
  { id: 'etsy', name: 'Etsy', signIn: 'https://www.etsy.com/signin', domains: ['etsy.com'] },
  { id: 'netflix', name: 'Netflix', signIn: 'https://www.netflix.com/login', domains: ['netflix.com'], session: /^(NetflixId|SecureNetflixId)$/ },
  { id: 'spotify', name: 'Spotify', signIn: 'https://accounts.spotify.com/login', domains: ['spotify.com'], session: /^(sp_dc|sp_key)$/ },
  { id: 'disney', name: 'Disney+', signIn: 'https://www.disneyplus.com/login', domains: ['disneyplus.com'] },
  { id: 'twitch', name: 'Twitch', signIn: 'https://www.twitch.tv/login', domains: ['twitch.tv'], session: /^(auth-token|unique_id)$/ },
  { id: 'yahoo', name: 'Yahoo', signIn: 'https://login.yahoo.com/', domains: ['yahoo.com'], session: /^(T|Y|A3)$/ },
  { id: 'proton', name: 'Proton', signIn: 'https://account.proton.me/login', domains: ['proton.me', 'protonmail.com'] },
  { id: 'wordpress', name: 'WordPress', signIn: 'https://wordpress.com/log-in', domains: ['wordpress.com'] },
  { id: 'medium', name: 'Medium', signIn: 'https://medium.com/m/signin', domains: ['medium.com'] },
  { id: 'salesforce', name: 'Salesforce', signIn: 'https://login.salesforce.com/', domains: ['salesforce.com', 'force.com'] },
  { id: 'airbnb', name: 'Airbnb', signIn: 'https://www.airbnb.com/login', domains: ['airbnb.com'], labels: ['airbnb'] },
  { id: 'booking', name: 'Booking.com', signIn: 'https://account.booking.com/sign-in', domains: ['booking.com'] },
];

// Sites that never need a person to sign in, or are shared hosts where a domain is not one account.
const NEVER = new Set([
  'wikipedia.org', 'wikimedia.org', 'wiktionary.org', 'wikihow.com', 'duckduckgo.com', 'bing.com', 'ecosia.org', 'startpage.com', 'brave.com', 'example.com', 'example.org',
  'github.io', 'gitlab.io', 'netlify.app', 'vercel.app', 'pages.dev', 'workers.dev', 'herokuapp.com', 'blogspot.com', 'web.app', 'firebaseapp.com', 'localhost',
]);

// Second-level suffixes where the registrable domain has three labels (example.co.uk). Not the full public suffix list: it
// only needs to be right for the sites a person actually uses, and a miss just groups two sub-sites separately.
const SECOND_LEVEL = new Set(['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'co.jp', 'ne.jp', 'or.jp', 'co.kr', 'co.in', 'com.br', 'com.mx', 'com.ar', 'com.tr', 'com.cn', 'com.hk', 'com.sg', 'com.tw', 'co.za', 'com.ua', 'com.pl', 'co.il', 'com.sa', 'com.eg', 'co.id']);

module.exports = { PROVIDERS, NEVER, SECOND_LEVEL };
