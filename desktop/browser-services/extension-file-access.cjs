'use strict';
// "Allow access to file URLs" (Settings › Extensions): Chrome's per-extension switch, off by default.
//
// Ported from Chromium (BSD-3-Clause), the files read:
//   extensions/browser/extension_util.cc               AllowFileAccess(): the extension's pref `newAllowFileAccess`, default false
//   extensions/browser/extension_prefs.cc              kPrefAllowFileAccess, AllowFileAccess / SetAllowFileAccess
//   chrome/browser/extensions/extension_util.cc        SetAllowFileAccess(): nothing happens when the value is the same; else the pref is written and the extension is
//                                                      reloaded, EVEN IF IT IS TURNED OFF, "to make sure file access is reinitialized correctly"
//   extensions/common/extension.h                      Extension::ALLOW_FILE_ACCESS creation flag ("permissions and content scripts that match file:/// URLs will be
//                                                      filtered out" without it) and wants_file_access()
//   extensions/common/manifest_handlers/permissions_parser.cc  ParseHostPermissions(): wants_file_access is set by activeTab and by any host pattern that matches file:
//   extensions/common/manifest_handlers/content_scripts_handler.cc  a content script whose matches reach file: sets it as well
//   extensions/common/url_pattern.cc                   MatchesScheme(): only <all_urls> and an explicit file: pattern reach file: ("*" narrows to http and https)
//   chrome/browser/extensions/api/developer_private/extension_info_generator.cc  file_access.is_enabled = wants_file_access (the switch is shown only then),
//                                                      file_access.is_active = AllowFileAccess
//   extensions/browser/extension_util.cc               InitializeFileSchemeAccessForExtension(): with the pref on, the extension's process may request file: (its pages fetch / XHR it)
// Electron's session.extensions.loadExtension({allowFileAccess}) is Chromium's ALLOW_FILE_ACCESS creation flag; the manager passes it at every load.

const ALL_URLS = '<all_urls>';

const strings = value => (Array.isArray(value) ? value.filter(item => typeof item === 'string') : []);

/** Chromium's URLPattern::Parse + MatchesScheme("file"): <all_urls>, or a pattern whose scheme is file. "*://" does not reach file: (URLPattern::SetScheme). */
function patternMatchesFileScheme(text) {
  const pattern = String(text == null ? '' : text).trim();
  if (pattern === ALL_URLS) return true;
  let end = pattern.indexOf('://');
  if (end < 0) end = pattern.indexOf(':');
  if (end <= 0) return false;
  return pattern.slice(0, end).toLowerCase() === 'file';
}

/**
 * Chromium's Extension::wants_file_access(): does the manifest ask for something file: URLs would be part of? activeTab (a person should be able to enable file access for
 * it), a host permission (required or optional, MV3 host_permissions or an MV2 permissions entry) matching file:, or a content script matching file:.
 */
function wantsFileAccess(manifest) {
  const m = manifest && typeof manifest === 'object' ? manifest : {};
  const apis = [...strings(m.permissions), ...strings(m.optional_permissions)];
  if (apis.includes('activeTab')) return true;
  for (const pattern of [...apis, ...strings(m.host_permissions), ...strings(m.optional_host_permissions)]) if (patternMatchesFileScheme(pattern)) return true;
  for (const script of Array.isArray(m.content_scripts) ? m.content_scripts : []) for (const pattern of strings(script && script.matches)) if (patternMatchesFileScheme(pattern)) return true;
  return false;
}

/** util::AllowFileAccess for a saved registry entry: the person's choice, false until made. */
const fileAccessOf = entry => !!entry && entry.fileAccess === true;

/** The ids of a profile's saved extensions whose switch is on (what the extension worlds are told: chrome.extension.isAllowedFileSchemeAccess). */
const fileAccessIds = (saved, profileId) => saved.filter(entry => entry.profileId === profileId && entry.fileAccess === true).map(entry => entry.id);

module.exports = { ALL_URLS, patternMatchesFileScheme, wantsFileAccess, fileAccessOf, fileAccessIds };
