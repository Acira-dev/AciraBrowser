'use strict';
// Translations for the browser services (summaries, warnings, dialogs). main.cjs installs the live translator, which follows Settings > Languages;
// until then (and in tests) text comes from the built catalog in English.
let live = null, built = null;
const fallback = () => (built ??= require('../i18n.cjs'));
function setTranslator(next) { live = next; }
function t(id, params) { return live ? live.t(id, params) : fallback().tm(id, params); }
/** A number grouped the way the current language writes it. */
function number(value) { const tag = live ? live.locale() : fallback().mainLocale(); try { return new Intl.NumberFormat(tag).format(value); } catch { return String(value); } }
module.exports = { t, number, setTranslator };
