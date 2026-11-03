import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { LOCALES } from '../src/i18n/locales';

// Settings › Profiles › "Switch between" and the questions around profiles as spaces were written in all 13 languages at once. The
// review found Japanese and Russian naming sign-ins with another word than their own Settings, Italian and Turkish buttons that read
// as "Pass" / "Skip", and the reload question cutting the list of pages off with a full stop. Each line now uses its catalog's words.
const catalog = (code: string) => JSON.parse(fs.readFileSync(`src/i18n/${code}.json`, 'utf8')) as Record<string, string>;
const lower = (code: string, text: string) => text.toLocaleLowerCase(code);
/** The first five letters of a message's first word, so "Bascule" counts as "Basculer". */
const stem = (code: string, text: string) => [...lower(code, text).split(/\s/)[0]].slice(0, 5).join('');

/** Each language's word for sign-ins, as "Each profile keeps its own sign-ins and history" (setup.profile.line1) says it. */
const SIGN_INS: Record<string, string> = {
  en: 'sign-ins', de: 'Anmeldungen', fr: 'connexions', es: 'inicios de sesión', it: 'accessi', 'pt-BR': 'logins', ru: 'сеансы входа',
  tr: 'oturumlar', ar: 'تسجيلات', hi: 'साइन-इन', ja: 'サインイン情報', ko: '로그인', 'zh-CN': '登录信息',
};

test('profiles as spaces names sign-ins, tab groups and secured workspaces as the rest of Settings does', () => {
  for (const { code } of LOCALES) {
    const messages = catalog(code), detail = lower(code, messages['profiles.switchSpacesDetail']);
    assert.ok(SIGN_INS[code], `${code}: no sign-ins word listed`);
    assert.ok(lower(code, messages['setup.profile.line1']).includes(lower(code, SIGN_INS[code])), `${code}: setup.profile.line1 doesn't say ${SIGN_INS[code]}`);
    assert.ok(detail.includes(lower(code, SIGN_INS[code])), `${code}: says sign-ins differently: ${messages['profiles.switchSpacesDetail']}`);
    assert.ok(detail.includes(stem(code, messages['tabgroupcontrols.tabGroup'])), `${code}: tab groups aren't "${messages['tabgroupcontrols.tabGroup']}"`);
    assert.ok(lower(code, messages['profiles.switchSecured']).includes(lower(code, messages['workspaces.securedGroup'])), `${code}: secured workspaces aren't "${messages['workspaces.securedGroup']}"`);
  }
});

test('the reload question lists its pages after a colon', () => {
  for (const { code } of LOCALES) assert.match(catalog(code)['profiles.spacesMoveDetail'], /\s?[:：]\s?\{pages\}$/u, code);
  // Portuguese "para" is "stops" and "for"; before a colon it read "for: {pages}".
  assert.doesNotMatch(catalog('pt-BR')['profiles.spacesMoveDetail'], /\bpara: \{pages\}/);
});

test('the Switch button uses the verb of its language’s own profile switching', () => {
  for (const { code } of LOCALES) {
    const messages = catalog(code), verbs = lower(code, `${messages['app.switchProfile']} ${messages['profiles.switchHere']}`);
    assert.ok(verbs.includes(stem(code, messages['profiles.switch'])), `${code}: "${messages['profiles.switch']}" isn't the verb of "${messages['app.switchProfile']}"`);
  }
  // Turkish "Geç" alone on a button reads as "Skip"; the button says what "Bu pencerede geçiş yapar" says.
  assert.equal(catalog('tr')['profiles.switch'], 'Geçiş yap');
});

test('Arabic reloads with the masculine passive (تحميل is masculine)', () => {
  const ar = catalog('ar');
  for (const [id, text] of Object.entries(ar)) assert.doesNotMatch(text, /تُعاد تحميل/, id);
});

