'use strict';
// A typed address that got https by default used to open over plain http 60 ms after its secure connection failed, with only a toast:
// someone on the network who blocks port 443 could land the person on an http sign-in page. Now the error page asks first; only a site
// this profile already chose opens straight away, and private and Tor tabs never keep the choice (qa/r14-https-fallback.mjs runs it).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const httpsFirst = require('../desktop/browser-services/https-first.cjs');
const root = path.join(__dirname, '..'), read = file => fs.readFileSync(path.join(root, file), 'utf8');

const fakeDatabase = () => { const rows = new Map(); return { rows, policy: (profile, site) => rows.get(profile + '|' + site) ?? null, setPolicy: (profile, site, value) => rows.set(profile + '|' + site, value) }; };
const page = (overrides = {}) => ({ id: 'tab-1', contentKind: 'web', httpsFirst: true, url: 'https://intranet.example:8080/', error: 'ERR_CONNECTION_REFUSED (-102)', browserProfileId: 'default', ...overrides });

test('only the no-secure-connection page of a typed address can offer http', () => {
  assert.equal(httpsFirst.offered(page()), true);
  for (const code of httpsFirst.FALLBACK_CODES) assert.equal(httpsFirst.offered(page({ error: `ERR_X (${code})` })), true, String(code));
  assert.equal(httpsFirst.offered(page({ httpsFirst: undefined })), false, 'an address the person typed with https:// keeps its error');
  assert.equal(httpsFirst.offered(page({ error: 'ERR_CERT_AUTHORITY_INVALID (-202)' })), false, 'certificate errors have their own page');
  assert.equal(httpsFirst.offered(page({ error: 'ERR_NAME_NOT_RESOLVED (-105)' })), false, 'an unknown host is not a blocked port');
  assert.equal(httpsFirst.offered(page({ error: null })), false, 'a page that loaded');
  assert.equal(httpsFirst.offered(page({ url: 'http://intranet.example/' })), false);
  assert.equal(httpsFirst.offered(page({ url: 'https://user:pw@intranet.example/' })), false);
  assert.equal(httpsFirst.offered(page({ contentKind: 'internal' })), false);
  assert.equal(httpsFirst.offered(undefined), false);
});

test('the choice is kept per site for an ordinary profile, never for private windows, private or Tor tabs, or private profiles', () => {
  const database = fakeDatabase();
  assert.equal(httpsFirst.allowed(database, 'default', 'intranet.example:8080'), false);
  database.setPolicy('default', 'http://intranet.example:8080', { aiContent: false });
  assert.equal(httpsFirst.remember(database, 'default', 'Intranet.Example:8080'), true);
  assert.deepEqual(database.policy('default', 'http://intranet.example:8080'), { aiContent: false, httpFallback: true }, 'other choices for the site stay');
  assert.equal(httpsFirst.allowed(database, 'default', 'intranet.example:8080'), true);
  assert.equal(httpsFirst.allowed(database, 'work', 'intranet.example:8080'), false, 'another profile asks for itself');
  assert.equal(httpsFirst.allowed(database, 'default', 'intranet.example'), false, 'another port is another site');
  assert.equal(httpsFirst.remembers(page()), true);
  assert.equal(httpsFirst.remembers(page(), { privateMode: true }), false);
  assert.equal(httpsFirst.remembers(page(), { torMode: true }), false);
  assert.equal(httpsFirst.remembers(page({ privacy: 'private' })), false);
  assert.equal(httpsFirst.remembers(page({ privacy: 'tor' })), false);
  assert.equal(httpsFirst.remembers(page(), { profile: { private: true } }), false);
  assert.equal(httpsFirst.remembers(page({ browserProfileId: 'private-1' })), false);
  assert.equal(httpsFirst.allowed({ policy() { throw new Error('closed'); } }, 'default', 'x'), false, 'a closed database never allows http');
});

