'use strict';
// Main-process glue for "Move to another computer": the `transfer.*` requests the interface may make (src/features/transfer/types.ts is the contract), each checked
// for its exact keys and values, run against the window's own transfer service (desktop/transfer/index.cjs), and answered in `{ transfer: <TransferResultBag> }`.
// Nothing here knows Electron: main.cjs hands in what it knows through `context`, so tests/transfer-wire.test.cjs drives every request with a fake one.
//
// The renderer never names a profile or a path: the profile is the window's active ordinary profile, and the file dialogs belong to the service. Every request
// throws in a private or Tor window, like the `imports.*` requests do.
const inventory = require('./inventory.cjs');

const INTENTS = ['choice', 'send', 'receive', 'file-save', 'file-open'];
/** How long a requested side waits for the sheet to read it (the sheet clears it with `transfer.sheetSeen` as soon as it has). */
const SHEET_TTL = 15000;
const PRIVATE_MESSAGE = 'Moving a profile is not available in a private window.';

/** The exact keys each request may carry (besides `type`). */
const KEYS = Object.freeze({
  'transfer.status': [], 'transfer.words': [], 'transfer.open': ['intent'], 'transfer.sheetSeen': [], 'transfer.summary': ['ui'],
  'transfer.send': ['include', 'historyDays', 'ui'], 'transfer.approve': ['number'], 'transfer.deny': [], 'transfer.receive': ['code'], 'transfer.preview': [],
  'transfer.apply': ['target', 'include', 'safety'], 'transfer.applyLook': ['batchId'], 'transfer.applied': ['batchId'], 'transfer.rolledBack': [],
  'transfer.cancel': ['side'], 'transfer.saveFile': ['include', 'historyDays', 'ui', 'password'], 'transfer.openFile': ['password'], 'transfer.reveal': ['path'], 'transfer.restart': []
});

const plain = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const bad = (message = 'Invalid transfer request.') => { throw new Error(message); };
const includeOf = (value, { optional = false } = {}) => {
  if (value === undefined && optional) return undefined;
  if (!plain(value) || Object.keys(value).some((key) => !inventory.ROWS.includes(key) || typeof value[key] !== 'boolean')) bad('Choose what to move.');
  return value;
};
const historyDaysOf = (value) => { if (![0, 30, 90].includes(value)) bad('Choose how much history to move.'); return value; };
const uiOf = (value) => { if (!plain(value)) bad('Invalid transfer request.'); return value; };
const passwordOf = (value) => { if (value !== undefined && (typeof value !== 'string' || value.length > 1024)) bad('Invalid transfer request.'); return value; };

/** The words of an error the service threw, in the language of this computer (the renderer shows `error.message`; the code does not cross the process boundary). */
function translated(error, type, tm) {
  const code = error?.code;
  const key = code === 'apply-failed' ? 'transfer.error.applyFailed' : code === 'gone' ? 'transfer.error.gone' : code === 'unavailable' ? 'transfer.error.unavailable' : code === 'not-yet' ? 'transfer.error.notYet'
    : code === 'damaged' ? 'transfer.error.damaged' : code === 'newer' ? (type === 'transfer.openFile' ? 'transfer.file.newer' : 'transfer.error.newer')
    : (code === 'unknown' || code === 'invalid') && type === 'transfer.openFile' ? 'transfer.file.unknown' : code === 'wrong-password' ? 'transfer.file.wrongPassword'
    : code === 'too-large' && type === 'transfer.send' ? 'transfer.send.tooLarge' : '';
  if (!key || typeof tm !== 'function') return error;
  const said = tm(key);
  return said && said !== key ? Object.assign(new Error(said), { code }) : error;
}

/** The window's active ordinary profile; a private or Tor window, or a profile that is one, throws. */
function activeProfile(context) {
  const state = context.getState();
  const profile = state.browserProfiles.find((item) => item.id === state.activeBrowserProfileId);
  if (context.privateMode || context.torMode || !profile || profile.private || profile.tor) throw new Error(PRIVATE_MESSAGE);
  return profile;
}

/**
 * @param request one of TransferRequest (src/features/transfer/types.ts)
 * @param context {
 *   service      this window's createTransfer(...)
 *   getState     () => this window's state (the active ordinary profile is read from it)
 *   privateMode, torMode
 *   relay        () => boolean: is a relay address available (resolveEndpoint() !== '')
 *   platform     'darwin' | 'win32' | 'linux'
 *   local        { sheet: null | {intent, at} }  the per-window holder of the side a menu asked the sheet to open on
 *   openSheet    (intent) => void  opens the `transfer` popup in this window
 *   legacyImported (batch) => void  shows the usual "Imported … · Undo" toast for an older export or a bookmarks file
 *   tm           (id) => text in this computer's language, for the service's own errors (optional)
 *   now          () => ms
 * }
 */
