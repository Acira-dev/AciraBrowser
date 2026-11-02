// What the API surface probe asks for and calls. Everything comes from the generated Chromium surface
// (desktop/browser-services/extension-api-surface.gen.cjs): the manifest requests every permission Chromium offers Web Store extensions on
// Windows, and the call plan holds only read-only or self-scoped calls with arguments Chromium's schema accepts. Destructive or
// user-visible members (uninstall, browsing-data removal, history/bookmark/download/cookie writes, settings set/clear, tabs/windows
// create/remove, notifications, speech, capture pickers, permission prompts, reloads) are never called; the report only records whether
// they exist.
import {createRequire} from 'node:module';
import {loadFeatures, evaluateFeature} from '../../scripts/gen-extension-api.mjs';
const require = createRequire(import.meta.url);
export const surface = require('../../desktop/browser-services/extension-api-surface.gen.cjs');

/** Every permission a Web Store extension may request on Windows (stable channel, MV3), from Chromium's _permission_features. */
export function allPermissions() {
  const features = loadFeatures();
  return Object.keys(features.permission).filter(name => {
    const result = evaluateFeature(features, 'permission', name);
    return result && result.ok && !result.notes.featureFlag;
  }).sort();
}

const READ = /^(get|query|is|has|contains|search|detect)/;
// Never called (exists-only), even when the name looks like a read.
const NEVER = new Set([
  'identity.getAuthToken', 'instanceID.getID', 'instanceID.getToken', 'instanceID.getCreationTime', 'gcm.register', 'permissions.request',
  'tabCapture.getMediaStreamId', 'desktopCapture.chooseDesktopMedia', 'downloads.getFileIcon', 'pageCapture.saveAsMHTML', 'tabs.captureVisibleTab',
  'runtime.getPackageDirectoryEntry', 'runtime.getBackgroundPage', 'extension.getBackgroundPage', 'search.query', 'debugger.getTargets',
  'dom.openOrClosedShadowRoot', 'declarativeContent.onPageChanged']);
