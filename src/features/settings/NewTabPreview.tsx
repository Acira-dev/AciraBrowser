import { useNewTabPreferences } from '../../ui/newTabPreferences';
import type { BrowserProfile } from '../../runtime/types';
import './new-tab-preview.css';

import { t } from '../../i18n';
/** A live miniature of this profile's new tab: every switch below changes it the moment it is flipped. */
export function NewTabPreview({ profile }: { profile: BrowserProfile }) {
  const [prefs] = useNewTabPreferences(profile.id, profile.private), on = prefs.modules;
  const name = profile.name || 'Personal';
  return <figure className="ntp" aria-label={t("newtabpreview.previewOfTheNewTab")} data-form-item>
    <svg viewBox="0 0 240 150" className="ntp-svg" focusable="false" aria-hidden="true">
      <rect className="ntp-page" width="240" height="150" rx="8" />
      {on.mark && <circle className="ntp-ink2" cx="120" cy="16" r="4.5" />}
      {on.name && <rect className="ntp-ink2" x="96" y={on.mark ? 26 : 12} width="48" height="5" rx="2.5" />}
      {on.search && <><rect className="ntp-field" x="62" y="34" width="116" height="16" rx="8" /><circle className="ntp-ink3" cx="72" cy="42" r="2.4" /><rect className="ntp-ink3" x="78" y="40.4" width="40" height="3.2" rx="1.6" /></>}
      {on.shortcuts && [0, 1, 2, 3, 4, 5, 6].map((i) => <rect key={i} className="ntp-tile" x={62 + i * 17.5} y="58" width="13" height="13" rx="3.5" />)}
      {on.artwork && <g><rect className="ntp-art" x="74" y={on.shortcuts ? 78 : 60} width="92" height={on.shortcuts ? 56 : 74} rx="4" /><path className="ntp-art2" d={on.shortcuts ? 'M74 124 Q96 108 116 118 T166 112 V130 a4 4 0 0 1 -4 4 H78 a4 4 0 0 1 -4 -4Z' : 'M74 124 Q96 100 116 114 T166 104 V130 a4 4 0 0 1 -4 4 H78 a4 4 0 0 1 -4 -4Z'} /></g>}
      {!on.artwork && (on.saved || on.recent) && [0, 1, 2].map((i) => <rect key={i} className="ntp-ink3" x="74" y={on.shortcuts ? 82 + i * 11 : 64 + i * 11} width={92 - i * 14} height="4" rx="2" />)}
    </svg>
    <figcaption>{t("newtabpreview.caption", { name })}</figcaption>
  </figure>;
}
