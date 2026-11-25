'use strict';
// A Chromium browser's open tabs, read from its session files (Opera, Opera GX and Vivaldi keep their workspaces' tabs there).
// Chromium writes every open window and tab as an append-only log in <profile>/Sessions/Session_<time> ("SNSS", format
// components/sessions/core/command_storage_backend.cc): an 8-byte header (the letters SNSS and a version), then commands, each
// a little-endian uint16 size (id byte included), a uint8 id and the payload. Replaying the commands gives the tabs that are
// open now, in their windows and order, with each tab's navigation history and pinned state.
//
// Opera and Vivaldi attach their own data to a tab (the workspace a tab is in, a Vivaldi tab stack) as "extra data":
// command 33, a tab id plus a text key plus a text value. The key names are the browser's own and not documented, so this
// module hands back every extra value it finds for a tab, whatever the key or command, and the caller looks for what it knows.
//
// Only read, never written. Version 5 files are encrypted with the browser's key in the system keychain: they are reported
// (code SNSS_ENCRYPTED) and left alone, so reading never asks the keychain for anything.
const fs = require('node:fs'), path = require('node:path');

const SIGNATURE = 0x53534e53;
const MAX_FILE = 64e6;
const MAX_COMMANDS = 2e6;
const MAX_TABS = 20000;

const COMMAND = Object.freeze({
  setTabWindow: 0,
  setTabIndexInWindow: 2,
  prunedFromBack: 5,
  updateTabNavigation: 6,
  setSelectedNavigationIndex: 7,
  setSelectedTabInIndex: 8,
  setWindowType: 9,
  prunedFromFront: 11,
  setPinnedState: 12,
  tabClosed: 16,
  windowClosed: 17,
  pruned: 24,
  addTabExtraData: 33,
  marker: 255,
});
/** Every command id Chromium itself defines (command_storage / session_service_commands.cc). Anything else is a browser's own. */
const KNOWN = new Set([0, 2, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 23, 24, 25, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 255]);

function failure(message, code) {
  return Object.assign(new Error(message), { code });
}

/** The commands of one session file: [{id, data}]. A cut-off last command (the browser is writing) is ignored. */
function readCommands(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) throw failure('Not a session file.', 'SNSS_INVALID');
  if (buffer.readUInt32LE(0) !== SIGNATURE) throw failure('Not a session file.', 'SNSS_INVALID');
  const version = buffer.readInt32LE(4);
  if (version === 5) throw failure('The session file is encrypted by the browser.', 'SNSS_ENCRYPTED');
  if (version !== 1 && version !== 3) throw failure('Unsupported session file version ' + version + '.', 'SNSS_VERSION');
  const commands = [];
  let at = 8;
  while (at + 2 <= buffer.length && commands.length < MAX_COMMANDS) {
    const size = buffer.readUInt16LE(at);
    if (size < 1 || at + 2 + size > buffer.length) break;
    commands.push({ id: buffer[at + 2], data: buffer.subarray(at + 3, at + 2 + size) });
    at += 2 + size;
  }
  return commands;
}

/** Chromium's base::Pickle: a uint32 payload size, then 4-byte aligned fields. Reads fail with null, never throw. */
class Pickle {
  constructor(data) {
    this.data = data;
    this.at = 4;
    this.end = data.length >= 4 ? Math.min(data.length, 4 + data.readUInt32LE(0)) : 0;
  }
  int() {
    if (this.at + 4 > this.end) return null;
    const value = this.data.readInt32LE(this.at);
    this.at += 4;
    return value;
  }
  bytes(length) {
    if (!Number.isInteger(length) || length < 0 || this.at + length > this.end) return null;
    const value = this.data.subarray(this.at, this.at + length);
    this.at += (length + 3) & ~3;
    return value;
  }
  string() {
    const length = this.int();
    const value = length === null ? null : this.bytes(length);
    return value === null ? null : value.toString('utf8');
  }
  string16() {
    const length = this.int();
    const value = length === null || length > 1e6 ? null : this.bytes(length * 2);
    return value === null ? null : value.toString('utf16le');
  }
}

