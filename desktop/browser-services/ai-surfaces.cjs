'use strict';
// Where AI answers and AI entry points live on the big search engines, as data the frame script (content-filter-preload.cjs) applies.
// Rules prefer stable attributes, ids, hrefs and the visible heading/label text (in several languages) over generated class names.
// Verified in a real browser on 24 Oct 2026 (see qa/privacy-plus/ai-surfaces.mjs); engines change their markup, so the text and
// href rules are the safety net when an id disappears. Nothing here classifies unknown text or images as AI-made.
const { getDomain } = require('tldts');
// Google's "AI Overview" heading, lower-case, hyphens and apostrophes in plain ASCII (the frame script normalises page text the same way).
// Read from live Google results on 24 Oct 2026: en, de, fr, es, it, pt-BR, ar. The other languages are Google's published names, not yet read from a live page.
const AI_OVERVIEW = Object.freeze(['übersicht mit ki', 'vista creada con ia', "overview dell'ai",'نبذة باستخدام الذكاء الاصطناعي', 'ai overview', 'ai overviews', 'aperçu ia', 'aperçu créé par l’ia', 'aperçu créé par l\'ia', 'ki-übersicht', 'ki-übersichten', 'descripción general creada por ia', 'descripción creada con ia', 'información general creada con ia', 'panoramica ai', 'panoramica creata dall’ai', 'panoramica creata dall\'ai', 'visão geral criada por ia', 'visão geral de ia', 'ai-overzicht', 'ai-overzichten', 'ai による概要', 'ai 개요', 'обзор от ии', 'нейрообзор', 'نظرة عامة من الذكاء الاصطناعي', 'yapay zeka özeti', 'ai-översikt', 'przegląd od ai', 'ai-oversigt', 'ai-oversikt', 'ai-yleiskatsaus', 'přehled od ai', 'ai áttekintés', 'ringkasan ai', 'tổng quan do ai tạo', 'ภาพรวมจาก ai']);
// Google's "AI Mode" entry point (button on the home page, tab on results).
// Google's "AI Mode" entry point, read the same way (live: en, de, fr, es, it, pt-BR, ar).
const AI_MODE = Object.freeze(['ki-modus', 'وضع ai', 'ai mode', 'ki-modus', 'mode ia', 'modo ia', 'modalità ia', 'ai-modus', 'ai モード', 'ai 모드', 'режим ии', 'وضع الذكاء الاصطناعي', 'yapay zeka modu', 'ai-läge', 'tryb ai', 'ai-tilstand', 'ai-modus']);
const ENTRY = 'button,a,[role=button],[role=link],[role=tab]';
const rule = (id, title, items) => Object.freeze({ id, title, items: Object.freeze(items.map(item => Object.freeze(item))) });
// kinds: css (querySelectorAll), heading (heading text in `labels`), text (short control text in `labels`).
// unit: how to find the whole block to hide: {self}, {closest:'selector'}, {wrapper:n} (climb through single-child wrappers, at most n), {results} (the region around it that holds no organic results or page landmarks).
// quiet: entry points hide without the "hidden · Show" line.
// `keep`: if the block a rule picked contains this, it is not an AI block (it holds organic results), so nothing is hidden. This is the structural
// guarantee that a selector drifting onto a shared container can never take the results away. Entry-point rules only match inside the page chrome.
// `pre` is the same block as a CSS selector. The frame script installs it as a style sheet at document start, before the page paints, so an AI block is never
// on screen even for one frame; the scripted rule then replaces it with the quiet "hidden · Show" line (and "Show" switches the style off for that block).
// Google, read from live results on 26 Oct 2026 (desktop and narrow layouts, five different queries): the AI Overview is the block inside #rcnt that holds
// #m-x-content (also marked data-async-type="folsrch" data-subtree="mfc"), none of those exist on results without an AI Overview, and the organic results live in #rso.
// The AI Mode tab is a role=listitem whose link goes to udm=50, and the AI Mode pill in the search box is button[jsname="B6rgad"] (its text also contains the pill's own style rules, so it is matched by selector, not by text length).
const GOOGLE_OVERVIEW = '#rcnt>div:has(#m-x-content):not(:has(#rso))';
const GOOGLE = rule('google', 'Google Search', [
  { kind: 'heading', labels: AI_OVERVIEW, unit: { results: true }, label: 'AI answer', keep: 'a h3', pre: GOOGLE_OVERVIEW },
  { kind: 'css', css: '[data-attrid="AIOverview"],[data-attrid="AIOverviewHeader"],#m-x-content', unit: { results: true }, label: 'AI answer', keep: 'a h3', pre: GOOGLE_OVERVIEW },
  { kind: 'css', css: 'a[href*="udm=50"]', unit: { wrapper: 3 }, quiet: true, keep: 'a h3', pre: 'div[role="listitem"]:has(>*>*>a[href*="udm=50"]),a[href*="udm=50"]' },
  { kind: 'css', css: 'button[jsname="B6rgad"]', unit: { self: true }, quiet: true },
  { kind: 'text', within: ENTRY, labels: AI_MODE, unit: { closest: ENTRY }, quiet: true, keep: 'a h3' }
]);
const BING = rule('bing', 'Bing', [
  { kind: 'css', css: '#copans_container', unit: { closest: 'li.b_ans' }, label: 'AI answer', keep: 'li.b_algo', pre: 'li.b_ans:has(#copans_container)' },
  { kind: 'css', css: '#b-scopeListItem-copilotsearch', unit: { self: true }, quiet: true, keep: 'li.b_algo' },
  // Chrome only (defence in depth): a result link that mentions Copilot, such as copilot.microsoft.com or a "copilot" query, can never be matched by these.
  { kind: 'css', css: 'header#b_header a[href*="copilot" i],nav.b_scopebar a[href*="copilot" i],a#id_copilot', unit: { closest: 'li,a#id_copilot' }, quiet: true, keep: 'li.b_algo' }
]);
const DUCKDUCKGO = rule('duckduckgo', 'DuckDuckGo', [
  { kind: 'css', css: 'section[data-testid="mainline"] [data-assist-icon-trigger]', unit: { closest: 'section[data-testid="mainline"] > ol > li' }, label: 'AI answer', keep: 'article[data-testid="result"]', pre: 'section[data-testid="mainline"]>ol>li:has([data-assist-icon-trigger])' },
  { kind: 'css', css: '#react-ai-button-slot', unit: { self: true }, quiet: true, keep: 'article[data-testid="result"]' },
  // Navigation chips and the menu only, so a result that links to duck.ai is left alone.
  { kind: 'css', css: 'nav a[href*="&assist"],nav a[href*="&ia=assist"],.nav-menu__list a[href="https://duck.ai"],.nav-menu__list a[href^="https://duck.ai/"]', unit: { closest: 'li' }, quiet: true, keep: 'article[data-testid="result"]' },
  { kind: 'css', css: '#react-ai-button-slot a[href*="ia=chat"],header a[href*="ia=chat"]', unit: { self: true }, quiet: true, keep: 'article[data-testid="result"]' },
  // The Duck.ai prompt's own form only: never a form that holds the search box (a page can wrap its header and results in one form; hiding that would blank the page).
  { kind: 'css', css: 'button[data-testid="ask"]', unit: { closest: 'form:not([role="search"]):not(:has(input[name="q"],input[type="search"],textarea[name="q"],[role="search"],article[data-testid="result"]))' }, quiet: true, keep: 'article[data-testid="result"]' }
]);
const BRAVE = rule('brave', 'Brave Search', [
  { kind: 'css', css: '#llm-snippet', unit: { self: true }, label: 'AI answer', keep: '.snippet[data-type="web"]' },
  { kind: 'css', css: '#submit-llm-button', unit: { self: true }, quiet: true, keep: '.snippet[data-type="web"]' },
  { kind: 'css', css: '#primary-tabs a[href^="/ask"]', unit: { closest: 'li' }, quiet: true, keep: '.snippet[data-type="web"]' }
]);
// Best effort, NOT verified live (logged out, those surfaces were not on the pages read on 24 Oct 2026, or sit behind a sign-in). Written from public markup and
// documentation, entry points only (quiet, nothing is guessed about page text), so a wrong selector hides nothing it should not. See docs/launch/AI_FREE_COVERAGE.md.
const quiet = (css, keep) => ({ kind: 'css', css, unit: { self: true }, quiet: true, ...(keep ? { keep } : {}) });
const YOUTUBE = rule('youtube', 'YouTube', [{ kind: 'text', within: 'button-view-model button, yt-button-view-model button, ytd-menu-renderer button', labels: ['ask'], unit: { closest: 'button-view-model, yt-button-view-model' }, quiet: true }]);
const REDDIT = rule('reddit', 'Reddit', [quiet('a[href^="/answers"],a[href*="reddit.com/answers"]'), quiet('faceplate-tracker[source*="answers" i]')]);
const QUORA = rule('quora', 'Quora', [quiet('a[href*="poe.com"]')]);
const STACKOVERFLOW = rule('stackoverflow', 'Stack Overflow', [quiet('a[href*="stackoverflow.ai"],a[href*="/ai-assist"]')]);
const GITHUB = rule('github', 'GitHub', [quiet('a[href*="github.com/features/copilot"],a[href^="/features/copilot"],a[href="/copilot"],a[href="https://github.com/copilot"],button[aria-label*="Copilot" i],copilot-chat')]);
const AMAZON = rule('amazon', 'Amazon', [quiet('[id^="rufus-"],[data-csa-c-content-id*="rufus" i],.ucc-v2-widget__rufus-pills-trigger,[aria-label*="Rufus"]')]);
const GOOGLE_WORKSPACE = rule('workspace', 'Gmail and Google Docs', [quiet('[aria-label*="Gemini" i][role="button"],button[aria-label*="Gemini" i],[aria-label*="Help me write" i][role="button"]')]);
const LINKEDIN = rule('linkedin', 'LinkedIn', [quiet('button[aria-label*="Rewrite with AI" i],button[aria-label*="Write with AI" i],button[aria-label*="Try Premium" i][data-test-icon*="ai" i]')]);
const X = rule('x', 'X', [quiet('a[href="/i/grok"],[data-testid="GrokDrawer"],[data-testid="grokImgGen"],button[aria-label*="Grok" i],a[aria-label="Grok"]')]);
const META = rule('meta', 'Instagram and Facebook', [quiet('a[href*="meta.ai"],[aria-label*="Meta AI" i][role="button"],[aria-label*="Meta AI" i][role="link"]')]);
const M365 = rule('m365', 'Microsoft 365 and Outlook', [quiet('button[aria-label*="Copilot" i],[data-automationid*="Copilot" i],#CopilotButton')]);
const RULES = Object.freeze({ google: GOOGLE, bing: BING, duckduckgo: DUCKDUCKGO, brave: BRAVE, youtube: YOUTUBE, reddit: REDDIT, quora: QUORA, stackoverflow: STACKOVERFLOW, github: GITHUB, amazon: AMAZON, workspace: GOOGLE_WORKSPACE, linkedin: LINKEDIN, x: X, meta: META, m365: M365 });
const googleHost = hostname => /^google\.(?:com|[a-z]{2}|(?:co|com)\.[a-z]{2})$/.test(getDomain(hostname) || '');
/** The rules that apply to a page address, or none. Exact hosts only: look-alike domains never match. */
function surfacesFor(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (host === 'mail.google.com' || host === 'docs.google.com') return GOOGLE_WORKSPACE; // Gmail and Docs are not the search page
  if (googleHost(host)) return GOOGLE;
  const domain = getDomain(host) || '';
  if (domain === 'bing.com') return BING;
  if (domain === 'duckduckgo.com' && host !== 'duck.ai') return DUCKDUCKGO;
  if (host === 'search.brave.com') return BRAVE;
  const more = { 'youtube.com': YOUTUBE, 'reddit.com': REDDIT, 'quora.com': QUORA, 'stackoverflow.com': STACKOVERFLOW, 'github.com': GITHUB, 'mail.google.com': GOOGLE_WORKSPACE, 'docs.google.com': GOOGLE_WORKSPACE, 'linkedin.com': LINKEDIN, 'x.com': X, 'twitter.com': X, 'instagram.com': META, 'facebook.com': META, 'office.com': M365, 'microsoft365.com': M365, 'outlook.live.com': M365, 'outlook.office.com': M365 };
  if (more[host] || more[domain]) return more[host] || more[domain];
  if (/^www.amazon.[a-z.]+$/.test(host) && /^amazon./.test(domain)) return AMAZON;
  return null;
}
/**
 * Style rules that hide the blocks of a rule set before the page paints. A rule gets one when it names a `pre` selector, or when it is a plain
 * selector for one element ({self}); the block's own `keep` guard becomes :not(:has(...)). A block the person revealed carries data-acira-shown.
 */
