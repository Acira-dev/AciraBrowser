import { currentLocale, t } from '../../i18n';

/** 14.3, the panel's time: "now", then minutes, hours and days in the interface's language, short and without "ago" ("2 min", "3 h", "2 d";
 *  Intl's narrow units). */
export function ago(at: number, now = Date.now(), locale = currentLocale()): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return t('sitenotes.now');
  const unit = (value: number, name: 'minute' | 'hour' | 'day') => { try { return new Intl.NumberFormat(locale, { style: 'unit', unit: name, unitDisplay: 'narrow' }).format(value); } catch { return `${value}`; } };
  const minutes = Math.round(seconds / 60); if (minutes < 60) return unit(minutes, 'minute');
  const hours = Math.round(minutes / 60); if (hours < 24) return unit(hours, 'hour');
  return unit(Math.round(hours / 24), 'day');
}