const newTab = (id) => ({ id, windowId: null, index: null, pinned: false, selected: null, navigations: new Map(), extras: [], closed: false, order: 0 });

/** Replays the commands: {windows: Map, tabs: Map}. Tabs keep their navigation entries by index and every extra value. */
function replay(commands) {
  const tabs = new Map(), windows = new Map();
  let counter = 0;
  const tab = (id) => {
    let found = tabs.get(id);
    if (!found && tabs.size < MAX_TABS) {
      found = newTab(id);
      found.order = counter++;
      tabs.set(id, found);
    }
    return found;
  };
  const window = (id) => {
    let found = windows.get(id);
    if (!found) windows.set(id, (found = { id, type: 0, closed: false }));
    return found;
  };
  // Extra values wait here by tab id: a browser may write them before the tab's own commands.
  const pending = new Map();
  const extra = (data, source) => {
    // A tab id then text fields: key and value for command 33; a browser's own command may carry only a value.
    const pickle = new Pickle(data), id = pickle.int();
    if (id === null || id < 0) return;
    const fields = [];
    for (let guard = 0; guard < 8; guard++) {
      const text = pickle.string();
      if (text === null) break;
      fields.push(text);
    }
    const found = pending.get(id) || [];
    if (source === 'extra' && fields.length >= 2) found.push({ key: fields[0], value: fields[1] });
    else for (const text of fields) found.push({ key: 'command-' + source, value: text });
    if (found.length && (pending.has(id) || pending.size < MAX_TABS)) pending.set(id, found.slice(0, 64));
  };
  for (const { id, data } of commands) {
    const int = (offset) => (data.length >= offset + 4 ? data.readInt32LE(offset) : null);
    switch (id) {
      case COMMAND.setTabWindow: {
        const found = int(4) === null ? null : tab(int(4));
        if (found && int(0) !== null) {
          found.windowId = int(0);
          window(int(0));
        }
        break;
      }
      case COMMAND.setTabIndexInWindow: {
        const found = int(0) === null ? null : tab(int(0));
        if (found && int(4) !== null) found.index = int(4);
        break;
      }
      case COMMAND.updateTabNavigation: {
        const pickle = new Pickle(data), tabId = pickle.int(), index = pickle.int(), url = pickle.string(), title = pickle.string16();
        const found = tabId === null || index === null ? null : tab(tabId);
        if (found && url !== null) found.navigations.set(index, { url, title: title || '' });
        break;
      }
      case COMMAND.setSelectedNavigationIndex: {
        const found = int(0) === null ? null : tab(int(0));
        if (found && int(4) !== null) found.selected = int(4);
        break;
      }
      case COMMAND.setWindowType:
        if (int(0) !== null && int(4) !== null) window(int(0)).type = int(4);
        break;
      case COMMAND.setPinnedState: {
        const found = int(0) === null ? null : tab(int(0));
        if (found && data.length >= 5) found.pinned = data[4] !== 0;
        break;
      }
      case COMMAND.prunedFromBack: {
        const found = tabs.get(int(0)), from = int(4);
        if (found && from !== null) for (const key of [...found.navigations.keys()]) if (key >= from) found.navigations.delete(key);
        break;
      }
      case COMMAND.prunedFromFront: {
        const found = tabs.get(int(0)), count = int(4);
        if (found && count > 0) found.navigations = new Map([...found.navigations].filter(([key]) => key >= count).map(([key, value]) => [key - count, value]));
        if (found && count > 0 && found.selected !== null) found.selected = Math.max(0, found.selected - count);
        break;
      }
      case COMMAND.pruned: {
        const found = tabs.get(int(0)), from = int(4), count = int(8);
        if (found && from !== null && count > 0) found.navigations = new Map([...found.navigations].filter(([key]) => key < from || key >= from + count).map(([key, value]) => [key >= from + count ? key - count : key, value]));
        break;
      }
      case COMMAND.tabClosed: {
        const found = tabs.get(int(0));
        if (found) found.closed = true;
        break;
      }
      case COMMAND.windowClosed: {
        const found = windows.get(int(0));
        if (found) found.closed = true;
        break;
      }
      case COMMAND.addTabExtraData:
        extra(data, 'extra');
        break;
      case 30:
        // kCommandSetTabData: per-tab data an embedder may use; read like extra data when it holds a tab id and text (a binary struct simply yields nothing).
        extra(data, 30);
        break;
      default:
        // A browser's own command (Vivaldi, Opera): its payload usually starts with the tab id, followed by text.
        if (!KNOWN.has(id)) extra(data, id);
    }
  }
  for (const [id, extras] of pending) {
    const found = tabs.get(id);
    if (found) found.extras.push(...extras);
  }
  return { tabs, windows };
}