async function handle(request, context) {
  try { return await run(request, context); } catch (error) { throw translated(error, request?.type, context?.tm); }
}

async function run(request, context) {
  if (!plain(request) || typeof request.type !== 'string' || !Object.hasOwn(KEYS, request.type)) throw new Error('Unknown transfer request.');
  const allowed = KEYS[request.type];
  if (Object.keys(request).some((key) => key !== 'type' && !allowed.includes(key))) throw new Error('Unexpected transfer field.');
  const profile = activeProfile(context);
  const { service } = context;
  const now = context.now || Date.now;

  switch (request.type) {
    case 'transfer.status': {
      const base = service.status();
      const sheet = context.local.sheet && now() - context.local.sheet.at < SHEET_TTL ? { ...context.local.sheet } : null;
      return { transfer: { status: { outgoing: base.outgoing, incoming: base.incoming, ...(base.applying ? { applying: base.applying } : {}), sheet, relay: Boolean(context.relay()), platform: context.platform } } };
    }
    case 'transfer.words':
      return { transfer: { words: [...require('./words.json')] } };
    case 'transfer.open': {
      if (!INTENTS.includes(request.intent)) bad('Choose where to start.');
      context.local.sheet = { intent: request.intent, at: now() };
      context.openSheet(request.intent);
      return { transfer: { opened: true } };
    }
    case 'transfer.sheetSeen':
      context.local.sheet = null;
      return { transfer: {} };
    case 'transfer.summary':
      return { transfer: { summary: await service.summary({ profileId: profile.id, ui: uiOf(request.ui) }) } };
    case 'transfer.send': {
      const result = await service.send({ profileId: profile.id, include: includeOf(request.include), historyDays: historyDaysOf(request.historyDays), ui: uiOf(request.ui) });
      return { transfer: { code: result.code, expiresAt: result.expiresAt, passwordsRefused: result.passwordsRefused === true } };
    }
    case 'transfer.approve': {
      if (typeof request.number !== 'string' || request.number.length > 8) bad('Type the two digits.');
      return { transfer: await service.approve({ number: request.number }) };
    }
    case 'transfer.deny':
      service.deny();
      return { transfer: {} };
    case 'transfer.receive': {
      if (typeof request.code !== 'string' || request.code.length > 200) bad('Type the code.');
      await service.receive({ code: request.code, profileId: profile.id });
      return { transfer: {} };
    }
    case 'transfer.preview':
      return { transfer: { preview: service.preview() } };
    case 'transfer.apply': {
      if (!['current', 'new'].includes(request.target)) bad('Choose where it should go.');
      if (!Array.isArray(request.safety) || request.safety.length > 40 || request.safety.some((id) => typeof id !== 'string' || id.length > 80)) bad('Invalid transfer request.');
      const applied = await service.apply({ target: request.target, include: includeOf(request.include, { optional: true }), safety: request.safety });
      return { transfer: { applied } };
    }
    case 'transfer.applyLook': case 'transfer.applied': {
      if (typeof request.batchId !== 'string' || !/^import-[\w-]{1,100}$/.test(request.batchId)) bad('Unknown transfer.');
      const done = request.type === 'transfer.applyLook' ? service.applyLook({ batchId: request.batchId }) : service.applied({ batchId: request.batchId });
      return { transfer: { ok: done?.ok !== false } };
    }
    case 'transfer.rolledBack':
      return { transfer: { batchIds: service.rolledBack().batchIds } };
    case 'transfer.cancel': {
      if (!['outgoing', 'incoming'].includes(request.side)) bad('Choose which side to cancel.');
      service.cancel({ side: request.side });
      return { transfer: {} };
    }
    case 'transfer.saveFile': {
      const saved = await service.saveFile({ profileId: profile.id, include: includeOf(request.include), historyDays: historyDaysOf(request.historyDays), ui: uiOf(request.ui), password: passwordOf(request.password) });
      return { transfer: saved };
    }
    case 'transfer.openFile': {
      const opened = await service.openFile({ password: passwordOf(request.password), profileId: profile.id });
      if (opened.legacy) { try { context.legacyImported?.(opened.batch); } catch { /* the import itself is done; only the toast is missing */ } return { transfer: { legacy: opened.legacy } }; }
      return { transfer: opened };
    }
    case 'transfer.restart':
      // R7's Restart button (secure DNS, third-party cookies or Global Privacy Control changed): an ordinary quit that relaunches
      context.restart?.();
      return { transfer: {} };
    case 'transfer.reveal': {
      // Show in folder: only the file this app just wrote, never a path the renderer picks.
      if (typeof request.path !== 'string' || request.path !== service.lastSavedPath?.()) bad('Unknown file.');
      context.reveal?.(request.path);
      return { transfer: {} };
    }
    default:
      throw new Error('Unknown transfer request.');
  }
}

module.exports = { handle, KEYS, INTENTS, SHEET_TTL, PRIVATE_MESSAGE };