/** Each language's word for a space, as its "Profiles as spaces" setting says it. */
const SPACE: Record<string, string> = {
  en: 'space', es: 'espacio', fr: 'espace', de: 'bereich', 'pt-BR': 'espaço', it: 'spazi', ru: 'пространств', tr: 'alan', ar: 'مساح', hi: 'स्पेस',
  ja: 'スペース', ko: '스페이스', 'zh-CN': '空间',
};
const SPACE_NAMES = ['workspaces.spaceChip', 'workspaces.spaceChipTip', 'workspaces.goToSpace', 'workspaces.nextSpace', 'workspaces.prevSpace', 'profiles.spacesOn', 'profiles.spacesOnPlain'];
const params = (text: string) => [...text.matchAll(/\{(\w+)/g)].map(match => match[1]).sort();

test('the founder\'s words for profiles as spaces (3 Nov) are in every language, with the parameters English has', () => {
  const en = catalog('en');
  const ids = ['profiles.switchAnyway', 'workspaces.tabsStayInProfile', 'workspaces.openInProfile', 'workspaces.spaceHud', 'profiles.spacesOff', ...SPACE_NAMES];
  assert.equal(en['workspaces.spaceChip'], 'Space: {name}');
  assert.equal(en['workspaces.nextSpace'], 'Next space');
  assert.equal(en['profiles.switchAnyway'], 'Switch anyway');
  assert.equal(en['workspaces.spaceHud'], '{name}, {count, plural, one {# tab} other {# tabs}}');
  for (const { code } of LOCALES) {
    const messages = catalog(code);
    for (const id of ids) {
      assert.ok(messages[id], `${code}: ${id}`);
      assert.deepEqual(params(messages[id]), params(en[id]), `${code}: ${id} parameters`);
    }
  }
});

test('profiles as spaces names a space with its language\'s word for it, never the workspace word, and keeps its words for the rest', () => {
  for (const { code } of LOCALES) {
    const messages = catalog(code), space = SPACE[code];
    assert.ok(space, `${code}: no space word listed`);
    assert.ok(lower(code, messages['profiles.switchSpaces']).includes(space), `${code}: "${messages['profiles.switchSpaces']}" doesn't say ${space}`);
    for (const id of SPACE_NAMES) assert.ok(lower(code, messages[id]).includes(space), `${code}: ${id} doesn't say ${space}: ${messages[id]}`);
    for (const id of ['workspaces.spaceChip', 'workspaces.nextSpace', 'workspaces.prevSpace', 'workspaces.goToSpace', 'workspaces.spaceHud']) assert.ok(!lower(code, messages[id]).includes(lower(code, messages['profiles.switchWorkspaces'])), `${code}: ${id} still says workspace`);
    // The HUD keeps its language's own plural forms; the turn-on toast names tab groups as the rest of Settings does.
    assert.equal(messages['workspaces.spaceHud'].slice(messages['workspaces.spaceHud'].indexOf('{count')), messages['workspaces.hud'].slice(messages['workspaces.hud'].indexOf('{count')), `${code}: HUD plural`);
    assert.ok(lower(code, messages['profiles.spacesOn']).includes(stem(code, messages['tabgroupcontrols.tabGroup'])), `${code}: tab groups aren't "${messages['tabgroupcontrols.tabGroup']}"`);
    assert.ok(lower(code, messages['profiles.switchAnyway']).includes(stem(code, messages['profiles.switch'])), `${code}: "${messages['profiles.switchAnyway']}" isn't the verb of "${messages['profiles.switch']}"`);
  }
});

test('Korean calls a profile\'s own window 별도 창, as its Settings do', () => {
  // "Opens in its own window" is 별도 창에서 열림; the turn-off toast said 자체 창, a word Korean used nowhere else.
  const ko = catalog('ko');
  assert.match(ko['profiles.opensOwn'], /별도 창/);
  assert.match(ko['profiles.spacesOff'], /별도 창/);
  for (const [id, text] of Object.entries(ko)) assert.doesNotMatch(text, /자체 창/, id);
});
