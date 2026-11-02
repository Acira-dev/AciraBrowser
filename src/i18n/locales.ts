/** Interface languages. `en` is the source; the rest are translations of the same message ids. */
export const LOCALES = [
  { code: 'en', name: 'English', native: 'English' },
  { code: 'es', name: 'Spanish', native: 'Español' },
  { code: 'fr', name: 'French', native: 'Français' },
  { code: 'de', name: 'German', native: 'Deutsch' },
  { code: 'pt-BR', name: 'Portuguese (Brazil)', native: 'Português (Brasil)' },
  { code: 'it', name: 'Italian', native: 'Italiano' },
  { code: 'ja', name: 'Japanese', native: '日本語' },
  { code: 'zh-CN', name: 'Chinese (Simplified)', native: '简体中文' },
  { code: 'ar', name: 'Arabic', native: 'العربية' },
  { code: 'tr', name: 'Turkish', native: 'Türkçe' },
  { code: 'ru', name: 'Russian', native: 'Русский' },
  { code: 'ko', name: 'Korean', native: '한국어' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी' },
] as const;
export type LocaleCode = typeof LOCALES[number]['code'];
export const LANGUAGE_CHOICES = ['system', ...LOCALES.map(locale => locale.code)] as string[];

/** The shipped locale for a setting ('system' or a code) and the system's language tag (en-US, pt-PT, zh-TW…). */
export function resolveLocale(setting: string | undefined, systemTag = 'en'): LocaleCode {
  const wanted = !setting || setting === 'system' ? systemTag : setting;
  const exact = LOCALES.find(locale => locale.code.toLowerCase() === wanted.toLowerCase());
  if (exact) return exact.code;
  const language = wanted.toLowerCase().split(/[-_]/)[0];
  if (language === 'pt') return 'pt-BR';
  if (language === 'zh') return 'zh-CN';
  return LOCALES.find(locale => locale.code.toLowerCase() === language)?.code ?? 'en';
}