function earlyStyles(items) {
  const rules = [];
  for (const item of items || []) {
    const selector = item.pre || (item.kind === 'css' && item.unit && item.unit.self ? item.css : '');
    if (!selector) continue;
    const keep = item.keep ? `:not(:has(${item.keep}))` : '';
    for (const part of splitSelectors(selector)) rules.push(`${part}:not([data-acira-shown])${keep}{display:none!important}`);
  }
  return rules.join(' ');
}
/** Splits a selector list at top-level commas, so one rule that a browser cannot read never switches off the others. */
function splitSelectors(list) {
  const parts = []; let depth = 0, quote = '', start = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (quote) { if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) { parts.push(list.slice(start, i).trim()); start = i + 1; }
  }
  parts.push(list.slice(start).trim());
  return parts.filter(Boolean);
}
/** What is covered, in the words Settings shows. */
const COVERAGE = Object.freeze([
  'Google Search: AI Overviews and the AI Mode button and tab',
  'Bing: Copilot Search answers and the Copilot and AI Mode buttons',
  'DuckDuckGo: Search Assist answers, the Duck.ai prompt and its buttons',
  'Brave Search: AI answers and the Ask button and tab',
  'Also, best effort: YouTube Ask, Reddit Answers, Quora Poe, Stack Overflow AI, GitHub Copilot, Amazon Rufus, Gmail and Docs Gemini, LinkedIn AI writing, X Grok, Meta AI, Microsoft 365 Copilot buttons'
]);
const googleSelectors = Object.freeze(GOOGLE.items.filter(item => item.kind === 'css').flatMap(item => item.css.split(',')));
module.exports = { surfacesFor, earlyStyles, splitSelectors, RULES, COVERAGE, AI_OVERVIEW, AI_MODE, googleHost, googleSelectors };
