import { useEffect, useMemo, useState } from 'react';
import { X } from '../../../components/AppIcons';
import type { SpellcheckStatus } from '../../../runtime/nativeCore';
import { SettingGroup, SettingNote, SettingRow, Select, Switch } from '../controls';
import { native, readable } from '../nativeClient';
import type { SettingsPanel } from '../panels';
import '../native-core.css';

import { t } from '../../../i18n';
let names: Intl.DisplayNames | null = null;
const language = (code: string) => { try { names ??= new Intl.DisplayNames(undefined, { type: 'language' }); return `${names.of(code) ?? code} (${code})`; } catch { return code; } };

function Spelling() {
  const [status, setStatus] = useState<(SpellcheckStatus & { available?: string[] }) | null>(null);
  const [error, setError] = useState('');
  const load = () => native({ type: 'spellcheck.status' }).then((result) => setStatus(result.spellcheck ?? null), (failure) => setError(readable(failure)));
  useEffect(() => { void load(); }, []);
  const apply = (enabled: boolean, languages: string[]) => {
    setError('');
    native({ type: 'spellcheck.set', enabled, languages }).then((result) => setStatus(result.spellcheck ?? null), (failure) => setError(readable(failure)));
  };
  const addable = useMemo(() => (status?.available ?? []).filter((code) => !status?.current.languages.includes(code)).map((code) => ({ value: code, label: language(code) })), [status]);
  if (!status) return error ? <p className="nc-message" data-bad role="alert">{error}</p> : null;
  const { enabled, languages } = status.current;
  return (
    <>
      <SettingGroup>
        <SettingRow id="spellcheck-enabled" title={t("nativeCore.checkSpelling")} detail="Underline misspelled words in text fields. Words are checked on this computer.">
          <Switch checked={enabled} label={t("nativeCore.checkSpelling")} onChange={(next) => apply(next, status.languageMode === 'system' ? [] : languages.length ? languages : ['en-US'])} />
        </SettingRow>
        {status.languageMode === 'selected' && (
          <SettingRow id="spellcheck-languages" title={t("spelling.languages")} detail="Words are accepted if they are correct in any selected language." stacked>
            <div className="nc-chips">
              {languages.map((code) => (
                <span className="nc-chip" key={code}>{language(code)}
                  <button type="button" aria-label={t("spelling.removeCode", { code: language(code) })} disabled={languages.length < 2 && enabled} onClick={() => apply(enabled, languages.filter((item) => item !== code))}><X size={12} /></button>
                </span>
              ))}
              {addable.length > 0 && <Select value="" label={t("spelling.addLanguage")} options={[{ value: '', label: t("spelling.addLanguage") }, ...addable]} onChange={(code) => code && apply(enabled, [...languages, code])} />}
            </div>
          </SettingRow>
        )}
      </SettingGroup>
      {error && <p className="nc-message" data-bad role="alert">{error}</p>}
      <SettingNote>{status.privateMode ? t("spelling.thisPrivateWindowUsesThe") : t("spelling.thisChoiceBelongsToThe")} {t("spelling.addWords")}</SettingNote>
    </>
  );
}

// R3-74: spell checking is a language setting (Chrome, Firefox and macOS all keep it with languages), so it joins the Languages section.
const panel: SettingsPanel = { section: 'Languages', order: 70, Component: Spelling };
export default panel;