// Calls that take Acira's main process down: exists-only until fixed. (system.storage.getInfo/getAvailableCapacity did until 28 Oct;
// Acira now answers system.storage itself, and every system.* member is called by `run.mjs --only system`.)
export const CRASHES = new Set([]);
for (const path of CRASHES) NEVER.add(path);
// system.* is small and read-mostly: every function is called (setters with harmless schema-built arguments) and every event gets a
// listener, so a native implementation that needs something Electron lacks shows up as a crash in the probe instead of in a user's browser.
const CALL_ALL = /^system\./;
// Calls with explicit, harmless arguments (self-scoped storage, own alarms, bogus native host).
const EXTRA = {
  'storage.local.set': [{aciraProbe: 1}], 'storage.local.get': [null], 'storage.local.remove': ['aciraProbe'], 'storage.local.getBytesInUse': [null],
  'storage.session.set': [{aciraProbe: 1}], 'storage.session.get': [null], 'storage.sync.get': [null], 'storage.sync.set': [{aciraProbe: 1}],
  'storage.managed.get': [null], 'storage.local.getKeys': [], 'storage.session.setAccessLevel': [{accessLevel: 'TRUSTED_CONTEXTS'}],
  'identity.getAuthToken': [{interactive: false}], 'identity.getRedirectURL': ['probe'],
  'runtime.sendNativeMessage': ['com.acira.probe.none', {}], 'runtime.sendMessage': [{probe: 'ping'}], 'runtime.getURL': ['page.html'],
  'runtime.requestUpdateCheck': undefined, 'i18n.getMessage': ['probe'], 'i18n.detectLanguage': ['Hello world, this is plain English text.'],
  'idle.queryState': [60], 'history.search': [{text: '', maxResults: 1}], 'bookmarks.search': ['acira'], 'bookmarks.getRecent': [1],
  'downloads.search': [{limit: 1}], 'management.get': ['__ID__'], 'management.getPermissionWarningsById': ['__ID__'],
  'management.getPermissionWarningsByManifest': ['{"manifest_version":3,"name":"x","version":"1","permissions":["tabs"]}'],
  'cookies.getAll': [{url: 'https://example.com/'}], 'cookies.get': [{url: 'https://example.com/', name: 'probe'}],
  'history.getVisits': [{url: 'https://example.com/'}], 'tabs.query': [{}], 'tabs.get': ['__TAB__'], 'tabs.getZoom': ['__TAB__'],
  'tabs.getZoomSettings': ['__TAB__'], 'tabs.detectLanguage': ['__TAB__'], 'windows.get': ['__WIN__'], 'windows.getAll': [{}],
  'windows.getCurrent': [{populate: true}], 'windows.getLastFocused': [{populate: true}], 'windows.update': ['__WIN__', {}],
  'webNavigation.getAllFrames': [{tabId: '__TAB__'}], 'webNavigation.getFrame': [{tabId: '__TAB__', frameId: 0}],
  'alarms.create': ['acira-probe', {delayInMinutes: 60}], 'alarms.get': ['acira-probe'], 'alarms.clear': ['acira-probe'],
  'contextMenus.removeAll': [], 'commands.getAll': [], 'action.isEnabled': [], 'action.getUserSettings': [], 'notifications.getAll': [], 'notifications.getPermissionLevel': [],
  'action.getBadgeText': [{}], 'action.getTitle': [{}], 'action.getPopup': [{}],
  'action.getBadgeBackgroundColor': [{}], 'action.getBadgeTextColor': [{}], 'action.setBadgeText': [{text: ''}],
  'declarativeNetRequest.getDynamicRules': [], 'declarativeNetRequest.getSessionRules': [], 'declarativeNetRequest.isRegexSupported': [{regex: 'a+'}],
  'declarativeNetRequest.getAvailableStaticRuleCount': [], 'declarativeNetRequest.getEnabledRulesets': [],
  'scripting.getRegisteredContentScripts': [], 'userScripts.getScripts': [], 'sidePanel.getOptions': [{}], 'sidePanel.getPanelBehavior': [],
  'tabGroups.query': [{}], 'readingList.query': [{}], 'sessions.getRecentlyClosed': [{maxResults: 1}], 'sessions.getDevices': [{maxResults: 1}],
  'fontSettings.getFont': [{genericFamily: 'standard'}], 'fontSettings.getDefaultFontSize': [{}], 'fontSettings.getDefaultFixedFontSize': [{}],
  'fontSettings.getMinimumFontSize': [{}], 'privacy.network.webRTCIPHandlingPolicy.get': [{}], 'privacy.services.passwordSavingEnabled.get': [{}],
  'privacy.network.networkPredictionEnabled.get': [{}], 'privacy.services.safeBrowsingEnabled.get': [{}], 'privacy.services.autofillAddressEnabled.get': [{}],
  'privacy.websites.thirdPartyCookiesAllowed.get': [{}], 'proxy.settings.get': [{}], 'contentSettings.cookies.get': [{primaryUrl: 'https://example.com/'}],
  'contentSettings.javascript.get': [{primaryUrl: 'https://example.com/'}], 'accessibilityFeatures.highContrast.get': [{}],
  // permissions / management (P4): harmless self-scoped calls with real arguments; request and uninstall stay uncalled (prompts, removal).
  'permissions.getAll': [], 'permissions.contains': [{permissions: ['tabs'], origins: ['https://example.com/*']}], 'permissions.remove': [{permissions: [], origins: []}],
  'management.getAll': [], 'management.getSelf': [],
  'offscreen.hasDocument': [], 'extension.isAllowedIncognitoAccess': [], 'extension.isAllowedFileSchemeAccess': [], 'extension.getViews': [{}]
};

function lookupType(ref) {
  const cut = ref.lastIndexOf('.');
  const ns = surface.namespaces[ref.slice(0, cut)];
  return ns && ns.types[ref.slice(cut + 1)];
}
/** A minimal value Chromium's schema accepts for a required parameter. */
function sample(spec, name = '', depth = 0) {
  if (depth > 4) return {};
  if (spec.$ref) { const t = lookupType(spec.$ref); return t ? sample(t, name, depth + 1) : {}; }
  if (spec.choices) return sample(spec.choices[0], name, depth + 1);
  if (spec.enum) return spec.enum[0];
  switch (spec.type) {
    case 'integer': return /tabId$/i.test(name) ? '__TAB__' : /windowId$/i.test(name) ? '__WIN__' : spec.minimum > 0 ? spec.minimum : 0;
    case 'number': return 0;
    case 'boolean': return false;
    case 'string': return /url$/i.test(name) ? 'https://example.com/' : /^(id|extensionId)$/.test(name) ? '__ID__' : '';
    case 'array': return [];
    case 'object': {
      const out = {};
      for (const [k, p] of Object.entries(spec.properties || {})) if (!p.optional) out[k] = sample(p, k, depth + 1);
      return out;
    }
    case 'any': return null;
    default: return null;
  }
}
const contextsAllow = (memberFeature, nsContexts, context) => {
  const contexts = memberFeature?.contexts || nsContexts || [];
  if (context === 'content_script') return contexts.includes('content_script');
  return contexts.includes('privileged_extension') || !contexts.length;
};

