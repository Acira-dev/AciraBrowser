// "Changes to how Acira protects you" (spec 4.3 R5 and 10.1): the words of each line, from the `id` main sends (desktop/transfer/payload.cjs `safetyLines`) and the
// detail that line carries. Every line is unticked until the person ticks it, and only ticked ids go back to `transfer.apply { safety }`.
// The detail (a host, a search engine's name) was written by the OTHER computer: it is cleaned before it is shown (control and direction-changing characters out,
// one line, 60 characters), and a line whose detail is missing is worded without it rather than with a hole in it.
import { t, type MessageId } from '../../i18n';
import type { SafetyLine } from './types';

/** The protections main names by id (`protection:<name>`), each with the words for "Turn off {name}". */
const PROTECTION_NAMES: Record<string, MessageId> = {
  cnameUncloaking: 'transfer.safety.name.cnameUncloaking',
  skipTrackingRedirects: 'transfer.safety.name.skipTrackingRedirects',
  stripTrackingParams: 'transfer.safety.name.stripTrackingParams',
  deAmp: 'transfer.safety.name.deAmp',
  fingerprint: 'transfer.safety.name.fingerprint'
};
/** The ids with fixed words (no detail). */
const FIXED: Record<string, MessageId> = {
  phishing: 'transfer.safety.phishing', cookies: 'transfer.safety.cookies', gpc: 'transfer.safety.gpc', blocking: 'transfer.safety.blocking',
  httpsOnly: 'transfer.safety.httpsOnly', suggest: 'transfer.safety.suggest', scripts: 'transfer.safety.scripts', tor: 'transfer.safety.tor', passwords: 'transfer.safety.passwords', livePrs: 'transfer.safety.livePrs'
};

/** One short line of text another computer sent, made safe to show next to words of ours. */
export function cleanDetail(value: unknown, max = 60): string {
  let text = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
    .replace(/[\u061c\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    .replace(/\s+/g, ' ').trim();
  if (text.length > max) text = text.slice(0, max - 1).trimEnd() + '\u2026';
  return text;
}

/** The words of one line, or null for an id this screen cannot word (it still shows a general line: see `safetyLabel`). */
export function wordedSafety(line: SafetyLine): string | null {
  const id = String(line.id ?? '');
  if (FIXED[id]) return t(FIXED[id]);
  if (id.startsWith('protection:')) {
    const name = PROTECTION_NAMES[id.slice('protection:'.length)];
    return name ? t('transfer.safety.protection', { name: t(name) }) : null;
  }
  if (id === 'dns') {
    if (line.mode === 'off') return t('transfer.safety.dnsOff');
    const host = cleanDetail(line.host);
    return line.mode === 'custom' && host ? t('transfer.safety.dnsCustom', { host }) : null;
  }
  if (id === 'suggest:custom' || id === 'imageSearch:custom') {
    const host = cleanDetail(line.host);
    return host ? t(id === 'suggest:custom' ? 'transfer.safety.suggestCustom' : 'transfer.safety.imageCustom', { host }) : null;
  }
  if (id.startsWith('search:')) {
    const name = cleanDetail(line.name), host = cleanDetail(line.host);
    return name && host ? t('transfer.safety.search', { name, host }) : null;
  }
  return null;
}
/** The line as shown: its words, or, for an id (or a detail) it cannot word, the general line, so a change is never hidden from the person who is about to allow it. */
export const safetyLabel = (line: SafetyLine): string => wordedSafety(line) ?? t('transfer.safety.other');
/** The ids this screen could not word (reported by the build, for the team). */
export const unwordedIds = (lines: readonly SafetyLine[]): string[] => lines.filter((line) => wordedSafety(line) === null).map((line) => String(line.id));
/** Every id main can send, for the test that keeps the wording complete. */
export const KNOWN_SAFETY_IDS = [...Object.keys(FIXED), ...Object.keys(PROTECTION_NAMES).map((name) => 'protection:' + name), 'dns', 'search:<id>'];