test('main opens http by itself only for a site this profile chose, and the error page\'s service checks the page and the profile', () => {
  const main = read('desktop/main.cjs');
  const start = main.indexOf("wc.on('did-fail-load',(_event,code,_description,failedURL,isMainFrame)=>{const httpsFirst=");
  assert.ok(start > 0, 'the failed-load handler uses https-first.cjs');
  const handler = main.slice(start, main.indexOf('},60);});', start));
  const navigate = handler.indexOf("dispatch({type:'tab.navigate',tabId:tab.id,url:'http://'");
  assert.ok(navigate > 0);
  assert.ok(handler.indexOf('httpsFirst.allowed(database,current.browserProfileId,siteHost))return;') > 0 && handler.indexOf('httpsFirst.allowed(') < navigate, 'nothing opens over http unless the profile chose it');
  assert.ok(handler.indexOf('httpsFirst.remembers(current,') < navigate, 'private and Tor tabs never follow a kept choice');
  assert.equal((main.match(/url:'http:\/\/'\+/g) || []).length, 2, 'two places open http: the kept choice and the error page\'s button');
  const service = main.slice(main.indexOf("case 'https.allow-http':"), main.indexOf("case 'threats.status':"));
  assert.match(service, /if\(!httpsFirst\.offered\(tab\)\|\|!wc\|\|wc\.isDestroyed\(\)\)throw new Error/);
  assert.match(service, /if\(httpsFirst\.remembers\(tab,\{privateMode,torMode,profile:/);
  assert.doesNotMatch(main, /\[-100,-101,-102,-103,-104,-107,-113,-118,-324\]\.includes/, 'the old inline fallback is gone');
});

test('the error page asks with Go back first, and both sides keep the same list of errors', () => {
  const view = read('src/components/NavigationError.tsx'), failure = read('src/ui/navigationFailure.ts');
  assert.match(view, /goBackFirst=certificateError\|\|threatError\|\|httpOffer/);
  assert.match(view, /runtime\.service\(\{type:'https\.allow-http',tabId:tab\.id\}\)/);
  assert.match(view, /\{httpOffer&&<div className="ne-unsafe">\n\s*\{!armed\?<button type="button" className="ne-link" data-danger onClick=\{\(\)=>setArmed\(true\)\}>\{t\('error\.http\.continue'\)\}/, 'two steps: the link, then the warning and the button');
  const list = /SECURE_CONNECTION_CODES:readonly number\[\]=\[([^\]]+)\]/.exec(failure)[1].split(',').map(Number);
  assert.deepEqual(list, [...httpsFirst.FALLBACK_CODES]);
  const en = JSON.parse(read('src/i18n/en.json'));
  for (const file of fs.readdirSync(path.join(root, 'src', 'i18n')).filter(name => name.endsWith('.json') && name !== 'converted.json')) {
    const catalog = JSON.parse(read('src/i18n/' + file));
    for (const key of ['error.http.title', 'error.http.message', 'error.http.continue', 'error.http.group', 'error.http.warning', 'error.http.note', 'error.http.noteStrict']) {
      assert.equal(typeof catalog[key], 'string', `${file} ${key}`);
      if (file !== 'en.json') assert.notEqual(catalog[key], en[key], `${file} ${key} is translated`);
      if (/\{host\}/.test(en[key])) assert.match(catalog[key], /\{host\}/, `${file} ${key} keeps {host}`);
    }
  }
});

test('with strict HTTPS-only mode on, the error page is the one question: its answer is strict mode\'s too, and a kept choice never skips it', () => {
  // Before: "Continue over http" opened http, strict mode upgraded it again and asked its own question (two in a row); a kept choice opened http
  // by itself, and strict mode asked anyway. https-only.cjs's grantHTTP has the behaviour tests (tests/services-https-only.test.cjs);
  // qa/r14-https-strict.mjs runs it in the app.
  const main = read('desktop/main.cjs'), view = read('src/components/NavigationError.tsx');
  const start = main.indexOf("wc.on('did-fail-load',(_event,code,_description,failedURL,isMainFrame)=>{const httpsFirst=");
  const handler = main.slice(start, main.indexOf('},60);});', start));
  assert.ok(handler.indexOf('if(contentBlocking?.https.active(wc))return;') > 0 && handler.indexOf('if(contentBlocking?.https.active(wc))return;') < handler.indexOf("dispatch({type:'tab.navigate'"), 'strict mode stops a kept choice from opening http by itself');
  const service = main.slice(main.indexOf("case 'https.allow-http':"), main.indexOf("case 'threats.status':"));
  const grant = service.indexOf("if(contentBlocking.https.active(wc))contentBlocking.https.grantHTTP(wc,'http://'+tab.url.slice(8));else if(httpsFirst.remembers(");
  assert.ok(grant > 0, 'strict mode gets the answer, and only an ordinary run keeps the choice');
  assert.ok(grant < service.indexOf("dispatch({type:'tab.navigate'"), 'the exception is there before http loads');
  assert.match(service, /if\(!httpsFirst\.offered\(tab\)\|\|!wc\|\|wc\.isDestroyed\(\)\)throw new Error/, 'only the live error page can ask');
  assert.match(view, /runtime\.service\(\{type:'https\.status',tabId:tab\.id\}\)\.then\(result=>\{if\(alive\)setStrictHttps\(result\.https\?\.enabled===true\);/);
  assert.match(view, /\{strictHttps\?t\('error\.http\.noteStrict'\):t\('error\.http\.note'\)\}/, 'the note says the page asks again next time');
});