/** Every function Chromium exposes (namespace functions and methods on namespace properties such as storage.local or ChromeSetting). */
export function chromiumMembers({includeRemoved = false} = {}) {
  const out = [];
  const keep = fn => includeRemoved || !(fn.notOnWindows || fn.feature && fn.feature.ok === false);
  for (const [ns, schema] of Object.entries(surface.namespaces)) {
    if (schema.status === 'types' || schema.status === 'flagged') continue;
    for (const [name, fn] of Object.entries(schema.functions)) if (keep(fn)) out.push({ns, path: `${ns}.${name}`, kind: 'function', fn, contexts: fn.feature?.contexts || schema.contexts});
    for (const [name, ev] of Object.entries(schema.events)) if (keep(ev)) out.push({ns, path: `${ns}.${name}`, kind: 'event', fn: ev, contexts: ev.feature?.contexts || schema.contexts});
    for (const [name, prop] of Object.entries(schema.properties)) {
      if (!keep(prop)) continue;
      const type = prop.$ref && lookupType(prop.$ref);
      if (type && (type.functions || type.events)) {
        for (const m of type.functions || []) out.push({ns, path: `${ns}.${name}.${m.name}`, kind: 'function', fn: m, contexts: schema.contexts, via: prop.$ref});
        for (const e of type.events || []) out.push({ns, path: `${ns}.${name}.${e.name}`, kind: 'event', fn: e, contexts: schema.contexts, via: prop.$ref});
      } else out.push({ns, path: `${ns}.${name}`, kind: 'property', fn: prop, contexts: schema.contexts});
    }
  }
  return out;
}

export function buildPlans({only} = {}) {
  const plans = {service_worker: [], extension_page: [], content_script: []};
  const members = chromiumMembers().filter(m => !only || only.split(',').some(name => m.path.startsWith(name + '.')));
  for (const member of members.filter(m => m.kind === 'event' && CALL_ALL.test(m.path)))
    for (const context of ['service_worker', 'extension_page']) plans[context].push({path: member.path + '.addListener', args: ['__FN__'], async: false});
  for (const member of members.filter(m => m.kind === 'function')) {
    const short = member.path.split('.').at(-1);
    const explicit = Object.prototype.hasOwnProperty.call(EXTRA, member.path);
    if (NEVER.has(member.path) || NEVER.has(member.path.split('.').slice(0, 2).join('.'))) continue;
    if (!explicit && !READ.test(short) && !CALL_ALL.test(member.path)) continue;
    if (explicit && EXTRA[member.path] === undefined) continue;
    if (member.fn.notOnWindows || member.fn.feature?.ok === false) continue;
    const params = member.fn.parameters || [];
    // Optional parameters are left out; Chromium's argument resolution lines the required ones up.
    const args = explicit ? EXTRA[member.path] : params.filter(p => !p.optional).map(p => sample(p, p.name));
    const async = !!member.fn.returns_async;
    const callbackOnly = async && member.fn.returns_async.does_not_support_promises;
    const entry = {path: member.path, args: callbackOnly ? [...args, '__CB__'] : args, async, validate: params.length + (async ? 1 : 0) + 2};
    for (const context of Object.keys(plans)) {
      if (context === 'extension_page' && member.ns === 'storage' && /\.set$/.test(member.path)) continue;
      if (contextsAllow(member.fn.feature, member.contexts, context)) plans[context].push(entry);
    }
  }
  // privacy.network.* / privacy.services.* are groups of ChromeSettings; the member walk stops at the group, so their reads are planned here.
  for (const path of Object.keys(EXTRA).filter(p => /^privacy\..*\.get$/.test(p)))
    if (!only || path.startsWith(only + '.')) for (const context of ['service_worker', 'extension_page']) plans[context].push({path, args: EXTRA[path], async: true, validate: 4});
  return plans;
}
