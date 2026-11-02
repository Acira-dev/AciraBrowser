'use strict';
// Where each browser window opens. Every window keeps its own saved size and position (window-state.json, keyed by window id), so a restored
// session puts each window back where it was. A window opened while another is open gets that window's size, moved 24 px right and down
// (wrapping to the top-left of the screen's work area when it would run off, like a Windows cascade), and never lands exactly on another window.
// The file's top-level bounds/maximized/fullscreen mirror the first window, which is what the splash window at launch reads.
const fs = require('node:fs');
const path = require('node:path');
const {clampWindowBounds} = require('./native-policy.cjs');

const STEP = 24, MAX_SAVED = 24;
const validId = id => typeof id === 'string' && /^[\w-]{1,80}$/.test(id);
const validBounds = bounds => !!bounds && typeof bounds === 'object' && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(bounds[key])) && bounds.width > 0 && bounds.height > 0;
const cleanEntry = value => {
  const entry = {};
  if (value && typeof value === 'object') {
    if (validBounds(value.bounds)) entry.bounds = {x: value.bounds.x, y: value.bounds.y, width: value.bounds.width, height: value.bounds.height};
    if (value.maximized === true) entry.maximized = true;
    if (value.fullscreen === true) entry.fullscreen = true;
  }
  return entry;
};

function readState(file) {
  let raw = {};
  try { const parsed = JSON.parse(fs.readFileSync(file, 'utf8')); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) raw = parsed; } catch {}
  const windows = {};
  if (raw.windows && typeof raw.windows === 'object' && !Array.isArray(raw.windows)) for (const [id, value] of Object.entries(raw.windows).slice(0, MAX_SAVED * 2)) if (validId(id)) windows[id] = cleanEntry(value);
  return {lead: cleanEntry(raw), windows};
}

/** Next free spot for a window the same size as `anchor`: one step right and down, wrapping to the work area's top-left. */
function cascadeBounds(anchor, area, taken = [], step = STEP) {
  const size = clampWindowBounds(anchor, area), occupied = (x, y) => taken.some(other => Math.abs(other.x - x) < step / 2 && Math.abs(other.y - y) < step / 2);
  let x = anchor.x + step, y = anchor.y + step;
  for (let tries = 0; tries < 200; tries += 1) {
    if (x < area.x || y < area.y || x + size.width > area.x + area.width || y + size.height > area.y + area.height) { x = area.x; y = area.y; }
    if (!occupied(x, y)) break;
    x += step; y += step;
  }
  return clampWindowBounds({x, y, width: size.width, height: size.height}, area);
}

/**
 * Size, position and window state for the window being created.
 * anchor: the open window to copy ({bounds: its normal bounds, maximized}) or null; taken: bounds of every open window.
 * areaFor(bounds?): the work area of the display holding `bounds` (the primary display when omitted).
 */
function place({file, windowId, restore, anchor, taken = [], areaFor}) {
  const state = readState(file), own = restore ? state.windows[windowId] : undefined;
  const fit = entry => ({bounds: clampWindowBounds(entry.bounds, areaFor(entry.bounds)), maximized: !!entry.maximized, fullscreen: !!entry.fullscreen});
  if (own?.bounds) return fit(own);
  if (anchor && validBounds(anchor.bounds)) return {bounds: cascadeBounds(anchor.bounds, areaFor(anchor.bounds), taken), maximized: !!anchor.maximized, fullscreen: false};
  return fit(state.lead);
}

/** Records this window's placement. `keep` lists the windows that come back next launch (first = the lead); the rest are forgotten. */
function save(file, windowId, entry, keep = []) {
  const state = readState(file), ids = [...new Set([...keep.filter(validId), windowId])].slice(0, MAX_SAVED);
  state.windows[windowId] = cleanEntry(entry);
  for (const id of Object.keys(state.windows)) if (!ids.includes(id)) delete state.windows[id];
  const lead = state.windows[ids[0]]?.bounds ? state.windows[ids[0]] : state.windows[windowId];
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, JSON.stringify({...lead, windows: state.windows}));
}

module.exports = {place, save, cascadeBounds, readState, STEP};