/** The address a tab shows now: its selected history entry, else the last one it has. */
function currentEntry(tab) {
  if (!tab.navigations.size) return null;
  const last = Math.max(...tab.navigations.keys());
  return tab.navigations.get(tab.selected !== null && tab.navigations.has(tab.selected) ? tab.selected : last) || null;
}

/** The open tabs of a session: [{id, windowId, index, pinned, url, title, extras:[{key, value}]}], window by window, each in tab order.
 *  Closed tabs and tabs of closed or non-normal windows (pop-ups, apps) are left out. A tab's address is as the browser stored it. */
function sessionTabs(buffer) {
  const { tabs, windows } = replay(readCommands(buffer));
  const open = [...tabs.values()].filter((tab) => {
    if (tab.closed || tab.windowId === null || !tab.navigations.size) return false;
    const window = windows.get(tab.windowId);
    return !window || (!window.closed && window.type === 0);
  });
  open.sort((a, b) => a.windowId - b.windowId || (a.index ?? Infinity) - (b.index ?? Infinity) || a.order - b.order);
  return open.map((tab) => {
    const entry = currentEntry(tab);
    return { id: tab.id, windowId: tab.windowId, index: tab.index, pinned: tab.pinned, url: entry.url, title: entry.title, extras: tab.extras };
  });
}

/** Session files of a profile, newest first: Sessions/Session_<time> (the current session), then the older Current Session / Last Session names. */
function sessionFiles(location) {
  const files = [];
  try {
    for (const name of fs.readdirSync(path.join(location, 'Sessions'))) if (/^Session_\d+$/.test(name)) files.push(name);
  } catch {}
  files.sort((a, b) => Number(b.slice(8)) - Number(a.slice(8)));
  const list = files.map((name) => path.join(location, 'Sessions', name));
  for (const legacy of ['Current Session', 'Last Session']) if (fs.existsSync(path.join(location, legacy))) list.push(path.join(location, legacy));
  return list;
}

/** The open tabs of a profile: from its newest session file that has any. {tabs, encrypted, unreadable}: `encrypted` counts files the
 *  browser encrypted, `unreadable` those that could not be read. Never throws. */
function readSessionTabs(location) {
  const result = { tabs: [], encrypted: 0, unreadable: 0 };
  for (const file of sessionFiles(location)) {
    try {
      const stat = fs.statSync(file);
      if (stat.size > MAX_FILE) {
        result.unreadable++;
        continue;
      }
      const tabs = sessionTabs(fs.readFileSync(file));
      if (tabs.length) return { ...result, tabs };
    } catch (error) {
      if (error?.code === 'SNSS_ENCRYPTED') result.encrypted++;
      else result.unreadable++;
    }
  }
  return result;
}

/** Whether a profile has a session file at all (a cheap check for the import list). */
const hasSessionFiles = (location) => sessionFiles(location).length > 0;

module.exports = { COMMAND, readCommands, replay, sessionTabs, sessionFiles, readSessionTabs, hasSessionFiles, Pickle };
